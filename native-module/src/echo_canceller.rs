//! AEC3, as a filter on the microphone path.
//!
//! # Why this, and not the operating system's canceller
//!
//! Both platforms ship one. macOS has `AUVoiceProcessingIO`; Windows has had
//! the Voice Capture DSP (`CLSID_CWMAudioAEC`) since Vista, and Windows 11 adds
//! an AEC APO that is supplied by the hardware vendor and therefore not
//! something we can require. Either would mean a **second microphone path** on
//! each platform, because neither is reachable through `cpal` — an audio unit we
//! take over the device with on one side, COM and a media object on the other,
//! two new entries in `scripts/check-platform.mjs`, and two implementations to
//! keep honest against one shared behaviour.
//!
//! `aec3` is the same algorithm as a *filter*: it takes the two streams this
//! module already captures and hands back a cleaned one. Pure Rust, no C++
//! toolchain (which is what disqualified `webrtc-audio-processing`: meson,
//! ninja and clang, on every machine that runs `npm install`), no second device,
//! no platform branch at all. `cargo check --target x86_64-pc-windows-msvc`
//! passes on the mac this was written on, which is the point of choosing it.
//!
//! # Which stages, and the one that is not optional
//!
//! Only the high-pass filter. Noise suppression and AGC2 are off, because
//! `core/domain/inputLevel.ts`, the VAD in `silence_suppression.rs` and DEC-40's
//! too-quiet detector all measure amplitude on the signal that leaves here, and
//! both of those stages reshape it. The high-pass filter does not: it removes DC
//! and rumble below the band the transcriber uses.
//!
//! It is also **mandatory**, and nothing in the crate says so. ERLE over the
//! far-end-only stretches of a 20 s synthetic call — two bursts of client
//! speech either side of a 2 s pause, the rep talking over the second one, a
//! 60 ms echo path with 120 ms of reverb at −6 dB:
//!
//! | stages | first burst | after the pause | after double-talk |
//! |---|---|---|---|
//! | none | 3.8 dB | 1.6 dB | −0.0 dB |
//! | **hpf** | **66.5 dB** | **64.0 dB** | **24.8 dB** |
//! | ns | 2.8 dB | 0.8 dB | −0.3 dB |
//! | agc | −11.2 dB | −8.5 dB | −7.7 dB |
//! | hpf, ns | 72.2 dB | 62.9 dB | 23.9 dB |
//! | hpf, ns, agc | 57.2 dB | 47.9 dB | 10.0 dB |
//!
//! Every row without the high-pass filter has collapsed: the adaptive filter
//! cancels ~66 dB for a second or two, diverges, and never comes back on a
//! signal that never changes. The configuration we need for the DEC-40 reasons
//! above is also, near enough, the best-performing one.
//!
//! **The pauses are what expose it.** Against unbroken far-end speech with no
//! gaps at all, the stage-off filter survives at ~28 dB and the whole finding
//! is invisible — which is how a first draft of the regression test below came
//! to pass with the stage disabled. Meetings have pauses; the test has them
//! now, and `does_not_cancel_without_the_high_pass_filter` is what keeps a
//! version bump from quietly taking the stage away.
//!
//! # What it costs
//!
//! On that same call, per second: converged inside the first second and holding
//! 62–67 dB, 50 dB through the pause, straight back to 66 dB after it. Through
//! double-talk it drops to 7.6–7.9 dB — the rep is attenuated 9 dB, ducked
//! rather than erased, with the residual 9.4 dB below their own voice once lag
//! and scale are fitted out — and recovers 20 → 62 → 63 dB over the three
//! seconds after the overlap ends. Output through silence is exactly zero.
//! Pipeline latency is 128 samples, 8.0 ms.
//!
//! That 9 dB is why `core/domain/channelBleed.ts` stays: a residual the
//! transcriber can still hear is a residual that can still produce a duplicate
//! segment, and the dedup is the backstop. `capture.channelBleed` staying quiet
//! is how we will know this worked.
//!
//! # Failing open
//!
//! DEC-26: everything downstream of capture may fail, and nothing downstream of
//! capture may stop a meeting being recorded. Every failure here — the pipeline
//! refusing to build, a frame the graph rejects, a rate that is not 16 kHz —
//! leaves the microphone samples exactly as they arrived and says so once.

use crate::echo_reference::{self, EchoReference, FRAME, I16_SCALE, REFERENCE_RATE};

use aec3::nodes::audio::AudioFormat;
use aec3::pipelines::linear::LinearPipeline;

/// How often to read AEC3's own metrics out for the log — every 1000 frames,
/// so ten seconds. The numbers are ERLE, the delay the filter settled on, and
/// the render/capture jitter, which between them say whether the thing is
/// working and whether *we* are pacing it correctly.
const METRICS_EVERY_FRAMES: u64 = 1_000;

pub struct EchoCanceller {
    pipeline: LinearPipeline,
    render: Vec<f32>,
    capture: Vec<f32>,
    output: Vec<f32>,
    /// The reference generation this filter's adaptation belongs to. A change
    /// means the far end moved to a different device and the echo path we spent
    /// a second learning describes a route that no longer exists.
    generation: Option<u64>,
    frames: u64,
    /// Set by the first hard failure, and never cleared.
    ///
    /// A graph that rejects one frame rejects all of them, so retrying at 100 Hz
    /// for the rest of the meeting buys nothing and a log line per frame would
    /// bury the meeting it broke. Failing open means *stopping*: from here the
    /// microphone passes through exactly as it arrives (DEC-26).
    failed: bool,
}

impl EchoCanceller {
    /// Builds the canceller, or `None` if the graph will not construct — in
    /// which case the caller runs without one.
    ///
    /// `rate` must be `REFERENCE_RATE`. The capture paths fall through to
    /// passthrough at the hardware rate when their resampler fails to build,
    /// and a canceller told 16 kHz while being fed 48 kHz would be cancelling
    /// against a reference three times too fast.
    pub fn new(rate: u32) -> Option<Self> {
        if rate != REFERENCE_RATE {
            println!(
                "[EchoCanceller] Not enabled: pipeline is at {rate}Hz, the reference bus is {REFERENCE_RATE}Hz."
            );
            return None;
        }

        let format = AudioFormat::ten_ms(REFERENCE_RATE, 1);
        let pipeline = aec3::pipelines::linear::builder(format, format)
            // See the table above. `true` here is load-bearing.
            .enable_high_pass_filter(true)
            .enable_noise_suppression(false)
            .enable_gain_controller2(false)
            .export_metrics(true)
            .build();

        match pipeline {
            Ok(pipeline) => {
                println!(
                    "[EchoCanceller] AEC3 ready at {REFERENCE_RATE}Hz (high-pass on, NS and AGC off)."
                );
                Some(Self {
                    pipeline,
                    render: vec![0.0; FRAME],
                    capture: vec![0.0; FRAME],
                    output: vec![0.0; FRAME],
                    generation: None,
                    frames: 0,
                    failed: false,
                })
            }
            Err(e) => {
                eprintln!("[EchoCanceller] AEC3 pipeline failed to build ({e}); microphone runs uncancelled.");
                None
            }
        }
    }

    /// Cancels the far end out of one block of microphone samples, in place.
    ///
    /// `block.len()` must be a whole number of 10 ms frames; anything else is
    /// left untouched. Called from the microphone DSP thread on the 20 ms chunk
    /// it is about to hand the silence suppressor — **before** it, because a
    /// canceller fed a gated signal cannot hold adaptation, and the gated frames
    /// are exactly the ones whose echo is still arriving.
    pub fn process(&mut self, block: &mut [i16]) {
        self.process_with(echo_reference::global(), block)
    }

    fn process_with(&mut self, reference: &EchoReference, block: &mut [i16]) {
        if self.failed || !reference.is_publishing() {
            // No far end, so no echo — and the high-pass filter has no business
            // touching a signal there was nothing to cancel out of.
            return;
        }
        if block.is_empty() || !block.len().is_multiple_of(FRAME) {
            self.give_up(&format!(
                "block of {} samples is not a whole number of {FRAME}-sample frames",
                block.len()
            ));
            return;
        }

        let generation = reference.generation();
        if self.generation != Some(generation) {
            if self.generation.is_some() {
                println!("[EchoCanceller] Far end restarted; resetting the adaptive filter.");
                if let Err(e) = self.pipeline.reset_aec3() {
                    self.give_up(&format!("reset failed: {e}"));
                    return;
                }
            }
            self.generation = Some(generation);
        }

        for chunk in block.chunks_mut(FRAME) {
            reference.pop_frame(&mut self.render);
            for (dst, &src) in self.capture.iter_mut().zip(chunk.iter()) {
                *dst = src as f32 / I16_SCALE;
            }

            if let Err(e) = self.pipeline.handle_render_frame(&self.render) {
                self.give_up(&format!("render frame rejected: {e}"));
                return;
            }
            match self
                .pipeline
                .process_capture_frame(&self.capture, &mut self.output)
            {
                // `false` is the pipeline's own priming latency — 8 ms of it,
                // once, at the start of a meeting. It filled `output` with
                // silence, which is not what we want written back over real
                // audio, so those first samples pass through instead.
                Ok(true) => {
                    for (dst, &src) in chunk.iter_mut().zip(self.output.iter()) {
                        *dst = (src * I16_SCALE).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
                    }
                }
                Ok(false) => {}
                Err(e) => {
                    self.give_up(&format!("capture frame rejected: {e}"));
                    return;
                }
            }

            self.frames += 1;
            if self.frames.is_multiple_of(METRICS_EVERY_FRAMES) {
                self.log_metrics(reference);
            }
        }
    }

    fn log_metrics(&mut self, reference: &EchoReference) {
        let metrics = match self.pipeline.try_pull_metrics() {
            Ok(Some(packet)) => *packet.payload(),
            _ => return,
        };
        let stats = reference.stats();
        println!(
            "[EchoCanceller] ERLE {:.1} dB, ERL {:.1} dB, delay {} ms | reference: depth {} ms, {} starved, {} trimmed, render/capture jitter {}..{}",
            metrics.echo_return_loss_enhancement,
            metrics.echo_return_loss,
            metrics.delay_ms,
            stats.depth_ms,
            stats.starved_frames,
            stats.trimmed_frames,
            metrics.render_jitter_min,
            metrics.render_jitter_max,
        );
    }

    /// Records a hard failure and stops. There is no path back on: see `failed`.
    fn give_up(&mut self, what: &str) {
        if self.failed {
            return;
        }
        self.failed = true;
        eprintln!("[EchoCanceller] {what}; microphone runs uncancelled from here.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::echo_reference::EchoReference;

    const RATE: usize = REFERENCE_RATE as usize;

    /// Two different mouths. Real formant sets — a close /i/ for the client, an
    /// open /a/ for the rep — and the difference between them is what a spectral
    /// echo suppressor uses to keep one voice and remove the other.
    ///
    /// **The client's 270 Hz first formant is load-bearing**, and a draft of
    /// this file that invented rounder numbers (520 Hz) hid the whole finding:
    /// with the energy moved up out of the bottom octave, the canceller holds
    /// 70 dB *without* the high-pass filter and
    /// `does_not_cancel_without_the_high_pass_filter` passes with the stage
    /// disabled. Low-frequency energy is what destabilises the adaptive filter,
    /// which is presumably why removing it is not optional.
    const FAR_FORMANTS: [f32; 3] = [270.0, 2290.0, 3010.0];
    const REP_FORMANTS: [f32; 3] = [730.0, 1090.0, 2440.0];

    /// Deterministic noise. No `rand` dependency, no run-to-run variation.
    struct Lcg(u64);
    impl Lcg {
        fn next_f32(&mut self) -> f32 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((self.0 >> 33) as f32 / (1u32 << 31) as f32) - 1.0
        }
    }

    /// Speech-shaped: three formant resonances excited by noise, under a
    /// syllabic envelope.
    ///
    /// **Three, and not one, and that distinction decides the double-talk
    /// result.** A single narrow resonance is the pathological input for any
    /// spectral echo suppressor: two talkers on one narrow band are not
    /// separable by a gain mask, so the first version of this measurement showed
    /// the near-end talker being destroyed and that was the test's fault, not
    /// the canceller's. Real speech is broadband, and two people have different
    /// formants — which is exactly the structure the suppressor uses to keep one
    /// and remove the other.
    fn voice(seed: u64, formants: [f32; 3], total: usize, active: impl Fn(usize) -> bool) -> Vec<f32> {
        let mut rng = Lcg(seed);
        let mut out = vec![0.0f32; total];
        let r = 0.96f32;
        let mut state = [(0.0f32, 0.0f32); 3];
        let coef: Vec<(f32, f32)> = formants
            .iter()
            .map(|f| {
                let w = 2.0 * std::f32::consts::PI * f / RATE as f32;
                (2.0 * r * w.cos(), -r * r)
            })
            .collect();

        for (n, slot) in out.iter_mut().enumerate() {
            let excite = if active(n) { rng.next_f32() } else { 0.0 };
            let mut sample = 0.0;
            for (k, (a1, a2)) in coef.iter().enumerate() {
                let (y1, y2) = state[k];
                let y = excite + a1 * y1 + a2 * y2;
                state[k] = (y, y1);
                // Falling weight per formant — speech's spectral tilt.
                sample += y / (k + 1) as f32;
            }
            let syl = 0.5 + 0.5 * (2.0 * std::f32::consts::PI * 4.0 * n as f32 / RATE as f32).sin();
            *slot = sample * syl;
        }

        /*
         * Normalised to a real speech amplitude, and that is not cosmetic. The
         * resonators' own gain put the first run of this measurement at rms 4.5
         * with peaks well past ±1.0 — float full scale — which trips the
         * canceller's saturation handling and made it suppress the near-end
         * talker by 18 dB. `core/domain/inputLevel.ts` measures real speech
         * between 0.02 and 0.15 on this scale; 0.06 is the middle of that.
         */
        let live: Vec<f32> = out.iter().copied().filter(|s| *s != 0.0).collect();
        if !live.is_empty() {
            let rms = (live.iter().map(|s| s * s).sum::<f32>() / live.len() as f32).sqrt();
            if rms > 0.0 {
                for s in out.iter_mut() {
                    *s *= 0.06 / rms;
                }
            }
        }
        /*
         * A guard, because this measurement has lied twice. A silent talker made
         * `live` empty, `0.06 / 0.0` infinite and `0.0 * inf` NaN — so every
         * control run came back as a column of dashes that read exactly like
         * flawless cancellation. An unchecked NaN in a measurement is worse than
         * a wrong number: a wrong number gets questioned.
         */
        assert!(out.iter().all(|s| s.is_finite()), "voice() produced non-finite samples");
        out
    }

    /// Speakers → air → microphone: a pure delay, then an exponentially
    /// decaying tail. 60 ms of latency and 120 ms of reverb is an ordinary
    /// laptop in an ordinary meeting room.
    ///
    /// The 120 ms is not a round number picked for realism — it is load-bearing
    /// for `does_not_cancel_without_the_high_pass_filter`. A first draft of this
    /// test used a 25 ms tail to keep the convolution cheap, and with that tail
    /// the filter cancels 27 dB *without* the high-pass stage, which would have
    /// read as "the stage does not matter". Under a real room's reverb it does.
    fn echo_path(far: &[f32], delay: usize, gain: f32) -> Vec<f32> {
        let taps = RATE * 12 / 100; // 120 ms
        let mut ir = vec![0.0f32; taps];
        let mut rng = Lcg(99);
        for (i, tap) in ir.iter_mut().enumerate() {
            *tap = rng.next_f32() * (-6.0 * i as f32 / taps as f32).exp();
        }
        let mut out = vec![0.0f32; far.len()];
        for n in delay..far.len() {
            let mut acc = 0.0;
            for (i, tap) in ir.iter().enumerate() {
                if n < delay + i {
                    break;
                }
                acc += tap * far[n - delay - i];
            }
            out[n] = acc;
        }

        /*
         * Normalise the echo, not the impulse response — and that distinction
         * cost a whole run. Scaling the IR to unit energy is only correct for
         * white input; against a narrowband voice the response at that one
         * frequency is a lottery, and one draw came out 10× hot, which put the
         * echo *above* the far signal and made the canceller look useless. What
         * we want to state is the physical quantity: how loud the speakers are
         * in the microphone, relative to the far signal itself.
         */
        let far_rms = (far.iter().map(|s| s * s).sum::<f32>() / far.len() as f32).sqrt();
        let out_rms = (out.iter().map(|s| s * s).sum::<f32>() / out.len() as f32).sqrt();
        let scale = gain * far_rms / out_rms.max(f32::EPSILON);
        for s in out.iter_mut() {
            *s *= scale;
        }
        out
    }

    fn to_i16(signal: &[f32]) -> Vec<i16> {
        signal
            .iter()
            .map(|s| (s * I16_SCALE).clamp(i16::MIN as f32, i16::MAX as f32) as i16)
            .collect()
    }

    fn rms_i16(block: &[i16]) -> f32 {
        if block.is_empty() {
            return 0.0;
        }
        let sum: f64 = block.iter().map(|&s| (s as f64 / 32768.0).powi(2)).sum();
        (sum / block.len() as f64).sqrt() as f32
    }

    fn db(num: f32, den: f32) -> f32 {
        if den <= 0.0 || num <= 0.0 {
            return f32::NAN;
        }
        10.0 * (num / den).log10()
    }

    /// Runs `mic` through a canceller fed `far`, exactly as the microphone DSP
    /// thread does: 20 ms chunks, reference published ahead of each one.
    fn run(far: &[f32], mic: &[f32], high_pass: bool) -> Vec<i16> {
        let reference = EchoReference::detached();
        let generation = reference.open();

        let format = AudioFormat::ten_ms(REFERENCE_RATE, 1);
        let pipeline = aec3::pipelines::linear::builder(format, format)
            .enable_high_pass_filter(high_pass)
            .enable_noise_suppression(false)
            .enable_gain_controller2(false)
            .export_metrics(true)
            .build()
            .expect("pipeline builds");
        let mut canceller = EchoCanceller {
            pipeline,
            render: vec![0.0; FRAME],
            capture: vec![0.0; FRAME],
            output: vec![0.0; FRAME],
            generation: None,
            frames: 0,
            failed: false,
        };

        let far_i16 = to_i16(far);
        let mut out = to_i16(mic);
        let chunk = FRAME * 2; // the 20 ms the DSP loop actually hands over
        for (i, block) in out.chunks_mut(chunk).enumerate() {
            let lo = i * chunk;
            reference.publish(generation, &far_i16[lo..(lo + block.len()).min(far_i16.len())]);
            canceller.process_with(&reference, block);
        }
        out
    }

    /// ERLE over one window, in dB: how much quieter the microphone got.
    fn erle(mic: &[f32], out: &[i16], from: f32, to: f32) -> f32 {
        let (lo, hi) = ((from * RATE as f32) as usize, (to * RATE as f32) as usize);
        db(rms_i16(&to_i16(&mic[lo..hi])).powi(2), rms_i16(&out[lo..hi]).powi(2))
    }

    /// A laptop with its speakers open: the client talks in two bursts either
    /// side of a pause, the rep is silent. That is the 32 % of rep segments
    /// which were the client's voice on the real call, and it is the case this
    /// whole file exists to remove.
    ///
    /// **The pause is not decoration.** It is the only reason this test can tell
    /// a working canceller from a diverging one — see
    /// `does_not_cancel_without_the_high_pass_filter`.
    fn far_end_with_a_pause() -> (Vec<f32>, Vec<f32>) {
        let total = RATE * 20;
        let far = voice(1, FAR_FORMANTS, total, |n| {
            let s = n as f32 / RATE as f32;
            (1.0..8.0).contains(&s) || (10.0..18.0).contains(&s)
        });
        let echo = echo_path(&far, RATE * 60 / 1000, 0.5);
        (far, echo)
    }

    #[test]
    fn cancels_the_far_end_out_of_the_microphone() {
        let (far, echo) = far_end_with_a_pause();
        let out = run(&far, &echo, true);

        let first = erle(&echo, &out, 2.0, 7.0);
        let after_pause = erle(&echo, &out, 11.0, 17.0);
        println!("first burst {first:.1} dB, after the pause {after_pause:.1} dB");
        assert!(first > 30.0, "did not converge on the first burst: {first:.1} dB");
        assert!(
            after_pause > 30.0,
            "cancellation was lost across the pause: {after_pause:.1} dB"
        );
    }

    /// The finding that is in no documentation, and the reason
    /// `enable_high_pass_filter(true)` above is not a stylistic choice: the same
    /// signal, the same canceller, that one stage removed.
    ///
    /// If a version bump ever makes the high-pass filter unnecessary this test
    /// fails — which is the right outcome, because it is the only way we would
    /// find out.
    #[test]
    fn does_not_cancel_without_the_high_pass_filter() {
        let (far, echo) = far_end_with_a_pause();

        let with = erle(&echo, &run(&far, &echo, true), 11.0, 17.0);
        let without = erle(&echo, &run(&far, &echo, false), 11.0, 17.0);
        println!("high-pass on {with:.1} dB, off {without:.1} dB");

        assert!(
            without < 10.0,
            "the high-pass filter may no longer be load-bearing — {without:.1} dB with the \
             stage off. Re-measure the stage matrix in this file's docblock before relaxing \
             anything."
        );
        assert!(
            with - without > 20.0,
            "expected the stage to be worth tens of dB; got {with:.1} on and {without:.1} off"
        );
    }

    /// Double-talk: both of them speaking at once. The canceller is allowed to
    /// duck the rep — it cannot tell the two apart perfectly — and is not
    /// allowed to erase them, because the rep's own words are the ones the
    /// compte-rendu is written from.
    ///
    /// The threshold is set at erasure, not at the measured value, and the gap
    /// between the two is mostly measurement. This is a raw energy ratio, so it
    /// charges the canceller for the pipeline's own 8 ms of delay as though the
    /// rep had been attenuated by it; fitting lag and scale out first — which
    /// the bench does and this test does not — put the residual 9.4 dB below the
    /// rep where the raw ratio says 13.7.
    #[test]
    fn the_rep_survives_double_talk() {
        let total = RATE * 8;
        let far = voice(1, FAR_FORMANTS, total, |_| true);
        let echo = echo_path(&far, RATE * 60 / 1000, 0.5);
        // The rep talks through the second half, over the far end.
        let rep = voice(7, REP_FORMANTS, total, |n| n > total / 2);
        let mic: Vec<f32> = echo.iter().zip(rep.iter()).map(|(e, r)| e + r).collect();

        let out = run(&far, &mic, true);

        let (lo, hi) = ((RATE as f32 * 5.0) as usize, (RATE as f32 * 8.0) as usize);
        let rep_level = rms_i16(&to_i16(&rep[lo..hi]));
        let kept = rms_i16(&out[lo..hi]);
        let attenuation = db(rep_level.powi(2), kept.powi(2));
        println!("rep attenuated {attenuation:.1} dB through double-talk");
        assert!(
            attenuation < 20.0,
            "the rep was attenuated {attenuation:.1} dB during double-talk — that is erasure, \
             not ducking"
        );
    }

    /// No far-end capture running: a meeting with the microphone alone, or the
    /// stretch before system audio finishes initialising. Nothing to cancel, so
    /// nothing may change — not even the high-pass filter, which would otherwise
    /// silently alter every sample of a signal that has no echo in it.
    #[test]
    fn passes_the_microphone_through_untouched_with_no_far_end() {
        let reference = EchoReference::detached(); // never opened
        let mut canceller = EchoCanceller::new(REFERENCE_RATE).expect("pipeline builds");

        let mic = voice(7, REP_FORMANTS, RATE, |_| true);
        let original = to_i16(&mic);
        let mut block = original.clone();
        for chunk in block.chunks_mut(FRAME * 2) {
            canceller.process_with(&reference, chunk);
        }
        assert_eq!(block, original, "the microphone was altered with no far end to cancel");
    }

    /// A rate the reference bus does not speak. Both capture paths fall through
    /// to passthrough at the hardware rate when their resampler will not build,
    /// and a canceller that accepted that would be cancelling against a
    /// reference running three times too fast.
    #[test]
    fn refuses_a_rate_that_is_not_the_reference_rate() {
        assert!(EchoCanceller::new(48_000).is_none());
        assert!(EchoCanceller::new(REFERENCE_RATE).is_some());
    }
}
