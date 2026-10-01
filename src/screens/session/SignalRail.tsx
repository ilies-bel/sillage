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
 * ## No header of its own
 *
 * It had one, carrying a « 4/7 » count and the *Masquer* verb. The count is
 * gone from the product — a ratio beside the list it counts is arithmetic the
 * rep has to redo, and the list says the same thing more slowly and more
 * exactly — and *Masquer* moved up to `LiveAside`, which is the one header this
 * column has now that the same slot can also hold a transcript.
 *
 * A slot stays empty for as long as nobody says the thing. A meeting where no
 * price comes up shows « TJM — » to the end, and filling it would be the exact
 * failure DEC-21 exists to prevent.
 */
import type { Signal, SignalKind } from '../../../electron/core/contracts/signals.ts'
import { DEFAULT_RECIPE, recipeById, type RecipeId } from '../../../electron/core/contracts/recipes.ts'
import { ReadingColumn } from '../../ui/index.ts'

interface SignalRailProps {
  signals: Signal[]
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

export function SignalRail({ signals, recipe = DEFAULT_RECIPE }: SignalRailProps) {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* `.slate` declares the container the rows measure themselves against;
          see `index.css`. Below 250px they stack rather than shrink the value. */}
      {/*
        `ReadingColumn` — the rail is a reading surface and had no edge.

        Measured at 960×600, 120 of 494 pixels of the slate sat below the fold
        with a hard rule under the last visible row, which is exactly the « a
        document cut off at the fold looks like a document that ends there »
        this component was written for. The slate is the whole point of the
        rail (DEC-14): a rep judges the compte-rendu against it by seeing
        « Durée — » empty, and a slot they never knew was there is a slot they
        cannot judge.

        The class alone would not have done it: `.fade-below` draws from
        `data-above` / `data-below`, which this component is what sets — a bare
        class would have masked nothing and exempted the element from the check,
        which is the worst of both.
      */}
      <ReadingColumn subject={{ determiner: 'la', noun: 'fiche' }} className="slate px-row pb-row">
        {/*
        `SLATE_LIST` — the hairline lives here, once, instead of as seven edge
        strokes. `divide-y` draws between the rows and never around the set, so
        the slate reads as one form being filled in rather than as a stack of
        cards, and the column's own border is the only rectangle left.
      */}
      <ul className="divide-y divide-[var(--border-subtle)]">
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
          <p className="text-muted mt-row text-meta">
            Aucune trame : le plan du compte-rendu sera décidé à la fin, à partir de ce qui a été
            dit.
          </p>
        ) : null}
        {/*
          **And no promise about a thing that does not happen.**

          The last line of the rail read « Rien ne migre dans vos notes. » — a
          statement, drawn permanently, about something the product never does,
          at the foot of the column, which is where the eye ends. It was already
          two clauses shorter than the version before it (« Se remplit à mesure ·
          ne clique nulle part · rien ne migre dans vos notes. »), and the same
          argument finishes the job: a rep who has never suspected this panel of
          typing into their notes is being told not to, during a client call.

          DEC-5's promise is not dropped, it is made where a rep is reading
          rather than talking, and it is made twice: step 1 of first run carries
          « Vos notes restent les vôtres — Sillage n’écrit jamais dans votre
          bloc-notes pendant l’appel », and step 3's third beat names this rail
          and what it does — « À droite, Sillage note au passage ce qu’il
          entend … sans rien écrire chez vous » (`Onboarding.tsx`, read before
          this line was deleted rather than assumed). The
          slate-less sentence above stays: it is not a promise, it is the reason
          an empty rail is empty (DEC-43).

          Measured on the shipped renderer: 33 px of content — one line plus its
          `mt-row` — which at 960×600, the only size where this rail overflows,
          is 197 → 164 px of slate below the fold during a recording and
          192 → 159 px once a compte-rendu is beside it.
        */}
      </ReadingColumn>
    </div>
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
    /*
      **No box.** Each row wore `border-card rounded-sm border` with `bg-inner`
      when filled and `border-transparent` when not, so a filled slate was seven
      individually outlined cards stacked inside an already-outlined column —
      the `nested-cards` the impeccable detector reports on this screen, and two
      of the three containers saying the same thing. VISION.md §6 has asked for
      « rows, not cards, for lists » from the start.

      What the box was really for is kept, and it is the only thing that
      mattered: **empty and filled are the same shape**, so a signal landing
      shifts nothing (DEC-14). That came from reserving the border's width on
      the empty row, and it now comes from the two states sharing one set of
      paddings and differing only in their text — which is a stronger version of
      the same guarantee, because there is no width left to reserve.

      The hairline between rows belongs to the list, not to the row; see
      `SLATE_LIST` below.
    */
    <li className="slate-row flex items-baseline gap-inline py-tight">
      {/* 64px, not 72: every pixel here is a pixel the value does not get,
          and the longest label in the slate (« Démarrage ») fits. */}
      <span className="slate-label text-muted w-16 shrink-0 text-meta">{label}</span>
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
