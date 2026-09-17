/**
 * The two rules `src/ui/` exists to make structural.
 *
 * Both are stated invariants that documentation has never once enforced, and
 * both are cheap to break by hand: a `bg-danger` dot with no word beside it, a
 * `disabled={busy}` with the explanation left in a comment. These tests are
 * what turns them from conventions into things the code refuses to express.
 *
 * The third block is the reason `cn()` was changed. A component that takes a
 * `className` override and concatenates it is a component whose override works
 * by accident.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  Button,
  Chip,
  CopyButton,
  EmptyState,
  List,
  OverflowMenu,
  Row,
  RowLead,
  RowTitle,
  SectionHeader,
  SectionNav,
  Segmented,
  StateDot,
} from './index.ts'
import { cn, SPACING_STEPS, TYPE_STEPS } from '../lib/utils.ts'

// `globals: false` in vitest.config.mts, so RTL never registers its own.
afterEach(cleanup)

describe('a state dot is never the only signal', () => {
  test('the dot and its label are one component — the dot cannot be rendered alone', () => {
    render(<StateDot tone="armed" label="Prêt" />)
    expect(screen.getByText('Prêt')).toBeTruthy()
  })

  test('the coloured element is decorative, so the label is the accessible name', () => {
    const { container } = render(<StateDot tone="down" label="Hors ligne" />)
    const dot = container.querySelector('[aria-hidden]')
    expect(dot, 'the dot must exist and must be hidden from assistive tech').toBeTruthy()
    expect(dot!.className).toContain('bg-danger')
    // The word is in the accessible tree; the colour is not the carrier.
    expect(container.textContent).toBe('Hors ligne')
  })

  test('a blank label is refused, not rendered', () => {
    // The type already requires `label`. This is the other half: `label=""` and
    // `label=" "` type-check, and both would put a bare coloured dot on screen.
    expect(() => render(<StateDot tone="ok" label="" />)).toThrow(/never the only signal/)
    expect(() => render(<StateDot tone="ok" label="   " />)).toThrow(/never the only signal/)
  })

  test('every tone reaches a token class and never a literal', () => {
    for (const tone of ['armed', 'ok', 'warn', 'down', 'selected', 'none'] as const) {
      const { container } = render(<StateDot tone={tone} label="état" />)
      expect(container.querySelector('[aria-hidden]')!.className).not.toMatch(/#[0-9a-f]{3}/i)
    }
  })
})

describe('a disabled control always carries its reason', () => {
  test('the reason is in the DOM beside the control, not in a title attribute', () => {
    render(
      <Button disabled disabledReason="Aucun calendrier connecté.">
        Synchroniser
      </Button>,
    )
    const control = screen.getByRole('button', { name: 'Synchroniser' })
    expect(control.hasAttribute('disabled')).toBe(true)
    expect(control.getAttribute('title')).toBe(null)
    expect(screen.getByText('Aucun calendrier connecté.')).toBeTruthy()
  })

  test('the reason is linked to the control, so it is announced with it', () => {
    render(
      <Button disabled disabledReason="Envoi en cours…">
        Valider
      </Button>,
    )
    const control = screen.getByRole('button', { name: 'Valider' })
    const id = control.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    expect(document.getElementById(id!)?.textContent).toBe('Envoi en cours…')
  })

  test('a blank reason is refused — a greyed button with no explanation is the bug', () => {
    expect(() => render(<Button disabled disabledReason="  ">Valider</Button>)).toThrow(/DEC-26/)
  })

  test('an enabled button renders the control alone, with no describedby and no reason slot', () => {
    const { container } = render(<Button>Ouvrir</Button>)
    const control = screen.getByRole('button', { name: 'Ouvrir' })
    expect(control.hasAttribute('disabled')).toBe(false)
    expect(control.getAttribute('aria-describedby')).toBe(null)
    expect(container.textContent).toBe('Ouvrir')
  })

  test('a button is type="button" unless it is asked to submit', () => {
    // A bare <button> inside a <form> submits it. Review's panel is a form.
    render(<Button>Réessayer</Button>)
    expect(screen.getByRole('button', { name: 'Réessayer' }).getAttribute('type')).toBe('button')
  })
})

describe('a section rail says which section is open, and not only in colour', () => {
  const items = [
    { id: 'transcription', label: 'Transcription' },
    { id: 'connecteurs', label: 'Connecteurs' },
  ] as const

  test('the current section is aria-current, so colour is not the carrier', () => {
    render(
      <SectionNav
        label="Sections des réglages"
        items={items}
        current="connecteurs"
        onSelect={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Connecteurs' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(
      screen.getByRole('button', { name: 'Transcription' }).getAttribute('aria-current'),
    ).toBe(null)
  })

  test('the rail is a named landmark — a screen holds more than one list', () => {
    render(
      <SectionNav
        label="Sections des réglages"
        items={items}
        current="transcription"
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('navigation', { name: 'Sections des réglages' })).toBeTruthy()
  })

  test('selection is brand blue, never the accent orange', () => {
    // VISION.md §6 gives orange exactly one meaning — armed or recording — and
    // a settings rail is not that. `--brand-700` on `--bg-inner` is 6.28:1.
    render(
      <SectionNav
        label="Sections des réglages"
        items={items}
        current="connecteurs"
        onSelect={() => {}}
      />,
    )
    const current = screen.getByRole('button', { name: 'Connecteurs' })
    expect(current.className).toContain('text-brand-700')
    expect(current.className).not.toMatch(/accent/)
  })

  test('the selected row lifts off the rail instead of tinting with it', () => {
    /*
     * `--brand-50` #ebf8ff on the rails' `--bg-subtle` #eef3f7 is **1.032:1** —
     * the fill did nothing, and selection rested entirely on the 2px rule and a
     * text colour. On two surfaces, because the Réglages sheet copied the app
     * rail's ground and took the defect with it.
     *
     * `--bg-inner` is the same lift `Segmented`'s raised chip uses against the
     * same ground, so « the selected one is the white one » is now one idiom
     * rather than two half-idioms.
     */
    render(
      <SectionNav
        label="Sections des réglages"
        items={items}
        current="connecteurs"
        onSelect={() => {}}
      />,
    )
    const current = screen.getByRole('button', { name: 'Connecteurs' })
    expect(current.className).toContain('bg-inner')
    expect(current.className).not.toContain('bg-brand-50')
  })

  test('the current section is also marked by a rule, not by the wash alone', () => {
    // `--brand-50` is 1.09:1 against the rail it sits on. On a projector or in
    // sunlight the tint is the first thing to go; a 2px edge rule is a shape and
    // survives. Every item reserves the width, so selection never nudges a label.
    render(
      <SectionNav
        label="Sections des réglages"
        items={items}
        current="connecteurs"
        onSelect={() => {}}
      />,
    )

    const current = screen.getByRole('button', { name: 'Connecteurs' })
    const other = screen.getByRole('button', { name: 'Transcription' })
    expect(current.className).toContain('border-l-2')
    expect(current.className).toContain('border-brand-500')
    expect(other.className).toContain('border-l-2')
    expect(other.className).toContain('border-transparent')
  })

  test('choosing a section reports the id, not the label', () => {
    const onSelect = vi.fn()
    render(
      <SectionNav
        label="Sections des réglages"
        items={items}
        current="transcription"
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Connecteurs' }))
    expect(onSelect).toHaveBeenCalledWith('connecteurs')
  })

  test('a current that names no section is refused — the content pane would be empty', () => {
    expect(() =>
      render(
        <SectionNav
          label="Sections des réglages"
          items={items}
          // @ts-expect-error — the type already forbids it; this is the runtime half.
          current="diagnostics"
          onSelect={() => {}}
        />,
      ),
    ).toThrow(/names no section/)
  })
})

describe('a view switch says which view is on, and is not a navigation rail', () => {
  const options = [
    { id: 'jour', label: 'Jour' },
    { id: 'mois', label: 'Mois' },
  ] as const

  test('the current option is aria-pressed, so colour is not the carrier', () => {
    render(
      <Segmented label="Affichage du calendrier" options={options} current="mois" onSelect={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Mois' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Jour' }).getAttribute('aria-pressed')).toBe('false')
  })

  test('it is a group and not a nav — these buttons are not destinations', () => {
    // The difference from SectionNav, and the reason both exist. A screen
    // reader must not announce "Mois, page courante" for a control that
    // changes how much of one screen is in view.
    render(
      <Segmented label="Affichage du calendrier" options={options} current="mois" onSelect={() => {}} />,
    )
    expect(screen.getByRole('group', { name: 'Affichage du calendrier' })).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getByRole('button', { name: 'Mois' }).getAttribute('aria-current')).toBe(null)
  })

  test('selection is brand blue, never the accent orange', () => {
    render(
      <Segmented label="Affichage du calendrier" options={options} current="jour" onSelect={() => {}} />,
    )
    const current = screen.getByRole('button', { name: 'Jour' })
    expect(current.className).toContain('text-brand-700')
    expect(current.className).not.toMatch(/accent/)
  })

  test('choosing an option reports the id, not the label', () => {
    const onSelect = vi.fn()
    render(
      <Segmented label="Affichage du calendrier" options={options} current="jour" onSelect={onSelect} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mois' }))
    expect(onSelect).toHaveBeenCalledWith('mois')
  })

  test('a current that names no option is refused', () => {
    expect(() =>
      render(
        <Segmented
          label="Affichage du calendrier"
          options={options}
          // @ts-expect-error — the type already forbids it; this is the runtime half.
          current="semaine"
          onSelect={() => {}}
        />,
      ),
    ).toThrow(/names no option/)
  })
})

describe('the primitives stay inside the token system', () => {
  test('no primitive emits a hex, on any variant', () => {
    const { container } = render(
      <div>
        <StateDot tone="armed" label="Prêt" />
        <Button variant="primary">Valider</Button>
        <Button variant="bordered">Ouvrir</Button>
        <Button variant="text">Réglages</Button>
        <Button variant="link">Se déconnecter</Button>
        <Chip variant="choice" onClick={() => {}}>
          Groupe SA
        </Chip>
        <Chip variant="brand">TJM 520 €</Chip>
        <Chip variant="label">Sur cette machine</Chip>
        <SectionHeader>Connecteurs</SectionHeader>
        <SectionNav
          label="Sections des réglages"
          items={[{ id: 'connecteurs', label: 'Connecteurs' }]}
          current="connecteurs"
          onSelect={() => {}}
        />
        <List>
          <Row>
            <RowTitle title="Point hebdo" subtitle="ACME" />
          </Row>
        </List>
        <Segmented
          label="Affichage du calendrier"
          options={[
            { id: 'jour', label: 'Jour' },
            { id: 'mois', label: 'Mois' },
          ]}
          current="mois"
          onSelect={() => {}}
        />
        <EmptyState reason="Aucun calendrier connecté.">Aucune réunion aujourd’hui.</EmptyState>
      </div>,
    )
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  test('an empty state states why, not just that', () => {
    render(<EmptyState reason="Le calendrier est facultatif.">Aucune réunion.</EmptyState>)
    expect(screen.getByText('Le calendrier est facultatif.')).toBeTruthy()
  })
})

/*
 * ── the press, and the three controls that must not have one ────────────────
 *
 * Measured on the shipped renderer before this round: across six stages, 311
 * live declarations, **one** animated property — 307 colour transitions and four
 * `riseIn`s. Nothing in the product answered a press. It does now, as a one-pixel
 * translate on the transition these controls already carry (`--motion-fast`,
 * 90ms) — driven in Chromium on the day row's own button, `transform: none` at
 * rest and `matrix(1, 0, 0, 1, 0, 1)` with the pointer down.
 *
 * **What this block really holds is the exclusion.** `primary`, `caution` and
 * `danger` are what the review gate's decision ships on, and US-3's own
 * out-of-scope line names them: the page turn and *Valider* were once the same
 * DOM node in the same rectangle 63ms apart, and a shared `transition` painted
 * the ship's fill under the turn's label for a frame. `POST /v1/crm/tasks` has no
 * idempotency key. jsdom cannot press anything usefully — every box measures zero
 * and `:active` is not reachable — so what is asserted is the *class*, which is
 * the thing a future edit would delete or extend by hand.
 */
describe('a control answers the press, and the ones that ship do not', () => {
  const PRESS = /(^|\s|:)active:translate-y-px(\s|$)/

  test.each(['bordered', 'nav', 'text', 'link'] as const)(
    'Button variant %s sinks one pixel under the finger',
    (variant) => {
      render(<Button variant={variant}>Ouvrir</Button>)
      expect(screen.getByRole('button').className).toMatch(PRESS)
    },
  )

  test.each(['primary', 'caution', 'danger'] as const)(
    'Button variant %s is deliberately still — it is what a decision ships on',
    (variant) => {
      render(<Button variant={variant}>Valider</Button>)
      expect(screen.getByRole('button').className).not.toMatch(PRESS)
    },
  )

  test('the press is never offered by a control that cannot be used', () => {
    // `enabled:` and not a bare `active:`: a disabled control that sinks under
    // the finger is DEC-26's dead button pretending to work.
    render(
      <Button variant="bordered" disabled disabledReason="Aucun modèle configuré.">
        Ouvrir
      </Button>,
    )
    expect(screen.getByRole('button').className).toMatch(/enabled:active:translate-y-px/)
  })

  test('a chip, a view switch and a section rail answer it too', () => {
    render(
      <div>
        <Chip onClick={() => {}}>Groupe SA</Chip>
        <Segmented
          label="Affichage du calendrier"
          options={[
            { id: 'jour', label: 'Jour' },
            { id: 'mois', label: 'Mois' },
          ]}
          current="mois"
          onSelect={() => {}}
        />
        <SectionNav
          label="Sections des réglages"
          items={[{ id: 'connecteurs', label: 'Connecteurs' }]}
          current="connecteurs"
          onSelect={() => {}}
        />
      </div>,
    )
    const pressable = screen.getAllByRole('button').filter((el) => PRESS.test(el.className))
    // Chip, two segments, one rail item.
    expect(pressable.length).toBe(4)
  })
})

/*
 * ── `animate-fade-in` finally has a caller ───────────────────────────────────
 *
 * `fadeIn` was declared in `tailwind.config.js` beside `riseIn` from the day the
 * config was written, and a grep for `animate-fade-in` under `src/` returned
 * nothing: two keyframes declared, one reachable — the same shape `--motion-fast`
 * was in. `CopyButton` is the surface that wanted it, because the whole argument
 * for a label swap over a toast is that the answer appears under the rep's
 * cursor, and it appeared between two frames.
 *
 * `key={state}` is what makes it replay: React reuses the node otherwise, the
 * class never re-enters, and the animation runs once per mount and never again.
 * jsdom runs no animation, so the property asserted here is the one a hand edit
 * would break — that the label is wrapped, that the wrapper carries the class,
 * and that it is keyed. Measured in Chromium on the gate's own *Copier*: « Copié »
 * at opacity 0.227 at +20ms, 0.864 at +60ms, 1.000 at +360ms; and 1.000 at every
 * sample under `prefers-reduced-motion`, which is the instant swap this replaces.
 */
describe('the copy confirmation arrives rather than appearing', () => {
  test('the label is a keyed, fading wrapper and not a bare string', () => {
    const { container } = render(<CopyButton text="le compte-rendu" what="le compte-rendu" />)
    const wrapper = container.querySelector('.animate-fade-in')
    expect(wrapper, 'le libellé doit être enveloppé pour pouvoir réapparaître').toBeTruthy()
    expect(wrapper!.textContent).toBe('Copier')
  })

  test('and the wrapper is the only thing the button holds, so the width does not move', () => {
    // `CopyButton`'s own docblock: « The width does not move: « Copié » is set on
    // the same box, so nothing beside it steps sideways. » A fade that introduced
    // a block wrapper would break that silently, and no screenshot shows a
    // one-character reflow.
    render(<CopyButton text="le brouillon" what="le brouillon" />)
    const button = screen.getByRole('button')
    expect(button.children.length).toBe(1)
    expect(button.children[0].tagName).toBe('SPAN')
  })
})

describe('cn() resolves conflicting utilities instead of emitting both', () => {
  test('the later class wins, which is what makes a className override an override', () => {
    // The old implementation returned 'px-row px-block' and left the winner to
    // whichever order Tailwind happened to emit them in its stylesheet.
    expect(cn('px-row py-tight', 'px-block')).toBe('py-tight px-block')
    expect(cn('text-ui', 'text-meta')).toBe('text-meta')
  })

  test('a type size and a text colour are not the same slot, despite sharing text-', () => {
    // `text-ui` is a size and `text-muted` is a colour. If tailwind-merge put
    // them in one group, every primitive that sets both would lose one.
    expect(cn('text-muted text-ui')).toBe('text-muted text-ui')
  })

  test('falsy variants drop out', () => {
    expect(cn('text-ui', false && 'w-full', undefined, null)).toBe('text-ui')
  })

  test('the scales cn() knows about are the scales tailwind.config.js defines', () => {
    // Two lists in two files is a drift risk, and the drift is invisible: the
    // symptom is a `className` override quietly failing to override, months
    // later, in one component.
    // `process.cwd()`, not `import.meta.url`: under the jsdom environment this
    // file's module URL is an http:// one and `fileURLToPath` refuses it.
    const config = readFileSync(resolve(process.cwd(), 'tailwind.config.js'), 'utf8')
    const keys = (group: string): string[] => {
      const block = new RegExp(`${group}:\\s*\\{([\\s\\S]*?)\\n      \\}`).exec(config)
      expect(block, `tailwind.config.js must still declare a ${group} block`).toBeTruthy()
      return [...block![1].matchAll(/^\s*'?([\w-]+)'?:/gm)].map(([, key]) => key)
    }

    expect(keys('spacing').sort()).toEqual([...SPACING_STEPS].sort())
    expect(keys('fontSize').sort()).toEqual([...TYPE_STEPS].sort())
  })
})

/*
 * The overflow: one 24×24 glyph, a real menu behind it, three ways out.
 */
describe('OverflowMenu', () => {
  test('opens on press, selects an item, and closes on Échap back to the trigger', () => {
    const onSelect = vi.fn()
    render(
      <OverflowMenu what="le compte-rendu" items={[{ id: 'copier', label: 'Copier', onSelect }]} />,
    )
    const trigger = screen.getByRole('button', { name: 'Autres actions sur le compte-rendu' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    const item = screen.getByRole('menuitem', { name: 'Copier' })
    expect(document.activeElement).toBe(item)
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copier' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('an outside press closes it', () => {
    render(<OverflowMenu what="le compte-rendu" items={[{ id: 'a', label: 'A', onSelect() {} }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Autres actions sur le compte-rendu' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

/*
 * **The two additions the Granola pass made to the nav item, and the shared
 * leading column.** All three are the kind of thing a screenshot shows and a
 * DOM test pins: a colour that means the wrong thing, an icon column only half
 * the rows reserve, and a width two lists have to agree on.
 */
describe('a note is a count unless the caller says it is a fault', () => {
  const items = [
    { id: 'a' as const, label: 'Aujourd’hui' },
    { id: 'b' as const, label: 'À valider', note: '3', noteLabel: '3 appels en attente' },
  ]

  test('by default the count is brand blue, not the warning orange', () => {
    /*
     * `--warn` marked both « 2 connecteurs en défaut » and « 3 calls waiting »,
     * which put a burnt orange twenty pixels from the bright `--accent` of
     * « réunion prête » in the calendar legend — two oranges, two meanings, one
     * glance. A queue is not a fault.
     */
    render(<SectionNav label="Navigation" items={items} current="a" onSelect={() => {}} />)
    const note = screen.getByText('3')
    expect(note.className).toContain('text-brand-700')
    expect(note.className).not.toContain('text-warn')
  })

  test('and `warn` is still available for the one note that is a fault', () => {
    const faults = [items[0], { ...items[1], noteTone: 'warn' as const }]
    render(<SectionNav label="Navigation" items={faults} current="a" onSelect={() => {}} />)
    expect(screen.getByText('3').className).toContain('text-warn')
  })

  test('the count keeps its sentence for a screen reader either way', () => {
    // Colour is never the only signal in this product, and « 3 » on its own
    // could be anything.
    render(<SectionNav label="Navigation" items={items} current="a" onSelect={() => {}} />)
    expect(screen.getByText('3 appels en attente')).toBeTruthy()
  })
})

describe('an icon column is all of the rows or none of them', () => {
  test('a glyph is drawn, hidden from the tree, and never the item’s name', () => {
    /*
     * The rail's labels sat on two left edges — three destinations at x=18 and
     * two footer buttons at x=42 — because only the footer reserved a slot.
     * `glyph` is a path so every row in a rail is the same 24-box stroke family;
     * the row is still named by its French label and nothing else.
     */
    const items = [{ id: 'a' as const, label: 'Historique', glyph: 'M12 7v5l3 2' }]
    render(<SectionNav label="Navigation" items={items} current="a" onSelect={() => {}} />)
    const button = screen.getByRole('button', { name: 'Historique' })
    const svg = button.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe('M12 7v5l3 2')
  })

  test('and an item without one draws no empty slot', () => {
    const items = [{ id: 'a' as const, label: 'Transcription' }]
    render(<SectionNav label="Navigation" items={items} current="a" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Transcription' }).querySelector('svg')).toBeNull()
  })
})

describe('every list row starts on one leading edge', () => {
  test('RowLead is one width, so two lists cannot disagree about it', () => {
    /*
     * Measured on the agenda before this existed: three sections of one
     * scrolling column drew title left edges at 724 / 592 / 676 — a 132px
     * spread — partly because two of them used `w-28` and `w-16` for the same
     * column. The width lives in one component now; a second number is a
     * second grid.
     */
    const { container } = render(
      <List bare>
        <Row>
          <RowLead>14:30 – 15:30</RowLead>
          <RowTitle title="Néovia Santé" />
        </Row>
      </List>,
    )
    const lead = container.querySelector('span.w-28')
    expect(lead?.textContent).toBe('14:30 – 15:30')
    // Tabular, because a column of times that reflows as it updates is a column
    // nobody can scan.
    expect(lead?.className).toContain('tabular-nums')
  })

  test('a bare list drops the box and keeps the hairlines', () => {
    const { container } = render(
      <List bare>
        <Row>
          <RowTitle title="Une réunion" />
        </Row>
      </List>,
    )
    const list = container.querySelector('ul')
    expect(list?.className).toContain('divide-y')
    expect(list?.className).not.toContain('border-card')
    expect(list?.className).not.toContain('rounded-lg')
  })
  test('a bare list starts its rows on the list’s own edge', () => {
    /*
     * The padding a `Row` carries is the distance from an edge stroke to the
     * text. `bare` takes the stroke away, so the padding became a distance from
     * nothing: measured on the shipped renderer at 1280×800, every boxless list
     * in the product drew a full-bleed hairline with its rows inset 16 to 20 px
     * inside it, and the caption naming the list sat on the outer edge while the
     * first row sat on the inner one. `shot.mjs --geometry` holds the rendered
     * geometry to it on all 156 stagings; this holds the composition, which is
     * the half a headless DOM can see.
     */
    const { container } = render(
      <List bare>
        <Row>
          <RowTitle title="Une réunion" />
        </Row>
      </List>,
    )
    expect(container.querySelector('ul')?.className).toContain('[&>*]:px-0')
    // And the boxed list keeps its inset, because there it is a real distance.
    const boxed = render(
      <List>
        <Row>
          <RowTitle title="Une réunion" />
        </Row>
      </List>,
    )
    expect(boxed.container.querySelector('ul')?.className).not.toContain('[&>*]:px-0')
    expect(boxed.container.querySelector('li')?.className).toContain('px-row')
  })

})
