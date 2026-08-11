/**
 * The in-call side surfaces make promises that are easy to break by accident
 * and expensive to notice: the rail draws the whole slate from the first frame
 * and never moves a row, it invents nothing for a slot nobody filled, and the
 * meter puts its threshold mark where the transcriber's threshold actually is.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { Signal, SignalKind } from '../../../electron/core/contracts/signals.ts'
import { SignalRail } from '../session/SignalRail.tsx'
import { barHeight } from '../session/LevelMeter.tsx'

afterEach(cleanup)

const signal = (seq: number, kind: SignalKind, label: string): Signal => ({
  id: `s${seq}`,
  seq,
  kind,
  label,
  source: { quote: label, channel: 'far', startMs: 0, endMs: 1 },
  createdAt: 1000 + seq,
})

const rows = () => screen.getAllByRole('listitem').map((li) => li.textContent ?? '')

describe('the signal rail shows what it is listening for', () => {
  test('every slot is drawn before anything has been heard', () => {
    // The old rail was an empty column for the first several minutes of every
    // meeting, and an empty column is indistinguishable from a broken one. The
    // slate is fixed (DEC-13), so there is nothing to hide.
    render(<SignalRail signals={[]} recording />)

    const labels = rows()
    expect(labels).toHaveLength(7)
    expect(labels[0]).toContain('Profil')
    expect(labels[1]).toContain('TJM')
    expect(labels.every((row) => row.includes('—'))).toBe(true)
  })

  test('a signal fills its own slot and moves nothing', () => {
    // The order is the constant in SignalRail.tsx, not arrival order and not
    // `seq`. Nothing on this pane can move, because there is nothing to move
    // past — which is a stronger form of DEC-14's "never reorders".
    render(
      <SignalRail
        signals={[signal(3, 'etape', 'RDV technique'), signal(1, 'tjm', 'TJM 520 €')]}
        recording
      />,
    )

    const labels = rows()
    expect(labels).toHaveLength(7)
    expect(labels[1]).toContain('TJM 520 €')
    expect(labels[6]).toContain('RDV technique')
    // Untouched slots still say so rather than disappearing.
    expect(labels[0]).toContain('—')
  })

  test('several signals of one kind stack inside that slot', () => {
    render(
      <SignalRail
        signals={[signal(1, 'objection', 'budget gelé'), signal(2, 'objection', 'délai court')]}
        recording
      />,
    )

    const objection = rows().find((row) => row.startsWith('Objection')) ?? ''
    expect(objection).toContain('budget gelé')
    expect(objection).toContain('délai court')
  })

  test('the catch-all appears only once something lands in it', () => {
    // `autre` has no slot to wait in — an "Autre —" row would be a promise the
    // extractor never made.
    render(<SignalRail signals={[]} recording />)
    expect(screen.queryByText(/^Autre$/)).toBeNull()

    cleanup()
    render(<SignalRail signals={[signal(1, 'autre', 'refonte SI 2027')]} recording />)
    expect(rows()).toHaveLength(8)
    expect(screen.getByText('refonte SI 2027')).toBeTruthy()
  })

  test('the count reports covered slots, not signals', () => {
    // Two signals of the same kind cover one slot. A count that said 2/7 would
    // read as progress the meeting has not made.
    render(
      <SignalRail
        signals={[signal(1, 'tjm', '520 €'), signal(2, 'tjm', '480 € en régie')]}
        recording
      />,
    )
    expect(screen.getByText('1/7')).toBeTruthy()
  })
})

describe('the level meter marks the threshold the transcriber uses', () => {
  test('the transcription floor lands inside the drawn range, not on the baseline', () => {
    // `SPEECH_FLOOR` is 0.008. On a linear scale it is 0.8% of the height —
    // indistinguishable from the bottom border, which is the entire reason the
    // meter is log-scaled.
    const floor = barHeight(0.008)
    expect(floor).toBeGreaterThan(0.25)
    expect(floor).toBeLessThan(0.55)
  })

  test('the level a working microphone produced reads clearly above the floor', () => {
    // 0.0217 is the measured peak once the input volume was raised; 0.008 is
    // what the two-minute, one-line meeting produced. The meter has to separate
    // those two by more than a pixel or it cannot be used to fix the problem.
    expect(barHeight(0.0217) - barHeight(0.008)).toBeGreaterThan(0.1)
  })

  test('silence is flat and nothing exceeds the top', () => {
    expect(barHeight(0)).toBe(0)
    expect(barHeight(0.0001)).toBe(0)
    expect(barHeight(1)).toBe(1)
  })
})
