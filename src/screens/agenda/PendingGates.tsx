/**
 * *En attente de validation* — the calls that were recorded and never confirmed.
 *
 * ## The failure it exists to catch
 *
 * A meeting that reaches `awaiting_confirmation` and is never validated is the
 * product's quietest failure: the audio was captured, the transcript is stored,
 * the compte-rendu is written — and nothing reached VerySwing, nothing reached
 * Outlook, and nobody was told. The rep believes the call is filed. Every other
 * failure in this app announces itself (DEC-26); this one is a rep walking away
 * from a screen.
 *
 * The app knows exactly which calls those are — `statut: 'a-valider'` over the
 * event log is the same question the search's own chip asks. So the home screen
 * asks it, once, and puts the answer where the rep already is.
 *
 * ## Why here rather than in the header
 *
 * The status control is for the three subsystems that make a meeting possible
 * (DEC-32), and a backlog of unconfirmed calls is not a degradation: the app is
 * working perfectly and the rep owes it a gesture. Putting a count in the header
 * chip would teach a rep to read « Tout fonctionne » as « you have work », which
 * is the two-meanings-one-signal problem that decision exists to prevent.
 *
 * ## What it is not
 *
 * It is not a second inbox and it does not grow into one: at most a handful of
 * rows, and the rest is *Historique* with the `À valider` chip already on —
 * which is the same query, one link away, as with everything else on this
 * screen (DEC-25).
 *
 * Nothing here confirms anything. *Ouvrir* is the same navigation the day list
 * uses; the one confirmation stays where it has always been (DEC-4).
 */
import type { HistoryRow } from '../../../electron/core/contracts/history.ts'
import { meetingAnchor } from '../../../electron/core/contracts/meeting.ts'
import { formatDayShort, meetingHeading } from '../../app/format.ts'
import { Button, List, Row, RowLead, RowTitle, SectionHeader } from '../../ui/index.ts'

/** How many rows before the screen sends the rep to the full record. */
export const PENDING_SHOWN = 4

/**
 * How many the screen asks for. Far more than it draws, because the *count* is
 * the point: a backlog has a size, and « les 4 › » under four rows is not a
 * size. An empty query costs no transcript folding, so this is one indexed scan
 * and a chip filter. Past fifty the number stops being actionable and the
 * heading says so.
 *
 * **It is the size of the question and no longer the test for the answer.**
 * `total >= PENDING_LIMIT` was one more than the question: a rep owing exactly
 * fifty gestures — measured, fifty rows back with the handler reporting nothing
 * hidden — read « 50+ » over « Toutes › », a backlog that had been rounded up
 * and a link that no longer named its own count. The main process says whether a
 * row was hidden; this says how many to ask for.
 */
export const PENDING_LIMIT = 50

/** Past this, the row says how long it has been sitting there. */
const STALE_DAYS = 7
const DAY_MS = 86_400_000

export interface PendingGatesProps {
  /** Already narrowed to `statut: 'a-valider'` by the main process. */
  rows: readonly HistoryRow[]
  /**
   * The whole backlog, **before** the rows already drawn elsewhere on the screen
   * were removed from `rows`.
   *
   * The two used to be the same array, and that was the defect: the day pane
   * drops a pending call it is already showing — a sound rule, the same meeting
   * twice on one screen reads as two meetings — so the count moved with the day
   * the rep happened to be looking at. Ten September said one; the thirty-first
   * of August said two; nothing had changed but the cell that was open. A
   * backlog whose size depends on the date you clicked is not a backlog.
   *
   * So the *number* is the real one and never moves, and the de-duplication
   * survives where it belongs: in what is drawn.
   */
  total: number
  /**
   * Whether the backlog was **cut short** — the main process's own answer, off
   * the field the search channel ships on every reply.
   *
   * Never `total >= PENDING_LIMIT`: that is one more than the question, and it
   * turned a rep owing exactly fifty gestures into « 50+ ». The count above is
   * a number the screen may print; this is the only thing that licenses a `+`
   * on the end of it.
   */
  capped: boolean
  /**
   * **The one meeting on this screen that carries a filled control** (US-26).
   *
   * Decided in `Agenda` and shared with `DayPane`, because « exactly one filled
   * control » is a fact about the *screen* and this is the second of its two lists.
   * The oldest call still `à valider` can be in either one — this section
   * deliberately drops the rows the day list is already showing — so a section
   * deciding on its own would draw a second blue whenever the day happened to hold
   * one of them.
   *
   * `null` means no row here does, which is the ordinary case: a live call or an
   * armed offer outranks a backlog.
   */
  emphasis: string | null
  /** Today, from the same clock the day pane uses. */
  now: number
  /** *Tout l'historique* with the same chip on. */
  onSeeAll: () => void
  onOpen: (meetingId: string) => void
}

export function PendingGates({
  rows,
  total,
  capped,
  emphasis,
  now,
  onSeeAll,
  onOpen,
}: PendingGatesProps) {
  // Nothing to owe is not an empty state — it is a section that does not exist.
  // A permanent « rien à valider » panel would be a congratulation the rep gets
  // every day and reads on none of them.
  if (total === 0) return null

  const shown = rows.slice(0, PENDING_SHOWN)
  /*
   * How many of the backlog are on this screen already, drawn by the day list.
   * Only ever a subtraction of what the caller filtered out — never a guess.
   */
  const hiddenHere = Math.max(0, Math.min(total, PENDING_SHOWN) - rows.length)

  return (
    <section className="mt-block">
      <div className="mb-inline flex items-baseline gap-inline">
        <SectionHeader className="mb-0 shrink-0">En attente de validation</SectionHeader>
        {/*
          The size, beside the name. Without it the section is a sample with no
          scale: four rows look identical whether the rep owes four gestures or
          twenty-nine, and the one number that would make them open *Historique*
          was the one number the screen did not print.
        */}
        <span
          /* A bare numeral beside a heading reads as « En attente de validation
             trois » and could be anything. The label says what it counts — and
             it says the `+` too: a reader given « 50 » where the screen shows
             « 50+ » has been told something the screen is not claiming. */
          aria-label={
            capped
              ? `au moins ${total} réunions en attente de validation`
              : `${total} réunion${total > 1 ? 's' : ''} en attente de validation`
          }
          /*
            `--brand-700`, not `--warn`. This is the same number the rail prints
            beside *À valider* and it means the same thing — calls waiting for
            the rep — so the two have to agree, and `SectionNavItem.noteTone`
            carries the argument: a queue is not a fault. Nothing here has gone
            wrong; three compte-rendus are ready and nobody has read them yet.

            It also un-crowds the screen. In `--warn` this sat a few rows under
            « réunion prête » in the calendar's legend, which is the bright
            `--accent`: two oranges at different saturations meaning different
            things, in one glance. The staleness line below — « Rien n'a été
            envoyé depuis N jours » — keeps `--warn`, because that one *is* a
            fault and is the only thing on this screen making that claim.
          */
          className="text-brand-700 min-w-0 flex-1 text-ui font-semibold tabular-nums"
        >
          {capped ? `${total}+` : total}
        </span>
        {total > shown.length ? (
          <Button variant="text" className="shrink-0" onClick={onSeeAll}>
            {capped ? 'Toutes ›' : `Les ${total} ›`}
          </Button>
        ) : null}
      </div>

      {/*
        **Why the count and the rows can disagree, said where they disagree.**
        `Agenda` removes any meeting already drawn in the day list above — the
        alternative is the same call twice on one screen — but the count stays
        the whole backlog, because that is a fact about the rep's work and not
        about which day cell happens to be open. So « 2 » over one row, with no
        explanation, read as a section that had lost a row. It has not; the row
        is thirty pixels up.
      */}
      {hiddenHere > 0 ? (
        <p className="text-muted -mt-hair mb-snug text-meta">
          {hiddenHere === 1
            ? 'Une autre est dans la liste du jour, au-dessus.'
            : `${hiddenHere} autres sont dans la liste du jour, au-dessus.`}
        </p>
      ) : null}

      <List bare label="Réunions en attente de validation">
        {shown.map((row) => {
          /* Read once: the branch and the number are the same answer. */
          const stale = staleFor(row, now)
          return (
          <Row key={row.meeting.id} density="roomy" align="center">
            {/* The same leading column the day pane uses — `ui/List.tsx` says
                why all three sections of this scroller share one. */}
            <RowLead>{formatDayShort(meetingAnchor(row.meeting))}</RowLead>
            <RowTitle {...meetingHeading(row.meeting)} />
            {/*
              **How long it has been sitting — past a week, and only then.**

              The age used to be left to the date on the left, on the grounds
              that « il y a 3 jours » is a reproach. That holds for three days
              and stops holding at fourteen: « 27/08 » and « 09/09 » are the same
              pixel weight, and one of them is a fortnight of a client's CRM
              being wrong. It appears only past a week, so it is information on
              the rows where it is information and silent everywhere else.

              **And for four rounds it was not silent.** The `null` branch —
              *not* stale — printed a bare « Rien n'a été envoyé » in `--warn`,
              so the sentence four separate docblocks describe as appearing past
              a week appeared on every row of the section from the minute a call
              ended. Measured on `agenda` at 1280×800 and 960×600: the one
              pending row, four days old, drew rgb(125, 95, 24) — the fault
              colour, which the comment on the count twenty lines above reserves
              for this line precisely *because* « that one **is** a fault and is
              the only thing on this screen making that claim ». A backlog of
              mixed ages was therefore one flat orange column, and the row that
              was genuinely a fortnight old was painted like this morning's.

              It also restated its own heading. Every row in this section is,
              by construction, one from which nothing has been sent; « En attente
              de validation » sits eight pixels above the first of them.
              `--echo` cannot see that — a repetition *along a list* is exempt by
              rule, so that the same word on five rows reads as one control
              offered five times — which is how a sentence drawn once per row
              stayed invisible to the one check built for a string drawn twice.

              `staleFor` is read once rather than twice, so the branch and the
              number can no longer disagree.
            */}
            {stale === null ? null : (
              <span className="text-warn shrink-0 text-ui">
                {`Rien n’a été envoyé depuis ${stale} jours`}
              </span>
            )}
            {/*
              Filled only on the row `Agenda` named — the oldest thing the rep
              owes, and only when nothing is being recorded and nothing is armed.
              The control, the verb and the handler are the same on every row: this
              is ink, not an affordance (US-26). Nothing here confirms anything; the
              one confirmation stays at the gate (DEC-4).
            */}
            <Button
              variant={row.meeting.id === emphasis ? 'primary' : 'bordered'}
              onClick={() => onOpen(row.meeting.id)}
            >
              Ouvrir
            </Button>
          </Row>
          )
        })}
      </List>
    </section>
  )
}

/**
 * Whole days since the call, or `null` while it is still recent enough that the
 * date on the row says it better than a number would.
 */
const staleFor = (row: HistoryRow, now: number): number | null => {
  const days = Math.floor((now - meetingAnchor(row.meeting)) / DAY_MS)
  return days >= STALE_DAYS ? days : null
}
