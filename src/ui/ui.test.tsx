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
