/**
 * *Revue* — the review gate. The only human confirmation in the product (DEC-4).
 *
 *   ┌ Compte-rendu ───────────────┬ Prêt à envoyer ──────────────┐
 *   │ the document, editable      │ Client   [Acme SA]  ⚠ faible │
 *   │                             │ Besoin   …        [source ▸] │
 *   │                             │ …                            │
 *   │                             │ ── Email de relance ──       │
 *   │                             │ ☑ tâche ☑ oppy ☑ brouillon   │
 *   │                             │              [ Valider ]     │
 *   └─────────────────────────────┴──────────────────────────────┘
 *
 * Three rules this screen cannot get wrong:
 *
 * **DEC-23 — nothing surfaces while the meeting is `recording`.** Not enforced
 * by a condition here. `review:get` answers with a closed union that carries no
 * panel at all, so there is no field, no count and no badge in this component's
 * hands to leak. `ClosedGate` below is the whole of what exists in that state.
 *
 * **DEC-21 — `⚠ faible` is measured.** Every marker on this screen is
 * `field.confidence`, which the main process reads off the `VerificationReport`
 * after checking the cited quote occurs in the stored transcript. Nothing here
 * computes a confidence and nothing here receives one from a model.
 *
 * **DEC-20 / DEC-4 — three intents, one button.** Each row is uncheckable and
 * the unchecked ids are simply absent from what *Valider* sends; the main
 * process records them rather than inferring them from a missing row. There is
 * exactly one submit control on this screen and there is no second prompt.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ReviewEdits,
  ReviewField,
  ReviewIntent,
  ReviewPanel,
} from '../../electron/core/contracts/review.ts'
import type { MeetingState } from '../../electron/core/contracts/meeting.ts'
import type { ConnectorHealth, ConnectorId } from '../../electron/core/contracts/health.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { formatOffset } from '../app/format.ts'
import { Button, Centered, Chip, List, SectionHeader, unavailable } from '../ui/index.ts'

/** The one thing a rep must notice without reading (DEC-21). */
const FAIBLE = '⚠ faible'

/**
 * How long the *Ce qui sera créé* rows lag the field being typed into.
 *
 * Short enough that the rep never sees the old account name while looking at
 * the new one, long enough that a held key is one round trip and not thirty.
 */
const PREVIEW_DEBOUNCE_MS = 150

interface ReviewProps {
  meetingId: string
  onBack: () => void
  /** Called once the confirmation has been accepted. One gesture, no second prompt. */
  onConfirmed?: () => void
}

/** Which `ReviewEdits` key each form row writes into. */
const EDIT_KEY: Record<ReviewField['key'], keyof ReviewEdits> = {
  taskName: 'taskName',
  account: 'accountName',
  besoin: 'besoin',
  profils: 'profils',
  modeCollaboration: 'modeCollaboration',
  tjm: 'tjm',
  dateDemarrage: 'dateDemarrage',
  dureeMission: 'dureeMission',
  contexteTechnique: 'contexteTechnique',
  objections: 'objections',
  prochainesEtapes: 'prochainesEtapes',
}

/** Rows whose value is prose rather than a word. */
const MULTILINE = new Set<ReviewField['key']>([
  'besoin',
  'profils',
  'contexteTechnique',
  'objections',
  'prochainesEtapes',
])

/**
 * What an empty row says, as a `placeholder` and never as a value.
 *
 * The account used to arrive pre-filled with « Client à confirmer » — a phrase
 * that looked like an answer, sat in a box that looked filled, and was written
 * into `meetings.client_name` the moment the extraction landed. Grey hint text
 * in an empty field is the same information without any of that: it cannot be
 * confirmed by a rep skimming, it cannot be submitted, and it cannot be stored.
 *
 * The interpretive rows have none. An empty *Besoin* means the model found
 * nothing to say about the need, and a hint there would be a prompt to invent
 * one — which is the failure DEC-21 exists to prevent, one field at a time.
 */
const PLACEHOLDER: Partial<Record<ReviewField['key'], string>> = {
  taskName: 'Objet de la réunion — requis par VerySwing',
  /*
   * States the fact, and asks for nothing.
   *
   * It read « — saisissez-le » and that was an instruction the app cannot keep:
   * typing a company name here resolves no account, so the rep spends a
   * keystroke and `accountId` is still null — the opportunity stays undraftable
   * either way (DEC-20), and the task ships with or without it. The one field
   * that really is required says so on the line above; a second row wearing the
   * same urgency teaches the rep to read past both.
   *
   * Blank is a resting state. « non résolu » is also exactly what the
   * compte-rendu prints for it, so the two surfaces agree.
   */
  account: 'Client non résolu',
}

export function Review({ meetingId, onBack, onConfirmed }: ReviewProps) {
  const loaded = useInvoke('review:get', { meetingId })
  const [edits, setEdits] = useState<ReviewEdits | null>(null)
  const [checked, setChecked] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  /** The intents as they stand now. Null until the first preview answers. */
  const [live, setLive] = useState<ReviewIntent[] | null>(null)
  /** Which intents were draftable last time, so a newly possible one is noticed. */
  const availableBefore = useRef<Set<string> | null>(null)

  // Enhancement finishes in the background, so the gate opens on a broadcast
  // rather than on a poll — and closes again the moment the machine moves.
  useBroadcast('session:changed', (payload) => {
    if (payload.meetingId === meetingId) loaded.reload()
  })

  /*
   * Connector health, so an intent whose destination is unreachable says so
   * *before* the rep presses the one button (DEC-26). Read here rather than
   * folded into `review:get` because it changes independently of the panel —
   * VSA can come back while this screen is open, and it should stop saying it
   * is down without a reload.
   */
  const healthState = useInvoke('health:snapshot', {})
  useBroadcast('health:changed', (payload) => {
    if (healthState.state.status !== 'ready') return
    healthState.set({ ...healthState.state.value, [payload.connector]: payload.health })
  })
  const health = healthState.state.status === 'ready' ? healthState.state.value : null

  const retry = useCallback(
    (connector: ConnectorId) => {
      void invoke('health:retry', { connector }).then((result) => {
        if (healthState.state.status !== 'ready') return
        healthState.set({ ...healthState.state.value, [connector]: result })
      })
    },
    [healthState],
  )

  const panel: ReviewPanel | null =
    loaded.state.status === 'ready' && loaded.state.value.open ? loaded.state.value.panel : null

  // The form is seeded once from the server's pre-fill. Re-seeding on every
  // render of the panel would throw away what the rep is in the middle of
  // typing the first time a broadcast lands.
  useEffect(() => {
    if (!panel) return
    setEdits((previous) => previous ?? panel.edits)
    setChecked((previous) =>
      previous ?? panel.intents.filter((i) => i.available).map((i) => i.id),
    )
    availableBefore.current ??= new Set(
      panel.intents.filter((i) => i.available).map((i) => i.id),
    )
  }, [panel])

  /*
   * *Ce qui sera créé*, kept honest while the rep types.
   *
   * `panel.intents` is drafted from the **pre-fill** and never changes again, so
   * on its own this list describes what would have been created before the rep
   * touched anything — on the one screen whose entire promise is that what they
   * read is what the CRM receives. Recomputed through `review:preview`, which
   * runs the same `draftIntents` as `review:confirm` rather than a second copy
   * of the rule in here (`src/` may not import `core/domain/`, and a screen
   * showing its own idea of what will be created is the failure this fixes).
   *
   * Debounced because it fires per keystroke, and `stale` because the responses
   * are promises: without it a slow early reply can land after a fast later one
   * and put the pre-edit summary back on screen.
   */
  useEffect(() => {
    if (!edits || checked === null) return
    let stale = false
    const timer = setTimeout(() => {
      void invoke('review:preview', { meetingId, edits, intentIds: checked })
        .then((result) => {
          if (!stale) setLive(result.intents)
        })
        // Keep the last good draft. This runs while the rep is typing, so an
        // error banner here would cover a screen that is working.
        .catch(() => undefined)
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [checked, edits, meetingId])

  /*
   * An intent that has just become possible is checked, because nothing is ever
   * pre-unchecked (DEC-20) and the rep cannot have unchecked this one — it was
   * disabled until a moment ago. This is the other half of DEC-18 mitigation
   * *a*: picking a candidate account resolves `accountId`, which makes the
   * opportunity draftable, and it now both says so and ships.
   */
  useEffect(() => {
    if (live === null) return
    const nowAvailable = new Set(live.filter((i) => i.available).map((i) => i.id))
    const before = availableBefore.current
    availableBefore.current = nowAvailable
    if (!before) return
    const appeared = [...nowAvailable].filter((id) => !before.has(id))
    if (appeared.length === 0) return
    setChecked((previous) =>
      previous === null ? previous : [...previous, ...appeared.filter((id) => !previous.includes(id))],
    )
  }, [live])

  const set = useCallback((key: keyof ReviewEdits, value: string | number | null) => {
    setEdits((previous) => (previous ? { ...previous, [key]: value } : previous))
  }, [])

  const toggle = useCallback((id: string) => {
    setChecked((previous) =>
      previous === null
        ? previous
        : previous.includes(id)
          ? previous.filter((other) => other !== id)
          : [...previous, id],
    )
  }, [])

  const confirm = useCallback(async () => {
    if (!edits || checked === null || busy) return
    setBusy(true)
    setFailure(null)
    try {
      const outcome = await invoke('review:confirm', { meetingId, edits, intentIds: checked })
      if (outcome.ok) onConfirmed?.()
      else setFailure(outcome.reason)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'validation impossible')
    } finally {
      setBusy(false)
    }
  }, [busy, checked, edits, meetingId, onConfirmed])

  if (loaded.state.status === 'loading') return <Centered>Chargement…</Centered>

  if (loaded.state.status === 'failed') {
    return (
      <Centered>
        <p className="text-danger text-copy">{loaded.state.reason}</p>
        <BackLink onBack={onBack} />
      </Centered>
    )
  }

  // DEC-23. The closed arm of the union carries a state and a reason and
  // nothing else, so this branch has nothing it *could* render from the gate.
  if (!loaded.state.value.open) {
    return (
      <ClosedGate
        state={loaded.state.value.state}
        reason={loaded.state.value.reason}
        onBack={onBack}
      />
    )
  }

  if (!panel || !edits || checked === null) return <Centered>Chargement…</Centered>

  // The server's draft until the first preview lands, so the rows are never
  // blank — then what the form currently says.
  const intents = live ?? panel.intents

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/*
        The screen names itself (`5.3 Revue`). It used to open with the meeting
        title and nothing else, which left the one irreversible screen in the
        product looking like a second view of the meeting — a rep who arrives
        here from a broadcast has to be told, in a word, that this is the gate.
        The meeting is the line under it, where the design puts it.
      */}
      <header className="border-subtle flex shrink-0 items-center gap-inline border-b px-gutter py-3">
        <Button variant="nav" onClick={onBack}>
          ‹ Calendrier
        </Button>
        <span aria-hidden className="border-subtle h-4 shrink-0 border-l" />
        <h1 className="font-display text-strong shrink-0 text-display leading-none">Revue</h1>
        <p className="text-muted min-w-0 flex-1 truncate text-ui">
          {panel.meeting.title}
          {edits.accountName ? ` · ${edits.accountName}` : ''}
        </p>
        {panel.overall === 'faible' ? (
          <p className="text-warn shrink-0 text-ui">
            Certains champs n’ont pas pu être vérifiés dans la transcription.
          </p>
        ) : null}
      </header>

      {failure ? (
        <p role="alert" className="text-danger border-subtle border-b px-gutter py-1.5 text-ui">
          {failure}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <main className="bg-inner min-w-0 flex-1 overflow-y-auto px-gutter py-row">
          {/*
            « · modifiable » is not decoration. This is a borderless textarea on
            the same white as the pane, which is exactly what a read-only preview
            looks like — and the rep's last chance to correct the compte-rendu is
            the one surface they must not mistake for one.
          */}
          <SectionHeader>Compte-rendu · modifiable</SectionHeader>
          {/*
            Not `font-mono`. The compte-rendu is a document the rep reads and
            edits, and the monospace read as a log dump of something the machine
            had produced rather than as prose they own (`5.3 Revue` sets it in
            the body face at 13/1.5). The design also inks AI sentences apart
            from the rep's — that needs the editor, not a textarea, and is not
            built here.
          */}
          <textarea
            aria-label="Compte-rendu"
            value={edits.compteRendu}
            onChange={(event) => set('compteRendu', event.target.value)}
            className="text-body h-[calc(100%-2rem)] min-h-[24rem] w-full resize-none bg-transparent text-copy leading-relaxed"
          />
        </main>

        {/*
          440px in the design. Floor and ceiling rather than a bare `flex-[2]`,
          for the reason the session panes carry one: this column holds every
          editable field on the screen, and a two-word label wrapping to three
          lines on a laptop is how a rep misses the `⚠ faible` beside it.
        */}
        <aside className="border-subtle bg-card-soft w-[38%] min-w-[360px] max-w-[440px] shrink-0 overflow-y-auto border-l px-row py-row">
          <SectionHeader>Prêt à envoyer</SectionHeader>

          <List as="div" className="bg-card">
            {panel.fields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                value={String(edits[EDIT_KEY[field.key]] ?? '')}
                onChange={(value) => set(EDIT_KEY[field.key], value)}
              />
            ))}
          </List>

          {panel.accountCandidates.length > 0 ? (
            <div className="mt-2">
              <p className="text-muted text-meta">Autres sociétés du même groupe :</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {panel.accountCandidates.map((candidate) => (
                  <li key={candidate.accountId ?? candidate.name}>
                    <Chip
                      variant="choice"
                      onClick={() => {
                        set('accountId', candidate.accountId)
                        set('accountName', candidate.name)
                      }}
                    >
                      {candidate.name}
                    </Chip>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-muted mt-3 text-ui">
            <span className="text-body">Interlocuteurs</span> :{' '}
            {panel.interlocuteurs.length === 0
              ? 'aucun au calendrier'
              : panel.interlocuteurs.map((a) => a.name || a.email).join(', ')}
          </p>

          <MailDraft
            subject={edits.mailSubject}
            body={edits.mailBody}
            to={panel.mailTo}
            onSubject={(value) => set('mailSubject', value)}
            onBody={(value) => set('mailBody', value)}
          />

          <fieldset className="mt-5">
            <SectionHeader as="legend" className="mb-2">
              Ce qui sera créé
            </SectionHeader>
            {intents.map((intent) => (
              <IntentRow
                key={intent.id}
                intent={intent}
                checked={checked.includes(intent.id)}
                onToggle={() => toggle(intent.id)}
                connector={connectorFor(intent.kind, health)}
                onRetry={retry}
              />
            ))}
          </fieldset>

          {/*
            One button (DEC-4). It ships everything still checked, together, and
            the rep is never asked again — `confirm` is legal from
            `awaiting_confirmation` and nowhere else, so a second press is
            refused by the machine rather than by a flag here.
          */}
          <Button
            variant="primary"
            block
            className="mt-5 py-2"
            onClick={() => void confirm()}
            {...unavailable(busy, 'Envoi en cours. Ne fermez pas la fenêtre.')}
          >
            {busy ? 'Envoi…' : 'Valider'}
          </Button>
          <p className="text-muted mt-1.5 text-center text-meta">
            Rien n’est envoyé au client : la relance est créée en brouillon.
          </p>
        </aside>
      </div>
    </div>
  )
}

interface FieldRowProps {
  field: ReviewField
  value: string
  onChange: (value: string) => void
}

/**
 * One editable row with its `[source ▸]`.
 *
 * The affordance is on every row, including the two that were never
 * interpreted — it is the answer to "where did this come from?", and
 * « du calendrier, jamais de la transcription » is exactly the answer for those
 * two (DEC-7). A row that simply had no button would read as an oversight.
 */
function FieldRow({ field, value, onChange }: FieldRowProps) {
  const [open, setOpen] = useState(false)
  const multiline = MULTILINE.has(field.key)

  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline gap-2">
        <label className="text-muted w-28 shrink-0 text-meta" htmlFor={`field-${field.key}`}>
          {field.label}
        </label>
        {field.confidence === 'faible' ? (
          <span className="text-warn shrink-0 text-meta">{FAIBLE}</span>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-muted hover:text-body ml-auto shrink-0 text-meta"
        >
          {`source ${open ? '▾' : '▸'}`}
        </button>
      </div>

      {multiline ? (
        <textarea
          id={`field-${field.key}`}
          value={value}
          rows={Math.min(6, Math.max(2, value.split('\n').length))}
          onChange={(event) => onChange(event.target.value)}
          className="text-strong bg-inner border-subtle mt-1 w-full resize-none rounded-sm border px-2 py-1 text-ui"
        />
      ) : (
        <input
          id={`field-${field.key}`}
          value={value}
          {...(PLACEHOLDER[field.key] ? { placeholder: PLACEHOLDER[field.key] } : {})}
          onChange={(event) => onChange(event.target.value)}
          className="text-strong placeholder:text-muted bg-inner border-subtle mt-1 w-full rounded-sm border px-2 py-1 text-ui"
        />
      )}

      {open ? (
        <p className="text-muted mt-1 text-meta italic">
          {field.span
            ? `« ${field.span.quote} »${
                field.span.startMs === null ? ' — introuvable dans la transcription' : ` — ${formatOffset(field.span.startMs)}`
              }`
            : 'Du calendrier Outlook et de VerySwing — jamais lu sur la transcription.'}
        </p>
      ) : null}
    </div>
  )
}

interface MailDraftProps {
  subject: string
  body: string
  to: readonly string[]
  onSubject: (value: string) => void
  onBody: (value: string) => void
}

/**
 * Previewed inline and editable (VISION.md §6). A draft, never a send (HR-8).
 *
 * With no Microsoft account there are no recipients — they are deterministic
 * and come from the Graph event (DEC-7) — so `mail.draft` is not draftable and
 * nothing here will be created. *Ce qui sera créé* says so, but it says so
 * **below** this section, which is a rep editing a follow-up for two minutes
 * and only then reading that it goes nowhere. The consequence therefore appears
 * on the line the rep reads first.
 *
 * The fields stay editable on purpose rather than being disabled: without
 * Outlook this text is the one thing a rep can select and paste into their own
 * mail client, and a read-only textarea would take that away to make a point.
 */
function MailDraft({ subject, body, to, onSubject, onBody }: MailDraftProps) {
  return (
    <section className="mt-5">
      <SectionHeader as="h3" className="mb-2">
        Email de relance (brouillon)
      </SectionHeader>
      <p className="text-muted mb-1 text-meta">
        À :{' '}
        {to.length === 0
          ? 'aucun destinataire — aucun brouillon ne sera créé, le texte reste copiable'
          : to.join(', ')}
      </p>
      <input
        aria-label="Objet du brouillon"
        value={subject}
        onChange={(event) => onSubject(event.target.value)}
        className="text-strong bg-inner border-subtle w-full rounded-sm border px-2 py-1 text-ui"
      />
      <textarea
        aria-label="Corps du brouillon"
        value={body}
        rows={8}
        onChange={(event) => onBody(event.target.value)}
        className="text-body bg-inner border-subtle mt-1 w-full resize-none rounded-sm border px-2 py-1 text-ui leading-relaxed"
      />
    </section>
  )
}

/** Which connector each intent needs. */
const CONNECTOR_OF: Record<ReviewIntent['kind'], ConnectorId> = {
  'crm.task': 'crm',
  'crm.opportunity': 'crm',
  'mail.draft': 'mail',
}

/**
 * A connector that is not `ok`. Narrowed here, once, so the row below reads as
 * the rule rather than as a chain of optional checks — and so `reason` and
 * `retryable` are simply present, which is the whole point of the contract
 * making them mandatory off `ok`.
 */
type Trouble = { id: ConnectorId; health: Exclude<ConnectorHealth, { state: 'ok' }> }

const connectorFor = (
  kind: ReviewIntent['kind'],
  health: Partial<Record<ConnectorId, ConnectorHealth>> | null,
): Trouble | null => {
  const id = CONNECTOR_OF[kind]
  const value = health?.[id]
  return value && value.state !== 'ok' ? { id, health: value } : null
}

interface IntentRowProps {
  intent: ReviewIntent
  checked: boolean
  onToggle: () => void
  /** Non-null when the connector this intent needs is degraded or down. */
  connector: Trouble | null
  onRetry: (connector: ConnectorId) => void
}

/**
 * DEC-26, and the one place its wording is easy to get backwards.
 *
 * A down connector greys the row and states the reason inline, with a retry —
 * but it does **not** disable the checkbox. The outbox drains what it cannot
 * send yet, so an intent confirmed while VSA is unreachable is queued, not
 * lost. Disabling it would send the rep away to come back later, which is
 * exactly the second prompt DEC-4 exists to prevent — and would silently turn
 * an outage into a dropped compte-rendu.
 *
 * `available: false` is a different thing and still disables: it means there is
 * nothing to send at all (no opportunity in the extraction, no recipient for a
 * draft), which no amount of reconnecting fixes.
 */
function IntentRow({ intent, checked, onToggle, connector, onRetry }: IntentRowProps) {
  const trouble = connector
  const degraded = trouble !== null

  return (
    <div
      className={`flex items-start gap-2 py-1 text-ui ${
        intent.available && !degraded ? 'text-body' : 'text-muted'
      }`}
    >
      <input
        id={intent.id}
        type="checkbox"
        checked={checked && intent.available}
        disabled={!intent.available}
        onChange={onToggle}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0">
        <label htmlFor={intent.id} className="block">
          {intent.label}
        </label>
        {/* DEC-26: a disabled control always states why, inline. */}
        <span className="text-muted block truncate text-meta">
          {intent.available ? intent.summary : intent.reason}
        </span>
        {intent.available && trouble ? (
          <span className="text-warn block text-meta">
            {trouble.health.reason} — sera envoyé dès le rétablissement.{' '}
            {trouble.health.retryable ? (
              <Button variant="link" onClick={() => onRetry(trouble.id)}>
                Réessayer
              </Button>
            ) : null}
          </span>
        ) : null}
      </span>
    </div>
  )
}

/**
 * Everything the gate is while it is closed (DEC-23).
 *
 * A reason and a way back. No field names, no counts, no "3 éléments prêts" —
 * the response this renders does not contain any of that, which is the point.
 */
function ClosedGate({
  state,
  reason,
  onBack,
}: {
  state: MeetingState
  reason: string
  onBack: () => void
}) {
  return (
    <Centered>
      <p className="text-body text-copy">{reason}</p>
      {state === 'recording' ? (
        <p className="text-muted mt-1.5 text-ui">
          Le compte-rendu sera prêt à la fin de la réunion.
        </p>
      ) : null}
      <BackLink onBack={onBack} />
    </Centered>
  )
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="link" onClick={onBack} className="mt-3">
      Retour
    </Button>
  )
}
