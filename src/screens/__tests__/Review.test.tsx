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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

/** One stored transcript row, as `review:transcript` answers with it. */
const segment = (id: string, channel: 'rep' | 'far', startMs: number, text: string) => ({
  id,
  channel,
  text,
  startMs,
  endMs: startMs + 4_000,
  isFinal: true,
  provider: 'local-whisper',
  receivedAt: 1000 + startMs,
})

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
    compteRendu:
      '# Acme Industries\n\nRenfort de deux profils Java.\n\n### Prochaines étapes\n\n- envoyer 2 CV — Julien — vendredi\n- ranger le bureau\n',
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
  /*
   * Two of the three bullets came from a cited item; the third did not. The
   * document has to make exactly the first two followable — the point of
   * matching on string equality is that a line the composer did not write from
   * evidence stays plain rather than acquiring a control that leads nowhere.
   */
  sources: [
    { text: 'envoyer 2 CV — Julien — vendredi', span: span('on vous envoie deux CV vendredi') },
    { text: 'relancer les achats', span: span('il faut repasser par les achats') },
  ],
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
    /*
      **The recipe the document came out of** (DEC-43), which the gate reads from
      the one channel that answers it.

      In `beforeEach` and not only in the recipe tests on purpose: the chip is on
      every gate, so every case in this file should have it. A fixture that only
      supplies it where it is being asserted is a fixture that cannot exercise the
      screen — and the read failing has to leave the gate exactly as it was
      (DEC-26), which is what the last case in this file drives.
    */
    .when('meeting:get', () => ({
      meeting,
      segments: [],
      signals: [],
      outbox: [],
      document: null,
      compteRendu: panel().edits.compteRendu,
      recipe: 'besoin-commercial' as const,
    }))
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
    /*
      On the row it flags, exactly once — the marker is a measurement about that
      field and scattering it would make it decoration (DEC-21).

      Scoped to the rail rather than counted across the screen, because the
      document column also *names* the glyph: the compte-rendu is a second
      document that goes out on the same press and carries its own `⚠ faible`,
      so the gate says once, where the confusion happens, that a doubt lifted in
      the rail has not been lifted in that text.
    */
    const row = document.getElementById('row-account')
    expect(row).toBeTruthy()
    // `selector` because testing-library matches an ancestor whose whole text is
    // the string as well as the leaf that holds it, and the row wraps the marker.
    expect(within(row as HTMLElement).getAllByText('⚠ faible', { selector: 'span' })).toHaveLength(1)
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
    const unresolved = document.getElementById('row-account')
    expect(unresolved).toBeTruthy()
    expect(
      within(unresolved as HTMLElement).getAllByText('⚠ faible', { selector: 'span' }),
    ).toHaveLength(1)

    // And leaving it that way is a valid confirmation — nothing on this screen
    // blocks on it, and the header does not print a dangling « · ». The button
    // says what it is shipping, though: an unverified field reaches the one
    // control the screen has, or the `⚠` is decoration (DEC-21).
    fireEvent.click(screen.getByRole('button', { name: 'Valider malgré 1 champ non vérifié' }))
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

  /*
   * DEC-21's loop, closed.
   *
   * A quote with no context is evidence a rep cannot weigh. Following a
   * citation has to land in the *stored* transcript — the same rows
   * `spanVerification.ts` checked the quote against — and when the quote is not
   * in there, the reader has to say so rather than opening silently at 0:00 and
   * leaving the rep hunting for a sentence that was never said.
   */
  test('a citation can be followed into the transcript it was verified against', async () => {
    bridge.when('review:get', () => openGate())
    bridge.when('review:transcript', () => ({
      marks: [],
      segments: [
        segment('s1', 'far', 0, 'Bonjour, merci pour le point.'),
        segment('s2', 'far', 61_000, 'Il nous faut deux dev java senior sur le sujet.'),
      ],
    }))

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    // The gate opens on the document; the transcript is not fetched until asked.
    expect(screen.queryByText(/Bonjour, merci pour le point/)).toBeNull()

    await act(async () => {
      screen.getAllByRole('button', { name: /^source/ })[3]?.click()
    })
    await act(async () => {
      screen.getByRole('button', { name: /Voir dans la transcription/ }).click()
    })

    // The record is on screen, and the reader names the field and the moment.
    expect(await screen.findByText(/Il nous faut deux dev java senior/)).toBeTruthy()
    // Both the heading and the cited row carry the moment — the reader says
    // where it landed, and the row says when it was said.
    expect(screen.getByText(/Citation du champ/)).toBeTruthy()
    expect(screen.getAllByText('1:01')).toHaveLength(2)
  })

  test('a citation the transcript does not contain says so, and does not pretend', async () => {
    bridge.when('review:get', () => openGate())
    bridge.when('review:transcript', () => ({
      marks: [],
      segments: [segment('s1', 'far', 0, 'Rien de ce qui a été cité.')],
    }))

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    await act(async () => {
      screen.getAllByRole('button', { name: /^source/ })[3]?.click()
    })
    await act(async () => {
      screen.getByRole('button', { name: /Voir dans la transcription/ }).click()
    })

    expect(await screen.findByText(/est introuvable dans la transcription/)).toBeTruthy()
    // The record is still drawn — the rep reads the call and judges for
    // themselves, which is the whole reason this is the transcript and not a
    // second summary of it.
    expect(screen.getByText(/Rien de ce qui a été cité/)).toBeTruthy()
  })

  /*
   * Saying « introuvable » is the honest half. Leaving the rep at 0:04 of a
   * twenty-minute call is the other half, and the search is what closes it:
   * the claim is usually in the record, paraphrased or split across two turns.
   */
  test('the transcript search opens carrying the quote that did not verify', async () => {
    bridge.when('review:get', () => openGate())
    bridge.when('review:transcript', () => ({
      marks: [],
      segments: [
        segment('s1', 'far', 0, 'Rien de ce qui a été cité.'),
        /*
         * **Close, and genuinely not the quote.**
         *
         * This turn used to be « Il nous faudrait deux dev java, senior de
         * préférence » against a cited « deux dev java senior » — which the
         * *gate* verifies, because `normalizeForVerification` folds the comma,
         * and which the reader's own raw `includes` did not. So the fixture was
         * an instance of the contradiction rather than a test of the dead end:
         * the two halves of one screen disagreeing about the same sentence, with
         * this test asserting the losing half. One search now, so the dead end
         * has to be a real one.
         */
        segment('s2', 'far', 61_000, 'Il nous faudrait deux profils java confirmés, plutôt seniors.'),
      ],
    }))

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    await act(async () => {
      screen.getAllByRole('button', { name: /^source/ })[3]?.click()
    })
    await act(async () => {
      screen.getByRole('button', { name: /Voir dans la transcription/ }).click()
    })

    const box = (await screen.findByLabelText(
      'Rechercher dans la transcription',
    )) as HTMLInputElement
    // Seeded with the fragment the verification looked for and did not find,
    // and saying so rather than silently listing the whole call.
    expect(box.value).toBe('deux dev java senior')
    expect(screen.getByText('aucun passage')).toBeTruthy()

    /*
     * The dead end ends in a tap, and what it offers is a **moment of the call**,
     * not a word.
     *
     * It used to offer content words of the failed quote as chips, which was
     * right and useless: the rep is not looking for « senior », they are looking
     * for the turn where the client said something close to what was cited. So
     * the candidates are segments, scored by how much of the query they carry
     * weighted by how rare each term is in this call, and they are labelled as
     * candidates — the app failed to verify this quote and a ranked guess must
     * never wear the verified treatment (DEC-21).
     */
    expect(screen.getByText(/Les plus proches, à vérifier/)).toBeTruthy()
    const candidate = screen.getByRole('button', { name: /Il nous faudrait deux profils java/ })
    // The one turn that carries four of the query's terms, and not the turn that
    // carries none of them.
    expect(screen.queryByRole('button', { name: /Rien de ce qui a été cité/ })).toBeNull()

    // Pressing it marks that turn in the record below — with the search rule,
    // never the citation's wash.
    await act(async () => {
      candidate.click()
    })
    // The last of the two — the candidate button above carries the same string,
    // and the one that has to change is the turn in the record itself.
    const drawn = screen.getAllByText('Il nous faudrait deux profils java confirmés, plutôt seniors.')
    expect(drawn[drawn.length - 1]?.className).toContain('text-strong')
  })

  test('a verified citation does not pre-fill the search over its own hit', async () => {
    bridge.when('review:get', () => openGate())
    bridge.when('review:transcript', () => ({
      marks: [],
      segments: [segment('s1', 'far', 61_000, 'Il nous faut deux dev java senior.')],
    }))

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    await act(async () => {
      screen.getAllByRole('button', { name: /^source/ })[3]?.click()
    })
    await act(async () => {
      screen.getByRole('button', { name: /Voir dans la transcription/ }).click()
    })

    expect(
      (screen.getByLabelText('Rechercher dans la transcription') as HTMLInputElement).value,
    ).toBe('')
    expect(screen.getByText(/Citation du champ/)).toBeTruthy()
  })

  /*
   * The two rows that were never interpreted (DEC-7) have no citation to
   * follow, and offering one would be a control that lands nowhere (DEC-26).
   */
  test('a deterministic row offers no jump, because it has nothing to jump to', async () => {
    bridge.when('review:get', () => openGate())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    await act(async () => {
      screen.getAllByRole('button', { name: /^source/ })[1]?.click()
    })
    expect(screen.queryByRole('button', { name: /Voir dans la transcription/ })).toBeNull()
  })
})

/**
 * The measurement reaches the button.
 *
 * DEC-21 is the whole of what this product has over a general-purpose
 * notetaker: it checks its own sentences against the recording and says so. The
 * gate drew a mid-blue *Valider* whether every citation had verified or whether
 * one had failed — same colour, same word, same place — so the `⚠` in the
 * banner and the `⚠` on the row were counted by nothing. Two things change with
 * the payload and nothing else does: there is still one button, it is still
 * live, and pressing it still ships (DEC-4).
 */
describe('DEC-21 — the one button says what it is shipping', () => {
  test('a clean gate says Valider, and nothing on it is amber', async () => {
    bridge.when('review:get', () => openGate())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const button = screen.getByRole('button', { name: 'Valider' })
    expect(button.className).toContain('bg-brand-700')
    expect(screen.queryByText(/malgré/)).toBeNull()
  })

  test('an unverified field is named on the button and carried in its colour', async () => {
    bridge.when('review:get', () =>
      openGate({
        fields: panel().fields.map((f) =>
          f.key === 'besoin' ? { ...f, confidence: 'faible' as const } : f,
        ),
      }),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const button = screen.getByRole('button', { name: 'Valider malgré 1 champ non vérifié' })
    // Warn, not brand — and not disabled: withholding the control would be a
    // second gate, and a greyed primary is a button a rep presses (DEC-4).
    expect(button.className).toContain('bg-warn')
    expect((button as HTMLButtonElement).disabled).toBe(false)

    // And the count's obvious follow-up question — *which* — is answered on the
    // line under it rather than left to the rep to go hunting for.
    expect(screen.getByText(/Besoin — introuvable dans la transcription/)).toBeTruthy()

    await act(async () => {
      button.click()
    })
    await waitFor(() => expect(confirmCall()).toBeTruthy())
  })
})

describe('DEC-20 / DEC-4 — three intents, one button', () => {
  /*
   * **Where the manifest lives, because where it lives decides what the guard
   * charges for and how much of the rail a rep gets.**
   *
   * « Ce qui sera créé » sat in the pinned band under the rail's scroller, and
   * that band has no ceiling: measured on the shipped renderer at 960×600, the
   * minimum window `main.ts` declares, it held **313px of a 510px column** and
   * left the eleven typed fields a **196px window on 1100px** — 17.8%, five page
   * turns, and `review-garde-mort` needed fourteen presses to arm the gate.
   * Inside the scroller the same three rows cost 206px of content that the
   * arming guard measures instead of 206px of furniture that it cannot, and the
   * rail's window goes to 403px.
   *
   * jsdom measures every box as zero, so the arithmetic is the harness's
   * (`--scrollers`, « aucune bande fixe ne dépasse la colonne qu'elle borde »).
   * What this asserts is the structural fact that arithmetic rests on, and it is
   * the half a screenshot cannot state: the three checkboxes are **inside** the
   * measured column, and *Valider* is **outside** it. Swap either and this goes
   * red.
   */
  test('the manifest is inside the measured rail; the button is not', async () => {
    bridge.when('review:get', () => openGate())

    const { container } = render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const rail = container.querySelector('[data-rail]')
    expect(rail).toBeTruthy()

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    for (const box of boxes) expect(rail!.contains(box)).toBe(true)

    // The legend travels with the rows it heads.
    expect(rail!.contains(screen.getByText('Ce qui sera créé'))).toBe(true)

    // And the decision does not scroll: it is the pinned sibling, not inside it.
    const ship = screen.getByRole('button', { name: /^Valider/ })
    expect(rail!.contains(ship)).toBe(false)
  })

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

    // The gate opens on the typeset reading of the document; the raw string is
    // one word away and *Modifier* is the word. Both halves show every marker.
    expect(screen.queryByLabelText('Compte-rendu')).toBeNull()
    await act(async () => {
      screen.getByRole('button', { name: 'Modifier' }).click()
    })

    await act(async () => {
      /*
       * `Objet` and not `Client`. This drove `Client` and asserted
       * `edits.accountName` — a field that is `readOnly` because an account is
       * resolved and never typed (DEC-7), so no rep can make that edit. It held
       * anyway: `fireEvent.change` sets a value and dispatches an event whatever
       * `readOnly` says, because jsdom enforces `readOnly` against a *user* and
       * there is none here. The file's headline « an edited field is what gets
       * sent » test was therefore asserting a payload produced by a gesture the
       * product refuses, and it would have gone green on a regression that made
       * `Client` typeable again *and* on one that did not.
       *
       * The sibling test one describe-block away was rewritten for exactly this
       * and this one was missed, because the grep stopped at the test named after
       * the symptom.
       */
      fireEvent.change(screen.getByLabelText('Objet'), {
        target: { value: 'Point Acme — renfort data' },
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
    expect(sent?.edits.taskName).toBe('Point Acme — renfort data')
    expect(sent?.edits.besoin).toBe('Trois développeurs, pas deux')
    expect(sent?.edits.compteRendu).toBe('# Corrigé par le commercial')
    expect(sent?.edits.mailSubject).toBe('Suite à notre point')
    // Untouched rows travel as they were pre-filled.
    expect(sent?.edits.tjm).toBe('520 €')
    // And the account travels resolved, because the rail cannot write it: the
    // candidate chip is its only writer.
    expect(sent?.edits.accountName).toBe('Acme Industries')
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

describe('the guard measures the rep, not the scroller', () => {
  /*
   * **The gate's own opening scroll used to satisfy its own guard.**
   *
   * It jumps the rail to the first `⚠ faible` row (DEC-21), and on the ESN
   * document that lands it at exactly `scrollHeight − clientHeight`. The old
   * flag was « the bottom has been touched », so it was true before the rep had
   * done anything: scrolling the *document* alone then armed « Valider malgré 1
   * champ non vérifié » with seven of eleven fields never drawn at 1280×800 —
   * *Client* among them, the field that decides which VerySwing account gets the
   * opportunity — under a caption reading « Tout ce qui part doit avoir été
   * affiché avant d'être validé ».
   *
   * The guard was inverted by its own good behaviour: the jump only happens when
   * there *is* something unverified, so it stood down exactly when there was
   * something to check.
   *
   * jsdom measures every box as zero, so the guard's *permissive* default is all
   * that can be asserted here — the arithmetic itself is held by
   * `scripts/harness` driving a real layout. What these hold is the thing jsdom
   * can see: that a column which cannot be measured never refuses, because a
   * gate dead in a test environment is worse than no guard.
   */
  test('a column that cannot be measured never blocks the button', async () => {
    bridge.when('review:get', () => openGate())
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    // Every box is 0×0 here, so nothing is measurable and nothing is withheld.
    expect(screen.getByRole('button', { name: /^Valider/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /(la suite|Remonter)/ })).toBeNull()
  })
})

describe('a correction is not lost by leaving the screen', () => {
  /*
   * `edits` is component state, so every way off this screen threw it away
   * silently — `Échap` (one of exactly two shortcuts deliberately allowed while
   * typing, on the one screen with a fifty-six-line textarea), `Ctrl/⌘ H`,
   * `Ctrl/⌘ ,` and the back link. A rep who corrected the objection, glanced at
   * the calendar and came back found the model's sentence again, with nothing
   * having said the correction was gone.
   */
  test('what was typed is still there after leaving and coming back', async () => {
    bridge.when('review:get', () => openGate())

    const first = render(<Review meetingId="m-draft" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    fireEvent.change(document.getElementById('field-objections') as HTMLTextAreaElement, {
      target: { value: 'le TJM a été accepté après relecture' },
    })

    // Leaving is anything at all — the map is keyed by meeting, not by route.
    first.unmount()

    render(<Review meetingId="m-draft" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    expect((document.getElementById('field-objections') as HTMLTextAreaElement).value).toBe(
      'le TJM a été accepté après relecture',
    )
  })

  test('another meeting’s gate is not another meeting’s draft', async () => {
    bridge.when('review:get', () => openGate())

    const first = render(<Review meetingId="m-un" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    fireEvent.change(document.getElementById('field-objections') as HTMLTextAreaElement, {
      target: { value: 'correction du premier appel' },
    })
    first.unmount()

    render(<Review meetingId="m-deux" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    // The server's pre-fill, not the other call's correction.
    expect((document.getElementById('field-objections') as HTMLTextAreaElement).value).not.toBe(
      'correction du premier appel',
    )
  })

  test('a confirmed gate keeps no draft', async () => {
    bridge.when('review:get', () => openGate())

    const first = render(<Review meetingId="m-confirme" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    const objections = document.getElementById('field-objections') as HTMLTextAreaElement
    const original = objections.value
    fireEvent.change(objections, { target: { value: 'une correction envoyée' } })

    // Read to the end, then ship.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Valider/ }))
    })
    await waitFor(() => expect(confirmCall()).toBeTruthy())
    first.unmount()

    render(<Review meetingId="m-confirme" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    /*
     * Nothing to restore: it was confirmed, the gate refuses this meeting from
     * here on, and a leftover draft would outlive the screen that could show it.
     */
    expect((document.getElementById('field-objections') as HTMLTextAreaElement).value).toBe(
      original,
    )
  })
})

describe('a correction that would reach nothing is not offered', () => {
  /*
   * The nine interpretive rows are the *opportunity's* columns and nothing
   * else's — `draftIntents` composes them into its description, and the CRM task
   * carries the compte-rendu instead. So an opportunity that does not ship turns
   * nine live textareas into controls over a payload that will never exist: the
   * rep corrects the objection this screen is architected around, presses
   * *Valider*, and VerySwing gets the model's uncorrected text.
   *
   * Read-only and stated (DEC-26), never hidden: the value, its citation and its
   * `⚠ faible` are still what the screen is for.
   */
  const withoutOpportunity = () =>
    openGate({
      intents: panel().intents.map((intent) =>
        intent.kind === 'crm.opportunity'
          ? { ...intent, available: false, reason: 'Compte non résolu — pas d’opportunité.' }
          : intent,
      ),
    })

  test('the typed rows go read-only, and the reason is stated once', async () => {
    bridge.when('review:get', () => withoutOpportunity())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const objections = document.getElementById('field-objections') as HTMLTextAreaElement
    expect(objections.readOnly).toBe(true)
    // Once, above the group — nine identical sentences would be a wall.
    expect(screen.getAllByText(/Les valeurs ci-dessous ne partiront pas/)).toHaveLength(1)
    // And it names where a correction *does* still land.
    expect(screen.getByText(/corrigez le compte-rendu à gauche/)).toBeTruthy()
  })

  test('the objet stays editable, because the task still ships it', async () => {
    bridge.when('review:get', () => withoutOpportunity())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    // Two of the eleven rows are the task's, and the task is unaffected.
    expect((document.getElementById('field-taskName') as HTMLInputElement).readOnly).toBe(false)
  })

  test('unchecking the opportunity is the same case', async () => {
    bridge.when('review:get', () => openGate())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    expect((document.getElementById('field-objections') as HTMLTextAreaElement).readOnly).toBe(
      false,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Opportunité/ }))
    })

    // Unchecked: the same nine rows now reach nothing, and say so.
    await waitFor(() =>
      expect((document.getElementById('field-objections') as HTMLTextAreaElement).readOnly).toBe(
        true,
      ),
    )
    expect(screen.getByText(/L’opportunité n’est pas cochée/)).toBeTruthy()
  })

  /*
   * **The button counts what leaves, and the two halves of this were tested in
   * disjoint tests until now.**
   *
   * Three tests above assert `readOnly`, the single sentence and the objet
   * staying editable, and none of them reads the button; two elsewhere assert
   * the exact string « Valider malgré 1 champ non vérifié » and never touch the
   * checkbox. So the gate told the rep they were shipping past an unverified
   * field that was not shipping, and the same sentence labelled the payload with
   * an opportunity and the payload without — at the one human gate in the
   * product, in front of a POST with no idempotency key and no delete verb.
   */
  test('the count on the button is what leaves, not what is unverified', async () => {
    /*
     * Two unverified rows on purpose, one of each kind: `account` is one of the
     * two the CRM *task* ships whatever happens to the opportunity, `objections`
     * is one of the nine typed. So the count must fall from 2 to 1 rather than
     * vanish, and the button stays on screen to be read.
     */
    bridge.when('review:get', () =>
      openGate({
        fields: panel().fields.map((f) =>
          f.key === 'account' || f.key === 'objections'
            ? { ...f, confidence: 'faible' as const }
            : f,
        ),
      }),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    expect(screen.getByRole('button', { name: 'Valider malgré 2 champs non vérifiés' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Opportunité/ }))
    })

    await waitFor(() =>
      expect((document.getElementById('field-objections') as HTMLTextAreaElement).readOnly).toBe(
        true,
      ),
    )
    // One, not two: `objections` is no longer leaving.
    expect(screen.getByRole('button', { name: 'Valider malgré 1 champ non vérifié' })).toBeTruthy()

    // The header keeps the measurement: it is what the product checked, and it
    // does not change because a payload shrank.
    expect(screen.getByText(/11 champs · 9 vérifiés/)).toBeTruthy()
  })

  /*
   * And the way back to the sentence, because the count is a control: with every
   * unverified row inert, pressing it used to focus a `readOnly` textarea — the
   * dead control DEC-26 refuses — while the sentence saying where the correction
   * goes sat 555 px above the top of its own scroller.
   */
  /*
   * **The one gate that writes into a client's CRM was offering a remedy that
   * does nothing, and pointing the rep at it.**
   *
   * An account is resolved, never typed (DEC-7): `crm.task` carries `accountId`
   * and `accountName` appears in no payload. Driven on the shipped `draftIntents`
   * by round 16: two payload sets across a changed `accountName`, byte-identical.
   * So the rep read « Valider malgré 1 champ non vérifié », pressed the count,
   * was *focused into* `#field-account` by the product itself, typed the client's
   * real name, and nothing moved — in front of a POST with no idempotency key and
   * no delete verb.
   *
   * And the sentence beside the button said « Client — introuvable dans la
   * transcription » about a row whose `span` is `null` **by contract**, two lines
   * under a `source ▸` panel reading « jamais lu sur la transcription ». It sent
   * them to search a place the screen had already said was never consulted.
   *
   * `accountCandidates: []` is the default here on purpose: it is what
   * `register.ts` returns whenever there are no attendee e-mails, which is the
   * no-Entra build DEC-28 ships the first demo on. On that build there is no
   * remedy on the screen at all, and the sentence has to say so rather than
   * invent one.
   */
  test('the client row states where the act lives, and never claims the transcription', async () => {
    bridge.when('review:get', () =>
      openGate({
        fields: panel().fields.map((f) =>
          f.key === 'account' ? { ...f, confidence: 'faible' as const } : f,
        ),
      }),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    // Not a control: the value is resolved, and the box pretended otherwise.
    expect((document.getElementById('field-account') as HTMLInputElement).readOnly).toBe(true)

    // It still ships — `accountId` goes in the task — so the count still names it.
    expect(screen.getByRole('button', { name: 'Valider malgré 1 champ non vérifié' })).toBeTruthy()

    // But not with the false clause, and with the true one instead.
    expect(screen.queryByText(/Client — introuvable dans la transcription/)).toBeNull()
    expect(screen.getByText(/Client — non résolu, et rien ici ne peut le rattacher/)).toBeTruthy()

    // And the row carries the reason, where the rep is looking.
    expect(screen.getByText(/Aucun rattachement n’a été proposé/)).toBeTruthy()

    // Pressing the count must not focus a box the rep cannot type in.
    await act(async () => {
      fireEvent.click(screen.getByText(/champs · /))
    })
    expect(document.activeElement?.id).not.toBe('field-account')
  })

  /*
   * **`edits.compteRendu` has one consumer, and the screen promised it
   * unconditionally.**
   *
   * The document's only destination is `crm.task`'s `payload.body`. Untick the
   * task and it reaches no external system — and the sentence over the document
   * went on reading « Ce texte-ci part dans la tâche VerySwing tel qu'il est
   * affiché ». The rep corrects the thing the entire left half of the screen is
   * for, under a promise that is false.
   *
   * This is `Client`'s defect at the scale of a column, and it wants a different
   * remedy: the document stays editable, because it is the rep's own record and
   * `confirmation.recorded` writes it verbatim into the log whatever ships, so
   * *Historique* and its search read the corrected text. What was owed was a true
   * sentence, not an inert column.
   */
  test('with the task unticked, the document stops claiming it goes to VerySwing', async () => {
    bridge.when('review:get', () =>
      openGate({
        fields: panel().fields.map((f) =>
          f.key === 'objections' ? { ...f, confidence: 'faible' as const } : f,
        ),
      }),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    expect(screen.getByText(/Ce texte-ci part dans la tâche VerySwing/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Tâche/ }))
    })

    expect(screen.queryByText(/Ce texte-ci part dans la tâche VerySwing/)).toBeNull()
    expect(screen.getByText(/il reste sur la réunion dans « Historique »/)).toBeTruthy()
  })

  test('with nothing correctable in the rail, the count reaches the sentence', async () => {
    // The one unverified row is a typed one, so with the opportunity gone there
    // is nothing in the rail a rep can act on.
    bridge.when('review:get', () =>
      openGate({
        intents: panel().intents.map((intent) =>
          intent.kind === 'crm.opportunity'
            ? { ...intent, available: false, reason: 'Compte non résolu — pas d’opportunité.' }
            : intent,
        ),
        fields: panel().fields.map((f) =>
          f.key === 'objections' ? { ...f, confidence: 'faible' as const } : f,
        ),
      }),
    )

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const notice = screen.getByText(/Les valeurs ci-dessous ne partiront pas/)
    expect(notice.id).toBe('rail-inert-notice')

    const count = screen.getByRole('button', { name: /11 champs · 10 vérifiés/ })
    const objections = document.getElementById('field-objections') as HTMLTextAreaElement
    await act(async () => {
      fireEvent.click(count)
    })
    expect(document.activeElement).not.toBe(objections)
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

describe('the gate is headed by the call, never by the word « Revue »', () => {
  test('open, the one h1 is the meeting, and nothing names the furniture', async () => {
    /*
     * It was a 28px serif « Revue » — the largest thing on the screen, naming
     * what the screen permanently is — with the call in muted 12px beside it.
     * The rep pressed *Relire et valider* on that call thirty seconds ago; what
     * the strongest ink owes them is which call the one irreversible press is
     * about.
     */
    bridge.when('review:get', () => openPanel())

    render(<Review meetingId="m1" onBack={() => {}} />)

    const title = await screen.findByRole('heading', { level: 1 })
    expect(title.textContent).toContain('Acme Industries — besoin Dev Java')
    expect(screen.queryByRole('heading', { name: 'Revue' })).toBeNull()

    // The client is *not* appended: this title already opens with it, and
    // « Acme Industries — besoin Dev Java · Acme Industries » is the account
    // name printed twice on one line.
    const banner = screen.getByRole('banner').textContent ?? ''
    expect(banner).toContain('Acme Industries — besoin Dev Java')
    expect(banner).not.toContain('Dev Java · Acme Industries')

    // And the way back still names a *destination*, which is a different job
    // from a screen naming itself.
    expect(screen.getByRole('button', { name: '‹ Calendrier' })).toBeTruthy()
  })

  test('no caption over the document, and the switch is what says which view', async () => {
    /*
     * « COMPTE-RENDU » sat over a document whose own first line is `# <objet>`,
     * two inches under a segmented control already naming the three views — so
     * in the third tab « Transcription » was drawn twice on one screen. A pane is
     * named by its content (`ui/SectionHeader.tsx`).
     *
     * Asked of the *heading* role, not of the text: « compte-rendu » appears in
     * this screen's prose in several places that are doing work — the document's
     * own title, the copy control, the switch's own label.
     */
    bridge.when('review:get', () => openPanel())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByRole('button', { name: 'Valider' })

    expect(screen.queryByRole('heading', { name: 'Compte-rendu' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Transcription' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Lecture', pressed: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeTruthy()
  })

  test('the markers sentence is here, where the document is editable', async () => {
    /*
     * It used to be drawn on all three surfaces that typeset a compte-rendu, two
     * of which are read-only — including the session pane, during the call. It is
     * a real promise (DEC-44: VerySwing receives the string the rep read) and it
     * is needed once, at the moment the rep can act on it: this screen, where the
     * text is editable and where the press that writes into the client's CRM is.
     */
    bridge.when('review:get', () => openPanel())

    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByRole('button', { name: 'Valider' })

    expect(screen.getByText(/font partie du texte/)).toBeTruthy()
    expect(screen.getByText(/VerySwing reçoit exactement ce qui est affiché/)).toBeTruthy()
  })

  test('closed, there is no header at all — only the reason and the way back', async () => {
    bridge.when('review:get', () => ({
      open: false as const,
      state: 'recording' as const,
      reason: 'Réunion en cours.',
    }))

    render(<Review meetingId="m1" onBack={() => {}} />)

    await screen.findByText('Réunion en cours.')
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
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

  /*
   * **This test used to prove the opposite, and it would still pass either way.**
   *
   * It was « correcting the client renames what will be created »: it typed into
   * `Client` and watched the summary follow. Two things were wrong with it. The
   * summary is not what will be created — `accountName` reaches no payload, only
   * this line — and `fireEvent.change` sets a value and dispatches an event
   * whatever `readOnly` says, because jsdom enforces `readOnly` against a *user*
   * and there is no user here. So the assertion held whether or not a rep could
   * type in the box at all, which is the one thing it looked like it was proving.
   *
   * What is left is the attribute, which is what the browser actually enforces,
   * and the sole legitimate writer: the candidate chip, `set('accountName', …)`,
   * covered by « resolving the account enables the opportunity, and it ships ».
   */
  test('the client row cannot be typed into, because typing it ships nothing', async () => {
    bridge.when('review:get', () => openPanel()).when('review:preview', preview)

    render(<Review meetingId="m1" onBack={() => {}} />)

    const client = (await screen.findByLabelText('Client')) as HTMLInputElement
    await waitFor(() =>
      expect(screen.getByText('Acme Industries — besoin Dev Java — Acme Industries')).toBeTruthy(),
    )

    expect(client.readOnly).toBe(true)
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

describe('the bullets are checkable, the way the fields are (DEC-21)', () => {
  /*
   * The eleven typed rows each offered a `[source ▸]` and the twenty-four
   * hundred pixels of compte-rendu beside them offered provenance on quotations
   * only — five followable fragments across twenty-eight substantive lines, and
   * **none at all on the twelve bullets**. The bullets are the operative half:
   * « Envoyer 3 CV avec TJM avant vendredi » is the commitment that becomes the
   * VerySwing task, and it was the least checkable thing on a screen whose whole
   * argument is that nothing ships unchecked.
   *
   * Nothing new is claimed here. The spans were already on the `Cited<T>` items
   * the composer wrote each line from and `spanVerification` had already looked
   * them up; they simply never left the extraction.
   */
  test('a bullet written from a cited item opens the record on it', async () => {
    bridge.when('review:get', () => openGate())
    bridge.when('review:transcript', () => ({
      marks: [],
      segments: [segment('s1', 'far', 61_000, 'On vous envoie deux CV vendredi, promis.')],
    }))
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    // Not fetched until asked — the same rule `source ▸` keeps.
    expect(screen.queryByText(/promis/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /envoyer 2 CV — Julien — vendredi/ }))
    // The same reader, over the same stored segments.
    await screen.findByText(/On vous envoie deux CV vendredi/)
  })

  test('a ⚠ faible bullet keeps its provenance — it is the one most worth checking', async () => {
    // The marker is appended to the rendered line and is not part of what was
    // said. Comparing with it attached would strip the control from exactly the
    // lines a rep needs it on, which is backwards.
    bridge.when('review:get', () =>
      openGate({
        edits: {
          ...panel().edits,
          compteRendu: '### Prochaines étapes\n\n- relancer les achats ⚠ faible\n',
        },
        sources: [
          { text: 'relancer les achats', span: span('il faut repasser par les achats') },
        ],
      }),
    )
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    expect(screen.getByRole('button', { name: /relancer les achats/ })).toBeTruthy()
  })

  test('a bullet the composer did not write from evidence stays plain', async () => {
    /*
     * The match is string equality on purpose. A near-match would be the app
     * guessing which sentence a piece of evidence belongs to — the failure
     * DEC-21 exists to prevent — and a control that leads nowhere is the dead
     * control DEC-26 forbids.
     */
    bridge.when('review:get', () => openGate())
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    expect(screen.queryByRole('button', { name: /ranger le bureau/ })).toBeNull()
    expect(screen.getByText(/ranger le bureau/)).toBeTruthy()
  })
})

/**
 * **« ce n’est pas le bon modèle de compte-rendu »** (DEC-43, US-8).
 *
 * The recipe was decided before the call and then invisible: measured on the
 * shipped gate at 1280×800 and at 960×600, the words « Prise de besoin »,
 * « Compte-rendu libre » and « Modèle » appeared nowhere on the screen and none
 * of its forty-two controls could change it — so a rep who recorded a discovery
 * call under the ESN trame had to re-record to get the other shape.
 *
 * These hold the three things that decide whether the picker is right, and the
 * one thing jsdom cannot see is named where it is missing rather than dropped:
 * every box measures zero here, so the arming guard fails open by design and
 * « *Valider* is withheld until the new document has been shown » is driven
 * against real layout instead, at both smoke sizes.
 */
describe('the recipe is on the document, and changeable (DEC-43)', () => {
  /** Open the picker and hand back its rewrite control for the other recipe. */
  const openPicker = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /^Modèle :/ }))
    return screen.findByRole('button', { name: /^Réécrire avec/ })
  }

  test('the gate names the recipe the meeting is set to produce', async () => {
    bridge.when('review:get', () => openGate())
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    expect(
      await screen.findByRole('button', { name: 'Modèle : Prise de besoin commercial' }),
    ).toBeTruthy()
  })

  test('the free recipe names itself, and the picker offers the other one', async () => {
    bridge
      .when('review:get', () => openGate())
      .when('meeting:get', () => ({
        meeting,
        segments: [],
        signals: [],
        outbox: [],
        document: null,
        compteRendu: panel().edits.compteRendu,
        recipe: 'libre' as const,
      }))
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    expect(await screen.findByRole('button', { name: 'Modèle : Compte-rendu libre' })).toBeTruthy()
    // The declared set minus the current one, and nothing a rep typed (DEC-43).
    const offered = await openPicker()
    expect(offered.textContent).toBe('Réécrire avec « Prise de besoin commercial »')
    expect(
      screen.queryByRole('button', { name: /Réécrire avec « Compte-rendu libre »/ }),
    ).toBeNull()
  })

  /*
   * **The retry path, and only it.**
   *
   * `meeting:recipe` records the choice and fires `runEnhancement`, which is
   * `Orchestrator.enhance` — whose docblock states the property this acceptance
   * line exists for: `#enhance` gathers the transcript, the context and the rep's
   * notes the same way whichever way the run is reached, so a re-extraction can
   * never analyse less material than the attempt it replaces. Dispatching
   * `extract` over `session:command` would be a second way in, and that channel's
   * own docblock says a renderer using it moves the meeting to `extracting` with
   * no run behind it.
   */
  test('the rewrite goes through meeting:recipe and through nothing else', async () => {
    bridge
      .when('review:get', () => openGate())
      .when('meeting:recipe', (payload) => ({
        recipe: payload.recipe,
        regenerating: true,
      }))
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    await act(async () => {
      ;(await openPicker()).click()
    })

    const recipeCalls = bridge.calls.filter((c) => c.channel === 'meeting:recipe')
    expect(recipeCalls).toHaveLength(1)
    expect(recipeCalls[0]?.payload).toEqual({ meetingId: 'm1', recipe: 'libre' })
    expect(bridge.calls.some((c) => c.channel === 'session:command')).toBe(false)
    expect(bridge.calls.some((c) => c.channel === 'enhancement:retry')).toBe(false)
  })

  test('what happens to the rep’s corrections is on screen, counted, before the press', async () => {
    bridge.when('review:get', () => openGate())
    render(<Review meetingId="m-compte" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    // Nothing touched: the sentence promises nothing about corrections.
    await openPicker()
    expect(
      screen.getByText(/Réécrire remplace le compte-rendu, les champs et le brouillon de/),
    ).toBeTruthy()

    // One correction, named in the singular.
    fireEvent.change(document.getElementById('field-objections') as HTMLTextAreaElement, {
      target: { value: 'le TJM a été accepté' },
    })
    expect(screen.getByText(/votre correction sur cet écran sera perdue/)).toBeTruthy()

    // Three, counted rather than described.
    fireEvent.change(document.getElementById('field-besoin') as HTMLTextAreaElement, {
      target: { value: 'trois profils' },
    })
    fireEvent.change(screen.getByLabelText('Objet du brouillon'), {
      target: { value: 'Suite à notre point' },
    })
    expect(screen.getByText(/vos 3 corrections sur cet écran seront perdues/)).toBeTruthy()

    // And what is *not* lost is named too — the notes are the rep's (DEC-5) and
    // the transcript is the record (DEC-21).
    expect(screen.getByText(/Vos notes et la transcription ne changent pas/)).toBeTruthy()
  })

  /*
   * **And the sentence is true.**
   *
   * `PENDING_EDITS` is per meeting and lives as long as the window, so a draft
   * that outlived the document it was made against would come back on the next
   * mount — over a compte-rendu it does not belong to. Driven the way the product
   * does it: the rewrite starts, and the panel that comes back on
   * `session:changed` is the new document.
   */
  test('the corrections named are the corrections dropped, and the new document is drawn', async () => {
    let rewritten = false
    bridge
      .when('review:get', () =>
        rewritten
          ? openGate({
              edits: {
                ...panel().edits,
                compteRendu: '# Compte-rendu libre — Acme Industries\n\nUn autre plan.\n',
                objections: '',
                besoin: '',
              },
              fields: panel().fields.slice(0, 2),
            })
          : openGate(),
      )
      .when('meeting:recipe', (payload) => {
        rewritten = true
        return { recipe: payload.recipe, regenerating: true }
      })
    render(<Review meetingId="m-libre" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    fireEvent.change(document.getElementById('field-objections') as HTMLTextAreaElement, {
      target: { value: 'MA CORRECTION' },
    })

    await act(async () => {
      ;(await openPicker()).click()
    })
    // The broadcast the new extraction really arrives on.
    await act(async () => {
      bridge.emit('session:changed', { meetingId: 'm-libre', state: 'awaiting_confirmation' })
    })
    await screen.findByText('Prêt à envoyer')

    /*
     * The document *Valider* would ship is the new one, not the one the rewrite
     * replaced — which is what the shipped gate did at both smoke sizes before
     * this existed: the rail dropped from eleven rows to two and the document
     * stayed at the heading of the compte-rendu that had just been replaced.
     */
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }))
    await waitFor(() =>
      expect((screen.getByLabelText('Compte-rendu') as HTMLTextAreaElement).value).toBe(
        '# Compte-rendu libre — Acme Industries\n\nUn autre plan.\n',
      ),
    )
    // The row the correction was in is gone with the recipe that asked for it.
    expect(document.getElementById('field-objections')).toBeNull()

    // And the draft is dropped rather than held: a fresh mount gets the pre-fill.
    cleanup()
    render(<Review meetingId="m-libre" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    expect(screen.queryByDisplayValue('MA CORRECTION')).toBeNull()
  })

  /*
   * The gate closes under the rep while the run goes — `extract` is legal from
   * `awaiting_confirmation` and the machine moves — so the one screen they were
   * confirming on disappears. `STATE_REASON.extracting` is « Analyse en cours… »,
   * which is the right bland sentence for a meeting nobody touched and no answer
   * at all to « I pressed *Réécrire* ».
   */
  test('the gate closing under the rep says which press closed it', async () => {
    let rewritten = false
    bridge
      .when('review:get', () =>
        rewritten
          ? { open: false as const, state: 'extracting' as const, reason: 'Analyse en cours…' }
          : openGate(),
      )
      .when('meeting:recipe', (payload) => {
        rewritten = true
        return { recipe: payload.recipe, regenerating: true }
      })
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    await act(async () => {
      ;(await openPicker()).click()
    })
    await act(async () => {
      bridge.emit('session:changed', { meetingId: 'm1', state: 'extracting' })
    })

    expect(
      await screen.findByText(
        /Le compte-rendu est en cours de réécriture avec « Compte-rendu libre »/,
      ),
    ).toBeTruthy()
  })

  /*
   * `regenerating: false` means the recorded choice already matched the stored
   * document's, so nothing is being replaced — and nothing of the rep's may be
   * thrown away for a run that is not happening.
   */
  test('a choice that replaces nothing keeps what the rep typed', async () => {
    bridge
      .when('review:get', () => openGate())
      .when('meeting:recipe', (payload) => ({
        recipe: payload.recipe,
        regenerating: false,
        state: 'awaiting_confirmation' as const,
      }))
    render(<Review meetingId="m-garde" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    fireEvent.change(document.getElementById('field-objections') as HTMLTextAreaElement, {
      target: { value: 'gardée' },
    })

    await act(async () => {
      ;(await openPicker()).click()
    })
    expect((document.getElementById('field-objections') as HTMLTextAreaElement).value).toBe(
      'gardée',
    )
    // And the chip has moved to what was recorded.
    expect(await screen.findByRole('button', { name: 'Modèle : Compte-rendu libre' })).toBeTruthy()
  })

  /*
   * DEC-26, and the reason this read is not allowed to be load-bearing: a picker
   * is worth less than the one confirmation in the product, so a channel that
   * refuses costs the chip and nothing else.
   */
  test('a recipe the app could not read costs the chip and not the gate', async () => {
    bridge
      .when('review:get', () => openGate())
      .when('meeting:get', () => {
        throw new Error('réunion inconnue: m1')
      })
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    expect(screen.queryByRole('button', { name: /^Modèle/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Valider/ })).toBeTruthy()
  })

  /*
   * **One press, one run — and the lock lasts exactly as long as the request.**
   *
   * `meeting:recipe` would happily record a second choice mid-run, and the run
   * already reading the first would finish and store a document whose recipe is
   * not the one the chip shows. So the panel is closed by the press: the gesture
   * is over, and what happens next arrives in the column behind it.
   *
   * The lock is deliberately **not** « a rewrite has been asked for », and the
   * reason is the case the three tests below drive: on the build DEC-28 ships
   * first — and on any machine whose key has expired — `Enhancement.run` returns
   * without moving the machine, so the gate stays open and no document ever
   * arrives. A *lock* keyed on the request would hold « Réécriture… » over a live
   * gate for the life of the window, which is the dead control DEC-26 forbids.
   *
   * What that reasoning got wrong, and R33-1 measured, is the *conclusion* it
   * drew: « the renderer cannot tell that case from a slow one, because
   * `enhancement:status` answers `idle` for every meeting past `ended` ». It can,
   * because `statusOf` reports `running` off `#running` and off
   * `state === 'extracting'` — and a run that started is one or the other by the
   * time the press's own answer crosses the bridge. That is what the gate asks
   * now, once, and it is the only thing allowed to say a rewrite did not start.
   */
  test('the press closes the picker, and two clicks are one run', async () => {
    bridge
      .when('review:get', () => openGate())
      .when('meeting:recipe', (payload) => ({
        recipe: payload.recipe,
        regenerating: true,
      }))
      .when('enhancement:status', () => ({ status: 'running' as const, since: null }))
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const press = await openPicker()
    await act(async () => {
      press.click()
      press.click()
    })
    expect(bridge.calls.filter((c) => c.channel === 'meeting:recipe')).toHaveLength(1)
    // Gone with the gesture, not greyed: there is no second « Réécrire » under
    // the pointer over a document that is already being replaced.
    expect(screen.queryByRole('button', { name: /^Réécrire avec/ })).toBeNull()
    // And the control it was opened from is still live, still naming what was
    // recorded — never stuck on a promise the main process may not keep.
    const chip = await screen.findByRole('button', { name: 'Modèle : Compte-rendu libre' })
    expect(chip.hasAttribute('disabled')).toBe(false)
  })

  /*
   * **A rewrite that cannot run took *Valider* away and said nothing** (R33-1).
   *
   * The three cases below are one behaviour and each is a different half of it.
   * What made this reachable is that nothing on the **open** gate ever learned
   * the run had not started: `register.ts` answers `changed: true` and fires
   * `runEnhancement` without awaiting it, `Enhancement.run` finds no recipe,
   * records `enhancement.deferred` and returns *without moving the machine*, and
   * the only sentence this screen had was drawn in the `!open` branch under
   * `state === 'extracting'` — the one branch a deferred rewrite never reaches.
   *
   * **Two of the three are visible here only because the withdrawal stopped
   * being a measurement.** jsdom gives every box a height of zero, so `below` is
   * null and the arming guard fails open by design — the coverage reset the press
   * used to do was structurally invisible to every test in this repo, which is
   * why the five-to-eight page turns it cost were found by driving the browser
   * and not here. *Valider* is now withheld by the marker itself, which is a fact
   * about the press rather than about a rectangle, so jsdom can see it; the cost
   * in page turns is still measured against real layout, in
   * `review-modele-differe`.
   */
  test('a rewrite in flight withholds Valider and says so, without a greyed copy', async () => {
    let answer: (status: { status: 'running'; since: number | null }) => void = () => {}
    bridge
      .when('review:get', () => openGate())
      .when('meeting:recipe', (payload) => ({ recipe: payload.recipe, regenerating: true }))
      // Held open, which is the window the marker exists for: between the press
      // and knowing, *Valider* may not be on screen — `confirm` is legal from
      // `awaiting_confirmation` and would ship the document being replaced.
      .when(
        'enhancement:status',
        () =>
          new Promise((resolve) => {
            answer = resolve as typeof answer
          }),
      )
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')
    expect(screen.getByRole('button', { name: /^Valider/ })).toBeTruthy()

    await act(async () => {
      ;(await openPicker()).click()
    })

    expect(screen.queryByRole('button', { name: /^Valider/ })).toBeNull()
    expect(
      screen.getByText(
        /Réécriture avec « Compte-rendu libre » demandée — la validation reprendra/,
      ),
    ).toBeTruthy()

    // The run really started: the gate goes on waiting, and the way out is the
    // machine moving, which the two tests above drive.
    await act(async () => {
      answer({ status: 'running', since: null })
    })
    expect(screen.queryByRole('button', { name: /^Valider/ })).toBeNull()
  })

  test('a rewrite that never starts gives Valider back, and names what it ships', async () => {
    bridge
      .when('review:get', () => openGate())
      .when('meeting:recipe', (payload) => ({ recipe: payload.recipe, regenerating: true }))
      /*
       * What the shipped main process answers for this meeting, measured against
       * the real `Orchestrator` and the real `Enhancement` wired the way `main.ts`
       * wires them: the meeting is `awaiting_confirmation`, so `statusOf` returns
       * `idle` — the deferral is recorded and announced, and `idle` is what an
       * open gate sees.
       */
      .when('enhancement:status', () => ({ status: 'idle' as const }))
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    await act(async () => {
      ;(await openPicker()).click()
    })

    // Back, at no cost in page turns: nothing on screen changed, so nothing the
    // rep had read stopped being read.
    expect(screen.getByRole('button', { name: /^Valider/ })).toBeTruthy()
    // And it says what it is about to send, because the panel had just promised
    // « La validation reprendra dès que le nouveau compte-rendu sera prêt ».
    expect(
      screen.getByText(/La réécriture n’a pas démarré : ce que « Valider » envoie est le/),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /n’a pas démarré\. Le compte-rendu ci-dessous est toujours celui de « Prise de besoin commercial »/,
      ),
    ).toBeTruthy()
  })

  /*
   * **And the chip names the document, which is also what keeps the retry on the
   * screen.**
   *
   * `recipe` is `chosen ?? meeting:get`, so the press moves it at once. Left
   * there, the chip claimed the document was the recipe that had just failed to
   * be written — and `RecipeSwitch`'s `others` excludes the current value, so
   * « Réécrire avec « Compte-rendu libre » » left the screen: a rep told the
   * rewrite had not started, on a gate with no way to ask again.
   */
  test('a stalled rewrite keeps the document’s recipe on the chip, and the retry offered', async () => {
    bridge
      .when('review:get', () => openGate())
      .when('meeting:recipe', (payload) => ({ recipe: payload.recipe, regenerating: true }))
      .when('enhancement:status', () => ({ status: 'idle' as const }))
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    await act(async () => {
      ;(await openPicker()).click()
    })

    expect(
      await screen.findByRole('button', { name: 'Modèle : Prise de besoin commercial' }),
    ).toBeTruthy()
    // And pressing it again is a real retry, not a press recording the recipe the
    // document already has.
    await act(async () => {
      ;(await openPicker()).click()
    })
    const calls = bridge.calls.filter((c) => c.channel === 'meeting:recipe')
    expect(calls).toHaveLength(2)
    expect(calls[1]?.payload).toEqual({ meetingId: 'm1', recipe: 'libre' })
  })
})

/**
 * **Every sentence the gate makes about what leaves, against what `draftIntents`
 * would actually create.**
 *
 * The subject of the rule is *which of three intents is going*, so the fixture
 * walks all eight tick sets rather than the one that prompted it. A one-subset
 * fixture is what let three of these sentences ship: `e6c52aa` made the document's
 * VerySwing claim conditional on `crm.task` and left the rail notice, the markers
 * note, the account row, the mail heading and the button's count reading the
 * *opportunity* — or nothing at all.
 *
 * Driven on the shipped renderer at 1280×800 before the fix, task and opportunity
 * unticked, on one painted frame:
 *
 *     rail   « … corrigez le compte-rendu à gauche, c'est lui qui part dans la
 *              tâche VerySwing. »
 *     doc    « La tâche VerySwing ne part pas : ce texte-ci ne quitte pas
 *              l'application … »
 *
 * Two claims about one string four hundred pixels apart, and the false one is the
 * *remedy* — it spends the rep's correction on a document that will not leave the
 * machine, at the one human gate in the product (DEC-4), in front of a
 * `POST /v1/crm/tasks` with no idempotency key and a `CrmPort` with no delete
 * verb.
 *
 * Ground truth is `draftIntents` itself, run on the same tick set: a sentence is
 * allowed to name a destination exactly when a payload for it exists.
 */
describe('DEC-4 — every sentence about what leaves agrees with what is created', () => {
  const INTENT_IDS = ['m1:crm.task', 'm1:crm.opportunity', 'm1:mail.draft'] as const

  /**
   * **What is actually created, from the panel the main process sent.**
   *
   * `draftIntents` cannot be imported here — the renderer may read
   * `core/contracts/` only (ARCHITECTURE §4) — and it does not need to be: the
   * contract the gate is handed is `ReviewIntent.available`, and the rep's tick
   * is the other half. `register.ts` drafts on exactly that pair and the press
   * below is asserted against it, so the loop is closed at the channel rather
   * than at a second copy of the domain.
   */
  const created = (checked: readonly string[]): Set<string> =>
    new Set(
      panel()
        .intents.filter((intent) => intent.available && checked.includes(intent.id))
        .map((intent) => intent.kind),
    )

  /** Both deterministic rows unverified, so the count has something to name. */
  const withFaibleAccount = () =>
    openGate({
      fields: panel().fields.map((field) =>
        field.key === 'account' ? { ...field, confidence: 'faible' as const } : field,
      ),
    })

  const screenText = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')

  const untick = async (id: string) => {
    const box = document.querySelector<HTMLInputElement>(`input[type="checkbox"][value="${id}"]`)
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    const target = box ?? boxes[INTENT_IDS.indexOf(id as (typeof INTENT_IDS)[number])]
    if (!target) throw new Error(`no checkbox for ${id}`)
    await act(async () => {
      target.click()
    })
  }

  for (let mask = 0; mask < 8; mask += 1) {
    const checked = INTENT_IDS.filter((_, i) => (mask & (1 << i)) !== 0)
    const dropped = INTENT_IDS.filter((id) => !checked.includes(id))

    test(`cochées : ${checked.length === 0 ? 'aucune' : checked.join(' + ')}`, async () => {
      bridge.when('review:get', () => withFaibleAccount())
      render(<Review meetingId="m1" onBack={() => {}} />)
      await screen.findByText('Prêt à envoyer')
      for (const id of dropped) await untick(id)

      const kinds = created(checked)
      const text = screenText()

      // The task's document. Three sentences used to claim it independently.
      const claimsTask = [
        'part dans la tâche VerySwing tel qu’il est affiché',
        'VerySwing reçoit exactement ce qui est affiché',
        'c’est lui qui part dans la tâche VerySwing',
        'la tâche partira sans compte',
      ].filter((claim) => text.includes(claim))
      if (!kinds.has('crm.task')) {
        expect({ claimsTask, checked }).toEqual({ claimsTask: [], checked })
      }

      // The opportunity's nine rows.
      if (!kinds.has('crm.opportunity')) {
        expect(text).not.toContain('Les corrections faites à droite vont dans l’opportunité')
      }

      // The follow-up. « (brouillon) » is a promise about what will be created.
      if (!kinds.has('mail.draft')) {
        expect(text).not.toContain('Email de relance (brouillon)')
        expect(text).not.toContain('la relance est créée en brouillon')
      }

      /*
       * And the count on the one irreversible control. `taskName` and `account`
       * ride `payload.title` and `payload.accountId` of *both* CRM intents, so
       * they leave if either leaves; the nine interpretive rows are the
       * opportunity's alone.
       */
      const owed = panel()
        .fields.map((field) => field.key)
        .filter((key) => (key === 'account' ? true : false))
        .filter(() => kinds.has('crm.task') || kinds.has('crm.opportunity')).length
      const label =
        [...document.querySelectorAll('button')]
          .map((b) => b.textContent ?? '')
          .find((t) => t.startsWith('Valider')) ?? ''
      const counted = /Valider malgré (\d+) champ/.exec(label)
      expect({ set: checked.join(','), counted: counted === null ? 0 : Number(counted[1]) }).toEqual({
        set: checked.join(','),
        counted: owed,
      })

      /*
       * And the sentences are about the press that actually happens. Without
       * this the block would be eight assertions about a screen with nothing
       * tying it to the channel that writes into a client's CRM.
       */
      if (label !== '') {
        const button = [...document.querySelectorAll('button')].find((b) =>
          (b.textContent ?? '').startsWith('Valider'),
        )
        await act(async () => {
          button?.click()
        })
        expect(confirmCall()?.intentIds?.slice().sort()).toEqual([...checked].sort())
      }
    })
  }
})

/**
 * **A refusal that leaves the gate usable** (DEC-4, `f630dcd`).
 *
 * `register.ts` refuses a press that would create nothing *before* dispatching,
 * so the one confirmation is not spent on the empty set — the defect it repaired
 * left the meeting in `pushing` with an empty outbox, from which `confirm`,
 * `extract` and `abort` are all illegal for the life of the database, and the
 * gate read « Envoi en cours… » for ever about a POST that was never made.
 *
 * « refused » and « refused and still usable » are two different facts and only
 * the second is the fix, so both halves are here: the sentence reaches the rep,
 * and the next press carries the row they ticked. `review-refus` photographs the
 * first half — it cannot drive the second, because a successful press navigates
 * off the screen it exists to keep on camera.
 */
describe('DEC-4 — a press that creates nothing is refused, and not spent', () => {
  const EMPTY =
    'Rien ne serait créé — aucune action n’est cochée, ou aucune n’est disponible. La raison est indiquée sur chaque ligne.'

  test('the sentence reaches the rep and the button is still there for the next press', async () => {
    bridge
      .when('review:get', () => openGate())
      // The handler's own rule, not a canned refusal: an empty draft is refused
      // and anything else goes through.
      .when('review:confirm', (payload: { intentIds: string[] }) =>
        payload.intentIds.length === 0
          ? { ok: false as const, state: 'awaiting_confirmation' as const, reason: EMPTY }
          : { ok: true as const, state: 'pushing' as const, intentIds: payload.intentIds },
      )

    let confirmed = 0
    render(<Review meetingId="m1" onBack={() => {}} onConfirmed={() => (confirmed += 1)} />)
    await screen.findByText('Prêt à envoyer')

    for (const box of screen.getAllByRole('checkbox')) {
      await act(async () => {
        box.click()
      })
    }
    await valider()

    // The refusal is announced, the gate did not move, and nothing was confirmed.
    expect((await screen.findByRole('alert')).textContent).toBe(EMPTY)
    expect(confirmed).toBe(0)
    expect(screen.getByRole('button', { name: /^Valider/ })).toBeTruthy()

    // And the next press is a real one.
    await act(async () => {
      screen.getAllByRole('checkbox')[0]?.click()
    })
    await valider()

    const presses = bridge.calls.filter((c) => c.channel === 'review:confirm')
    expect(presses).toHaveLength(2)
    expect((presses[0]?.payload as { intentIds: string[] }).intentIds).toEqual([])
    expect((presses[1]?.payload as { intentIds: string[] }).intentIds).toEqual(['m1:crm.task'])
    expect(confirmed).toBe(1)
  })
})

/**
 * **The rail's coverage key names the ticks that change the rail, and no others.**
 *
 * `viewOf('rail')` was keyed on the whole checked set, and one of the three ticks
 * draws nothing in that column. Driven on the shipped renderer at 960×600 before
 * the fix: arm the gate, untick « Brouillon de relance », and *Valider* is
 * replaced by « Il reste des champs à lire, plus haut. » over a page turn reading
 * « Remonter dans ce qui part » — **eight presses** to get the button back, over
 * a column whose `innerText` and `scrollHeight` did not change (1159/1159 with
 * the opportunity ticked, 1096/1096 without). After: zero.
 *
 * `RAIL_INTENTS` is the one place that says which intents the column reads, and a
 * declaration like that rots. So this walks all eight subsets rather than the one
 * pair that prompted it, and asserts the property the declaration stands for
 * rather than the declaration: **two tick sets that agree on the CRM intents draw
 * the same rail.** A fourth intent the rail starts drawing, or a change that makes
 * the mail tick reach into this column, fails it here.
 *
 * And the other direction, which is the one DEC-4 cares about: the two CRM ticks
 * still change it. A key that made everything equal would pass the first half.
 */
describe('la colonne de droite ne dépend que des deux intentions CRM', () => {
  const IDS = ['m1:crm.task', 'm1:crm.opportunity', 'm1:mail.draft'] as const

  /** The measured column: the rail's scroller, not the footer under it. */
  const railText = () =>
    (document.querySelector('aside .fade-below')?.textContent ?? '').replace(/\s+/g, ' ').trim()

  /**
   * The account unverified, which is what `review-valider` stages and what makes
   * the *task* tick visible in this column at all: `accountReason` is null unless
   * the account is `faible`, so on a clean panel two of the three ticks draw
   * nothing here and the second test below could not tell a narrowed key from a
   * broken one.
   */
  const gateWithFaibleAccount = () =>
    openGate({
      fields: panel().fields.map((field) =>
        field.key === 'account' ? { ...field, confidence: 'faible' as const } : field,
      ),
    })

  const setTicks = async (want: readonly boolean[]) => {
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    for (const [i, box] of boxes.entries()) {
      if (box.checked === want[i] || box.disabled) continue
      await act(async () => {
        box.click()
      })
    }
  }

  const drawnFor = async (mask: number): Promise<string> => {
    await setTicks(IDS.map((_, i) => (mask & (1 << i)) !== 0))
    const drawn = railText()
    expect(drawn.length, 'the rail has to be drawing something to compare').toBeGreaterThan(200)
    return drawn
  }

  test('le brouillon Outlook ne change rien dans cette colonne, sur les huit sous-ensembles', async () => {
    bridge.when('review:get', gateWithFaibleAccount)
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    for (let mask = 0; mask < 8; mask += 1) {
      if ((mask & 4) !== 0) continue
      const without = await drawnFor(mask)
      const with_ = await drawnFor(mask | 4)
      expect(with_, `masque ${mask} vs ${mask | 4}`).toBe(without)
    }
  })

  test('les deux intentions CRM, elles, la changent', async () => {
    bridge.when('review:get', gateWithFaibleAccount)
    render(<Review meetingId="m1" onBack={() => {}} />)
    await screen.findByText('Prêt à envoyer')

    const all = await drawnFor(0b111)
    expect(await drawnFor(0b110), 'sans la tâche').not.toBe(all)
    expect(await drawnFor(0b101), 'sans l’opportunité').not.toBe(all)
  })
})
