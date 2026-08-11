//! The far end, made available to the microphone path as an echo reference.
//!
//! On a laptop with its speakers open the microphone hears the far end, so the
//! client is transcribed twice — once correctly on `far`, once as the rep.
//! Measured on a real call: 62 of 193 rep segments, and an earlier stretch of
//! the same meeting ran at 63 %. `core/domain/channelBleed.ts` drops the rep
//! copy at read time, which keeps the compte-rendu honest but leaves the
//! microphone genuinely full of somebody else's voice.
//!
//! Cancelling it needs the far-end signal, and the two capture objects that
//! hold the two halves are independent `#[napi]` instances created separately
//! by JS, on separate threads, with no reference to one another. This module is
//! the one seam between them: `SystemAudioCapture` publishes what it captured,
//! `MicrophoneCapture` pops it back out a frame at a time as AEC3's reference.
//!
//! # Why a process global rather than a handle threaded through
//!
//! Because the alternative is a napi-visible object that JS has to create,
//! own, and pass to both captures — a new lifetime to get wrong across a device
//! switch, in a layer that has no business knowing that echo cancellation
//! exists. Both captures are singletons in practice, `generation` covers the
//! device-switch case that would otherwise motivate an explicit handle, and
//! nothing here is reachable from JS at all.
//!
//! # Pacing
//!
//! Two independently-clocked capture paths. The microphone path is the clock
//! master: it pops **exactly one** 10 ms reference frame per 10 ms of capture,
//! so AEC3 sees a strict 1:1 render/capture cadence, which is the cadence its
//! own delay estimator is happiest with.
//!
//! That leaves two ways for the reference to drift out from under it, and each
//! is bounded here rather than left to AEC3:
//!
//!  - **Dry** — the far end produced nothing (nobody is talking, or the
//!    loopback simply does not deliver buffers through silence, which differs
//!    per platform and per driver). We hand AEC3 silence. This costs nothing:
//!    a dry ring means there is no backlog to push *later*, so the reference
//!    timeline does not stretch.
//!  - **Backlogged** — the far end ran ahead, or this thread stalled. Now the
//!    frame we would pop is old, and a reference that arrives *after* the echo
//!    it is supposed to explain is one AEC3 cannot use: the filter is causal.
//!    Past `HIGH_WATER` we throw the backlog away and resume at `TRIM_TARGET`.
//!    That is a discontinuity and the canceller will re-converge through it —
//!    it took under a second to do so on the bench — which is strictly better
//!    than cancelling against a reference that is permanently late.
//!
//! Between those two rules the reference stays within `[0, HIGH_WATER)` of real
//! time for the length of a meeting, with no clock discipline and no drift
//! estimator of our own.
//!
//! # Threading
//!
//! A plain `Mutex`. Both sides of this run on the *DSP* threads, never on an
//! audio callback: the callbacks feed lock-free `ringbuf`s and return. Nothing
//! here is in a realtime context, so there is no reason to pay for a lock-free
//! structure — and a poisoned mutex is recovered with `into_inner` rather than
//! unwrapped, because a panic somewhere else must not take capture down with it
//! (DEC-26: nothing downstream may stop a meeting being recorded).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use once_cell::sync::Lazy;

/// The only rate the reference is ever published or read at. Both capture paths
/// already resample to it (`CANONICAL_STT_RATE`), and when either one cannot —
/// resampler construction failed and it fell through to passthrough at the
/// hardware rate — that path opts out of this bus entirely rather than
/// publishing samples at a rate the other side would misread.
pub const REFERENCE_RATE: u32 = 16_000;

/// 10 ms at 16 kHz: AEC3's frame size, and therefore the unit of everything
/// here. A pop is all-or-nothing at this granularity.
pub const FRAME: usize = 160;

/// Hard ceiling on the ring — 2 s. Only reachable when a publisher is running
/// and nothing is consuming (a meeting with system audio but no microphone),
/// where it caps the ring instead of growing without bound for the length of
/// the call.
const CAPACITY: usize = REFERENCE_RATE as usize * 2;

/// How late the reference may get before we stop believing it (120 ms). Chosen
/// above any plausible scheduling hiccup between two DSP threads that both poll
/// every 5 ms, and below the point where AEC3's delay search would lose it.
const HIGH_WATER: usize = REFERENCE_RATE as usize * 120 / 1000;

/// Where a trim resumes from (20 ms). Not zero: a ring trimmed to empty starves
/// on the very next pop, and one starved frame per trim is a gap in the
/// reference for no gain.
const TRIM_TARGET: usize = FRAME * 2;

/// What the far-end capture path has produced, and how far behind it the
/// microphone path currently is. Read for diagnostics; never used to make a
/// decision.
#[derive(Debug, Clone, Copy)]
pub struct EchoReferenceStats {
    /// Bumped every time a publisher opens. A change means the far-end stream
    /// restarted underneath the canceller — a device switch mid-meeting — and
    /// the adaptive filter is holding an echo path that no longer exists.
    pub generation: u64,
    /// A far-end capture is open and publishing.
    pub publishing: bool,
    /// Reference currently queued, in milliseconds. Sits near zero in the
    /// steady state; approaching `HIGH_WATER` means this side is falling behind.
    pub depth_ms: u32,
    pub published_frames: u64,
    /// Pops that found the ring dry and handed AEC3 silence.
    pub starved_frames: u64,
    /// Frames thrown away by a `HIGH_WATER` trim.
    pub trimmed_frames: u64,
}

pub struct EchoReference {
    ring: Mutex<VecDeque<f32>>,
    publishing: AtomicBool,
    generation: AtomicU64,
    published_frames: AtomicU64,
    starved_frames: AtomicU64,
    trimmed_frames: AtomicU64,
}

static REFERENCE: Lazy<EchoReference> = Lazy::new(EchoReference::new);

/// The process-wide reference bus.
pub fn global() -> &'static EchoReference {
    &REFERENCE
}

impl EchoReference {
    fn new() -> Self {
        Self {
            ring: Mutex::new(VecDeque::with_capacity(CAPACITY)),
            publishing: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            published_frames: AtomicU64::new(0),
            starved_frames: AtomicU64::new(0),
            trimmed_frames: AtomicU64::new(0),
        }
    }

    /// A bus that is not the global one, for tests that would otherwise fight
    /// each other over shared state. Deliberately test-only: production has
    /// exactly one far end, and a second bus nobody publishes to would be a
    /// canceller cancelling against silence.
    #[cfg(test)]
    pub(crate) fn detached() -> Self {
        Self::new()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, VecDeque<f32>> {
        // A panic on the other thread poisons the mutex. Recover the queue
        // rather than propagate: the worst case is a few stale samples, and the
        // alternative is capture dying because of a fault somewhere else.
        self.ring.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Declares a far-end capture open. Discards whatever the previous one left
    /// behind and bumps `generation` so the consumer resets its filter.
    ///
    /// Returns the generation the caller now owns; hand it back to
    /// [`close`](Self::close) when the stream ends.
    pub fn open(&self) -> u64 {
        self.lock().clear();
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.publishing.store(true, Ordering::Release);
        generation
    }

    /// Declares a far-end capture closed. The consumer sees `publishing` false
    /// and stops running the canceller at all — with no far end there is no
    /// echo, and a microphone with nothing to cancel out of it should come
    /// through untouched.
    ///
    /// **Scoped to the generation `open` returned, and that is not bookkeeping.**
    /// `SystemAudioCapture.stop()` on the JS side defers the blocking native
    /// teardown into a `setImmediate` and only resolves once it has run, so a
    /// caller that restarts capture without awaiting it — a mid-meeting output
    /// device switch is the case that would — leaves the *dying* thread to call
    /// this after the new one has already opened. An unscoped close would then
    /// wipe the live reference and leave `publishing` false for the rest of the
    /// call, with echo cancellation silently off and nothing to say so. A late
    /// close from a generation that no longer owns the bus does nothing.
    pub fn close(&self, generation: u64) {
        if self.generation() != generation {
            return;
        }
        self.publishing.store(false, Ordering::Release);
        self.lock().clear();
    }

    pub fn is_publishing(&self) -> bool {
        self.publishing.load(Ordering::Acquire)
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    /// Publishes far-end samples at `REFERENCE_RATE`, as captured — before the
    /// silence suppressor, which is the point. A canceller fed a gated,
    /// discontinuous reference cannot hold adaptation, and a suppressed frame
    /// is exactly the frame whose echo is still arriving at the microphone.
    ///
    /// Scoped to `generation` for the same reason [`close`](Self::close) is: the
    /// other half of the overlapping-restart race is a *dying* stream still
    /// pushing samples into the ring its replacement just cleared. Both streams
    /// carry the same system output, so the damage is a time-shifted
    /// discontinuity rather than wrong audio — but it would land as an
    /// unexplained loss of cancellation seconds after a device switch, which is
    /// the hardest kind of thing to ever find.
    pub fn publish(&self, generation: u64, samples: &[i16]) {
        if samples.is_empty() || !self.is_publishing() || self.generation() != generation {
            return;
        }
        let mut ring = self.lock();
        for &s in samples {
            ring.push_back(s as f32 / I16_SCALE);
        }
        if ring.len() > CAPACITY {
            let excess = ring.len() - CAPACITY;
            ring.drain(0..excess);
        }
        self.published_frames
            .fetch_add((samples.len() / FRAME) as u64, Ordering::Relaxed);
    }

    /// Pops one 10 ms reference frame into `out`, which must be `FRAME` long.
    ///
    /// Returns whether the frame came from the far end. `false` means the ring
    /// was dry and `out` is silence — which is the honest answer, not a
    /// failure: for most of a meeting the far end genuinely is not talking.
    pub fn pop_frame(&self, out: &mut [f32]) -> bool {
        debug_assert_eq!(out.len(), FRAME);
        let mut ring = self.lock();

        // Counters are bumped under the lock rather than after releasing it. A
        // relaxed atomic costs nothing next to the `drain` above it, and the
        // alternative — drop, add, re-acquire — opens a window in which the
        // depth this call just corrected has already changed again.
        if ring.len() > HIGH_WATER {
            let excess = ring.len() - TRIM_TARGET;
            ring.drain(0..excess);
            self.trimmed_frames
                .fetch_add((excess / FRAME) as u64, Ordering::Relaxed);
        }

        if ring.len() < out.len() {
            out.fill(0.0);
            self.starved_frames.fetch_add(1, Ordering::Relaxed);
            return false;
        }

        for slot in out.iter_mut() {
            *slot = ring.pop_front().unwrap_or(0.0);
        }
        true
    }

    pub fn stats(&self) -> EchoReferenceStats {
        let depth = self.lock().len();
        EchoReferenceStats {
            generation: self.generation(),
            publishing: self.is_publishing(),
            depth_ms: (depth * 1000 / REFERENCE_RATE as usize) as u32,
            published_frames: self.published_frames.load(Ordering::Relaxed),
            starved_frames: self.starved_frames.load(Ordering::Relaxed),
            trimmed_frames: self.trimmed_frames.load(Ordering::Relaxed),
        }
    }
}

/// i16 full scale. Used in both directions so the round trip is exact to within
/// one rounding step, rather than the 32767/32768 mismatch that creeps in when
/// each direction picks its own constant.
pub const I16_SCALE: f32 = 32_768.0;

#[cfg(test)]
mod tests {
    use super::*;

    /// The global is shared, so these tests drive a private instance instead —
    /// `EchoReference::detached()` is the same object the global is built from.
    /// Returns the bus and the generation a publisher would hold.
    fn fresh() -> (EchoReference, u64) {
        let r = EchoReference::detached();
        let generation = r.open();
        (r, generation)
    }

    fn ramp(n: usize, from: i16) -> Vec<i16> {
        (0..n).map(|i| from.wrapping_add(i as i16)).collect()
    }

    #[test]
    fn pops_back_exactly_what_was_published() {
        let (r, g) = fresh();
        r.publish(g, &ramp(FRAME, 100));
        let mut out = vec![0.0; FRAME];
        assert!(r.pop_frame(&mut out));
        for (i, &s) in out.iter().enumerate() {
            assert!(
                (s - (100 + i as i16) as f32 / I16_SCALE).abs() < 1e-9,
                "sample {i} came back changed"
            );
        }
    }

    #[test]
    fn a_dry_ring_yields_silence_and_does_not_consume() {
        let (r, g) = fresh();
        // Half a frame in: not enough, so the pop must not take it.
        r.publish(g, &ramp(FRAME / 2, 1));
        let mut out = vec![9.0; FRAME];
        assert!(!r.pop_frame(&mut out));
        assert!(out.iter().all(|&s| s == 0.0), "starved frame must be silent");
        assert_eq!(r.stats().starved_frames, 1);

        // The rest arrives; the frame is now whole and nothing was lost.
        r.publish(g, &ramp(FRAME / 2, 1 + (FRAME / 2) as i16));
        assert!(r.pop_frame(&mut out));
        assert!((out[0] - 1.0 / I16_SCALE).abs() < 1e-9, "the half-frame was dropped");
    }

    #[test]
    fn a_backlog_past_high_water_is_trimmed_to_the_most_recent_audio() {
        let (r, g) = fresh();
        // 200 ms queued — the microphone path stalled, or the far end ran ahead.
        let n = REFERENCE_RATE as usize * 200 / 1000;
        r.publish(g, &ramp(n, 0));
        assert!(r.stats().depth_ms >= 190);

        let mut out = vec![0.0; FRAME];
        assert!(r.pop_frame(&mut out));

        // What came back is the END of the backlog, not its start: the trim
        // exists to stop us cancelling against a reference that is already late.
        let expected_first = (n - TRIM_TARGET) as i16;
        assert!(
            (out[0] - expected_first as f32 / I16_SCALE).abs() < 1e-9,
            "expected the trim to resume near the newest sample, got {}",
            out[0] * I16_SCALE
        );
        assert!(r.stats().trimmed_frames > 0);
        assert!(r.stats().depth_ms < 120, "still backlogged after a trim");
    }

    #[test]
    fn the_ring_is_capped_when_nothing_consumes_it() {
        let (r, g) = fresh();
        // Ten seconds published with no consumer at all.
        for _ in 0..10 {
            r.publish(g, &vec![1; REFERENCE_RATE as usize]);
        }
        assert!(
            r.stats().depth_ms <= 2000,
            "ring grew past its cap: {} ms",
            r.stats().depth_ms
        );
    }

    #[test]
    fn closing_stops_publication_and_opening_bumps_the_generation() {
        let r = EchoReference::detached();
        let first = r.open();

        r.close(first);
        assert!(!r.is_publishing());
        r.publish(first, &ramp(FRAME, 1));
        let mut out = vec![0.0; FRAME];
        assert!(!r.pop_frame(&mut out), "a closed reference must stay dry");

        let second = r.open();
        assert!(r.is_publishing());
        assert!(
            second > first,
            "the consumer has no other way to know the far end restarted"
        );
    }

    /// The output device changed mid-meeting, JS started the replacement capture
    /// without awaiting the deferred native teardown of the old one, and the
    /// dying thread now calls `close` after the live one has opened. If that
    /// landed, echo cancellation would be off for the rest of the call and
    /// nothing would say so.
    #[test]
    fn a_late_close_from_the_previous_stream_does_not_shut_the_live_one_down() {
        let r = EchoReference::detached();
        let dying = r.open();
        let live = r.open();

        r.close(dying);

        assert!(r.is_publishing(), "the replacement stream was shut down by its predecessor");
        r.publish(live, &ramp(FRAME, 42));
        let mut out = vec![0.0; FRAME];
        assert!(r.pop_frame(&mut out), "the live stream's reference was discarded");

        r.close(live);
        assert!(!r.is_publishing(), "the owning generation must still be able to close");
    }

    #[test]
    fn reopening_discards_the_previous_streams_audio() {
        let (r, g) = fresh();
        r.publish(g, &ramp(FRAME * 4, 1));
        r.open();
        let mut out = vec![0.0; FRAME];
        assert!(
            !r.pop_frame(&mut out),
            "audio from the device we just left must not be cancelled against"
        );
    }
}
