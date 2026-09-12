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
  Row,
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
    // a settings rail is not that. `--brand-700` on `--brand-50` is 5.80:1.
    render(
      <SectionNav
        label="Sections des réglages"
        items={items}
        current="connecteurs"
        onSelect={() => {}}
      />,
    )
    const current = screen.getByRole('button', { name: 'Connecteurs' })
    expect(current.className).toContain('bg-brand-50')
    expect(current.className).toContain('text-brand-700')
    expect(current.className).not.toMatch(/accent/)
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
