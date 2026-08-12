/**
 * *Réglages* — two panes: the section list left, its content right
 * (VISION.md §6, screen 5). Providers, connectors, and the diagnostics panel.
 *
 * Three rules carry this screen, and all three are about saying the unwelcome
 * thing out loud rather than hiding it.
 *
 * **DEC-32 is the split, and the sentence above it is the split's point.**
 * *Requis* is audio, transcription and analysis — the three the header's status
 * control reads. *Facultatifs* is the calendar, VerySwing and Outlook, which
 * publish exactly the same `ConnectorHealth`, keep their reason and their retry,
 * and never move the general status. Both groups are built from
 * `REQUIRED_CONNECTORS` / `OPTIONAL_CONNECTORS` in `core/contracts/status.ts` —
 * the same two constants the header aggregates over — so the screen cannot come
 * to disagree with the control it is the destination of. A list retyped here
 * would drift the first time a connector is added, and the symptom would be a
 * rep reading *Facultatifs* about something that had just closed their app.
 *
 * **DEC-30 is the first section.** Local transcription is the default and is
 * written as the normal case, at the top of *Transcription*, above a table whose
 * first tier is *Sur cette machine*. Cloud STT is an accuracy upgrade a rep opts
 * into. Nothing here calls the local engine a fallback, and nothing here calls
 * coming back to it a degradation.
 *
 * **Where a provider runs is visible, and visible is all it is.** Every provider
 * is listed with that stated on the row — « sur la machine » or « hors machine »
 * — and a provider that cannot be used carries the reason instead. This is never
 * one of those reasons: where a client's transcript may be processed is a
 * contractual decision, and this screen's job is to make it in the open rather
 * than to make it for whoever signs. A row hidden or greyed by policy would put
 * that decision somewhere no one can see it, and the rep who pasted the key
 * would spend the demo wondering where it went.
 *
 * The row used to claim a jurisdiction as well — « UE » / « Hors UE ». It no
 * longer does (DEC-37): that is a per-client, per-contract fact the app cannot
 * keep true, and a stale badge is worse than no badge.
 *
 * **DEC-27 is on the button.** Two exports leave this machine. *Diagnostics*
 * goes through `core/domain/redactDiagnostics.ts` and contains no conversation
 * content; *Diagnostic complet* contains it, and the control says so in French,
 * on itself, before it is pressed. A bundle full of prospect transcripts sitting
 * in a support mailbox is a GDPR incident, so the safe one is the effortless one
 * and the other one is the one that has to be read.
 *
 * **DEC-34 put the credentials here.** This screen used to carry a note saying
 * it never edits one, because keys came from the environment and a field would
 * have been a control that appears to work and does not. That note described a
 * bug rather than a principle: a rep cannot set an environment variable, and a
 * packaged build has no `.env` to set it in, so every provider beyond the
 * bundled engine was a developer-only feature. A key typed here goes to the OS
 * credential store and is never read back — the row shows that one is stored and
 * four characters of it, which is the whole vocabulary the screen has for a
 * secret.
 */
import { useCallback, useState, type ReactNode } from 'react'
import type { DiagEvent } from '../../electron/core/contracts/diagnostics.ts'
import type { ConnectorHealth, ConnectorId } from '../../electron/core/contracts/health.ts'
import {
  OPTIONAL_CONNECTORS,
  REQUIRED_CONNECTORS,
} from '../../electron/core/contracts/status.ts'
import type {
  ConnectorRow,
  ProviderFieldValue,
  ProviderRow,
  ProviderSection,
  SettingsSnapshot,
} from '../../electron/core/contracts/settings.ts'
import type { CapabilityFinding, CapabilityReport } from '../../electron/core/contracts/crm.ts'
import type { ProviderTier } from '../../electron/core/contracts/providers.ts'
import type { ModelRow, ModelSection } from '../../electron/core/contracts/models.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { formatAgo } from '../app/format.ts'
import {
  Button,
  Centered,
  Chip,
  List,
  Row,
  SectionHeader,
  SectionNav,
  StateDot,
  unavailable,
} from '../ui/index.ts'
import type { SectionNavItem, StateDotProps } from '../ui/index.ts'

type SectionId = 'transcription' | 'llm' | 'connecteurs' | 'diagnostics'

/** VISION.md §6 names them in this order: the two provider tables, then the
 *  connectors, then diagnostics. */
const SECTIONS: readonly SectionNavItem<SectionId>[] = [
  { id: 'transcription', label: 'Transcription' },
  { id: 'llm', label: 'Modèle de langage' },
  { id: 'connecteurs', label: 'Connecteurs' },
  { id: 'diagnostics', label: 'Diagnostics' },
]

/**
 * Not the first item, on purpose. This screen is the destination of the header
 * status control (DEC-32), and a rep who clicks « Transcription indisponible »
 * has to land on the pane that says which subsystem is down and offers the
 * retry — not on a provider table. Opening on the first section would make the
 * one click the control hands over cost a second one.
 */
const LANDING: SectionId = 'connecteurs'

interface ReglagesProps {
  onBack: () => void
}

export function Reglages({ onBack }: ReglagesProps) {
  const [section, setSection] = useState<SectionId>(LANDING)
  const settings = useInvoke('settings:snapshot', {})
  /** The provider or model id currently being written, so two clicks cannot race. */
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  // Kept current by the broadcasts that already exist, rather than by a poll.
  useBroadcast('health:changed', (payload) => {
    if (settings.state.status !== 'ready') return
    const snapshot = settings.state.value
    settings.set({
      ...snapshot,
      connectors: snapshot.connectors.map((row) =>
        row.id === payload.connector ? { ...row, health: payload.health } : row,
      ),
    })
  })
  useBroadcast('auth:changed', (auth) => {
    if (settings.state.status !== 'ready') return
    settings.set({ ...settings.state.value, auth })
  })

  /**
   * Every settings write answers with the whole snapshot, and the screen takes
   * it wholesale (DEC-34).
   *
   * Not a local patch: storing a key can change *which* provider is selected,
   * whether the row above it is still the fallback, and what the boot step for
   * transcription would now say. A screen that patched one row would be right
   * about the row and wrong about the table.
   *
   * Declared above the loading guards, not below them — it is a hook, and a
   * hook after a conditional return is a hook that runs in a different order on
   * the render *after* the data lands.
   */
  const write = useCallback(
    async (id: string, run: () => Promise<SettingsSnapshot>) => {
      setBusy(id)
      try {
        settings.set(await run())
        setFailure(null)
      } catch (error) {
        // Named, never swallowed. The one screen a rep opens when something is
        // already broken must not add a control that silently does nothing.
        setFailure(error instanceof Error ? error.message : 'échec de l’enregistrement')
      } finally {
        setBusy(null)
      }
    },
    [settings],
  )

  if (settings.state.status === 'loading') {
    return <Centered>Chargement…</Centered>
  }
  if (settings.state.status === 'failed') {
    return (
      <Centered>
        <p className="text-danger text-copy">{settings.state.reason}</p>
      </Centered>
    )
  }

  const snapshot: SettingsSnapshot = settings.state.value

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-subtle flex items-baseline gap-4 border-b px-gutter pb-4 pt-7">
        <Button variant="nav" onClick={onBack}>
          ‹ Calendrier
        </Button>
        <h1 className="font-display text-strong text-display leading-none">Réglages</h1>
      </header>

      {/*
        Two panes, one window (HR-10). No dialog, no popover, no toast — the
        rail switches what the right pane holds and nothing overlays anything.

        Both panes carry a surface and run the full height (`5.5 Réglages`). A
        border alone left the rail and the content on the same white, so the
        split existed as a hairline and nothing else — and a rail that does not
        read as a rail is a column of links a rep scrolls past. The content pane
        is `--bg-card`, the rail one step back on `--bg-card-soft`, which is the
        same pairing the calendar uses one screen over.
      */}
      <div className="flex min-h-0 flex-1">
        <SectionNav
          label="Sections des réglages"
          items={SECTIONS}
          current={section}
          onSelect={setSection}
          className="bg-card-soft border-subtle w-60 overflow-y-auto border-r py-row"
        />

        <main className="bg-card min-h-0 flex-1 overflow-y-auto px-gutter pb-10 pt-row">
          {failure ? <p className="text-danger mb-3 text-ui">{failure}</p> : null}

          {section === 'transcription' ? (
            <>
              <Providers
                title="Transcription"
                capability="stt"
                section={snapshot.stt}
                intro={<TranscriptionIntro />}
                busy={busy}
                onSave={(providerId, value) =>
                  void write(providerId, () =>
                    invoke('settings:setCredential', { providerId, value }),
                  )
                }
                onForget={(providerId) =>
                  void write(providerId, () => invoke('settings:clearCredential', { providerId }))
                }
                onUse={(capability, providerId) =>
                  void write(providerId ?? capability, () =>
                    invoke('settings:selectProvider', { capability, providerId }),
                  )
                }
                onRecheck={(providerId) =>
                  void write(providerId, () => invoke('settings:snapshot', {}))
                }
                onSetField={(providerId, key, value) =>
                  void write(providerId, () =>
                    invoke('settings:setProviderField', { providerId, key, value }),
                  )
                }
              />
              <Models
                section={snapshot.models}
                busy={busy}
                onDownload={(modelId) =>
                  void write(modelId, async () => {
                    await invoke('models:download', { modelId })
                    return invoke('settings:snapshot', {})
                  })
                }
                onCancel={(modelId) =>
                  void write(modelId, async () => {
                    await invoke('models:cancel', { modelId })
                    return invoke('settings:snapshot', {})
                  })
                }
                onSelect={(modelId) =>
                  void write(modelId, () => invoke('settings:selectModel', { modelId }))
                }
              />
            </>
          ) : section === 'llm' ? (
            <Providers
              title="Modèle de langage"
              capability="llm"
              section={snapshot.llm}
              intro={<LlmIntro />}
              busy={busy}
              onSave={(providerId, value) =>
                void write(providerId, () => invoke('settings:setCredential', { providerId, value }))
              }
              onForget={(providerId) =>
                void write(providerId, () => invoke('settings:clearCredential', { providerId }))
              }
              onUse={(capability, providerId) =>
                void write(providerId ?? capability, () =>
                  invoke('settings:selectProvider', { capability, providerId }),
                )
              }
              onRecheck={(providerId) => void write(providerId, () => invoke('settings:snapshot', {}))}
              onSetField={(providerId, key, value) =>
                void write(providerId, () =>
                  invoke('settings:setProviderField', { providerId, key, value }),
                )
              }
            />
          ) : section === 'connecteurs' ? (
            <Connectors
              rows={snapshot.connectors}
              auth={snapshot.auth}
              probe={snapshot.probe}
              probeReason={snapshot.probeReason}
              onHealth={(connector, health) => {
                settings.set({
                  ...snapshot,
                  connectors: snapshot.connectors.map((row) =>
                    row.id === connector ? { ...row, health } : row,
                  ),
                })
              }}
            />
          ) : (
            <DiagnosticsPanel retentionDays={snapshot.retention.diagnosticsDays} />
          )}
        </main>
      </div>
    </div>
  )
}

/** The paragraph every pane opens with: muted, one column wide, never truncated. */
function Lede({ children }: { children: ReactNode }) {
  return <p className="text-muted mb-3 max-w-prose text-ui">{children}</p>
}

// ── Providers ───────────────────────────────────────────────────────────────

/** The three tiers, in the order VISION.md §6 names them: the floor first. */
const TIERS: readonly ProviderTier[] = ['local', 'self-hosted', 'cloud']

const TIER_LABEL: Record<ProviderTier, string> = {
  local: 'Sur cette machine',
  'self-hosted': 'Serveur auto-hébergé',
  cloud: 'Fournisseur cloud',
}

const RESIDENCY_LABEL = {
  local: 'sur la machine',
  remote: 'hors machine',
} as const

/**
 * DEC-30, in the two sentences a rep actually reads.
 *
 * The order of the clauses is the decision: the machine first, the cloud second
 * and as an upgrade. « revient sur cette machine » and not « repli », « secours »
 * or « mode dégradé » — coming back to the default is a return, and naming it a
 * downgrade would teach the rep to distrust the case that is normal.
 */
function TranscriptionIntro() {
  return (
    <Lede>
      La transcription se fait sur cette machine : c’est le fonctionnement normal, et rien
      de ce qui est dit pendant une réunion n’en sort. Un fournisseur cloud peut être
      ajouté pour gagner en précision ; s’il devient injoignable, la transcription revient
      sur cette machine et la réunion continue.
    </Lede>
  )
}

/**
 * The lede *Modèle de langage* never had, which left `TranscriptionIntro`'s
 * privacy claim reading as if it covered this section too.
 *
 * It does not. Transcription runs on the machine by default; the extraction
 * step sends the transcript to whichever model is selected, and on a cloud row
 * that means it leaves. Saying so here is the only place a rep would find out
 * before a client call rather than after one.
 */
function LlmIntro() {
  return (
    <Lede>
      Le modèle de langage rédige le compte-rendu à la fin de la réunion. Il ne s’agit pas de
      la transcription : ce qui lui est envoyé, c’est le texte de la réunion. Chaque
      fournisseur indique où il traite ces données ; un modèle installé sur cette machine ne
      les fait sortir nulle part.
    </Lede>
  )
}

// ── Local models (DEC-35) ───────────────────────────────────────────────────

/** French, and the sentence is the state — never a bare status word. */
const MODEL_STATE: Record<ModelRow['status'], (row: ModelRow) => string> = {
  absent: () => 'non installé',
  downloading: (row) => `téléchargement · ${row.progress} %`,
  verifying: () => 'vérification des fichiers…',
  ready: () => 'installé',
  cancelled: () => 'téléchargement annulé',
  error: (row) => row.reason ?? 'échec du téléchargement',
  interrupted: () => 'téléchargement interrompu — à relancer',
}

interface ModelsProps {
  section: ModelSection
  busy: string | null
  onDownload: (modelId: string) => void
  onCancel: (modelId: string) => void
  onSelect: (modelId: string) => void
}

/**
 * The checkpoints the local engine can load (DEC-35).
 *
 * Under *Transcription* and not beside it: this is the second half of one
 * question. The provider row answers "which engine"; this answers "which
 * weights", and only for the local one.
 */
function Models({ section, busy, onDownload, onCancel, onSelect }: ModelsProps) {
  return (
    <section className="mt-8">
      <SectionHeader>Modèles sur cette machine</SectionHeader>
      <Lede>
        Le modèle fourni avec le logiciel est déjà présent et connaît le vocabulaire de la
        société. Les autres se téléchargent à la demande : plus ils sont grands, plus ils sont
        précis et plus ils sollicitent la machine pendant la réunion.
      </Lede>

      <List as="div">
        {section.rows.map((row) => {
          const inFlight = row.status === 'downloading' || row.status === 'verifying'
          return (
            <Row as="div" key={row.id}>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-copy ${row.status === 'ready' ? 'text-strong' : 'text-muted'}`}
                >
                  {row.label}
                  {/*
                    « Chargé », not « Utilisé ». The provider table one section
                    up already marks its selection *Utilisé*, and two chips with
                    the same word on one pane ask the rep to work out which
                    noun each belongs to. The engine is used; the checkpoint is
                    what it loads.
                  */}
                  {row.selected ? (
                    <Chip variant="brand" className="ml-2 uppercase tracking-wider">
                      Chargé
                    </Chip>
                  ) : null}
                  {row.bundled ? (
                    <Chip variant="label" className="ml-2">
                      fourni
                    </Chip>
                  ) : null}
                </span>
                <span className="text-muted block text-meta">{MODEL_STATE[row.status](row)}</span>
              </span>

              <span className="flex shrink-0 items-center gap-3">
                <span className="text-muted text-meta">
                  {row.sizeMb} Mo · précision {row.accuracy}
                </span>

                {row.status === 'ready' && !row.selected ? (
                  <Button variant="text" onClick={() => onSelect(row.id)}>
                    Utiliser
                  </Button>
                ) : null}

                {inFlight ? (
                  <Button variant="text" onClick={() => onCancel(row.id)}>
                    Annuler
                  </Button>
                ) : null}

                {/*
                  The bundled row is never offered a download and never offered a
                  removal: it ships in the installer, it is the floor DEC-30
                  relies on, and a button that deletes the floor is one click
                  from a machine that cannot transcribe at all.
                */}
                {!row.bundled && !inFlight && row.status !== 'ready' ? (
                  <Button
                    variant="bordered"
                    onClick={() => onDownload(row.id)}
                    {...unavailable(busy === row.id, 'téléchargement en cours de démarrage')}
                  >
                    Télécharger
                  </Button>
                ) : null}
              </span>
            </Row>
          )
        })}
      </List>
    </section>
  )
}

interface ProvidersProps {
  title: string
  capability: 'stt' | 'llm'
  section: ProviderSection
  intro?: ReactNode
  /** Null while a write is in flight, so two clicks cannot race the vault. */
  busy: string | null
  onSave: (providerId: string, value: string) => void
  onForget: (providerId: string) => void
  onUse: (capability: 'stt' | 'llm', providerId: string | null) => void
  /** Re-read the tables. The only control an `oauth` row can honestly offer. */
  onRecheck: (providerId: string) => void
  onSetField: (providerId: string, key: string, value: string) => void
}

function Providers({
  title,
  capability,
  section,
  intro,
  busy,
  onSave,
  onForget,
  onUse,
  onRecheck,
  onSetField,
}: ProvidersProps) {
  /**
   * Which row has its credential field open.
   *
   * One at a time, and closed by default. A column of password fields is a
   * screen that looks like it is asking for six keys when it wants none of
   * them, and on the one screen a rep opens when something is already wrong.
   */
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section>
      <SectionHeader>{title}</SectionHeader>

      {intro}

      {/* Why nothing is selected, from the registry's own refusal (DEC-26). */}
      {section.selected === null && section.reason ? (
        <p className="text-warn mb-2 text-ui">{section.reason}</p>
      ) : null}

      <List as="div">
        {TIERS.map((tier) => {
          const rows = section.rows.filter((row) => row.tier === tier)
          if (rows.length === 0) return null
          return (
            <div key={tier}>
              <Row as="div" className="bg-subtle py-1">
                <Chip variant="label">{TIER_LABEL[tier]}</Chip>
              </Row>
              {rows.map((row) => (
                <ProviderLine
                  key={row.id}
                  row={row}
                  capability={capability}
                  open={open === row.id}
                  busy={busy === row.id}
                  onToggle={() => setOpen((current) => (current === row.id ? null : row.id))}
                  onSave={onSave}
                  onForget={onForget}
                  onUse={onUse}
                  onRecheck={onRecheck}
                  onSetField={onSetField}
                />
              ))}
            </div>
          )
        })}
      </List>
    </section>
  )
}

interface ProviderLineProps {
  row: ProviderRow
  capability: 'stt' | 'llm'
  open: boolean
  busy: boolean
  onToggle: () => void
  onSave: (providerId: string, value: string) => void
  onForget: (providerId: string) => void
  onUse: (capability: 'stt' | 'llm', providerId: string | null) => void
  onRecheck: (providerId: string) => void
  onSetField: (providerId: string, key: string, value: string) => void
}

function ProviderLine({
  row,
  capability,
  open,
  busy,
  onToggle,
  onSave,
  onForget,
  onUse,
  onRecheck,
  onSetField,
}: ProviderLineProps) {
  return (
    <div>
      <Row as="div">
        <span className="min-w-0 flex-1">
          <span className={`block text-copy ${row.selectable ? 'text-strong' : 'text-muted'}`}>
            {row.label}
            {/*
              *Utilisé* used to be `text-accent` — 2.41:1, and orange borrowed for
              a meaning it does not have. Selection is brand blue (VISION.md §6),
              and `--brand-900` on `--brand-100` is 10.55:1.
            */}
            {row.selected ? (
              <Chip variant="brand" className="ml-2 uppercase tracking-wider">
                Utilisé
              </Chip>
            ) : null}
          </span>
          {/*
            The reason, in one line. On screen and never behind a tooltip — the
            type makes it mandatory whenever the row is unselectable, so this
            can never render a greyed name with no explanation. It wraps rather
            than truncating: a reason nobody can finish reading is a reason that
            is not on screen.
          */}
          {row.reason ? <span className="text-muted block text-meta">{row.reason}</span> : null}
          {/*
            Four characters of the stored key (DEC-34). Enough to tell two keys
            apart, which is the only question a rep asks about a key they can no
            longer see — and the most this app will ever hand back to a screen.
          */}
          {row.credential.stored && row.credential.hint ? (
            <span className="text-muted block text-meta">clé enregistrée · …{row.credential.hint}</span>
          ) : null}
          {/*
            The `oauth` row's equivalent, and it says *session* rather than
            *clé* because that is what it is: nothing was typed here and there
            is nothing here to forget. The row is configured exactly while a
            grant is readable, so this line and `row.reason` are never both on
            screen — and one of them always is.
          */}
          {row.auth === 'oauth' && row.configured ? (
            <span className="text-muted block text-meta">session active</span>
          ) : null}
        </span>

        <span className="flex shrink-0 items-center gap-3">
          <span className="text-muted text-meta">{RESIDENCY_LABEL[row.residency]}</span>

          {/*
            Choosing is a separate act from configuring. A rep with two keys
            stored has already done the hard part; making them delete one to
            switch would be the friction DEC-33 removed, showing up again
            wearing a different hat.
          */}
          {row.selectable && !row.selected ? (
            <Button variant="text" onClick={() => onUse(capability, row.id)}>
              Utiliser
            </Button>
          ) : null}

          {row.auth === 'apiKey' ? (
            <Button variant="text" onClick={onToggle} aria-expanded={open}>
              {row.credential.stored ? 'Modifier la clé' : 'Ajouter une clé'}
            </Button>
          ) : row.fields.length > 0 ? (
            // A row with settings but nothing to authenticate still needs a way
            // in. Without this the self-hosted row — the one that needs a URL
            // and nothing else — would have no control at all.
            <Button variant="text" onClick={onToggle} aria-expanded={open}>
              Configurer
            </Button>
          ) : null}

          {/*
            The whole of what an `oauth` row can offer, and the reason it is
            *Vérifier* and not *Se connecter*.

            This app does not run OpenAI's flow — it reads the grant `codex
            login` already obtained on this machine (DEC-36). A button labelled
            *Se connecter* would have to either open a terminal or do nothing,
            and DEC-26 has a name for the second one. *Vérifier* re-reads the
            tables, which is exactly the act a rep needs after running that
            command in the window next to this one: without it the alternative
            is restarting the app.
          */}
          {row.auth === 'oauth' ? (
            <Button
              variant="text"
              onClick={() => onRecheck(row.id)}
              {...unavailable(busy, 'vérification en cours')}
            >
              Vérifier
            </Button>
          ) : null}
        </span>
      </Row>

      {open ? (
        <>
          {row.auth === 'apiKey' ? (
            <CredentialField row={row} busy={busy} onSave={onSave} onForget={onForget} />
          ) : null}
          {row.fields.map((field) => (
            <SettingField
              key={field.key}
              row={row}
              field={field}
              busy={busy}
              onSave={onSetField}
            />
          ))}
        </>
      ) : null}
    </div>
  )
}

/**
 * A provider's non-secret setting (DEC-34) — a base URL, a deployment, a region.
 *
 * The deliberate opposite of `CredentialField` in the one way that matters: it
 * **opens with the stored value in it**. A key is write-only because reading one
 * back is a risk with no matching benefit; a URL that cannot be read back is a
 * URL nobody can correct, and the commonest reason to open this row is a typo in
 * the value already there.
 *
 * `type="text"` and no `autoComplete` suppression, for the same reason: nothing
 * here is a secret, and a browser remembering `http://localhost:11434/v1` is a
 * convenience rather than an extra copy of a credential.
 */
function SettingField({
  row,
  field,
  busy,
  onSave,
}: {
  row: ProviderRow
  field: ProviderFieldValue
  busy: boolean
  onSave: (providerId: string, key: string, value: string) => void
}) {
  const [value, setValue] = useState(field.value)
  // Saved when it differs from what is stored — so *Enregistrer* is dead
  // exactly when pressing it would do nothing, and live the moment it would.
  const dirty = value.trim() !== field.value

  return (
    <Row as="div" className="bg-subtle">
      <form
        className="flex w-full items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          onSave(row.id, field.key, value.trim())
        }}
      >
        <label className="text-muted w-40 shrink-0 text-meta" htmlFor={`field-${row.id}-${field.key}`}>
          {field.label}
          {/* Which ones the reader actually enforces. A row whose required
              field is empty is not configured, and the table says so one line
              up — this is where a rep finds out which field that was. */}
          {field.required ? <span className="text-warn"> *</span> : null}
        </label>
        <input
          id={`field-${row.id}-${field.key}`}
          type="text"
          spellCheck={false}
          className="border-subtle bg-canvas min-w-0 flex-1 rounded border px-2 py-1 text-ui"
          placeholder={field.placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          variant="bordered"
          {...unavailable(busy || !dirty, busy ? 'enregistrement en cours' : 'aucune modification')}
        >
          Enregistrer
        </Button>
      </form>
    </Row>
  )
}

/**
 * The one place in the product where a secret is typed (DEC-34).
 *
 * `type="password"` and `autoComplete="off"`: this is not a login, and a browser
 * offering to remember an OpenAI key in *its* password manager as well as the
 * OS keychain is one more copy of a live credential than anyone asked for.
 *
 * The field is always empty on open, even when a key is stored. There is nothing
 * to pre-fill it with — the value never leaves the vault, by design — and a
 * masked field showing dots that are not the real key is a worse lie than an
 * empty one.
 */
function CredentialField({
  row,
  busy,
  onSave,
  onForget,
}: {
  row: ProviderRow
  busy: boolean
  onSave: (providerId: string, value: string) => void
  onForget: (providerId: string) => void
}) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()

  return (
    <Row as="div" className="bg-subtle">
      <form
        className="flex w-full items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (trimmed.length > 0) onSave(row.id, trimmed)
          setValue('')
        }}
      >
        <label className="sr-only" htmlFor={`key-${row.id}`}>
          Clé d’API pour {row.label}
        </label>
        <input
          id={`key-${row.id}`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="border-subtle bg-canvas min-w-0 flex-1 rounded border px-2 py-1 text-ui"
          placeholder="Collez la clé ici"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          variant="bordered"
          {...unavailable(busy || trimmed.length === 0, busy ? 'enregistrement en cours' : 'la clé est vide')}
        >
          Enregistrer
        </Button>
        {row.credential.stored ? (
          <Button
            variant="text"
            onClick={() => onForget(row.id)}
            {...unavailable(busy, 'enregistrement en cours')}
          >
            Oublier
          </Button>
        ) : null}
      </form>
    </Row>
  )
}

// ── Connectors (DEC-26, DEC-32) ─────────────────────────────────────────────

/** French, and the rep's vocabulary. Matches the header control and the splash. */
const CONNECTOR_TONE: Record<ConnectorHealth['state'], StateDotProps['tone']> = {
  ok: 'ok',
  degraded: 'warn',
  down: 'down',
}

/**
 * Invariable, like the header control's, and for the same reason: *Audio* is
 * masculine, *Transcription* is feminine, and a word built from an adjective
 * would have to agree with a value read at runtime.
 */
const CONNECTOR_STATE: Record<ConnectorHealth['state'], string> = {
  ok: 'connecté',
  degraded: 'à vérifier',
  down: 'indisponible',
}

interface ConnectorsProps {
  rows: readonly ConnectorRow[]
  auth: SettingsSnapshot['auth']
  probe: CapabilityReport | null
  probeReason: string | null
  onHealth: (connector: ConnectorId, health: ConnectorRow['health']) => void
}

/**
 * The rows for one group, in the contract's order rather than the snapshot's.
 *
 * `REQUIRED_CONNECTORS` is ordered by how early a failure costs the rep —
 * capture first, because it is the one that cannot be repaired after the call —
 * and that order is worth keeping on screen.
 */
const group = (
  rows: readonly ConnectorRow[],
  ids: readonly ConnectorId[],
): readonly ConnectorRow[] =>
  ids.flatMap((id) => {
    const row = rows.find((candidate) => candidate.id === id)
    return row ? [row] : []
  })

function Connectors({ rows, auth, probe, probeReason, onHealth }: ConnectorsProps) {
  const [retrying, setRetrying] = useState<ConnectorId | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Why the last sign-in attempt did not land.
   *
   * Both of these rejections are real and neither was rendered: a tenant that
   * requires admin consent answers AADSTS90094, and `auth:signIn` itself
   * refuses when there is no registration. `try/finally` with no `catch` turned
   * either one into an unhandled rejection in the console and a button that
   * appeared to do nothing — which a rep reads as the app being broken.
   */
  const [failure, setFailure] = useState<string | null>(null)

  const retry = useCallback(
    async (connector: ConnectorId) => {
      setRetrying(connector)
      try {
        onHealth(connector, await invoke('health:retry', { connector }))
      } finally {
        setRetrying(null)
      }
    },
    [onHealth],
  )

  const signIn = useCallback(async () => {
    setBusy(true)
    setFailure(null)
    try {
      await invoke('auth:signIn', {})
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'La connexion Microsoft n’a pas abouti.',
      )
    } finally {
      setBusy(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    setBusy(true)
    setFailure(null)
    try {
      await invoke('auth:signOut', {})
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : 'La déconnexion Microsoft n’a pas abouti.',
      )
    } finally {
      setBusy(false)
    }
  }, [])

  const required = group(rows, REQUIRED_CONNECTORS)
  const optional = group(rows, OPTIONAL_CONNECTORS)

  return (
    <section>
      <SectionHeader>Connecteurs</SectionHeader>

      {/*
        The sentence the split exists for (DEC-26, DEC-32). It states what the
        header control means, so that a rep reading « Tout fonctionne » while
        VerySwing is unreachable does not read it as a lie — and so that the
        reverse never happens either.
      */}
      <Lede>
        L’indicateur d’état, en haut de l’écran, ne suit que les trois connecteurs requis —
        audio, transcription, analyse. Les connecteurs facultatifs signalent leur panne
        ici, avec son motif ; ils ne rendent jamais l’application indisponible.
      </Lede>

      <SectionHeader as="h3" className="mt-block">
        Requis
      </SectionHeader>
      <Lede>
        Sans eux, une réunion ne peut pas être enregistrée. Ce sont les seuls à faire
        changer l’indicateur d’état.
      </Lede>
      <List>
        {required.map((row) => (
          <ConnectorLine
            key={row.id}
            row={row}
            retrying={retrying === row.id}
            onRetry={() => void retry(row.id)}
          />
        ))}
      </List>

      <SectionHeader as="h3" className="mt-block">
        Facultatifs
      </SectionHeader>
      <Lede>
        Une réunion s’enregistre, se transcrit et s’analyse sans eux. Chacun garde son
        état et son propre bouton, ici.
      </Lede>

      {/*
        The credential the calendar and Outlook both hang off, so it sits with
        them rather than in a section of its own.

        Three states, not two. *Signed out* is two situations a rep experiences
        as nothing alike, and `AuthState.reason` is what tells them apart
        (`core/contracts/identity.ts`): a rep who has an app to sign into and
        has not, and a build with **no Entra registration at all** — which is
        the one the first demo ships in (DEC-28), because the registration lives
        in a tenant we do not control.

        In the second, *Se connecter* can only reject — `auth:signIn` throws
        before it reaches MSAL. So the row states its condition and carries no
        control at all, which is the same answer `ConnectorLine` gives a
        connector that is `down` and not `retryable`, and the same one `DayPane`
        gives a calendar invite with no session behind it. A button that does
        nothing is the defect DEC-26 names.
      */}
      <List as="div" className="mb-2">
        <Row as="div" align="center">
          <span className="text-body w-32 shrink-0 text-copy">Microsoft 365</span>
          <span className="min-w-0 flex-1">
            {auth.status === 'signedIn' ? (
              <span className="text-muted text-ui">{auth.account.username}</span>
            ) : auth.reason ? (
              <span className="text-muted block text-meta">{auth.reason}</span>
            ) : null}
            {failure ? (
              <span role="alert" className="text-danger block text-meta">
                {failure}
              </span>
            ) : null}
          </span>
          {auth.status === 'signedIn' ? (
            <BusyButton
              variant="link"
              busy={busy}
              busyReason="Connexion en cours…"
              onClick={() => void signOut()}
            >
              Se déconnecter
            </BusyButton>
          ) : auth.reason ? null : (
            <BusyButton busy={busy} busyReason="Connexion en cours…" onClick={() => void signIn()}>
              Se connecter
            </BusyButton>
          )}
        </Row>
      </List>

      <List>
        {optional.map((row) => (
          <ConnectorLine
            key={row.id}
            row={row}
            retrying={retrying === row.id}
            onRetry={() => void retry(row.id)}
          />
        ))}
      </List>

      {/* VISION.md §6: the DEC-24 probe result lives under *VerySwing*. */}
      <Probe report={probe} reason={probeReason} />
    </section>
  )
}

interface ConnectorLineProps {
  row: ConnectorRow
  retrying: boolean
  onRetry: () => void
}

function ConnectorLine({ row, retrying, onRetry }: ConnectorLineProps) {
  return (
    <Row>
      <span className="text-body w-32 shrink-0 text-copy">{row.label}</span>
      {/*
        DEC-26. `reason` is mandatory on anything that is not `ok`, so this is
        never a bare coloured dot — and `StateDot` would refuse one anyway.
        *Réessayer* appears exactly when the connector says retrying is worth
        something.
      */}
      <span className="min-w-0 flex-1">
        <StateDot tone={CONNECTOR_TONE[row.health.state]} label={CONNECTOR_STATE[row.health.state]} />
        {row.health.state !== 'ok' ? (
          <span className="text-muted block text-meta">{row.health.reason}</span>
        ) : null}
      </span>
      {row.health.state !== 'ok' && row.health.retryable ? (
        <BusyButton variant="link" busy={retrying} busyReason="Vérification…" onClick={onRetry}>
          Réessayer
        </BusyButton>
      ) : null}
    </Row>
  )
}

/**
 * A control that is unavailable while its own request is in flight — and says
 * so, in French, beside itself (DEC-26).
 *
 * `Button` makes `disabled` unconstructible without `disabledReason`, which is
 * the point of it; this is the one shape that repeats often enough here to be
 * worth naming, rather than four copies of the same ternary.
 */
interface BusyButtonProps {
  busy: boolean
  busyReason: string
  onClick: () => void
  variant?: 'bordered' | 'link'
  children: ReactNode
}

function BusyButton({ busy, busyReason, onClick, variant, children }: BusyButtonProps) {
  if (busy) {
    return (
      <Button variant={variant} disabled disabledReason={busyReason}>
        {children}
      </Button>
    )
  }
  return (
    <Button variant={variant} onClick={onClick}>
      {children}
    </Button>
  )
}

// ── The DEC-24 probe ────────────────────────────────────────────────────────

const CAPABILITY_LABEL = {
  ok: 'disponible',
  missing: 'absente',
  denied: 'refusée',
  unverified: 'non vérifiée',
} as const

/**
 * The connect-time capability diff, rendered row by row (DEC-24).
 *
 * The failure this exists to prevent is discovering during the demo, one 400 at
 * a time, that a tenant does not have an endpoint — so `matters` is shown
 * beside every finding that is not `ok`: "les statuts de tâche sont vides sur
 * ce tenant" is only useful next to what stops working because of it.
 */
function Probe({ report, reason }: { report: CapabilityReport | null; reason: string | null }) {
  return (
    <div className="mt-block">
      <SectionHeader as="h3">VerySwing — capacités du tenant</SectionHeader>

      {report === null ? (
        <p className="text-muted border-card bg-card-soft rounded-lg border px-row py-3 text-ui">
          {reason ?? 'sonde indisponible'}
        </p>
      ) : (
        <>
          <p className={`mb-2 text-ui ${report.ok ? 'text-muted' : 'text-warn'}`}>
            {report.summary} · {formatAgo(report.at, Date.now())}
          </p>
          <List>
            {report.findings.map((finding) => (
              <Finding key={finding.id} finding={finding} />
            ))}
          </List>
          {report.columnGaps.length > 0 ? (
            <p className="text-warn mt-2 text-meta">
              Colonnes non déclarées par ce tenant :{' '}
              {report.columnGaps.map((gap) => gap.column).join(', ')}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function Finding({ finding }: { finding: CapabilityFinding }) {
  const bad = finding.state === 'missing' || finding.state === 'denied'

  return (
    <Row className="py-2">
      <span className="text-body min-w-0 flex-1 text-ui">
        {finding.label}
        {bad ? <span className="text-muted block text-meta">{finding.matters}</span> : null}
      </span>
      <span className={`shrink-0 text-meta ${bad ? 'text-warn' : 'text-muted'}`}>
        {CAPABILITY_LABEL[finding.state]}
      </span>
    </Row>
  )
}

// ── Diagnostics (DEC-27) ────────────────────────────────────────────────────

/**
 * Recent errors, the retention setting, and the two exports.
 *
 * The asymmetry between the buttons is the design. *Diagnostics* is one click
 * and safe to send; *Diagnostic complet* states on itself, in French, that it
 * includes the content of client conversations. Neither is hidden behind a
 * confirmation dialog — HR-10 says no modal chrome, and a dialog people learn
 * to dismiss is worse than a label people read.
 */
function DiagnosticsPanel({ retentionDays }: { retentionDays: number }) {
  const recent = useInvoke('diagnostics:recent', { limit: 30 })
  const [exported, setExported] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useBroadcast('diag:appended', () => recent.reload())

  const exportBundle = useCallback(async (mode: 'redacted' | 'full') => {
    setBusy(true)
    setFailure(null)
    try {
      const result = await invoke('diagnostics:export', { mode })
      setExported(`${result.events} évènement(s) écrit(s) dans ${result.path}`)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'export impossible')
    } finally {
      setBusy(false)
    }
  }, [])

  const events: DiagEvent[] = recent.state.status === 'ready' ? recent.state.value : []
  const errors = events.filter((event) => event.severity === 'error' || event.severity === 'warn')

  return (
    <section>
      <SectionHeader>Diagnostics</SectionHeader>

      <Lede>
        Les diagnostics sont conservés {retentionDays} jours puis effacés. Le contenu des
        réunions n’expire jamais et n’est supprimé que par vous.
      </Lede>

      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div>
          <BusyButton
            busy={busy}
            busyReason="Export en cours…"
            onClick={() => void exportBundle('redacted')}
          >
            Diagnostics
          </BusyButton>
          <p className="text-muted mt-1 max-w-[15rem] text-meta">
            Sans contenu de conversation. Peut être envoyé au support.
          </p>
        </div>

        <div>
          {/*
            DEC-27. The control says what it includes, in French, on itself —
            not in a tooltip, not in a dialog that gets dismissed.
          */}
          <BusyButton
            busy={busy}
            busyReason="Export en cours…"
            onClick={() => void exportBundle('full')}
          >
            Diagnostic complet — inclut le contenu des conversations clients
          </BusyButton>
          <p className="text-muted mt-1 max-w-[24rem] text-meta">
            À ne transmettre qu’avec l’accord explicite du client.
          </p>
        </div>
      </div>

      {exported ? <p className="text-muted mb-3 text-meta">{exported}</p> : null}
      {failure ? (
        <p role="alert" className="text-danger mb-3 text-ui">
          {failure}
        </p>
      ) : null}

      <SectionHeader as="h3" className="mb-2">
        Erreurs récentes
      </SectionHeader>
      {errors.length === 0 ? (
        <p className="text-muted text-ui">Aucune erreur récente.</p>
      ) : (
        <List>
          {errors.map((event) => (
            <Row key={event.id} className="py-2 text-meta">
              <span className="text-muted w-24 shrink-0">{formatAgo(event.ts, Date.now())}</span>
              <span className="text-muted w-40 shrink-0 truncate font-mono">{event.code}</span>
              <span className="text-body min-w-0 flex-1">{event.message}</span>
            </Row>
          ))}
        </List>
      )}
    </section>
  )
}
