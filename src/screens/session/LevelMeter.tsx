/**
 * The input meter — the surface that answers « est-ce qu'il m'entend ? ».
 *
 * It exists because that question used to be answered by the transcript pane,
 * and the transcript answers it badly: it is seconds late, it is empty during
 * every pause, and an empty pane looks identical whether nobody is talking or
 * the microphone is dead. A meeting once ran for two minutes producing one line
 * — the input volume was at 37 % and every window fell under the transcriber's
 * speech floor — and nothing on screen said so.
 *
 * So the meter draws the measurement, and it draws the floor:
 *
 *   · bars at or above `floor` are audio the transcriber will use — in colour;
 *   · bars under it are audio it will silently drop — grey.
 *
 * A rep dragging their input volume up watches a grey meter turn blue. That is
 * the whole fix for the failure above, without a word of explanation.
 *
 * ## Both channels, one instrument
 *
 * This drew the rep's microphone alone, on the argument that a *second row* of
 * bars beneath the first turned a 128×16px instrument into a texture in the
 * header. That argument was about density and it was right; it is not an
 * argument against showing the far end, and showing the far end answers the
 * question the single row could not: **which of the two sides is not being
 * heard.** A rep watching one row go grey has to guess whether their microphone
 * is too quiet or the call itself is, and those have opposite fixes.
 *
 * So: one row of columns, mirrored about a baseline. Up is the rep, down is the
 * far end, and the bars stay their full width — the density is unchanged, only
 * the height is split. Two shades of the same blue rather than two unrelated
 * hues, because they are the same kind of measurement and neither is a status:
 * a loud client is not a warning, so no semantic colour may be spent here.
 *
 * The direction is what identifies the channel and the colour reinforces it —
 * and the two halves are **named on screen**, in two words, at the left of the
 * bars.
 *
 * That key used to be a `title` attribute, on the argument that a meter needing
 * a legend is not an instrument. The argument holds for a single-channel meter
 * and stops holding the moment there are two: « up » and « down » is a
 * convention, and a convention a rep has not been told is a coin toss on the one
 * reading whose whole value is knowing *which side* is not being heard. A
 * tooltip is not being told — it is hover-only, so it never reaches a keyboard,
 * never reaches a rep mid-call with their hand off the mouse, and is invisible
 * in every screenshot anyone reviews. Two 11px words cost 34px of a header and
 * are true without being pointed at.
 *
 * **It owns its own subscription.** The samples arrive ten times a second, and
 * `Session` holds a live ProseMirror view with the rep's caret in it — lifting
 * this into that component's state would reconcile the notepad's subtree ten
 * times a second, on the one surface where a dropped keystroke is unrecoverable.
 * Same reasoning as `Elapsed`, ten times over.
 */
import { useState } from 'react'
import { useBroadcast } from '../../app/bridge.ts'

/**
 * How many samples are on screen, and the number is set by legibility rather
 * than by how much history would be nice to have.
 *
 * This started at 32 in a 104px strip: 2.3px per bar across two rows, which
 * rendered as a texture — a small blue icon that happened to change. A meter
 * has to be read at a glance from a metre away by someone whose attention is on
 * a client, so the bar has to be a bar. Twenty samples at 100 ms is a
 * two-second window, which is a needle, not a chart, and that is the right
 * instrument for the question it answers.
 *
 * Unchanged by the mirroring, and that is the point of mirroring rather than
 * stacking: splitting the height costs vertical range, which is log-scaled and
 * has it to spare. Splitting the width would have cost bar count, which does
 * not.
 */
const HISTORY = 20

/**
 * The drawn amplitude range, log-scaled.
 *
 * Linear is unusable here: speech lives between roughly 0.02 and 0.15 on a 0…1
 * scale, so a linear meter spends 85 % of its height on volumes no voice ever
 * reaches and renders every utterance as the same stub. On this scale the
 * transcription floor (0.008) lands at 38 % height, which puts the line where a
 * meter's line belongs — inside the range, not scraping the bottom.
 */
const DRAWN_MIN = 0.0008
const DRAWN_MAX = 0.35
const SPAN = Math.log(DRAWN_MAX / DRAWN_MIN)

/** Amplitude → 0…1 of one half of the meter's height. */
export const barHeight = (rms: number): number => {
  if (rms <= DRAWN_MIN) return 0
  return Math.min(1, Math.log(rms / DRAWN_MIN) / SPAN)
}

interface Sample {
  rep: number
  far: number
}

const SILENT: Sample[] = new Array(HISTORY).fill({ rep: 0, far: 0 })

interface LevelMeterProps {
  meetingId: string
}

export function LevelMeter({ meetingId }: LevelMeterProps) {
  const [samples, setSamples] = useState<Sample[]>(SILENT)
  const [floor, setFloor] = useState(0)

  useBroadcast('audio:level', (payload) => {
    if (payload.meetingId !== meetingId) return
    setFloor(payload.floor)
    setSamples((previous) => [...previous.slice(1), { rep: payload.rep, far: payload.far }])
  })

  return (
    <div
      aria-hidden
      /*
       * `aria-hidden`, and deliberately. Twenty bars whose heights change ten
       * times a second is, to a screen reader, a live region firing two hundred
       * times a second, and there is nothing in it that a sentence could not say
       * better. The sentence exists: `capture.level.tooQuiet` raises
       * « niveau d'entrée trop faible pour être transcrit » with the measurement
       * in it. The meter is the glance; the diagnostic is the statement.
       */
            className="flex shrink-0 items-stretch gap-1.5"
    >
      {/*
        The key. Two words, one per half, on the same baselines the bars grow
        from — so the label is not describing the meter, it is *on* the row it
        names. `leading-none` and a fixed half each, or the two words drift off
        the channels they belong to as the meter's height changes.
      */}
      <span className="text-muted flex w-8 shrink-0 flex-col justify-between text-right text-meta leading-none">
        <span>moi</span>
        <span>client</span>
      </span>

      {/*
        148×28 rather than 128×24. This is the whole of DEC-38's proof of life —
        the surface that answers « est-ce qu'il m'entend ? » — and at 2.3px per
        bar over two 11px halves it read as a small blue icon that happened to
        change rather than as a reading. The bar count is unchanged; the bars
        are simply wide enough and tall enough to be a bar.
      */}
      <span className="flex h-7 w-[148px] shrink-0 items-stretch gap-[2px]">
      {samples.map((sample, index) => (
        /*
         * The 1px gutter between the halves is the baseline, and it is drawn by
         * absence rather than by a rule: a 1px line across a 24px strip in a
         * header is invisible at the distance this is read from, while a gap
         * that never closes is legible even when both channels are silent.
         */
        <div key={index} className="flex flex-1 flex-col gap-px">
          <Bar rms={sample.rep} floor={floor} channel="rep" />
          <Bar rms={sample.far} floor={floor} channel="far" />
        </div>
      ))}
      </span>

      {/*
        What grey means. The third and last thing this instrument has to say.

        The channels are named and the floor was not: a rep watching half the
        strip go pale had no way to know whether that was a reading or a style.
        It is the reading DEC-38 exists for — audio the transcriber will drop.
        It was explained in a `title`, which is to say nowhere: hover-only, out
        of reach of a keyboard, out of reach of a rep mid-call with their hand
        off the mouse, and invisible in every screenshot anyone reviews.

        Permanent, and not drawn only while grey is on screen. Speech has gaps,
        so a below-floor reading is on the strip most seconds of most calls, and
        a caption that came and went with it would flicker in the header during a
        client call — which is the one thing DEC-14 says a surface here may not
        do. A key is part of an instrument; it does not blink.

        The swatch is the token the bars use, so the key cannot drift from what
        it names.
      */}
      <span className="text-muted flex shrink-0 items-center gap-1 self-center whitespace-nowrap text-meta leading-none">
        <span aria-hidden className="bg-meter-dropped inline-block h-2 w-2 rounded-[1px]" />
        non transcrit
      </span>
    </div>
  )
}

interface BarProps {
  rms: number
  floor: number
  channel: 'rep' | 'far'
}

/**
 * One channel's reading for one sample, growing away from the baseline.
 *
 * The half is a fixed-height box and the bar inside it is a percentage of that
 * box, so the two channels cannot borrow height from each other — a loud client
 * must not shorten the rep's own reading, which is the measurement the rep is
 * actually watching.
 *
 * The same `floor` greys both. It is one threshold — `whisper/vad.ts` applies
 * `RMS_THRESHOLD` per window without caring which channel the window came from
 * — and the fix differs by side: a grey top row is the machine's input volume,
 * a grey bottom row is the call's own volume. That distinction is the whole
 * reason the second row is here.
 */
function Bar({ rms, floor, channel }: BarProps) {
  const rep = channel === 'rep'
  const audible = rms >= floor && rms > 0

  return (
    <span className={`flex flex-1 ${rep ? 'items-end' : 'items-start'}`}>
      <span
        /*
         * Two tones per channel and no threshold line — a 1px dashed rule
         * across a strip this size in a header is invisible at the distance
         * this is read from, whereas colour survives it, and a channel that is
         * too quiet turns grey along its *whole* length, which is a harder
         * thing to miss than bars sitting under a line.
         *
         * Two shades of the one blue *between* channels, because they measure
         * the same thing on two sides of a call. Grey is shared: audio the
         * transcriber drops is the same fact whoever said it, and two different
         * greys would imply a distinction the threshold does not make.
         *
         * `bg-meter-dropped` and not `bg-muted/30`, which is what stood here
         * and drew nothing at all — see the token's own comment.
         */
        className={`w-full rounded-[1px] ${
          audible ? (rep ? 'bg-brand-500' : 'bg-brand-700') : 'bg-meter-dropped'
        }`}
        /*
         * A floor of 6% rather than 0: a bar with no height is a gap, and a row
         * of gaps reads as a broken widget rather than as silence. Silence
         * should look like a flat line, which is what a strip of stubs is. Six
         * of a half rather than three of a whole — the stub is the same 0.7px
         * it always was, and halving the box would otherwise have halved it.
         */
        style={{ height: `${Math.max(barHeight(rms) * 100, 6)}%` }}
      />
    </span>
  )
}
