/**
 * **The screen the arming gesture lands on, saying what it is.**
 *
 * Two human entrances reach a session that has not started — *Préparer* on a
 * calendar row, and the DEC-46 arming notice — and both of them landed here.
 * Measured on the shipped renderer (`agenda-preparer`, both smoke sizes):
 *
 *     arbre: 7 contrôle(s) et 2 champ(s) nommés, 0 titre(s), aucune prose
 *     sept « — » dans la trame, « Client » en placeholder, notes vides
 *
 * Nothing on it said the meeting was armed, when the call was, who was on the
 * far side, or that **nothing was being recorded yet**. « Suis-je en train
 * d'enregistrer ? » was answered only by the *absence* of the meter pill a
 * recording screen carries — an absence is not an answer, and the one question
 * DEC-38 exists for is exactly this one.
 *
 * ## Every fact here is Graph's, and none of it is invented (DEC-7)
 *
 * The hour and the far side are read off the calendar event this meeting was
 * armed from, joined by `eventId` through `agenda:snapshot` — the channel the
 * calendar screen already reads, so no new port and no new claim. The rep's own
 * address comes from `auth:state`, and is removed from the list: « en face »
 * means the other side of the call, and a rep is not on it. Room mailboxes
 * (`type: 'resource'`) are not people and are dropped for the same reason.
 *
 * **`clientName: null` is the product's correct answer, not a gap.** `Agenda.#arm`
 * passes the event's context to `orchestrator.create` and no client name, because
 * the account is resolved against VerySwing at the gate and never parsed out of an
 * objet line. So this says so, rather than filling the field with a guess: the
 * emptiest thing on the screen was the one field a rep was most likely to
 * mis-read as « the app does not know who this is ».
 *
 * ## Why a strip and not a pane
 *
 * It is the fourth in a stack that already answers « what is this meeting doing »
 * — `EnhancementNotice` for the wait, `OutcomeNotice` for the three terminal
 * states, `RecipeSwitchNotice` for a pending rewrite. A pane would have to take
 * its height from the notepad permanently; this takes it only while there is
 * nothing to record, and is gone on the press it names. Measured on the shipped
 * renderer at 960×600, the window's own declared minimum: the strip is
 * **124.2px of 600** and the notepad below it keeps 379.1. It costs the
 * *recording* screen nothing at all, which is the trade — the two screens a rep
 * spends time on are the call and the gate, and this is neither.
 *
 * Its own subscriptions, for `EnhancementNotice`'s reason exactly: `Session`
 * holds a live ProseMirror view with the rep's caret in it, and a read that
 * re-rendered `Session` would reconcile the notepad's subtree.
 */
import type { MeetingState } from '../../../electron/core/contracts/meeting.ts'
import type { Attendee, MeetingContext } from '../../../electron/core/contracts/meeting.ts'
import { useInvoke } from '../../app/bridge.ts'
import { formatDayLong, formatTime, isSameDay } from '../../app/format.ts'

/**
 * **Which states owe the rep a statement of what has not happened yet.**
 *
 * A table over `MeetingState` rather than an `if`, on `OutcomeNotice.SPEAKS_FOR`'s
 * precedent: a tenth state added to the machine does not compile until somebody
 * has decided whether it is a meeting still waiting to be recorded.
 *
 * `recording` is deliberately false and it is the one that matters: the pill, the
 * clock and the moving meter are that screen's answer (DEC-38), and US-27 took
 * the *word* off it because three statements of one fact is noise on the screen a
 * rep has open while a client is talking. Everything after `recording` has a
 * document, a notice or both.
 */
const BEFORE_THE_CALL: Record<MeetingState, boolean> = {
  idle: true,
  armed: true,
  recording: false,
  ended: false,
  extracting: false,
  awaiting_confirmation: false,
  pushing: false,
  done: false,
  aborted: false,
}

/** `A`, `A et B`, `A, B et C`, then `A, B et 2 autres`. Never a bare comma list. */
const nameList = (names: readonly string[]): string => {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`
  return `${names.slice(0, 2).join(', ')} et ${names.length - 2} autres`
}

/**
 * The other side of the call, as Graph spells it.
 *
 * The organiser is included — on an invitation the rep accepted, the organiser
 * *is* the client — and then the rep's own address is removed, so the same
 * function is right whichever side sent the invite. Deduplicated on the address
 * because Graph returns the organiser in `attendees` as well in most tenants and
 * does not in all of them.
 */
export const farSide = (context: MeetingContext, repEmail: string | null): string[] => {
  const mine = repEmail?.trim().toLocaleLowerCase() ?? null
  const seen = new Set<string>()
  const out: string[] = []
  for (const person of [context.organizer, ...context.attendees] as Attendee[]) {
    if (person.type === 'resource') continue
    const key = person.email.trim().toLocaleLowerCase()
    if (key !== '' && (key === mine || seen.has(key))) continue
    if (key !== '') seen.add(key)
    const shown = person.name.trim() || person.email.trim()
    if (shown !== '') out.push(shown)
  }
  return out
}

interface ArmedBriefProps {
  state: MeetingState | null
  /** The calendar event this meeting was armed from, or null for an ad-hoc call. */
  eventId: string | null
  /** The meeting's own anchor, which survives a calendar the app can no longer read. */
  scheduledStart: number | null
}

/**
 * The gate, and it is a component boundary rather than an `if` inside one so the
 * two reads below **do not happen during a call**. Hooks run before any early
 * return, so an `ArmedBrief` that decided in its own body would still invoke
 * `agenda:snapshot` on every recording screen — a read of the Graph fold on the
 * one path DEC-26 says has no network dependency.
 */
export function ArmedBrief({ state, eventId, scheduledStart }: ArmedBriefProps) {
  if (state === null || !BEFORE_THE_CALL[state]) return null
  return <Brief eventId={eventId} scheduledStart={scheduledStart} />
}

function Brief({ eventId, scheduledStart }: Omit<ArmedBriefProps, 'state'>) {
  const agenda = useInvoke('agenda:snapshot', {})
  const auth = useInvoke('auth:state', {})

  const events = agenda.state.status === 'ready' ? agenda.state.value.events : []
  const context =
    eventId === null ? null : (events.find((event) => event.id === eventId)?.context ?? null)
  const repEmail =
    auth.state.status === 'ready' && auth.state.value.status === 'signedIn'
      ? auth.state.value.account.username
      : null

  const start = context?.scheduledStart ?? scheduledStart
  const now = Date.now()
  /*
   * « aujourd'hui » rather than the date on the day it is the day: a rep opening
   * this at 15:58 does not need to be told which Thursday it is, and the calendar
   * screen they came from already said so.
   */
  const day = start === null ? null : isSameDay(start, now) ? 'aujourd’hui' : formatDayLong(start)

  /*
   * Three shapes, and the third is not an error. A call with no invitation has
   * no hour and no far side to name, and saying so is the honest line — the
   * alternative is a sentence about an empty list.
   */
  const when =
    start === null
      ? null
      : context !== null
        ? `Prévue ${day} de ${formatTime(start)} à ${formatTime(context.scheduledEnd)}.`
        : `Prévue ${day} à ${formatTime(start)}.`

  const people = context === null ? [] : farSide(context, repEmail)
  const who =
    context === null
      ? 'Cet appel n’a pas d’invitation : personne n’est nommé en face.'
      : people.length === 0
        ? 'L’invitation ne nomme personne d’autre que vous.'
        : `En face : ${nameList(people)}.`

  return (
    <div
      role="status"
      className="border-subtle bg-card-soft shrink-0 border-b px-gutter py-snug"
    >
      {/*
        **`h2` and not `h1`**, and the reason was measured rather than assumed.
        The page's own name is the objet in the header, which is an `input`. The
        only `h1` this screen ever carries is the **notepad's** — driven on the
        `agenda` scenario, the two headings it draws are `h1 « Néovia Santé —
        cadrage data »` and `h2 « À retenir »`, both inside `.notepad`, both the
        rep's own words. The compte-rendu contributes none: `CompteRenduDocument`
        typesets its `#` and `##` lines as `div`s, so the document this screen is
        named after is not in the accessibility tree as structure at all. That is
        a finding and not a reason — it is recorded here and belongs to whoever
        takes the typesetter next.

        What this heading names is the *moment*, which is what changed when the
        rep pressed *Préparer*, and an `h2` under a document whose `h1` is the
        rep's is the honest level for it.
      */}
      <h2 className="text-subhead">Prête à démarrer, rien n’est encore enregistré</h2>
      {/*
        `.measure` on the element that holds the prose, never only on a wrapper
        — the one reading rule, and `--prose` measures this box.
      */}
      <p className="text-body measure mt-hair text-ui">
        {when === null ? null : <>{when} </>}
        {who}
      </p>
      {/*
        Two sentences and not four. Measured at 960×600, the declared minimum:
        the strip was 142.8px of the 600 this window is allowed to be — 23.8 % of
        it, off the notepad — and `.measure` caps a line at 58 characters, so
        every sentence is two lines whatever its width. What was cut is the
        clause explaining that the header field « n’est qu’un intitulé », which
        is the product describing its own convention (US-25) rather than telling
        a rep what is about to happen.
      */}
      <p className="text-muted measure mt-hair text-ui">
        Rien n’est capté avant que vous pressiez Démarrer. Le compte client viendra de VerySwing à
        la validation.
      </p>
    </div>
  )
}
