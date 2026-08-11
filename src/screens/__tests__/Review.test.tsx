/**
 * The review gate is the only human confirmation in the product (DEC-4), which
 * makes it the one screen where a rendering bug has an external consequence: a
 * wrong account in the CRM of record, an intent the rep unchecked shipping
 * anyway, or a panel appearing during a client call.
 *
 * So these test the four invariants and not the layout:
 *
 *   DEC-23  the gate is unreachable while the meeting is `recording`
 *   DEC-21  `⚠ faible` is what the main process measured, never a local guess
 *   DEC-20  an unchecked intent is absent from what *Valider* sends
 *   DEC-4   one button, one gesture, and the rep's edit is what leaves
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ReviewPanel, ReviewSnapshot } from '../../../electron/core/contracts/review.ts'
import type { Meeting } from '../../../electron/core/contracts/meeting.ts'
import type {
  ConnectorHealth,
  ConnectorId,
  HealthSnapshot,
} from '../../../electron/core/contracts/health.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Review } from '../Review.tsx'

let bridge: FakeBridge
let uninstall: () => void

const meeting: Meeting = {
  id: 'm1',
  state: 'awaiting_confirmation',
  title: 'Acme Industries — besoin Dev Java',
  eventId: 'AAMkAGI2-sample',
  clientName: 'Acme Industries',
  scheduledStart: null,
  createdAt: 1000,
  startedAt: 2000,
  endedAt: 3000,
  confirmedAt: null,
  updatedAt: 3000,
}

const span = (quote: string) => ({ quote, channel: 'far' as const, startMs: 812_000, endMs: 815_400 })

const panel = (over: Partial<ReviewPanel> = {}): ReviewPanel => ({
  meeting,
  edits: {
    taskName: 'Acme Industries — besoin Dev Java',
    accountId: 'ACC-1042',
    accountName: 'Acme Industries',
    compteRendu: '# Acme Industries\n\nRenfort de deux profils Java.\n',
    besoin: "Renfort de l'équipe plateforme",
    profils: '2 × Dev Java — senior (Java, Spring)',
    modeCollaboration: 'régie',
    tjm: '520 €',
    dateDemarrage: 'septembre',
    dureeMission: '6 mois renouvelables',
    contexteTechnique: 'Migration Spring Boot 3',
    objections: 'délai de démarrage',
    prochainesEtapes: 'envoyer 2 CV — Julien — vendredi',
    montant: 520,
    devise: 'EUR',
    mailSubject: 'Suite à notre échange — Acme Industries',
    mailBody: 'Bonjour Camille,\n\nMerci pour cet échange.',
  },
  fields: [
    { key: 'taskName', label: 'Objet', confidence: 'ok', span: null },
    { key: 'account', label: 'Client', confidence: 'ok', span: null },
    { key: 'besoin', label: 'Besoin', confidence: 'ok', span: span('on a besoin de renfort') },
    { key: 'profils', label: 'Profils', confidence: 'ok', span: span('deux dev java senior') },
    { key: 'modeCollaboration', label: 'Mode', confidence: 'ok', span: span('plutôt en régie') },
    { key: 'tjm', label: 'TJM', confidence: 'ok', span: span('un TJM de 520 euros') },
    { key: 'dateDemarrage', label: 'Démarrage', confidence: 'ok', span: span('dès septembre') },
    { key: 'dureeMission', label: 'Durée', confidence: 'ok', span: span('six mois renouvelables') },
    {
      key: 'contexteTechnique',
      label: 'Contexte technique',
      confidence: 'ok',
      span: span('on migre vers Spring Boot 3'),
    },
    { key: 'objections', label: 'Objections', confidence: 'ok', span: span('le délai nous inquiète') },
    {
      key: 'prochainesEtapes',
      label: 'Prochaines étapes',
      confidence: 'ok',
      span: span('vous nous envoyez deux CV'),
    },
  ],
  accountCandidates: [],
  interlocuteurs: [
    {
      name: 'Camille Le Roy',
      email: 'camille.leroy@acme-industries.fr',
      type: 'required',
      response: 'accepted',
    },
  ],
  mailTo: ['camille.leroy@acme-industries.fr'],
  overall: 'ok',
  intents: [
    {
      id: 'm1:crm.task',
      kind: 'crm.task',
      label: 'Tâche compte-rendu (VerySwing)',
      summary: 'Acme Industries — besoin Dev Java',
      available: true,
      reason: null,
    },
    {
      id: 'm1:crm.opportunity',
      kind: 'crm.opportunity',
      label: 'Opportunité (VerySwing)',
      summary: 'Renfort plateforme',
      available: true,
      reason: null,
    },
    {
      id: 'm1:mail.draft',
      kind: 'mail.draft',
      label: 'Brouillon de relance (Outlook)',
      summary: 'Suite à notre échange',
      available: true,
      reason: null,
    },
  ],
  ...over,
})

const openGate = (over: Partial<ReviewPanel> = {}): ReviewSnapshot => ({
  open: true,
  panel: panel(over),
})

/** The payload the one *Valider* press sent, or null if nothing was sent. */
const confirmCall = () => {
  const call = bridge.calls.find((c) => c.channel === 'review:confirm')
  return (call?.payload ?? null) as {
    meetingId: string
    edits: ReviewPanel['edits']
    intentIds: string[]
  } | null
}

/** A snapshot always carries every connector — the orchestrator seeds all six. */
const snapshot = (troubled: Partial<Record<ConnectorId, ConnectorHealth>>): HealthSnapshot => ({
  capture: { state: 'ok' },
  transcribe: { state: 'ok' },
  calendar: { state: 'ok' },
  llm: { state: 'ok' },
  crm: { state: 'ok' },
  mail: { state: 'ok' },
  ...troubled,
})

const openPanel = openGate

const valider = async () => {
  const button = await screen.findByRole('button', { name: 'Valider' })
  await act(async () => {
    button.click()
  })
}

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
  bridge
    .when('review:confirm', () => ({
      ok: true as const,
      state: 'pushing' as const,
      intentIds: [],
    }))
    // Healthy by default, so the existing cases render no connector warnings.
    .when('health:snapshot', () => snapshot({}))
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('DEC-23 — nothing from the gate surfaces during a call', () => {
  test('a recording meeting renders no panel, no field and no Valider', async () => {
    bridge.when('review:get', () => ({
      open: false as const,
      state: 'recording' as const,
      reason: 'Réunion en cours.',
    }))

    render(<Review meetingId="m1" onBack={() => {}} />)

    expect(await screen.findByText('Réunion en cours.')).toBeTruthy()
    // Not merely hidden: there is nothing in the response to render. No field
    // label, no intent, no count, and no way to confirm.
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull()
    expect(screen.queryByText('Prêt à envoyer')).toBeNull()
    expect(screen.queryByText('Tâche compte-rendu (VerySwing)')).toBeNull()
    expect(screen.queryByLabelText('Compte-rendu')).toBeNull()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  test('an extraction still running says so and offers nothing to confirm', async () => {
    bridge.when('review:get', () => ({
      open: false as const,
      state: 'extracting' as const,
      reason: 'Analyse en cours…',
    }))

    render(<Review meetingId="m1" onBack={() => {}} />)

    expect(await screen.findByText('Analyse en cours…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull()
  })
})

describe('DEC-21 — ⚠ faible is measured, not decorated', () => {
  test('a weak account wears the marker, and its candidate is still pre-filled', async () => {
    bridge.when('review:get', () =>
      openGate({
        edits: { ...panel().edits, accountId: null, accountName: 'Acme Holding' },
        fields: panel().fields.map((f) =>
          f.key === 'account' ? { ...f, confidence: 'faible' as const } : f,
        ),
      }),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)

    await screen.findByText('Prêt à envoyer')
    expect(screen.getAllByText('⚠ faible')).toHaveLength(1)
    // DEC-18: something matched but not confidently, so the candidate is there
    // to correct rather than to re-type.
    expect((screen.getByLabelText('Client') as HTMLInputElement).value).toBe('Acme Holding')
  })

  // The other half of DEC-18 as amended: nothing matched at all. The field is
  // empty and stays empty — no « Client à confirmer » standing in for a company,
  // because a placeholder that is stored becomes a client name (it reached
  // `meetings.client_name` and the lexicon's per-client scope). The marker is
  // what says "unresolved"; the input's own placeholder says it without
  // occupying the value.
  test('an unresolved account is an empty field that stays empty', async () => {
    bridge.when('review:get', () =>
      openGate({
        edits: { ...panel().edits, accountId: null, accountName: '' },
        fields: panel().fields.map((f) =>
          f.key === 'account' ? { ...f, confidence: 'faible' as const } : f,
        ),
      }),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)

    await screen.findByText('Prêt à envoyer')
    const account = screen.getByLabelText('Client') as HTMLInputElement
    expect(account.value).toBe('')
    expect(account.placeholder).toBe('Client non résolu')
    expect(screen.getAllByText('⚠ faible')).toHaveLength(1)

    // And leaving it that way is a valid confirmation — nothing on this screen
    // blocks on it, and the header does not print a dangling « · ».
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }))
    await waitFor(() => expect(confirmCall()).toBeTruthy())
    expect(confirmCall()?.edits.accountName).toBe('')
  })

  test('a resolved account wears none', async () => {
    bridge.when('review:get', () => openGate())

    render(<Review meetingId="m1" onBack={() => {}} />)

    await screen.findByText('Prêt à envoyer')
    expect(screen.queryByText('⚠ faible')).toBeNull()
    expect((screen.getByLabelText('Client') as HTMLInputElement).value).toBe('Acme Industries')
  })

  test('every field offers its source, and an interpretive one reveals the quote', async () => {
    bridge.when('review:get', () => openGate())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const sources = screen.getAllByRole('button', { name: /^source/ })
    expect(sources).toHaveLength(panel().fields.length)

    // The interpretive rows reveal the transcript span they were read from…
    await act(async () => {
      sources[3]?.click()
    })
    expect(screen.getByText(/deux dev java senior/)).toBeTruthy()

    // …and the two deterministic rows say where they really came from, rather
    // than citing a call nobody read them off (DEC-7).
    await act(async () => {
      sources[1]?.click()
    })
    expect(screen.getByText(/jamais lu sur la transcription/)).toBeTruthy()
  })
})

describe('DEC-20 / DEC-4 — three intents, one button', () => {
  test('all three are drafted and checked, and Valider ships them together', async () => {
    bridge.when('review:get', () => openGate())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(
      true,
    )
    // One submit control on the whole screen. The rep is never asked twice.
    expect(screen.getAllByRole('button', { name: 'Valider' })).toHaveLength(1)

    await valider()

    expect(confirmCall()?.intentIds).toEqual([
      'm1:crm.task',
      'm1:crm.opportunity',
      'm1:mail.draft',
    ])
    expect(bridge.calls.filter((c) => c.channel === 'review:confirm')).toHaveLength(1)
  })

  test('an unchecked intent is absent from what Valider sends', async () => {
    bridge.when('review:get', () => openGate())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const opportunity = screen.getByRole('checkbox', { name: /Opportunité/ })
    await act(async () => {
      fireEvent.click(opportunity)
    })
    expect((opportunity as HTMLInputElement).checked).toBe(false)

    await valider()

    const sent = confirmCall()
    expect(sent?.intentIds).toEqual(['m1:crm.task', 'm1:mail.draft'])
    expect(sent?.intentIds).not.toContain('m1:crm.opportunity')
  })

  test('an undraftable intent is disabled, says why, and is never sent', async () => {
    bridge.when('review:get', () =>
      openGate({
        intents: panel().intents.map((intent) =>
          intent.kind === 'crm.opportunity'
            ? { ...intent, available: false, reason: 'Compte non résolu — pas d’opportunité.' }
            : intent,
        ),
      }),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const opportunity = screen.getByRole('checkbox', { name: /Opportunité/ }) as HTMLInputElement
    expect(opportunity.disabled).toBe(true)
    // DEC-26: never a dead control without a reason on screen.
    expect(screen.getByText('Compte non résolu — pas d’opportunité.')).toBeTruthy()

    await valider()
    expect(confirmCall()?.intentIds).toEqual(['m1:crm.task', 'm1:mail.draft'])
  })

  /**
   * DEC-28's own configuration, at the gate.
   *
   * With no Entra app registration there is no Graph event, so there are no
   * interlocuteurs — they are deterministic and come from the calendar (DEC-7)
   * — so `mailTo` is empty and `mail.draft` is undraftable. The other two
   * intents go to VerySwing and owe Microsoft nothing (DEC-26), so they must
   * stay fully selectable and pushable.
   */
  test('with no Microsoft account the Outlook intent is greyed and the two CRM ones still ship', async () => {
    bridge.when('review:get', () =>
      openGate({
        interlocuteurs: [],
        mailTo: [],
        intents: panel().intents.map((intent) =>
          intent.kind === 'mail.draft'
            ? {
                ...intent,
                summary: 'Indisponible',
                available: false,
                reason: 'Aucun destinataire au calendrier.',
              }
            : intent,
        ),
      }),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const draft = screen.getByRole('checkbox', { name: /Brouillon/ }) as HTMLInputElement
    expect(draft.disabled).toBe(true)
    expect(draft.checked).toBe(false)
    expect(screen.getByText('Aucun destinataire au calendrier.')).toBeTruthy()

    // The mail editor states the consequence where the rep starts reading it,
    // rather than only in *Ce qui sera créé* two sections below.
    expect(screen.getByText(/aucun destinataire — aucun brouillon ne sera créé/)).toBeTruthy()

    // The other two are untouched: no calendar is not a degradation of the CRM.
    for (const name of [/Tâche compte-rendu/, /Opportunité/]) {
      const box = screen.getByRole('checkbox', { name }) as HTMLInputElement
      expect(box.disabled).toBe(false)
      expect(box.checked).toBe(true)
    }

    await valider()
    expect(confirmCall()?.intentIds).toEqual(['m1:crm.task', 'm1:crm.opportunity'])
  })

  test('confirming once calls back; a refusal is shown instead of being swallowed', async () => {
    let confirmed = 0
    bridge
      .when('review:get', () => openGate())
      .when('review:confirm', () => ({
        ok: false as const,
        state: 'awaiting_confirmation' as const,
        reason: 'confirm is not legal from pushing',
      }))

    render(<Review meetingId="m1" onBack={() => {}} onConfirmed={() => (confirmed += 1)} />)
    await screen.findByText('Prêt à envoyer')

    await valider()

    expect(confirmed).toBe(0)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})

describe('the rep’s correction is what ships', () => {
  test('an edited field is what gets sent, not the pre-filled original', async () => {
    bridge.when('review:get', () => openGate())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Client'), {
        target: { value: 'Acme Industries SAS' },
      })
      fireEvent.change(screen.getByLabelText('Besoin'), {
        target: { value: 'Trois développeurs, pas deux' },
      })
      fireEvent.change(screen.getByLabelText('Compte-rendu'), {
        target: { value: '# Corrigé par le commercial' },
      })
      fireEvent.change(screen.getByLabelText('Objet du brouillon'), {
        target: { value: 'Suite à notre point' },
      })
    })

    await valider()

    const sent = confirmCall()
    expect(sent?.edits.accountName).toBe('Acme Industries SAS')
    expect(sent?.edits.besoin).toBe('Trois développeurs, pas deux')
    expect(sent?.edits.compteRendu).toBe('# Corrigé par le commercial')
    expect(sent?.edits.mailSubject).toBe('Suite à notre point')
    // Untouched rows travel as they were pre-filled.
    expect(sent?.edits.tjm).toBe('520 €')
  })

  test('the mail is previewed inline, editable, and framed as a draft (HR-8)', async () => {
    bridge.when('review:get', () => openGate())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    expect((screen.getByLabelText('Objet du brouillon') as HTMLInputElement).value).toBe(
      'Suite à notre échange — Acme Industries',
    )
    expect(screen.getByText(/camille\.leroy@acme-industries\.fr/)).toBeTruthy()
    expect(screen.getByText(/créée en brouillon/)).toBeTruthy()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Corps du brouillon'), {
        target: { value: 'Bonjour Camille, comme convenu…' },
      })
    })
    await valider()
    expect(confirmCall()?.edits.mailBody).toBe('Bonjour Camille, comme convenu…')
  })
})

describe('the gate follows the machine', () => {
  test('a session:changed broadcast re-reads the gate', async () => {
    let state: 'extracting' | 'awaiting_confirmation' = 'extracting'
    bridge.when('review:get', () =>
      state === 'extracting'
        ? { open: false as const, state: 'extracting' as const, reason: 'Analyse en cours…' }
        : openGate(),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Analyse en cours…')

    state = 'awaiting_confirmation'
    await act(async () => {
      bridge.emit('session:changed', { meetingId: 'm1', state: 'awaiting_confirmation' })
    })

    await waitFor(() => expect(screen.getByText('Prêt à envoyer')).toBeTruthy())
  })
})

describe('a connector that is down (DEC-26)', () => {
  test('says why inline, offers a retry, and still lets the rep confirm', async () => {
    // The wording of DEC-26 is easy to get backwards. Greying the CRM intents
    // must NOT disable them: the outbox drains what it cannot send yet, so an
    // intent confirmed while VSA is unreachable is queued, not lost. Disabling
    // would send the rep away to come back — the second prompt DEC-4 exists to
    // prevent — and would silently turn an outage into a dropped compte-rendu.
    bridge
      .when('review:get', () => openPanel())
      .when('health:snapshot', () =>
        snapshot({
          crm: { state: 'down', reason: 'VerySwing injoignable', since: 1, retryable: true },
        }),
      )
      .when('health:retry', () => ({ state: 'ok' }) as ConnectorHealth)
      .when('review:confirm', () => ({
        ok: true as const,
        state: 'pushing' as const,
        intentIds: ['m1:crm.task'],
      }))

    render(<Review meetingId="m1" onBack={() => {}} />)

    // Both CRM intents carry it — the task and the opportunity share a
    // connector, so one outage is two warnings, not one.
    const warnings = await screen.findAllByText(/VerySwing injoignable/)
    expect(warnings).toHaveLength(2)
    expect(warnings[0].textContent).toContain('sera envoyé dès le rétablissement')

    const task = screen.getByLabelText('Tâche compte-rendu (VerySwing)') as HTMLInputElement
    expect(task.disabled).toBe(false)
    expect(task.checked).toBe(true)

    await act(async () => {
      screen.getByRole('button', { name: 'Valider' }).click()
    })
    expect(bridge.calls.some((c) => c.channel === 'review:confirm')).toBe(true)
  })

  test('the Outlook draft is untouched when only VSA is down', async () => {
    bridge
      .when('review:get', () => openPanel())
      .when('health:snapshot', () =>
        snapshot({
          crm: { state: 'down', reason: 'VerySwing injoignable', since: 1, retryable: true },
        }),
      )

    render(<Review meetingId="m1" onBack={() => {}} />)

    // Exactly the two CRM rows. The Outlook draft says nothing and is still
    // checkable — DEC-26's "the Outlook draft still ships".
    expect(await screen.findAllByText(/sera envoyé dès le rétablissement/)).toHaveLength(2)
    const draft = screen.getByLabelText('Brouillon de relance (Outlook)') as HTMLInputElement
    expect(draft.disabled).toBe(false)
    expect(draft.checked).toBe(true)
  })

  test('a healthy connector adds no noise at all', async () => {
    bridge.when('review:get', () => openPanel()).when('health:snapshot', () => snapshot({}))

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByRole('button', { name: 'Valider' })

    expect(screen.queryByText(/sera envoyé dès le rétablissement/)).toBeNull()
  })
})

describe('the gate says which screen it is', () => {
  test('open, it is headed *Revue*, with the meeting under the name', async () => {
    // It used to open with the meeting title alone, which made the one
    // irreversible screen in the product look like a second view of the
    // meeting. A rep arriving here from a broadcast is told where they are.
    bridge.when('review:get', () => openPanel())

    render(<Review meetingId="m1" onBack={() => {}} />)

    expect(await screen.findByRole('heading', { name: 'Revue' })).toBeTruthy()
    // The meeting is in the header too — as the line under the screen's name,
    // not as the name. (It also fills the *Objet* field, which is why this
    // reads the header rather than the document.)
    expect(screen.getByRole('banner').textContent).toContain(
      'Acme Industries — besoin Dev Java · Acme Industries',
    )
  })

  test('closed, there is no header at all — only the reason and the way back', async () => {
    bridge.when('review:get', () => ({
      open: false as const,
      state: 'recording' as const,
      reason: 'Réunion en cours.',
    }))

    render(<Review meetingId="m1" onBack={() => {}} />)

    await screen.findByText('Réunion en cours.')
    expect(screen.queryByRole('heading', { name: 'Revue' })).toBeNull()
  })
})

/**
 * The panel said what *would have been* created before the rep touched the
 * form. `review:get` drafts the intents from the pre-fill and never revisits
 * them, so on the one screen whose whole promise is « what you read is what the
 * CRM receives », the rows and the payload could disagree.
 *
 * The preview responder below is deliberately a small stand-in for the real
 * `draftIntents`: it composes the same two summaries and applies the same
 * `available` predicate (`accountId !== null`), which is what these cases are
 * about. The rule itself is tested in `core/domain/__tests__/reviewGate`.
 */
describe('DEC-4 — the rows describe the form as it stands, not as it arrived', () => {
  const preview = (payload: {
    meetingId: string
    edits: ReviewPanel['edits']
    intentIds: string[]
  }) => {
    const { meetingId, edits } = payload
    const possible = edits.accountId !== null
    return {
      intents: [
        {
          id: `${meetingId}:crm.task`,
          kind: 'crm.task' as const,
          label: 'Tâche compte-rendu (VerySwing)',
          summary: `${edits.taskName} — ${edits.accountName}`,
          available: true,
          reason: null,
        },
        {
          id: `${meetingId}:crm.opportunity`,
          kind: 'crm.opportunity' as const,
          label: 'Opportunité (VerySwing)',
          summary: possible ? `${edits.taskName} — ${edits.besoin}` : 'Indisponible',
          available: possible,
          reason: possible
            ? null
            : 'Compte non résolu — une opportunité ne peut pas être créée sans client identifié.',
        },
        {
          id: `${meetingId}:mail.draft`,
          kind: 'mail.draft' as const,
          label: 'Brouillon de relance (Outlook)',
          summary: `${edits.mailSubject} → camille.leroy@acme-industries.fr`,
          available: true,
          reason: null,
        },
      ],
    }
  }

  test('correcting the client renames what will be created', async () => {
    bridge.when('review:get', () => openPanel()).when('review:preview', preview)

    render(<Review meetingId="m1" onBack={() => {}} />)

    const client = await screen.findByLabelText('Client')
    // The pre-fill's summary, before anything is touched.
    await waitFor(() =>
      expect(screen.getByText('Acme Industries — besoin Dev Java — Acme Industries')).toBeTruthy(),
    )

    fireEvent.change(client, { target: { value: 'Acme France' } })

    // The row follows the field. Before this fix it kept naming « Acme
    // Industries » while `review:confirm` shipped « Acme France ».
    await waitFor(() =>
      expect(screen.getByText('Acme Industries — besoin Dev Java — Acme France')).toBeTruthy(),
    )
  })

  test('resolving the account enables the opportunity, and it ships', async () => {
    // DEC-18 mitigation *a*: the candidates are listed so the rep sees a choice
    // exists. Picking one sets `accountId`, which is exactly what makes an
    // opportunity draftable (DEC-20).
    bridge
      .when('review:get', () =>
        openPanel({
          edits: { ...panel().edits, accountId: null },
          accountCandidates: [
            { accountId: 'ACC-2087', name: 'Acme France', confidence: 'ok' as const },
          ],
          intents: [
            ...panel().intents.slice(0, 1),
            {
              id: 'm1:crm.opportunity',
              kind: 'crm.opportunity' as const,
              label: 'Opportunité (VerySwing)',
              summary: 'Indisponible',
              available: false,
              reason:
                'Compte non résolu — une opportunité ne peut pas être créée sans client identifié.',
            },
            ...panel().intents.slice(2),
          ],
        }),
      )
      .when('review:preview', preview)

    render(<Review meetingId="m1" onBack={() => {}} />)

    const opportunity = (await screen.findByLabelText(
      'Opportunité (VerySwing)',
    )) as HTMLInputElement
    expect(opportunity.disabled).toBe(true)

    fireEvent.click(await screen.findByRole('button', { name: 'Acme France' }))

    // Enabled *and* checked: it was disabled a moment ago, so the rep cannot
    // have unchecked it, and nothing is ever pre-unchecked (DEC-20).
    await waitFor(() => expect(opportunity.disabled).toBe(false))
    await waitFor(() => expect(opportunity.checked).toBe(true))

    await valider()
    expect(confirmCall()?.intentIds).toContain('m1:crm.opportunity')
  })
})
