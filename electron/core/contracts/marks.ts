/**
 * **The rep's own bookmark in a call.**
 *
 * One press, no typing required, recorded with the instant it was made. It is
 * the only thing in this product the rep can put into the record *during* a
 * call besides their own notes — and it exists because of where it is pressed:
 * the widget, floating over Teams, is the only Sillage surface a rep can see
 * while they are in the meeting (`app/windows/Overlay.ts`).
 *
 * Three things it is not.
 *
 * **It is not a signal** (DEC-14). A signal is extracted by the model and is
 * read-only to the rep; a mark is made by the rep and read by nobody else. They
 * are opposite directions through the same screen, and collapsing them would
 * put a rep's press in a rail that says « what the model heard ».
 *
 * **It is not an annotation on a sentence.** A turn is transcribed *after* it
 * is spoken — `modules/transcribe` stamps a segment with its arrival, and
 * documents that a batch provider cannot report acoustic time — so the words a
 * rep is reacting to at 14:32:10 are usually in a turn that arrives at
 * 14:32:14. Attaching the mark to « the turn nearest its timestamp » would be
 * the app guessing which sentence the rep meant, which is the same mistake
 * DEC-21 refuses everywhere else. So a mark is placed *in time*, drawn as a
 * rule across the reader's column, and claims nothing about the turn either
 * side of it.
 *
 * **It is not an input to the recipe.** Nothing here reaches a prompt. A mark
 * that steered the compte-rendu would make the rep's attention during a call
 * change what the model wrote about it, and the rep would have no way to see
 * that it had.
 */
import { z } from 'zod'
import { TimestampSchema } from './meeting.ts'

/**
 * The note's ceiling, and why it is short.
 *
 * This is typed one-handed, in a call, into a box floating over the client's
 * face. Two hundred and eighty characters is about three lines at the widget's
 * width — enough for « prix : ils bloquent à 550 » and far too little to start
 * writing the compte-rendu in, which is the notepad's job and belongs in the
 * window the rep is not looking at.
 */
export const MARK_NOTE_MAX = 280

export const MomentMarkSchema = z.object({
  id: z.string().min(1),
  /**
   * Wall clock, not an offset into the recording.
   *
   * The reader places a mark against `TranscriptSegment.receivedAt`, which is
   * also wall clock, so the two are directly comparable with no arithmetic. An
   * offset would have to be recomputed against `startedAt` at every call site,
   * and a meeting that was armed, ended and re-recorded has more than one.
   */
  at: TimestampSchema,
  /** The rep's own words, or empty when they only pressed the button. */
  note: z.string().trim().max(MARK_NOTE_MAX).default(''),
  /**
   * **The turn the rep pressed on, when they pressed on one.**
   *
   * This is what makes the widget's live transcript more than a comfort. The
   * paragraph above explains why a mark cannot be *inferred* onto a turn — a
   * turn is written down seconds after it is spoken, so « the turn nearest the
   * timestamp » is a guess. But a rep who presses *on a line* is not being
   * guessed at: they pointed at it. So the id travels with the mark, and the
   * readers place it exactly, under the words it was made about.
   *
   * Null is the other press — the button on the pill, made while the rep is
   * looking at the client and not at a transcript. That one is a moment and is
   * drawn as a moment, in time, claiming nothing about the turns either side.
   */
  segmentId: z.string().min(1).nullable().default(null),
  /**
   * **Whose act this was**, because « a mark is the rep's » was a rule with no
   * field behind it.
   *
   * One thing in this product writes a mark that the rep did not make: the
   * widget's « Prévenir le client », which records that the disclosure was read
   * out (US-11). It went through this same channel with a note, so it was
   * indistinguishable from a moment the rep pressed — and three written rules
   * broke at once. « A mark is the rep's and is never inferred onto a sentence »:
   * this one was the product's. « Taking one back is an event, never a delete »:
   * the panel drew it with the rep's own bookmark and a *Retirer ce moment
   * marqué* ×, so the rep could erase the record that they had asked. And the
   * pill's counter — the number a rep glances at to decide whether they caught
   * anything — went 2 → 3 on a press that marked nothing, over-reporting by the
   * number of times they did the honest thing.
   *
   * Defaulted, so every mark already in a rep's log parses as theirs, which is
   * what they are: nothing but this one call site has ever passed anything else.
   */
  by: z.enum(['rep', 'product']).default('rep'),
})
export type MomentMark = z.infer<typeof MomentMarkSchema>

/**
 * The transcript with the marks interleaved, oldest first.
 *
 * In `contracts` for the reason `speakerLabel` and `meetingAnchor` are: three
 * surfaces draw a transcript — the gate's reader, *Historique*'s and the
 * session screen's list — and `src/*` may import `core/contracts/` and nothing
 * else, so a helper anywhere else would be reimplemented per screen and the
 * three would eventually disagree about where a mark sits.
 *
 * A mark follows every turn that had already arrived when it was made. Ties go
 * to the turn: a mark and a segment stamped the same millisecond means the
 * segment was written down first, and the rep pressed after reading it.
 */
export type TranscriptRow<S extends { receivedAt: number }> =
  | { kind: 'turn'; key: string; segment: S }
  | { kind: 'mark'; key: string; mark: MomentMark }

export const interleaveMarks = <S extends { id: string; receivedAt: number }>(
  segments: readonly S[],
  marks: readonly MomentMark[],
): TranscriptRow<S>[] => {
  const rows: TranscriptRow<S>[] = segments.map((segment) => ({
    kind: 'turn' as const,
    key: segment.id,
    segment,
  }))
  /*
   * A mark that names a turn is placed on that turn, wherever the clock says
   * it was made — the rep pointed at a line, and a line they pointed at is not
   * something to re-derive. A mark whose turn is not in this record (a filtered
   * view, a segment that never persisted) falls back to its instant rather than
   * disappearing: the mark is the rep's, and losing one silently is worse than
   * placing it a turn early.
   */
  const known = new Set(segments.map((segment) => segment.id))
  const pinned = new Map<string, MomentMark[]>()
  const floating: MomentMark[] = []
  for (const mark of [...marks].sort((a, b) => a.at - b.at)) {
    if (mark.segmentId !== null && known.has(mark.segmentId)) {
      const list = pinned.get(mark.segmentId) ?? []
      list.push(mark)
      pinned.set(mark.segmentId, list)
    } else {
      floating.push(mark)
    }
  }

  const placed: TranscriptRow<S>[] = []
  let next = 0
  const flush = (row: TranscriptRow<S>): void => {
    placed.push(row)
    if (row.kind !== 'turn') return
    for (const mark of pinned.get(row.segment.id) ?? []) {
      placed.push({ kind: 'mark', key: mark.id, mark })
    }
  }
  for (const mark of floating) {
    while (next < rows.length) {
      const row = rows[next]
      if (row?.kind !== 'turn' || row.segment.receivedAt > mark.at) break
      flush(row)
      next += 1
    }
    placed.push({ kind: 'mark', key: mark.id, mark })
  }
  while (next < rows.length) {
    const row = rows[next]
    if (row) flush(row)
    next += 1
  }
  return placed
}
