/**
 * `buildEntries` is pure, so the rules it applies can be asserted at an arbitrary
 * instant instead of by waiting for one — which is the whole reason the overrun
 * rule below is testable at all.
 */
import { describe, expect, it } from 'vitest'
import { buildEntries } from '../entries.ts'
import { OVERRUN_GRACE_MS } from '../../../../electron/core/contracts/meeting.ts'
import type { AgendaSnapshotPayload } from '../../../../electron/core/contracts/ipc.ts'

const T0 = Date.parse('2026-09-11T14:00:00Z')
const END = T0 + 30 * 60_000

const attendee = (name: string) => ({
  name,
  email: `${name}@client.fr`,
  type: 'required' as const,
  response: 'accepted' as const,
})

const snapshot = (): AgendaSnapshotPayload => ({
  events: [
    {
      id: 'evt-sodexial',
      isCancelled: false,
      isAllDay: false,
      lastModified: 0,
      context: {
        eventId: 'evt-sodexial',
        subject: 'Sodexial — comité de staffing',
        agenda: '',
        organizer: attendee('fontaine'),
        attendees: [attendee('zaiou')],
        onlineMeetingJoinUrl: 'https://teams.microsoft.com/x',
        categories: [],
        sensitivity: 'normal',
        scheduledStart: T0,
        scheduledEnd: END,
        seriesMasterId: null,
        timeZone: 'Europe/Paris',
      },
    },
  ],
  syncedAt: T0,
  window: { from: T0 - 86_400_000, to: T0 + 86_400_000 },
  armed: null,
  reason: '',
})

/** What `DayPane` draws for this row: the arm control, or nothing. */
const control = (now: number): 'Enregistrer' | null => {
  const [entry] = buildEntries({ snapshot: snapshot(), meetings: [], now })
  return entry !== undefined && entry.eventId !== null && !entry.past ? 'Enregistrer' : null
}

describe('a call that runs over keeps its invite', () => {
  /*
   * DEC-9 says sales calls overrun constantly. `isPast` answered `end < now` for
   * a row with no meeting, so at 14:31 on a 14:00–14:30 slot the row moved under
   * *Passées* and carried no control at all — while `Agenda.armNow`, which that
   * control calls, would happily have armed it. The rep's only remaining route
   * was « Démarrer une réunion », which drops `eventId` and with it the
   * attendees, « Interlocuteurs », `speakerLabel`'s one chance to name the far
   * channel after a person, and the strongest signal account resolution has —
   * at the moment the conversation is going well enough to run late.
   */
  it('still offers the control one minute past the scheduled end', () => {
    expect(control(END - 60_000)).toBe('Enregistrer')
    expect(control(END + 60_000)).toBe('Enregistrer')
  })

  it('still offers it a quarter of an hour over', () => {
    expect(control(END + 15 * 60_000)).toBe('Enregistrer')
  })

  it('withdraws it once the grace has run out', () => {
    // Bounded deliberately: a slot nobody joined must eventually read as past,
    // or every skipped meeting keeps a live primary for the rest of the day.
    expect(control(END + OVERRUN_GRACE_MS - 1_000)).toBe('Enregistrer')
    expect(control(END + OVERRUN_GRACE_MS + 1_000)).toBe(null)
  })

  it('applies the grace with no microphone signal at all', () => {
    /*
     * The domain rule (`decideArming`) extends only while a conferencing app
     * still holds a microphone, because a schedule alone is not evidence a call
     * is happening and the app must not *offer* on a guess. This surface must
     * not inherit that condition: `armNow` does not consult `decideArming` —
     * the detector guesses, the rep has said — so on an older binary, on macOS
     * before 14.4, on a locked-down Windows box, or on a call taken on a desk
     * phone, the control has to be there anyway. Nothing in this test supplies a
     * microphone signal, which is the point.
     */
    expect(control(END + 5 * 60_000)).toBe('Enregistrer')
  })
})
