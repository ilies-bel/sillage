/**
 * The right pane: what the app is listening *for*, and what it has heard.
 *
 * It used to be an append-only list of chips, which meant that for the first
 * several minutes of every meeting it was an empty column. An empty column is
 * indistinguishable from a broken one, and it never told the rep the more
 * useful half of what it knows: the *slate*. The ESN compte-rendu is written
 * from a fixed set of fields (DEC-13), so those fields are known before the call
 * starts and there is no reason to hide them.
 *
 * So every slot is drawn from the first frame, empty ones included. A rep
 * glancing at the rail sees « Durée — » and knows that nobody has said how long
 * the mission runs; that is a thing they can act on while the client is still on
 * the line, which an empty column is not.
 *
 * ## The recipe with no slate (DEC-43)
 *
 * A free-form compte-rendu has no fields known in advance, so there is no slate
 * to draw and the rail falls back to what it shows for `autre`: the signals that
 * have actually landed, in the order they landed. That is not a regression to
 * the empty column — the difference is that the rail *says so*, in the footer,
 * instead of leaving the rep to wonder whether it is broken. Drawing the ESN
 * slate anyway would be worse than either: seven rows the document will never
 * contain, three of which the model was never asked to look for.
 *
 * The DEC-14 constraints survive the change, and one of them gets stronger:
 *
 *  - **Never reorders.** Now by construction rather than by sort: the slots are
 *    a fixed list in this file, and a signal lands in its slot. Nothing on this
 *    pane can move, because there is nothing for it to move past.
 *  - **Never animates.** No enter transition, no fade. A chip that moves while
 *    someone is on a call steals a glance they owe the client.
 *  - **Never makes a sound.**
 *  - **Read-only.** Nothing here is clickable during the call and nothing here
 *    writes to the document (DEC-5). The rail is a side surface.
 *
 * A slot stays empty for as long as nobody says the thing. A meeting where no
 * price comes up shows « TJM — » to the end, and filling it would be the exact
 * failure DEC-21 exists to prevent.
 */
import type { Signal, SignalKind } from '../../../electron/core/contracts/signals.ts'
import { DEFAULT_RECIPE, recipeById, type RecipeId } from '../../../electron/core/contracts/recipes.ts'

interface SignalRailProps {
  signals: Signal[]
  recording: boolean
  /** Which compte-rendu the meeting is set to produce — it owns the slate. */
  recipe?: RecipeId
}

/** French, short, and stable — the label is a category, not a sentence. */
const KIND_LABEL: Record<SignalKind, string> = {
  tjm: 'TJM',
  profil: 'Profil',
  demarrage: 'Démarrage',
  duree: 'Durée',
  mode: 'Mode',
  objection: 'Objection',
  etape: 'Étape',
  autre: 'Autre',
}

export function SignalRail({ signals, recording, recipe = DEFAULT_RECIPE }: SignalRailProps) {
  const ordered = [...signals].sort((a, b) => a.seq - b.seq)
  const byKind = new Map<SignalKind, Signal[]>()
  for (const signal of ordered) {
    const bucket = byKind.get(signal.kind)
    if (bucket) bucket.push(signal)
    else byKind.set(signal.kind, [signal])
  }

  /**
   * The slate, declared by the recipe (`core/contracts/recipes.ts`) and empty
   * for the free one.
   *
   * `autre` is deliberately never in it — it is the extractor's catch-all, so it
   * has no slot to wait in and appears at the bottom only once something lands.
   */
  const slots = recipeById(recipe).slate

  /**
   * The rows drawn beyond the slate: anything heard whose kind the slate does
   * not already hold a row for, in the order it was first heard.
   *
   * For the ESN recipe this is `autre` and nothing else, which is what it was
   * before. For the free recipe it is *every* kind, which is the whole of what
   * that rail is.
   */
  const extra = [...byKind.keys()].filter((kind) => !slots.includes(kind))
  const covered = slots.filter((kind) => byKind.has(kind)).length
  const heard = ordered.length

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-baseline justify-between gap-inline px-4 pb-2 pt-4">
        <h2 className="pane-label">Signaux</h2>
        {/*
          A count, not a score. With a slate it answers "how much of it has come
          up" at a glance, which is the question the list below answers slowly.
          With no slate there is no denominator that would mean anything — a
          « 4/7 » against a document with no fields is a score against a target
          nobody set — so it counts what has been heard instead. `tabular-nums`
          either way, so it does not jitter as it changes.
        */}
        <span className="text-muted shrink-0 tabular-nums text-label" aria-hidden>
          {slots.length > 0 ? `${covered}/${slots.length}` : heard}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <ul className="space-y-1.5">
          {slots.map((kind) => (
            <Slot key={kind} label={KIND_LABEL[kind]} found={byKind.get(kind) ?? []} />
          ))}
          {extra.map((kind) => (
            <Slot key={kind} label={KIND_LABEL[kind]} found={byKind.get(kind) ?? []} />
          ))}
        </ul>

        {/*
          The contract, written where the rep can read it (`5.2 En réunion`).
          Every constraint in this file's docblock is invisible from the outside:
          a rail that has not reordered *yet* looks exactly like one that is
          about to, and a rep who suspects the app might start typing into their
          notes will watch it instead of the client.

          The slate-less recipe gets one sentence more, and it is the one that
          keeps an empty rail from reading as a broken one: nothing is missing,
          the plan simply does not exist yet (DEC-43).
        */}
        {slots.length === 0 ? (
          <p className="text-muted mt-row text-label">
            Aucune trame : le plan du compte-rendu sera décidé à la fin, à partir de ce qui a été
            dit.
          </p>
        ) : null}
        <p className="text-muted mt-row text-label">
          {recording
            ? 'Se remplit à mesure · ne clique nulle part · rien ne migre dans vos notes.'
            : 'Ne se réordonne pas · ne clique nulle part · rien ne migre dans vos notes.'}
        </p>
      </div>
    </section>
  )
}

interface SlotProps {
  label: string
  found: Signal[]
}

/**
 * One field of the slate, as a label/value row rather than a stacked chip.
 *
 * The chip form put the category on its own line in 10px uppercase, which was
 * tolerable for the three or four chips a meeting produced and is not for a
 * seven-row slate: seven lines of 10px caps is the densest, least readable text
 * on the screen, sitting beside the one surface that must never lose a glance.
 * Two columns instead — the label at 11px in the muted tone, the value at the
 * body size — which reads as a form the rep is filling in, which is what it is.
 *
 * Empty and filled rows are the same shape, so filling one shifts none of the
 * others. The "never moves" rule of DEC-14 applies to the rows a signal does
 * *not* land in just as much as to the ones it does.
 */
function Slot({ label, found }: SlotProps) {
  const empty = found.length === 0

  return (
    <li
      className={`border-card flex items-baseline gap-inline rounded-sm border px-2.5 py-1.5 ${
        empty ? 'border-transparent' : 'bg-inner'
      }`}
    >
      <span className="text-muted w-[4.5rem] shrink-0 text-meta">{label}</span>
      {empty ? (
        /*
         * `text-muted`, not the `text-muted/60` that stood here. Tailwind cannot
         * recompute alpha on a bare `var()` (tailwind.config.js says so at the
         * top), so that class emitted no rule at all and the em-dash inherited
         * `--text-body` — every *empty* slot was drawn in a stronger colour than
         * the values in the filled ones, which is the opposite of the intent.
         */
        <span className="text-muted text-ui" aria-label="pas encore évoqué">
          —
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          {found.map((signal) => (
            <span key={signal.id} className="text-body block text-ui">
              {signal.label}
            </span>
          ))}
        </span>
      )}
    </li>
  )
}
