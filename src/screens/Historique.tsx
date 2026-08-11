/**
 * *Historique* — every call ever captured, searchable (DEC-25).
 *
 *   ┌ Historique ──────────────── ⌕ « TJM » ─────────────────┐
 *   │ 12 mars   Acme SA        Validée   tâche · oppy · mail │
 *   │ 08 mars   Nordis         Validée   tâche · mail        │
 *   │ 05 mars   Groupe Lefort  À valider ⚠ VSA indisponible  │
 *   │  └ Transcript · Mes notes · Compte-rendu · Extraction  │
 *   └────────────────────────────────────────────────────────┘
 *
 * Four things this screen is, and one it is not:
 *
 * **It is not in the navigation.** It is the expanded form of the calendar's
 * search (VISION.md §6), reached from it and from nowhere else — with the same
 * field and the same chips carried over, which is why the back link reads
 * *‹ Calendrier* and why `query` and `filter` arrive as props. A rep looking for
 * what a client said in March starts by typing the client's name on the home
 * screen, which is where they already are.
 *
 * **It is a reader over the event log.** There is no history table. Every row
 * and every section below is folded from `events` on demand by the main
 * process, which is why a call captured before a field existed still opens.
 *
 * **The search runs in the main process.** This component sends a string and
 * four chip values and receives rows with short excerpts; it never holds a
 * transcript it did not expand, and it never narrows a list it already has.
 * That is not an optimisation — shipping the corpus here so a filter could run
 * over it would put every client conversation in a devtools console.
 *
 * **Nothing here writes.** The one gesture in the product that reaches an
 * external system is *Valider*, on the review gate, once (DEC-4). A row that
 * failed to push shows why; retrying is the status control's job, because the
 * failure is a connector's and not this call's.
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  HistoryFilter,
  HistoryIntent,
  HistoryRecord,
  HistoryRow,
} from '../../electron/core/contracts/history.ts'
import type { ReviewField } from '../../electron/core/contracts/review.ts'
import type { TranscriptSegment } from '../../electron/core/contracts/transcript.ts'
import { invoke } from '../app/bridge.ts'
import { formatDayShort, formatOffset, meetingHeading } from '../app/format.ts'
import { Button, EmptyState, List, Row as UiRow, RowTitle } from '../ui/index.ts'
import { NO_FILTER, isSearchActive } from './search/filters.ts'
import { IntentSummary } from './search/Intents.tsx'
import { Matches } from './search/Matches.tsx'
import { SearchBar } from './search/SearchBar.tsx'
import { useHistorySearch } from './search/useHistorySearch.ts'

/** The full record, so the cap is the corpus and not a viewport. */
const SEARCH_LIMIT = 50

interface HistoriqueProps {
  onBack: () => void
  /** What the rep typed on the calendar. Empty when they opened it with an empty box. */
  query?: string
  filter?: HistoryFilter
}

export function Historique({
  onBack,
  query: initialQuery = '',
  filter: initialFilter = NO_FILTER,
}: HistoriqueProps) {
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState<HistoryFilter>(initialFilter)
  const [expanded, setExpanded] = useState<string | null>(null)

  const search = useHistorySearch(query, filter, SEARCH_LIMIT)
  const rows: readonly HistoryRow[] | null = search.result?.rows ?? null

  const toggle = useCallback((meetingId: string) => {
    setExpanded((previous) => (previous === meetingId ? null : meetingId))
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="px-gutter pb-4 pt-7">
        <div className="flex items-baseline gap-4">
          <Button variant="nav" onClick={onBack}>
            ‹ Calendrier
          </Button>
          <h1 className="font-display text-strong flex-1 text-display leading-none">Historique</h1>
        </div>

        {/*
          The same component the calendar carries, on the same state (VISION.md
          §6). Two implementations would drift, and the day they did, the
          expanded form would answer a different question from the one the rep
          typed on the screen they came from.
        */}
        <SearchBar
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          clients={search.result?.clients ?? []}
          className="mt-4"
        />
      </header>

      {search.failure ? (
        <p role="alert" className="text-danger border-subtle border-b px-gutter py-1.5 text-ui">
          {search.failure}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-gutter pb-block">
        {rows === null ? (
          <p className="text-muted text-copy">Chargement…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            hint={
              isSearchActive(query, filter)
                ? 'La recherche porte sur les clients, les sujets, les transcriptions, vos notes et les comptes-rendus.'
                : undefined
            }
          >
            {isSearchActive(query, filter)
              ? 'Aucun appel ne correspond.'
              : 'Aucun appel enregistré.'}
          </EmptyState>
        ) : (
          <List label="Appels enregistrés">
            {rows.map((row) => (
              <Row
                key={row.meeting.id}
                row={row}
                expanded={expanded === row.meeting.id}
                onToggle={() => toggle(row.meeting.id)}
              />
            ))}
          </List>
        )}
      </div>
    </div>
  )
}

interface RowProps {
  row: HistoryRow
  expanded: boolean
  onToggle: () => void
}

function Row({ row, expanded, onToggle }: RowProps) {
  const { meeting } = row

  return (
    <li className="bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="hover:bg-card-soft w-full text-left transition"
      >
        <UiRow as="div" density="roomy" align="center" className="bg-transparent">
          <span className="text-muted w-16 shrink-0 tabular-nums text-ui">
            {formatDayShort(meeting.startedAt ?? meeting.scheduledStart ?? meeting.createdAt)}
          </span>
          <RowTitle {...meetingHeading(meeting)} />
          <span className="text-muted w-20 shrink-0 text-right text-ui">{row.status}</span>
          <IntentSummary intents={row.intents} className="w-40" />
        </UiRow>
      </button>

      <Matches matches={row.matches} className="px-5 pb-2.5" />

      {expanded ? <Record meetingId={meeting.id} intents={row.intents} /> : null}
    </li>
  )
}

/**
 * The expanded record: the four sections of DEC-25, in order.
 *
 * Fetched when the row opens rather than with the list. A transcript is the
 * biggest thing in the product and fifty of them would arrive with every
 * search — which is the same mistake as filtering in the renderer, made one
 * layer later.
 */
function Record({ meetingId, intents }: { meetingId: string; intents: readonly HistoryIntent[] }) {
  const [record, setRecord] = useState<HistoryRecord | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    invoke('history:record', { meetingId })
      .then((value) => {
        if (live) setRecord(value)
      })
      .catch((error: unknown) => {
        if (live) setFailure(error instanceof Error ? error.message : 'lecture impossible')
      })
    return () => {
      live = false
    }
  }, [meetingId])

  if (failure) {
    return (
      <p role="alert" className="text-danger px-5 pb-4 text-xs">
        {failure}
      </p>
    )
  }
  if (!record) return <p className="text-muted px-5 pb-4 text-xs">Chargement…</p>

  return (
    <div className="bg-inner border-subtle grid grid-cols-2 gap-6 border-t px-5 py-4">
      <Section title="Transcript">
        <Transcript segments={record.segments} />
      </Section>

      <Section title="Mes notes">
        {record.notes.trim() ? (
          <p className="text-strong whitespace-pre-wrap text-xs leading-relaxed">{record.notes}</p>
        ) : (
          <p className="text-muted text-xs">Rien n’a été saisi pendant cet appel.</p>
        )}
      </Section>

      <Section title="Compte-rendu">
        {record.compteRendu ? (
          // Muted, because the agent wrote it (DEC-5). Colour alone, no badge.
          <p className="text-muted whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
            {record.compteRendu}
          </p>
        ) : (
          <p className="text-muted text-xs">Cet appel n’a pas produit de compte-rendu.</p>
        )}
      </Section>

      <Section title="Extraction">
        <Extraction fields={record.fields} />
        <PushStatus intents={intents} />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="pane-label mb-2">{title}</h3>
      <div className="max-h-72 overflow-y-auto pr-1">{children}</div>
    </section>
  )
}

/** Speaker channels, from the hardware — mic is the rep, loopback is the far end. */
const CHANNEL_LABEL: Record<TranscriptSegment['channel'], string> = {
  rep: 'Moi',
  far: 'Client',
}

function Transcript({ segments }: { segments: readonly TranscriptSegment[] }) {
  if (segments.length === 0) {
    return <p className="text-muted text-xs">Aucune transcription pour cet appel.</p>
  }

  return (
    <ul className="space-y-1">
      {segments.map((segment) => (
        <li key={segment.id} className="flex gap-2 text-xs">
          <span className="text-muted w-10 shrink-0 tabular-nums text-[11px]">
            {formatOffset(segment.startMs)}
          </span>
          <span className="text-muted w-12 shrink-0 text-[11px]">
            {CHANNEL_LABEL[segment.channel]}
          </span>
          <span className="text-body min-w-0 flex-1">{segment.text}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Each field with the span it was read from (DEC-21).
 *
 * A span whose `startMs` is null is one the app could not locate in the stored
 * transcript, and it wears `⚠ faible` for exactly that reason. Showing the
 * quote anyway is deliberate: "the model said this and we could not find it" is
 * the most useful thing this screen can tell somebody months later.
 */
function Extraction({ fields }: { fields: readonly ReviewField[] }) {
  if (fields.length === 0) {
    return <p className="text-muted text-xs">Aucune extraction pour cet appel.</p>
  }

  return (
    <dl className="space-y-1.5">
      {fields.map((field) => (
        <div key={field.key}>
          <dt className="text-muted flex items-baseline gap-2 text-[11px]">
            {field.label}
            {field.confidence === 'faible' ? <span className="text-warn">⚠ faible</span> : null}
          </dt>
          <dd className="text-body text-[11px] italic">
            {field.span
              ? `« ${field.span.quote} »${
                  field.span.startMs === null
                    ? ' — introuvable dans la transcription'
                    : ` — ${formatOffset(field.span.startMs)}`
                }`
              : 'Du calendrier Outlook et de VerySwing — jamais lu sur la transcription.'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** What became of each intent, with the failure sentence when there was one. */
function PushStatus({ intents }: { intents: readonly HistoryIntent[] }) {
  if (intents.length === 0) return null

  return (
    <div className="mt-4">
      <h4 className="pane-label mb-2">Envois</h4>
      <ul className="space-y-1">
        {intents.map((intent) => (
          <li key={intent.intentId} className="text-[11px]">
            <span className="text-body">{intent.label}</span>{' '}
            <span className={intent.state === 'failed' ? 'text-warn' : 'text-muted'}>
              {PUSH_LABEL[intent.state]}
            </span>
            {intent.remoteId ? <span className="text-muted"> · {intent.remoteId}</span> : null}
            {/* A failed row without its reason is the dead control DEC-26 forbids. */}
            {intent.lastError ? (
              <span className="text-muted block">{intent.lastError}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

const PUSH_LABEL: Record<HistoryIntent['state'], string> = {
  pending: 'en attente',
  blocked: 'en attente d’un autre envoi',
  draining: 'envoi en cours',
  drained: 'envoyé',
  failed: 'échec',
}
