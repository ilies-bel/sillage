/**
 * The left navigation rail — the app's one permanent surface (V2).
 *
 * It carries three destinations and two footer rows, and nothing else. In
 * particular:
 *
 *  · **There is no *Clients* item.** A client is not a place in this product:
 *    every question about one is asked by typing its name into the search box
 *    on the screen the rep is already on (DEC-25). A nav item would be a fourth
 *    destination whose content is a query, and it would compete with the box
 *    that answers it.
 *  · **There is no sync status line.** The calendar is optional (DEC-26) and
 *    never renders as a degradation (DEC-32); « Synchronisé il y a 4 min » in
 *    permanent chrome is an optional connector reporting itself on every screen,
 *    which is precisely the app-level banner DEC-32 retired. Where the calendar
 *    was last read is stated once, in the empty day's card, where it is an
 *    answer to a question the rep just asked.
 *  · **« Mise à jour prête » is drawn only when one is.** `phase: 'ready'` is a
 *    terminus — the update sits on disk until a human presses *Installer et
 *    redémarrer* (`core/contracts/update.ts`) — so this row is a standing offer
 *    and not a notification. It is brand-coloured because it is the one row here
 *    that is about something new; it is not a filled control, so the screen's
 *    single fill (US-26) is untouched. It never moves the general status
 *    (DEC-32): it opens the pane that owns the decision.
 *
 * The three destinations reuse `SectionNav`, which is where « selection is brand
 * blue, never orange », « selection is in the accessible tree » and the 2px edge
 * rule already live. A second implementation of a current nav item is a second
 * place for those three to drift.
 */
import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'
import { SectionNav, type SectionNavItem } from './SectionNav.tsx'

/** Where the rep is. `À valider` is a query, not a screen — see `RailProps`. */
export type RailPlace = 'aujourdhui' | 'a-valider' | 'historique'

export interface RailProps {
  current: RailPlace
  /**
   * How many calls are waiting to be validated, or `null` when nothing is.
   *
   * The same number *En attente de validation* prints on the calendar, passed in
   * rather than asked for again: two components asking the same channel is two
   * answers that can disagree, and this one sits beside the section that draws
   * the rows.
   */
  pending: number | null
  /** `update:status` reports `phase: 'ready'`. See the docblock. */
  updateReady: boolean
  onPlace: (place: RailPlace) => void
  onReglages: () => void
  /** Opens Réglages on the update pane. Required whenever `updateReady`. */
  onUpdate: () => void
}

/** *À valider* is built in two branches (with a count and without), so its path
 *  is named rather than typed twice. */
const GLYPH_VALIDER = 'M20 6 9 17l-5-5'

const ITEM =
  'flex w-full items-center gap-snug border-l-2 border-transparent px-row py-snug text-left text-ui transition active:translate-y-px'

export function Rail({
  current,
  pending,
  updateReady,
  onPlace,
  onReglages,
  onUpdate,
}: RailProps) {
  /*
   * **One icon column for all five rows.** Measured, the labels sat on two left
   * edges — the three destinations at x=18 and the two footer buttons at x=42 —
   * because only the footer reserved a glyph slot. A 24px step down a five-row
   * list, on the one surface that is on every screen.
   *
   * The three paths are the same 24-box, 1.75-stroke family `RailGlyph` draws
   * below: a calendar page for the day, a check for the queue, a clock turned
   * back for the record.
   */
  const items: readonly SectionNavItem<RailPlace>[] = [
    {
      id: 'aujourdhui',
      label: 'Aujourd’hui',
      glyph: 'M4 8h16M8 3v3m8-3v3M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
    },
    pending !== null && pending > 0
      ? {
          id: 'a-valider' as const,
          label: 'À valider',
          glyph: GLYPH_VALIDER,
          note: String(pending),
          noteLabel:
            pending === 1
              ? '1 appel en attente de validation'
              : `${pending} appels en attente de validation`,
        }
      : { id: 'a-valider' as const, label: 'À valider', glyph: GLYPH_VALIDER },
    {
      id: 'historique',
      label: 'Historique',
      glyph: 'M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 5v4h4',
    },
  ]

  return (
    /*
      **The rail narrows before the content does.**

      224px is the design's width and what it draws at 1024 and up. At 960×600 —
      the minimum `app/main.ts` declares — that is a quarter of the window spent
      on five labels, and the cost lands on the one column that has real work to
      do: measured, the search results list hid 41px of a row inside its own box
      at 960 and was clean at 1060. Chrome gives way first.
    */
    /*
      **A ground, not a stroke.** The rail was `--bg-card-soft` with a 1px
      `--border-subtle` down its right edge, which is two ways of saying the
      same boundary: `--bg-card-soft` is #f9fbfd against the canvas's #f7f9fb,
      two units apart and invisible, so the whole separation was carried by the
      line and the fill was doing nothing. `--bg-subtle` is #eef3f7 — nine units
      down from the canvas, a step a rep can actually see — and with it the
      stroke is redundant and goes. One boundary, stated once.

      Every text token is measured against `--bg-subtle` in `tokens.css`
      precisely because it is « the darkest surface any of them lands on »:
      `--text-muted` is 4.56:1 there, so the footer rows still clear AA. The
      selected item brings its own `--brand-50`, so `SectionNav`'s 5.80:1 is
      untouched.
    */
    <div className="bg-subtle flex w-44 shrink-0 flex-col py-row lg:w-56">
      {/*
        The product's name, once, at the top of the one surface that is on every
        screen. It is not a heading: the page's `h1` says what changed (US-22),
        and a wordmark that claimed to be the heading would take that from it on
        all three screens at once.
      */}
      <p className="font-display text-strong mb-block px-row text-display leading-none">Sillage</p>

      <SectionNav
        label="Navigation principale"
        items={items}
        current={current}
        onSelect={onPlace}
      />

      {/*
        `mt-auto`: the two footer rows sit at the bottom of the window, where
        chrome that is not a destination belongs. Réglages is last and « Mise à
        jour prête » is directly above it — the pane it opens is in Réglages, so
        the offer stands next to the door it goes through.
      */}
      <div className="mt-auto">
        {updateReady ? (
          <button type="button" onClick={onUpdate} className={cn(ITEM, 'text-brand-700 font-medium')}>
            <RailGlyph d="M12 3v11m0 0 4-4m-4 4-4-4M4 19h16" />
            <span className="min-w-0 flex-1 truncate">Mise à jour prête</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onReglages}
          className={cn(ITEM, 'text-muted hover:bg-card hover:text-body')}
        >
          <RailGlyph d="M5 7h9m3 0h2M5 12h2m3 0h9M5 17h13m3 0h1" />
          <span className="min-w-0 flex-1 truncate">Réglages</span>
        </button>
      </div>
    </div>
  )
}

/**
 * A 16px stroke glyph, `aria-hidden`, in `currentColor`.
 *
 * Decoration and nothing else: every row here is labelled by its own French
 * text, so the glyph carries no state and no meaning colour alone would have to
 * supply. It is in the flow rather than absolutely placed, so it cannot end up
 * over the label at a narrow rail.
 *
 * **`stroke-width: 2`, which is the product's one icon weight.**
 *
 * It was 1.75 here and in `SectionNav`, with no recorded reason, against
 * lucide's default of 2 on every other icon in the app. Measured over every
 * stage at both sizes: 500 icons at 2 across 36 screens, 250 at 1.75 across 25,
 * and ten scans drawing both at once — the agenda's empty day puts a 16px rail
 * glyph at 1.75 beside a 22px notice icon at 2. Two hand-rolled glyphs against
 * two hundred and fifty-five vendor ones is not a decision, it is the two files
 * that drew their own SVG. `shot.mjs --geometry` holds a screen to one weight.

 */
function RailGlyph({ d }: { d: string }): ReactNode {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  )
}
