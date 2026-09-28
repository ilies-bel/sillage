/**
 * *Réglages* is where the product admits what it cannot do, so these test the
 * admissions rather than the layout:
 *
 *   DEC-32  the connectors split **Requis** / **Facultatifs**, the split comes
 *           from the contract the header control aggregates over, and the
 *           sentence above it says what that control means
 *   DEC-30  local transcription is the first thing under *Transcription* and is
 *           written as the normal case — never *dégradé*, never a fallback
 *   DEC-33  a provider that cannot be used is **listed with the reason**, never
 *           dropped from the table
 *   DEC-26  a connector that is down states why, and offers *Réessayer* exactly
 *           when retrying is worth something
 *   DEC-24  a probe finding says what stops working, and a missing probe says
 *           why it is missing
 *   DEC-27  two exports, and the one that carries client conversation content
 *           says so on the control itself, in French
 *
 * The screen is two panes now (VISION.md §6), so a section that is not open is
 * not in the DOM. `open()` below is the click a rep makes; every assertion that
 * used to read the whole screen names the section it belongs to instead.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ConnectorHealth } from '../../../electron/core/contracts/health.ts'
import {
  OPTIONAL_CONNECTORS,
  REQUIRED_CONNECTORS,
} from '../../../electron/core/contracts/status.ts'
import { MENTION_SENTENCE_DEFAULT } from '../../../electron/core/contracts/mention.ts'
import type { SettingsSnapshot } from '../../../electron/core/contracts/settings.ts'
import type { UpdateStatus } from '../../../electron/core/contracts/update.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Reglages } from '../Reglages.tsx'
import {
  ALLOWED_WHILE_TYPING,
  SHORTCUTS,
  typingExceptionKeys,
} from '../../app/shortcuts.ts'

let bridge: FakeBridge
let uninstall: () => void

const snapshot = (over: Partial<SettingsSnapshot> = {}): SettingsSnapshot => ({
  offlineOnly: false,
  mentionSentence: MENTION_SENTENCE_DEFAULT,
  stt: {
    rows: [
      {
        id: 'local-whisper',
        label: 'Whisper (local)',
        tier: 'local',
        residency: 'local',
        cost: 'free',
        auth: 'none',
        credential: { stored: false, hint: null },
        fields: [],
        configured: true,
        selected: true,
        selectable: true,
        reason: null,
      },
      {
        id: 'deepgram',
        label: 'Deepgram',
        tier: 'cloud',
        residency: 'remote',
        cost: 'metered',
        auth: 'apiKey',
        credential: { stored: false, hint: null },
        fields: [],
        configured: false,
        selected: false,
        selectable: false,
        reason: 'aucune clé enregistrée',
      },
    ],
    selected: 'local-whisper',
    reason: null,
  },
  llm: {
    rows: [
      {
        id: 'mistral',
        label: 'Mistral AI',
        tier: 'cloud',
        residency: 'remote',
        cost: 'metered',
        auth: 'apiKey',
        credential: { stored: false, hint: null },
        fields: [],
        configured: false,
        selected: false,
        selectable: false,
        reason: 'aucune clé enregistrée',
      },
    ],
    selected: null,
    reason: 'aucun modèle de langage n’est configuré',
  },
  connectors: [
    { id: 'capture', label: 'Audio', health: { state: 'ok' } },
    {
      id: 'transcribe',
      label: 'Transcription',
      health: { state: 'ok' },
    },
    { id: 'llm', label: 'Analyse', health: { state: 'ok' } },
    { id: 'mail', label: 'Outlook', health: { state: 'ok' } },
    {
      id: 'crm',
      label: 'VerySwing',
      health: { state: 'down', reason: 'VerySwing injoignable', since: 1000, retryable: true },
    },
    {
      id: 'calendar',
      label: 'Calendrier',
      health: {
        state: 'down',
        reason: 'autorisation refusée — votre administrateur doit approuver',
        since: 1000,
        retryable: false,
      },
    },
  ],
  auth: { status: 'signedOut' },
  probe: {
    at: Date.now() - 60_000,
    authenticated: true,
    findings: [
      {
        id: 'listCustomers',
        label: 'liste des clients',
        matters: 'sans elle, aucun compte client n’est proposé',
        required: true,
        state: 'missing',
        status: 404,
        detail: 'absente de ce tenant',
      },
      {
        id: 'findProspectContacts',
        label: 'recherche de contacts par e-mail',
        matters: 'sans elle, un interlocuteur en adresse personnelle n’est jamais rattaché',
        required: true,
        state: 'ok',
        status: 200,
        detail: 'disponible',
      },
    ],
    columnGaps: [],
    ok: false,
    summary: 'une capacité manque sur ce tenant : liste des clients',
  },
  probeReason: null,
  retention: { diagnosticsDays: 90, meetingContent: 'never' },
  models: {
    rows: [
      {
        id: 'Xenova/whisper-small',
        label: 'Whisper Small',
        sizeMb: 466,
        speed: 'medium',
        accuracy: 'très bonne',
        bundled: true,
        status: 'ready',
        progress: 100,
        reason: null,
        selected: true,
      },
      {
        id: 'Xenova/whisper-medium',
        label: 'Whisper Medium',
        sizeMb: 1530,
        speed: 'slow',
        accuracy: 'très bonne',
        bundled: false,
        status: 'absent',
        progress: 0,
        reason: null,
        selected: false,
      },
    ],
    selected: 'Xenova/whisper-small',
  },
  ...over,
})

const mount = (over: Partial<SettingsSnapshot> = {}) => {
  bridge
    .when('settings:snapshot', () => snapshot(over))
    .when('diagnostics:recent', () => [])
    .when('diagnostics:export', ({ mode }) => ({
      path: `/tmp/diagnostics-${mode}.ndjson`,
      events: 3,
    }))
    // Every mount answers this: the rail is drawn whatever section is open, and
    // a channel with no responder rejects rather than resolving empty.
    .when('update:status', () => updateStatus())
  return render(<Reglages onBack={() => {}} />)
}

const updateStatus = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  phase: 'idle',
  currentVersion: '0.1.1',
  availableVersion: null,
  percent: null,
  reason: null,
  checkedAt: null,
  installable: false,
  blockedReason: null,
  ...over,
})

/**
 * The click a rep makes in the left rail — scoped to the rail, because the rail
 * and the pane both hold a control called *Diagnostics* and only one of them
 * navigates.
 */
const open = async (section: string) => {
  const rail = await screen.findByRole('navigation', { name: 'Sections des réglages' })
  await act(async () => {
    // By prefix: a rail item that has something wrong inside it carries the
    // count in its accessible name (« Connecteurs, 3 connecteurs en défaut »).
    within(rail).getByRole('button', { name: new RegExp(`^${section}`) }).click()
  })
}

/** The right pane, for the same reason. */
const pane = () => within(screen.getByRole('main'))

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('two panes: the section list left, its content right (VISION.md §6)', () => {
  test('every section is in the rail, and only one is open', async () => {
    mount()
    const rail = await screen.findByRole('navigation', { name: 'Sections des réglages' })

    // The label itself, not the whole button: an item may also carry a count
    // and the sentence that count reads as.
    const labels = [...rail.querySelectorAll('button')].map((b) => b.firstElementChild?.textContent)
    expect(labels).toEqual([
      'Transcription',
      'Modèle de langage',
      'Connecteurs',
      'Calendrier',
      'Raccourcis clavier',
      'Mise à jour',
      'Diagnostics',
    ])

    // The fixture's connectors that are not `ok`, counted — the rail says so
    // where the choice is made rather than only inside the section.
    const connecteurs = within(rail).getByRole('button', { name: /^Connecteurs/ })
    expect(connecteurs.textContent).toContain('2 connecteurs en défaut')

    // One current section, announced rather than merely tinted.
    const current = rail.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
  })

  test('it opens on Connecteurs — the destination of the header control (DEC-32)', async () => {
    // A rep who clicks « Transcription indisponible » in the header lands on
    // the pane that names the subsystem and offers the retry. Opening on the
    // first section would make that one click cost a second one.
    mount()
    expect(await screen.findByText('Requis')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Connecteurs/ }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  test('choosing a section swaps the right pane, and nothing overlays the pane (HR-10)', async () => {
    const { container } = mount()
    await open('Diagnostics')

    expect(screen.getByText(/conservés 90 jours/)).toBeTruthy()
    // The connectors pane is gone, not hidden behind something.
    expect(screen.queryByText('Facultatifs')).toBeNull()

    /*
      **One dialog, and it is the sheet itself** (V2).

      Réglages is a drawer over the calendar now rather than a screen beside it,
      so `[role="dialog"]` is no longer proof of a popover — it is the frame. The
      rule HR-10 is about survives intact and is what is asserted here: the
      sections rail *swaps* the pane, and nothing inside the sheet overlays
      anything else. So exactly one dialog, and no second layer of chrome.
    */
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(container.querySelector('dialog')).toBeNull()
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  test('the pane’s title and its way out do not scroll away with the section', async () => {
    /*
      **The sheet's only visible exit left the window under the sheet's own
      control.**

      `ReadingColumn` gave this pane the mask and the page turn it was the last
      scroller in the product to have. The title row went inside it — the `h2`
      that says which section a rep is in, and the ✕ that is the only way out
      they can see. So pressing « Lire la suite de la section », the product's
      own control, to the end of *Connecteurs* put both off screen:

          1280×800   titre y −537 · ✕ y −536   clipped: true
          960×600    titre y −709 · ✕ y −708   clipped: true

      (`scratch/probe-reglages-turn.mjs`, both sizes, pressing the product's own
      page turn until it stops offering.) The pane then draws no title, no ✕,
      and one control saying « Remonter dans la section ». Échap and the veil
      still close it — neither is visible, and a rep who has just read to the
      bottom of a settings section has no reason to know either exists.

      The reasoning was already in this file, twenty lines above the column, and
      applied to the wrong element: the `notice` strip is outside the column
      « so the pane can be scrolled anywhere and the sentence is still on
      screen ». That is exactly the property a title and a close button need and
      the alert did not need more.

      Asserted on the class that makes the ancestor a scroller rather than on a
      measured offset, because jsdom lays nothing out: `overflow-y-auto` is what
      `ReadingColumn` puts on the element it scrolls, so an ancestor carrying it
      *is* the defect. `--fade` and `--scrollers` were both green over this for
      the life of the component — each asks an intrinsic question about one
      element, and this is a question about two.
    */
    mount()
    const close = await screen.findByRole('button', { name: 'Fermer les réglages' })
    const title = screen.getByRole('heading', { name: 'Connecteurs', level: 2 })

    const scrollerOver = (node: Element): Element | null => {
      for (let n = node.parentElement; n; n = n.parentElement) {
        if (n.classList.contains('overflow-y-auto')) return n
        if (n.getAttribute('role') === 'dialog') break
      }
      return null
    }

    expect(
      scrollerOver(close),
      '« Fermer les réglages » scrolls away with the section it closes',
    ).toBeNull()
    expect(scrollerOver(title), 'the pane’s own title scrolls away with its section').toBeNull()
  })
})

describe('the printed keyboard is a view of the table the matcher uses', () => {
  /*
    **The one line on this pane that was restated instead of read.**

    The rows are built from `SHORTCUTS`, and the docblock over `Raccourcis` gives
    the reason: a key that is added, moved or dropped cannot leave a row claiming
    otherwise. The sentence above the rows was written by hand and drifted —
    « ignorés pendant que vous écrivez, sauf Échap et Ctrl Entrée », two
    exceptions where `ALLOWED_WHILE_TYPING` holds one.

    The one it invented is the expensive one. `valider` is the accelerator for
    `review:confirm` — `POST /v1/crm/tasks`, no idempotency key, `CrmPort` with
    no delete verb — and `shortcuts.ts` took it off that list on purpose, its
    docblock calling the alternative « the most dangerous line in this file »:
    two of the fields a rep types in at the gate are the follow-up mail's subject
    and its body, and `Ctrl Entrée` in a mail body sends the mail in every client
    they have used. Driven on the shipped gate, all six editables, both
    modifiers: `review:confirm` is not called from any of them, and is called
    once from outside — the behaviour is right and has always been right. Only
    the sentence a rep reads was wrong, on the screen whose whole purpose is to
    be read once and believed.

    Asserted against `typingExceptionKeys()` rather than against the literal
    « Échap », so this test cannot be the third place that has to be remembered.
  */
  test('the sentence names exactly the keys that survive an editable', async () => {
    mount()
    await open('Raccourcis clavier')

    const lede = pane().getByText(/ignorés pendant que vous écrivez/)
    const keys = typingExceptionKeys()
    expect(keys.length, 'no exception left to name — the sentence would be a lie either way').
      toBeGreaterThan(0)

    for (const key of keys) {
      expect(lede.textContent, `« ${key} » survives an editable and the pane does not say so`)
        .toContain(key)
    }

    // The other side, and the one that was broken: a key the matcher drops while
    // typing must not be promised here.
    const promised = SHORTCUTS.filter((s) => !ALLOWED_WHILE_TYPING.includes(s.id)).filter((s) =>
      (lede.textContent ?? '').includes(s.keys.replace('Ctrl/⌘ ', 'Ctrl ')),
    )
    expect(
      promised.map((s) => s.id),
      'the pane promises a shortcut the matcher refuses while typing',
    ).toEqual([])
  })
})

describe('DEC-32: Requis / Facultatifs, from the contract the header aggregates over', () => {
  /*
   * The rule that was broken here was not a missing sentence, it was three of
   * them: a preamble on what the header indicator tracks, then a caption under
   * *Requis*, then one under *Facultatifs* — about sixty words of reasoning
   * standing between a rep who came here because VerySwing broke and the red
   * row they came for. The facts are load-bearing and stay; the paragraph in
   * front of the first control does not.
   */
  test('nothing stands between the screen and its first control', async () => {
    const { container } = mount()
    await screen.findByText('Requis')

    // The old preamble, gone…
    expect(screen.queryByText(/L’indicateur d’état, en haut de l’écran/)).toBeNull()

    // …and what is left between « Connecteurs » and the first connector row is
    // one line, not three paragraphs.
    const html = container.innerHTML
    const between = html.slice(html.indexOf('Requis'), html.indexOf('Analyse'))
    expect(between.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).length).toBeLessThan(35)
  })

  test('the two groups hold exactly what the contract puts in them', async () => {
    mount()
    await screen.findByText('Requis')

    // Not a list retyped in the screen: the same three the header reads.
    expect([...REQUIRED_CONNECTORS]).toEqual(['capture', 'transcribe', 'llm'])
    for (const label of ['Audio', 'Transcription', 'Analyse']) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0)
    }

    expect([...OPTIONAL_CONNECTORS]).toEqual(['calendar', 'crm', 'mail'])
    for (const label of ['Calendrier', 'VerySwing', 'Outlook']) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0)
    }
  })

  test('a required connector sits above the Facultatifs heading, an optional one below', async () => {
    // Order matters on this screen: the split is the sentence's evidence.
    const { container } = mount()
    await screen.findByText('Facultatifs')

    const html = container.innerHTML
    expect(html.indexOf('Requis')).toBeLessThan(html.indexOf('Facultatifs'))
    expect(html.indexOf('Analyse')).toBeLessThan(html.indexOf('Facultatifs'))
    expect(html.indexOf('Facultatifs')).toBeLessThan(html.indexOf('VerySwing'))
  })

  test('each group states, in French, what it costs when it is down', async () => {
    mount()
    // One line per heading, and between them they still carry both halves of
    // DEC-32: what moves the header indicator, and what never does (DEC-26).
    const required = await screen.findByText(
      /sans eux une réunion ne peut pas être enregistrée/,
    )
    expect(required.textContent).toContain('les seuls à faire changer l’indicateur d’état')
    const optional = screen.getByText(
      /Une réunion s’enregistre, se transcrit et s’analyse sans eux/,
    )
    expect(optional.textContent).toContain('jamais dans l’indicateur d’état')
  })
})

describe('DEC-30: local transcription is the default, and is written as one', () => {
  test('the section opens by stating that transcription happens on this machine', async () => {
    mount()
    await open('Transcription')

    const lede = screen.getByText(/La transcription se fait sur cette machine/)
    expect(lede.textContent).toContain('c’est le fonctionnement normal')
    // The cloud is the opt-in accuracy upgrade, and it is named second.
    expect(lede.textContent).toContain('pour gagner en précision')
  })

  test('the local tier is listed first, above any cloud provider', async () => {
    const { container } = mount()
    await open('Transcription')

    const html = container.innerHTML
    expect(html.indexOf('Sur cette machine')).toBeLessThan(html.indexOf('Fournisseur cloud'))
    expect(html.indexOf('Whisper (local)')).toBeLessThan(html.indexOf('Deepgram'))
  })

  test('nothing on the screen calls the local engine a downgrade', async () => {
    const { container } = mount()
    for (const section of ['Transcription', 'Modèle de langage', 'Connecteurs', 'Diagnostics']) {
      await open(section)
      const text = (container.textContent ?? '').toLowerCase()
      for (const word of ['dégradé', 'dégradée', 'repli', 'secours', 'faute de mieux']) {
        expect(text, `${section} / ${word}`).not.toContain(word)
      }
    }
  })

  test('the selected provider is marked in brand blue, never in the accent orange', async () => {
    // *Utilisé* was `text-accent` — 2.41:1, and orange borrowed for a meaning
    // it does not have. Selection is brand blue (VISION.md §6).
    const { container } = mount()
    await open('Transcription')

    const marker = screen.getByText('Utilisé')
    expect(marker.className).toContain('text-brand-900')
    expect(marker.className).not.toMatch(/accent/)
    expect(container.querySelector('.text-accent')).toBeNull()
  })
})

describe('DEC-33: every provider is listed, with where it runs and its reason', () => {
  test('an unusable provider is on screen and says why it cannot be used', async () => {
    mount()
    await open('Transcription')

    // The row exists — a silent omission is indistinguishable from a bug, and
    // the rep who pasted that key would spend the demo wondering where it went.
    expect(screen.getByText('Deepgram')).toBeTruthy()
    expect(screen.getByText('aucune clé enregistrée')).toBeTruthy()
  })

  test('a hosted provider says the audio leaves the machine, so the choice is informed', async () => {
    mount()
    await open('Transcription')

    // It refuses nothing, which makes showing it the only thing left that
    // carries the fact to the person deciding. The row used to claim a
    // jurisdiction too; DEC-37 removed that, because the app cannot keep it
    // true and a stale badge is worse than no badge.
    //
    // Exact, not a substring: « hors machine » is now also a phrase inside the
    // « cette machine uniquement » switch above the table, and a loose match
    // would pass on that sentence while the row itself said nothing at all.
    expect(screen.getAllByText('hors machine').length).toBeGreaterThan(0)
  })

  test('the tiers are named, and the selected provider is marked', async () => {
    mount()
    await open('Transcription')

    expect(screen.getByText('Sur cette machine')).toBeTruthy()
    expect(screen.getByText('Fournisseur cloud')).toBeTruthy()
    expect(screen.getByText('Utilisé')).toBeTruthy()
  })

  test('a section with nothing selected says why, from the registry’s own refusal', async () => {
    mount()
    await open('Modèle de langage')
    expect(screen.getByText('aucun modèle de langage n’est configuré')).toBeTruthy()
  })
})

describe('DEC-26: a down connector states why, and retry is offered only when it helps', () => {
  test('the reason is on screen and Réessayer appears exactly once', async () => {
    mount()

    expect(await screen.findByText('VerySwing injoignable')).toBeTruthy()
    expect(
      screen.getByText('autorisation refusée — votre administrateur doit approuver'),
    ).toBeTruthy()
    // Not a style choice: offering retry on a consent failure would have the rep
    // clicking forever at something only an administrator can fix.
    expect(screen.getAllByRole('button', { name: 'Réessayer' })).toHaveLength(1)
  })

  test('a state is a dot with its word beside it, never a bare colour', async () => {
    const { container } = mount()
    await screen.findByText('VerySwing injoignable')

    // Three healthy required connectors plus Outlook.
    expect(screen.getAllByText('connecté')).toHaveLength(4)
    expect(screen.getAllByText('indisponible')).toHaveLength(2)
    expect(container.querySelector('[aria-hidden].bg-danger')).toBeTruthy()
  })

  test('Réessayer runs the retry channel and shows the new state', async () => {
    bridge.when('health:retry', () => ({ state: 'ok' }) as ConnectorHealth)
    mount()

    const button = await screen.findByRole('button', { name: 'Réessayer' })
    await act(async () => {
      button.click()
    })

    expect(bridge.calls.some((c) => c.channel === 'health:retry')).toBe(true)
    await waitFor(() => expect(screen.queryByText('VerySwing injoignable')).toBeNull())
  })
})

/**
 * DEC-26 again, on the one row that is not a `ConnectorHealth`.
 *
 * *Signed out* is two situations a rep experiences as nothing alike, and until
 * `AuthState.reason` existed the screen could not tell them apart: it drew a
 * live *Se connecter* in a build with **no Entra app registration**, where
 * `auth:signIn` can only reject. That is the configuration the first demo ships
 * in (DEC-28) — the registration lives in a tenant we do not control — so this
 * is not a corner case, it is the case.
 */
describe('DEC-26: Microsoft 365 offers a sign-in only when there is one to offer', () => {
  const NO_REGISTRATION =
    'Aucune application Microsoft n’est configurée — le calendrier et les brouillons Outlook restent indisponibles.'

  test('with no app registration the row states why and carries no control', async () => {
    mount({ auth: { status: 'signedOut', reason: NO_REGISTRATION } })

    expect(await screen.findByText(NO_REGISTRATION)).toBeTruthy()
    // The whole of the fix: a button that can only throw is not drawn at all,
    // exactly as ConnectorLine draws no Réessayer on a non-retryable failure.
    expect(screen.queryByRole('button', { name: 'Se connecter' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull()
  })

  test('a rep who merely has not signed in still gets the button', async () => {
    mount({ auth: { status: 'signedOut' } })

    expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeTruthy()
    expect(screen.queryByText(NO_REGISTRATION)).toBeNull()
  })

  test('the missing registration is never an app-level degradation (DEC-32)', async () => {
    // It belongs to *Facultatifs*, under the sentence that says a meeting is
    // recorded, transcribed and analysed without any of them.
    mount({ auth: { status: 'signedOut', reason: NO_REGISTRATION } })
    const optional = await screen.findByText('Facultatifs')
    const row = screen.getByText(NO_REGISTRATION)

    expect(optional.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('a sign-in that rejects is named on screen, never swallowed', async () => {
    // Two real rejections reach here — AADSTS90094 from a tenant that requires
    // admin consent, and the handler's own refusal. `try/finally` with no
    // `catch` turned both into a button that appeared to do nothing.
    bridge.when('auth:signIn', () => {
      throw new Error('approbation de l’administrateur requise')
    })
    mount({ auth: { status: 'signedOut' } })

    const button = await screen.findByRole('button', { name: 'Se connecter' })
    await act(async () => {
      button.click()
    })

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'approbation de l’administrateur requise',
      ),
    )
  })
})

describe('DEC-24: the probe reports as data, row by row, under VerySwing', () => {
  test('a missing capability says what stops working because of it', async () => {
    mount()

    expect(await screen.findByText('liste des clients')).toBeTruthy()
    expect(screen.getByText('sans elle, aucun compte client n’est proposé')).toBeTruthy()
    expect(screen.getByText(/une capacité manque sur ce tenant/)).toBeTruthy()
  })

  test('it sits in the Connecteurs pane, below the optional group', async () => {
    const { container } = mount()
    await screen.findByText('liste des clients')

    const html = container.innerHTML
    expect(html.indexOf('Facultatifs')).toBeLessThan(
      html.indexOf('VerySwing — capacités du tenant'),
    )
  })

  test('no probe is a sentence, not an absence', async () => {
    mount({ probe: null, probeReason: 'VerySwing non configuré (VSA_BASE_URL)' })
    expect(await screen.findByText('VerySwing non configuré (VSA_BASE_URL)')).toBeTruthy()
  })
})

describe('DEC-27: the two exports, and what each one says about itself', () => {
  test('the full export names what it includes, in French, on the control', async () => {
    mount()
    await open('Diagnostics')

    const full = pane().getByRole('button', {
      name: 'Diagnostic complet — inclut le contenu des conversations clients',
    })
    expect(full).toBeTruthy()

    // The safe one is the effortless one: one word, no warning to read, because
    // a bundle of prospect transcripts in a support mailbox is the incident.
    const redacted = pane().getByRole('button', { name: 'Diagnostics' })
    expect(redacted.textContent).toBe('Diagnostics')
    expect(screen.getByText('Sans contenu de conversation. Peut être envoyé au support.'))
      .toBeTruthy()
  })

  test('each button asks for its own mode — the safe one goes through the redaction', async () => {
    mount()
    await open('Diagnostics')
    const redacted = pane().getByRole('button', { name: 'Diagnostics' })

    await act(async () => {
      redacted.click()
    })
    await waitFor(() =>
      expect(bridge.calls.some((c) => c.channel === 'diagnostics:export')).toBe(true),
    )
    expect(bridge.calls.filter((c) => c.channel === 'diagnostics:export').at(-1)?.payload).toEqual({
      mode: 'redacted',
    })

    await act(async () => {
      pane()
        .getByRole('button', {
          name: 'Diagnostic complet — inclut le contenu des conversations clients',
        })
        .click()
    })
    await waitFor(() =>
      expect(
        bridge.calls.filter((c) => c.channel === 'diagnostics:export').at(-1)?.payload,
      ).toEqual({ mode: 'full' }),
    )
  })

  test('the retention setting is stated, and meeting content is not on it', async () => {
    mount()
    await open('Diagnostics')
    expect(screen.getByText(/conservés 90 jours/)).toBeTruthy()
    expect(screen.getByText(/n’expire jamais/)).toBeTruthy()
  })
})

describe('DEC-34: the credential is entered here, and never comes back out', () => {
  const withKeyField = () =>
    snapshot({
      stt: {
        rows: [
          {
            id: 'elevenlabs',
            label: 'ElevenLabs Scribe',
            tier: 'cloud',
            residency: 'remote',
            cost: 'metered',
            auth: 'apiKey',
            credential: { stored: false, hint: null },
            fields: [],
            configured: false,
            selected: false,
            selectable: false,
            reason: 'aucune clé enregistrée',
          },
        ],
        selected: null,
        reason: 'aucun moteur de transcription n’est configuré',
      },
    })

  test('a provider with nothing to authenticate is offered no key field', async () => {
    // The bundled local engine. A password box next to it would be asking for a
    // secret the app would then ignore.
    mount()
    await open('Transcription')
    const local = pane().getByText('Whisper (local)').closest('div')!
    expect(within(local).queryByRole('button', { name: /clé/i })).toBeNull()
  })

  test('the key field is closed until it is asked for', async () => {
    mount(withKeyField())
    await open('Transcription')
    expect(pane().queryByLabelText(/Clé d’API/)).toBeNull()

    await act(async () => {
      pane().getByRole('button', { name: 'Ajouter une clé' }).click()
    })
    expect(pane().getByLabelText(/Clé d’API/)).toBeTruthy()
  })

  test('the field is a password field, and the browser is not invited to keep a copy', async () => {
    mount(withKeyField())
    await open('Transcription')
    await act(async () => {
      pane().getByRole('button', { name: 'Ajouter une clé' }).click()
    })

    const field = pane().getByLabelText(/Clé d’API/) as HTMLInputElement
    expect(field.type).toBe('password')
    // Not a login. A browser password manager holding a live OpenAI key is one
    // more copy of it than anyone asked for.
    expect(field.autocomplete).toBe('off')
  })

  test('saving sends the key once and takes the whole snapshot back', async () => {
    bridge.when('settings:setCredential', ({ providerId }) => {
      const next = withKeyField()
      next.stt.rows = next.stt.rows.map((row) =>
        row.id === providerId
          ? {
              ...row,
              credential: { stored: true, hint: 'k9f2' },
              configured: true,
              selectable: true,
              selected: true,
              reason: null,
            }
          : row,
      )
      next.stt.selected = providerId
      next.stt.reason = null
      return next
    })
    mount(withKeyField())
    await open('Transcription')
    await act(async () => {
      pane().getByRole('button', { name: 'Ajouter une clé' }).click()
    })

    const field = pane().getByLabelText(/Clé d’API/) as HTMLInputElement
    await act(async () => {
      fireEvent.change(field, { target: { value: 'sk-test-abcdefgh' } })
    })
    await act(async () => {
      pane().getByRole('button', { name: 'Enregistrer' }).click()
    })

    const call = bridge.calls.filter((c) => c.channel === 'settings:setCredential').at(-1)
    expect(call?.payload).toEqual({ providerId: 'elevenlabs', value: 'sk-test-abcdefgh' })

    // The screen takes the answer wholesale: storing a key can change which
    // provider is selected, and a screen that patched one row would be right
    // about the row and wrong about the table.
    await waitFor(() => expect(pane().getByText('Utilisé')).toBeTruthy())
  })

  test('a stored key is shown as four characters, and the value is never rendered', async () => {
    const stored = withKeyField()
    stored.stt.rows[0]!.credential = { stored: true, hint: 'k9f2' }
    stored.stt.rows[0]!.configured = true
    stored.stt.rows[0]!.selectable = true
    stored.stt.rows[0]!.reason = null
    mount(stored)
    await open('Transcription')

    expect(pane().getByText(/clé enregistrée · …k9f2/)).toBeTruthy()
    // Opening the field again offers an empty box. There is nothing to pre-fill
    // it with — the value never leaves the vault — and dots that are not the
    // real key would be a worse lie than an empty field.
    await act(async () => {
      pane().getByRole('button', { name: 'Modifier la clé' }).click()
    })
    expect((pane().getByLabelText(/Clé d’API/) as HTMLInputElement).value).toBe('')
  })

  test('a failed save is named on screen, never swallowed', async () => {
    bridge.when('settings:setCredential', () => {
      throw new Error('le coffre-fort n’est pas disponible sur cette machine')
    })
    mount(withKeyField())
    await open('Transcription')
    await act(async () => {
      pane().getByRole('button', { name: 'Ajouter une clé' }).click()
    })
    const field = pane().getByLabelText(/Clé d’API/) as HTMLInputElement
    await act(async () => {
      fireEvent.change(field, { target: { value: 'sk-test-abcdefgh' } })
    })
    await act(async () => {
      pane().getByRole('button', { name: 'Enregistrer' }).click()
    })

    await waitFor(() =>
      expect(screen.getByText(/coffre-fort n’est pas disponible/)).toBeTruthy(),
    )
  })
})

describe('DEC-35: the models are managed under Transcription', () => {
  test('the bundled model is marked and is offered no download', async () => {
    mount()
    await open('Transcription')

    const row = pane().getByText('Whisper Small').closest('div')!
    expect(within(row).getByText('fourni')).toBeTruthy()
    // The floor DEC-30 relies on. A button that removes it is one click from a
    // machine that cannot transcribe at all.
    expect(within(row).queryByRole('button', { name: 'Télécharger' })).toBeNull()
  })

  test('a checkpoint that is not installed offers a download', async () => {
    mount()
    await open('Transcription')
    await act(async () => {
      const row = pane().getByText('Whisper Medium').closest('div')!
      within(row).getByRole('button', { name: 'Télécharger' }).click()
    })

    expect(bridge.calls.filter((c) => c.channel === 'models:download').at(-1)?.payload).toEqual({
      modelId: 'Xenova/whisper-medium',
    })
  })

  test('a download in flight shows its percentage and offers a cancel', async () => {
    const downloading = snapshot()
    downloading.models.rows[1] = {
      ...downloading.models.rows[1]!,
      status: 'downloading',
      progress: 38,
    }
    mount(downloading)
    await open('Transcription')

    expect(pane().getByText(/téléchargement · 38 %/)).toBeTruthy()
    expect(pane().getByRole('button', { name: 'Annuler' })).toBeTruthy()
  })

  test('the percentage arrives — the row is moved by the broadcast, not by a re-read', async () => {
    /*
     * **The test above proves the row can render a number. It never asked
     * whether one arrives**, and for the life of this feature none did.
     *
     * `main.ts` broadcasts `models:progress` on every change, under a comment
     * naming the bug it exists to fix. The renderer subscribed to eleven
     * channels and this was not one of them — so a rep who pressed *Télécharger*
     * on a 1.5 GB model watched « téléchargement · 0 % » beside an *Annuler*
     * button, unchanged, **including after it finished**. The row only ever
     * moved when some unrelated write happened to re-read the whole snapshot.
     */
    const starting = snapshot()
    starting.models.rows[1] = { ...starting.models.rows[1]!, status: 'downloading', progress: 0 }
    mount(starting)
    await open('Transcription')
    expect(pane().getByText(/téléchargement · 0 %/)).toBeTruthy()

    await act(async () => {
      bridge.emit('models:progress', {
        id: starting.models.rows[1]!.id,
        status: 'downloading',
        progress: 61,
        reason: null,
      })
    })
    expect(pane().getByText(/téléchargement · 61 %/)).toBeTruthy()

    // And completion is visible too — the row said « téléchargement » for ever.
    await act(async () => {
      bridge.emit('models:progress', {
        id: starting.models.rows[1]!.id,
        status: 'ready',
        progress: 100,
        reason: null,
      })
    })
    expect(pane().queryByText(/téléchargement/)).toBeNull()
  })

  test('a failed download says why, in French, on the row', async () => {
    const failed = snapshot()
    failed.models.rows[1] = {
      ...failed.models.rows[1]!,
      status: 'error',
      reason: 'téléchargement incomplet — fichiers manquants sur le disque',
    }
    mount(failed)
    await open('Transcription')
    expect(pane().getByText(/fichiers manquants sur le disque/)).toBeTruthy()
  })
})

describe('DEC-36: the ChatGPT row is a session, not a key', () => {
  const withChatGpt = (over: Partial<SettingsSnapshot['llm']['rows'][number]> = {}) =>
    snapshot({
      llm: {
        rows: [
          {
            id: 'chatgpt',
            label: 'ChatGPT (abonnement)',
            tier: 'cloud',
            residency: 'remote',
            cost: 'included',
            auth: 'oauth',
            credential: { stored: false, hint: null },
            fields: [],
            configured: false,
            selected: false,
            selectable: false,
            reason: 'aucune session ChatGPT — exécutez `codex login`',
            ...over,
          },
        ],
        selected: null,
        reason: 'aucun modèle de langage n’est configuré',
      },
    })

  test('an oauth row is never offered a key field', async () => {
    // There is no key to type here. A rep who pasted a Platform key into this
    // row would have configured nothing, and the row would still be refused —
    // with a message about a session, which would then read as a bug.
    mount(withChatGpt())
    await open('Modèle de langage')
    const row = pane().getByText('ChatGPT (abonnement)').closest('div')!
    expect(within(row).queryByRole('button', { name: /clé/i })).toBeNull()
  })

  test('the refusal names the command, not a missing key', async () => {
    mount(withChatGpt())
    await open('Modèle de langage')
    expect(pane().getByText(/codex login/)).toBeTruthy()
    expect(pane().queryByText('aucune clé enregistrée')).toBeNull()
  })

  test('Vérifier re-reads the tables — the act after running the command elsewhere', async () => {
    // The one control this row can honestly offer. A rep who runs `codex login`
    // in the terminal next to this window otherwise has to restart the app.
    mount(withChatGpt())
    await open('Modèle de langage')
    expect(pane().queryByText('session active')).toBeNull()
    // From here the channel answers as it would once `codex login` has run in
    // the terminal next to this window.
    bridge.when('settings:snapshot', () =>
      withChatGpt({ configured: true, selectable: true, reason: null, selected: true }),
    )
    await act(async () => {
      pane().getByRole('button', { name: 'Vérifier' }).click()
    })
    await waitFor(() => expect(pane().getByText('session active')).toBeTruthy())
  })

})

describe('DEC-34: the settings that are not secrets', () => {
  const withFields = () =>
    snapshot({
      llm: {
        rows: [
          {
            id: 'local-openai',
            label: 'Modèle local',
            tier: 'self-hosted',
            residency: 'local',
            cost: 'free',
            auth: 'apiKey',
            credential: { stored: false, hint: null },
            fields: [
              {
                key: 'url',
                label: 'URL du serveur',
                placeholder: 'http://localhost:11434/v1',
                required: true,
                value: 'http://localhost:11434/v1',
              },
              { key: 'model', label: 'Modèle', placeholder: 'llama3.1:8b', required: true, value: '' },
            ],
            configured: false,
            selected: false,
            selectable: false,
            reason: 'aucune URL de serveur enregistrée',
          },
        ],
        selected: null,
        reason: 'aucun modèle de langage n’est configuré',
      },
    })

  test('a field opens with its stored value in it — unlike a key', async () => {
    // The deliberate opposite of the credential field. A URL nobody can read
    // back is a URL nobody can correct, and correcting a typo in the one
    // already there is the commonest reason to open this row at all.
    mount(withFields())
    await open('Modèle de langage')
    await act(async () => {
      pane().getByRole('button', { name: 'Ajouter une clé' }).click()
    })
    const field = pane().getByLabelText(/URL du serveur/) as HTMLInputElement
    expect(field.value).toBe('http://localhost:11434/v1')
    expect(field.type).toBe('text')
  })

  test('saving a field sends it on its own channel and takes the whole snapshot back', async () => {
    mount(withFields())
    await open('Modèle de langage')
    await act(async () => {
      pane().getByRole('button', { name: 'Ajouter une clé' }).click()
    })
    const field = pane().getByLabelText('Modèle *')
    fireEvent.change(field, { target: { value: 'llama3.1:8b' } })
    await act(async () => {
      within(field.closest('form')!).getByRole('button', { name: 'Enregistrer' }).click()
    })

    const sent = bridge.calls.find((call) => call.channel === 'settings:setProviderField')
    expect(sent?.payload).toEqual({ providerId: 'local-openai', key: 'model', value: 'llama3.1:8b' })
  })

  test('Enregistrer is dead exactly while pressing it would change nothing', async () => {
    mount(withFields())
    await open('Modèle de langage')
    await act(async () => {
      pane().getByRole('button', { name: 'Ajouter une clé' }).click()
    })
    const field = pane().getByLabelText(/URL du serveur/)
    const form = field.closest('form')!
    expect((within(form).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.change(field, { target: { value: 'http://autre:8000/v1' } })
    expect((within(form).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
})

/**
 * The update panel exists to restart the app under the rep, which makes it the
 * most destructive control in the product. These test the refusals.
 *
 * `mount()` seeds a default `update:status`, so every test here overrides it
 * *after* mounting and before opening the section — the panel is not in the DOM
 * until the rail is clicked, so that is when its one read fires.
 */
describe('mise à jour', () => {
  const openWith = async (over: Partial<UpdateStatus>) => {
    bridge.when('update:status', () => updateStatus(over))
    await open('Mise à jour')
  }

  test('the running version is named in every phase, including the one that cannot update', async () => {
    mount()
    await openWith({
      phase: 'disabled',
      reason: 'mise à jour automatique indisponible dans cette build',
    })
    expect(pane().getByText(/0\.1\.1/)).toBeTruthy()
    expect(pane().getByText(/indisponible dans cette build/)).toBeTruthy()
    // The lie this guards against: reporting "up to date" on a build that has
    // no way of discovering otherwise.
    expect(pane().queryByText(/est à jour/)).toBeNull()
  })

  /**
   * **The branch every Windows build takes today, and its remedy was a noun.**
   *
   * `build.win` declares neither `publisherName` nor `certificateFile`, so
   * `updateTrust` returns `ok: false` and the primary platform (HR-2) lands
   * here for the first deliverable (DEC-28). The panel said new versions « se
   * téléchargent depuis la page des versions du projet » and held **zero links
   * and zero buttons** at both sizes: a destination named in the abstract that
   * a rep has no way to reach from the screen telling them to reach it, which
   * is the dead end with a sentence in it DEC-26 forbids.
   *
   * Asked of the *control* and of the *call*, not of the copy — a sentence
   * naming GitHub with nothing behind it would be the same defect with better
   * wording.
   */
  test('the build that cannot update itself can still reach the versions', async () => {
    let opened = 0
    mount()
    bridge.when('update:releases:open', () => {
      opened += 1
      return { opened: true }
    })
    await openWith({
      phase: 'disabled',
      reason: 'cette version n’est pas signée',
    })

    const control = pane().getByRole('button', { name: 'Voir les versions publiées' })
    expect(control).toBeTruthy()

    fireEvent.click(control)
    await waitFor(() => expect(opened).toBe(1))
  })

  /**
   * A press that reached no browser must say so. Swallowed, it looks like it
   * worked and the rep waits for a window that is never coming.
   */
  test('a releases page that will not open is said, not swallowed', async () => {
    mount()
    bridge.when('update:releases:open', () => ({ opened: false }))
    await openWith({ phase: 'disabled', reason: 'cette version n’est pas signée' })

    fireEvent.click(pane().getByRole('button', { name: 'Voir les versions publiées' }))
    await waitFor(() => expect(pane().getByText(/n’a pas pu être ouverte/)).toBeTruthy())
  })

  test('an available version is not downloaded silently, and says what it will cost', async () => {
    mount()
    await openWith({ phase: 'available', availableVersion: '0.2.0' })
    expect(pane().getByText(/0\.2\.0 disponible/)).toBeTruthy()
    expect(pane().getByRole('button', { name: 'Télécharger' })).toBeTruthy()
    expect(pane().getByText(/ne démarre pas pendant une réunion/)).toBeTruthy()
  })

  test('a staged update installs on one click when nothing is running', async () => {
    let installs = 0
    mount()
    bridge.when('update:install', () => {
      installs += 1
      return { started: true, reason: null }
    })
    await openWith({ phase: 'ready', availableVersion: '0.2.0', installable: true })
    const button = pane().getByRole('button', { name: 'Installer et redémarrer' })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    await act(async () => button.click())
    expect(installs).toBe(1)
  })

  /*
   * The central one. A disabled control that does not say why is the dead
   * affordance DEC-26 forbids, and here the reason decides what the rep does
   * next: wait for a call to end, or go and validate a compte-rendu.
   */
  test('a meeting in progress disables the install and says so in the meeting’s own words', async () => {
    mount()
    await openWith({
      phase: 'ready',
      availableVersion: '0.2.0',
      installable: false,
      blockedReason: 'une réunion est en cours d’enregistrement',
    })
    const button = pane().getByRole('button', { name: 'Installer et redémarrer' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(pane().getByText('une réunion est en cours d’enregistrement')).toBeTruthy()
    // Stated in the DOM and wired to the control, not parked in a `title`.
    expect(button.getAttribute('aria-describedby')).toBeTruthy()
  })

  test('a refusal from the main process is surfaced, not swallowed', async () => {
    mount()
    // The race the renderer cannot see: a meeting started between paint and click.
    bridge.when('update:install', () => ({
      started: false,
      reason: 'un envoi vers VerySwing est en cours',
    }))
    await openWith({ phase: 'ready', availableVersion: '0.2.0', installable: true })
    await act(async () => {
      pane().getByRole('button', { name: 'Installer et redémarrer' }).click()
    })
    const alert = await pane().findByRole('alert')
    expect(alert.textContent).toBe('un envoi vers VerySwing est en cours')
  })

  test('the panel follows the session without being reopened', async () => {
    mount()
    await openWith({ phase: 'ready', availableVersion: '0.2.0', installable: true })
    expect(
      (pane().getByRole('button', { name: 'Installer et redémarrer' }) as HTMLButtonElement).disabled,
    ).toBe(false)

    // main.ts re-derives this on every session transition.
    await act(async () => {
      bridge.emit(
        'update:changed',
        updateStatus({
          phase: 'ready',
          availableVersion: '0.2.0',
          installable: false,
          blockedReason: 'une réunion est en cours d’enregistrement',
        }),
      )
    })
    await waitFor(() => {
      expect(
        (pane().getByRole('button', { name: 'Installer et redémarrer' }) as HTMLButtonElement).disabled,
      ).toBe(true)
    })
  })

  test('an unreachable update server is a stated error with a retry, never a crash', async () => {
    mount()
    bridge.when('update:check', () => updateStatus({ phase: 'idle', checkedAt: Date.now() }))
    await openWith({ phase: 'error', reason: 'serveur de mise à jour injoignable' })
    expect(pane().getByText('serveur de mise à jour injoignable')).toBeTruthy()
    await act(async () => {
      pane().getByRole('button', { name: 'Réessayer' }).click()
    })
    await waitFor(() => expect(pane().getByText(/est à jour/)).toBeTruthy())
  })

  /*
   * Reported from a real install: the update « had to be done three times ».
   * Part of that was here. A transfer that broke put the panel in `error` with
   * a button that re-ran the *check* — which could only ever answer « 0.2.0
   * disponible » again — so recovering cost two clicks and a round trip, every
   * time. The failure was the download; so is the button.
   */
  test('a download that broke offers to resume it, not to look again', async () => {
    mount()
    bridge.when('update:download', () => updateStatus({ phase: 'downloading', availableVersion: '0.2.0', percent: 0 }))
    await openWith({
      phase: 'error',
      availableVersion: '0.2.0',
      reason: 'serveur de mise à jour injoignable',
    })
    expect(pane().queryByRole('button', { name: 'Réessayer' })).toBeNull()
    await act(async () => {
      pane().getByRole('button', { name: 'Reprendre le téléchargement' }).click()
    })
    await waitFor(() => expect(pane().getByText(/Téléchargement…/)).toBeTruthy())
  })

  test('a retry explains why the bar went back to zero', async () => {
    mount()
    await openWith({
      phase: 'downloading',
      availableVersion: '0.2.0',
      percent: 0,
      reason: 'connexion interrompue, reprise du téléchargement (essai 2 sur 3)',
    })
    // Without this line the same download appears to restart itself, which
    // reads as the app being broken rather than as the app coping.
    expect(pane().getByText(/reprise du téléchargement \(essai 2 sur 3\)/)).toBeTruthy()
  })
})

/**
 * **The sentence a rep reads to a client is the ESN's, and this pane is where it is
 * theirs** (US-11, US-19, `core/contracts/mention.ts`).
 *
 * US-11 shipped the wording as a constant in the renderer, which is the
 * `SILLAGE_STT_OFFLINE_ONLY` mistake DEC-37 has already paid for once: a legal
 * sentence nobody deploying this product can change without a build.
 *
 * What is asserted here is the four properties that keep it honest — the field shows
 * what the *pill* will hand over rather than what is stored; an empty save is how you
 * return to the default and there is a control that says so; the box cannot clip its
 * own sentence; and nothing in the pane claims the client agreed to anything.
 */
describe('the sentence the client hears (US-19)', () => {
  const LABEL = 'Ce que vous dites au client'
  const field = () => pane().getByLabelText(LABEL) as HTMLTextAreaElement
  /*
   * Scoped to its own `<section>`: the Transcription pane also holds a provider's
   * *Enregistrer*, and a query that matched both would be asserting about whichever
   * one the tree happened to yield first.
   */
  const box = () => within(field().closest('section') as HTMLElement)
  const save = () => box().getByRole('button', { name: 'Enregistrer la phrase' }) as HTMLButtonElement
  const restore = () =>
    box().getByRole('button', { name: 'Rétablir la phrase par défaut' }) as HTMLButtonElement

  test('the pane shows the sentence the pill will hand over', async () => {
    mount()
    await open('Transcription')
    expect(field().value).toBe(MENTION_SENTENCE_DEFAULT)
    // The explanation says what the press does and, more importantly, what it does
    // not: no send, and no record of what the client said.
    expect(box().getByText(/n’envoie rien/)).toBeTruthy()
  })

  test('a deployment that wrote its own wording sees its own wording', async () => {
    /*
     * The whole of US-19 in one assertion. The snapshot is the only source: a field
     * that fell back to the default when a value was stored would show every ESN our
     * sentence while the pill handed over theirs, or the reverse — and either way the
     * pane would be lying about what happens on the call.
     */
    const own = 'Cet échange est transcrit par un outil interne. Dites-le si cela vous gêne.'
    mount({ mentionSentence: own })
    await open('Transcription')
    expect(field().value).toBe(own)
    expect(field().value).not.toBe(MENTION_SENTENCE_DEFAULT)
  })

  test('saving sends what was typed, and saves nothing until it differs', async () => {
    mount()
    let sent: string | null = null
    bridge.when('settings:setMentionSentence', ({ value }) => {
      sent = value
      return snapshot({ mentionSentence: value.trim() === '' ? MENTION_SENTENCE_DEFAULT : value })
    })
    await open('Transcription')

    // Dead exactly when pressing it would do nothing — the `SettingField` rule.
    expect(save().disabled).toBe(true)

    const own = 'Je vous signale que cet appel est transcrit pour le compte-rendu.'
    await act(async () => {
      fireEvent.change(field(), { target: { value: own } })
    })
    expect(save().disabled).toBe(false)
    await act(async () => {
      save().click()
    })
    await waitFor(() => expect(sent).toBe(own))
  })

  test('coming back to the default is a control, not a trick', async () => {
    /*
     * « Empty the box and save » is how the store deletes the row, and a rep is not
     * going to guess that. The control is live exactly when the wording is not the
     * default, and what it sends is the empty string — which `setMentionSentence`
     * reads as « forget it » and the snapshot answers as the default.
     */
    mount({ mentionSentence: 'Nous enregistrons cet appel.' })
    let sent: string | null = null
    bridge.when('settings:setMentionSentence', ({ value }) => {
      sent = value
      return snapshot({ mentionSentence: MENTION_SENTENCE_DEFAULT })
    })
    await open('Transcription')

    expect(restore().disabled).toBe(false)
    await act(async () => {
      restore().click()
    })
    await waitFor(() => expect(sent).toBe(''))
    await waitFor(() => expect(field().value).toBe(MENTION_SENTENCE_DEFAULT))
  })

  test('and it is dead when the wording already is the default', async () => {
    mount()
    await open('Transcription')
    expect(restore().disabled).toBe(true)
    // DEC-26: disabled is never silent.
    expect(box().getByText(/déjà la phrase par défaut/)).toBeTruthy()
  })

  test('nothing in the pane claims the client agreed', async () => {
    /*
     * The same sweep `Widget.test.tsx` runs over the card, on the surface that
     * *describes* the feature — which is where somebody would be tempted to write
     * « le client a été informé » and turn a record of what was handed over into a
     * claim about what was said.
     */
    mount()
    await open('Transcription')
    const claim = /consentement|a accept|a donn[ée]|autoris|accord du client|le client a été/i
    expect((screen.getByRole('main').textContent ?? '').match(claim)).toBeNull()
  })

  test('the box grows with its content rather than clipping it', async () => {
    /*
     * jsdom measures every box as zero, so what is asserted is the *declaration* —
     * `field-sizing: content` and no scroller. The measurement is
     * `shot.mjs reglages --scrollers`, which is where the eleven clipped textareas at
     * the gate were found; a four-line sentence in a three-line box is that defect on
     * a field whose content is, by construction, four lines.
     */
    mount()
    await open('Transcription')
    expect(field().className).toContain('[field-sizing:content]')
    expect(field().className).toContain('measure')
    expect(field().className).toContain('resize-none')
  })
})

/**
 * **When this screen refuses, the rep has to be able to read the refusal.**
 *
 * `write()` is the funnel every gesture here goes through — save a key, forget
 * one, pick a provider, set a field, toggle « cette machine uniquement »,
 * download a model, cancel one — and when the main process refuses it catches
 * the sentence and draws it. It drew it as the first child of the pane's
 * content, *inside* the scroller, with no role on it.
 *
 * Driven on the real screen (`scratch/reglages-refus.mjs`), staging the refusal
 * `ipc/register.ts:1590` throws when a rep presses *Télécharger* during a call
 * (DEC-35 — « le téléchargement attendra la fin de l’appel ») :
 *
 *     1280×800   bouton à y=1197   phrase à top=-638   visible sans défiler: false
 *     960×600    bouton à y=1169   phrase à top=-810   visible sans défiler: false
 *     role: (aucun)   aria-live: (aucun)   dans une région vivante: false
 *
 * Six hundred and thirty-eight pixels above the top of the window at the larger
 * size, eight hundred and ten at the smaller — the models table is at the
 * bottom of the longest pane in the product. The rep presses the button, the
 * app refuses correctly, and *nothing whatever happens on their screen*: the
 * row does not change, the button stays pressable, and the sentence explaining
 * why is a screenful above the fold. A reader is told nothing either. So the
 * one control DEC-35 exists to hold back was, from the rep's seat, a control
 * that does nothing — which is what DEC-26 forbids, on the screen the product
 * opens when something is already wrong.
 *
 * **Nothing was green over it by accident.** The test forty lines above presses
 * *Télécharger* and asserts the channel was called with the right payload; it
 * never makes the channel refuse, so `write`'s failure branch had no caller at
 * all. jsdom has no layout, so every rect is zero and no renderer test could
 * have seen the offset. `--a11y` asks whether a control has a name, not whether
 * a message is announced; `--scrollers` asks what a measured column hides, not
 * where a message landed; and the harness stub never refuses this channel, so
 * no stage has photographed the state.
 *
 * **The subject is `write`, not the download**, so two different gestures are
 * pressed and held to one answer. The placement assertion is « not inside the
 * scroller » rather than a pixel count, because that is the property jsdom can
 * hold, and it is the one that was false.
 */
describe('a refusal on this screen reaches the rep', () => {
  /** Word for word what `ipc/register.ts` throws on a download during a call. */
  const REFUS =
    'Une réunion est en cours — le téléchargement attendra la fin de l’appel pour ne pas lui prendre de mémoire.'
  /** And one from a different caller of the same funnel. */
  const REFUS_COFFRE = 'le coffre-fort n’est pas disponible sur cette machine'

  test('the refused download is said, announced, and not inside the scroller', async () => {
    bridge.when('models:download', () => {
      throw new Error(REFUS)
    })
    mount()
    await open('Transcription')
    await act(async () => {
      const row = pane().getByText('Whisper Medium').closest('div')!
      within(row).getByRole('button', { name: 'Télécharger' }).click()
    })

    const said = await screen.findByText(REFUS)

    /*
      Announced. A refusal answers a gesture the rep just made and nothing else
      on the screen moves, so a reader told nothing is a reader told it worked.
      `alert` and not `status`, for the reason `OutcomeNotice` gives next door:
      `status` is a wait the rep chose to start.
    */
    const live = said.closest('[role="alert"],[role="status"],[aria-live]')
    expect(live, 'la phrase n’est dans aucune région vivante — rien n’est annoncé').not.toBeNull()
    expect(live?.getAttribute('role')).toBe('alert')

    /*
      And in front of them. `.fade-below` is `ReadingColumn`'s scroller and it
      holds the whole pane, its title included; a sentence inside it is a
      sentence at whatever scroll position the pane was left at, and the control
      that produces this one is at the very bottom of it.
    */
    expect(
      said.closest('.fade-below'),
      'la phrase est dans le défilement du volet — invisible depuis le contrôle qui vient d’être pressé',
    ).toBeNull()
  })

  test('a second caller of the same funnel lands in the same place', async () => {
    bridge.when('settings:setOfflineOnly', () => {
      throw new Error(REFUS_COFFRE)
    })
    mount()
    await open('Transcription')
    await act(async () => {
      fireEvent.click(pane().getByRole('checkbox'))
    })

    const said = await screen.findByText(REFUS_COFFRE)
    expect(said.closest('[role="alert"]')).not.toBeNull()
    expect(said.closest('.fade-below')).toBeNull()
  })

  /*
   * And it is taken back by the next gesture that works. `write` already clears
   * it; the point of asserting it here is that a strip lifted out of the
   * scroller is a strip that would otherwise sit over the pane for ever.
   */
  test('a refusal followed by a success is taken back', async () => {
    let refusing = true
    bridge.when('models:download', () => {
      if (refusing) throw new Error(REFUS)
      // The section the shipped handler answers with, not `{}` — the fake
      // bridge is typed against the contract, which is what caught it.
      return snapshot().models
    })
    mount()
    await open('Transcription')
    const press = async () => {
      await act(async () => {
        const row = pane().getByText('Whisper Medium').closest('div')!
        within(row).getByRole('button', { name: 'Télécharger' }).click()
      })
    }
    await press()
    await screen.findByText(REFUS)

    refusing = false
    await press()
    await waitFor(() => expect(screen.queryByText(REFUS)).toBeNull())
  })
})
