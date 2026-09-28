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
import { X } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import type { DiagEvent } from '../../electron/core/contracts/diagnostics.ts'
import type { ConnectorHealth, ConnectorId } from '../../electron/core/contracts/health.ts'
import {
  OPTIONAL_CONNECTORS,
  REQUIRED_CONNECTORS,
  type RequiredConnectorId,
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
import {
  MENTION_MAX_CHARS,
  MENTION_SENTENCE_DEFAULT,
} from '../../electron/core/contracts/mention.ts'
import type { ModelRow, ModelSection } from '../../electron/core/contracts/models.ts'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { cn } from '../lib/utils.ts'
import { SHORTCUTS, typingExceptionKeys } from '../app/shortcuts.ts'
import { NOTE_SHORTCUTS } from '../editor/note/keymap.ts'
import { EssaiAudio } from './capture/EssaiAudio.tsx'
import { formatAgo } from '../app/format.ts'
import {
  Button,
  Centered,
  Chip,
  List,
  Row,
  SectionHeader,
  ReadingColumn,
  SectionNav,
  StateDot,
  unavailable,
} from '../ui/index.ts'
import type { SectionNavItem, StateDotProps } from '../ui/index.ts'

export type SectionId =
  | 'transcription'
  | 'llm'
  | 'connecteurs'
  | 'calendrier'
  | 'raccourcis'
  | 'maj'
  | 'diagnostics'

/** VISION.md §6 names them in this order: the two provider tables, then the
 *  connectors, then diagnostics. Updates sit last but one — next to
 *  diagnostics, which is where a tester looking for "what version am I on"
 *  already goes. */
const SECTIONS: readonly SectionNavItem<SectionId>[] = [
  { id: 'transcription', label: 'Transcription' },
  { id: 'llm', label: 'Modèle de langage' },
  { id: 'connecteurs', label: 'Connecteurs' },
  { id: 'calendrier', label: 'Calendrier' },
  /*
   * The keyboard has a pane because it has to be discoverable somewhere, and
   * the alternative is the one this product refuses: a `?` sheet over the
   * window (HR-10). It sits after the connectors — a rep looking for it is
   * looking for a reference, not for a setting — and nothing on it is a
   * setting, which is why it is a table and not a form.
   */
  { id: 'raccourcis', label: 'Raccourcis clavier' },
  { id: 'maj', label: 'Mise à jour' },
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

/**
 * **Where a required subsystem is repaired** — one table, because three screens
 * now send a rep here by connector and three copies of this would drift the
 * first time a pane was renamed.
 *
 * It lives beside `SECTIONS` rather than beside any of its readers: the sections
 * are declared here, so an id that stops existing stops compiling here first.
 * `capture` is *Connecteurs* and not a pane of its own — its remedy is a consent
 * and a *Requis* row, which is what that pane holds.
 */
export const SECTION_FOR_CONNECTOR: Record<RequiredConnectorId, SectionId> = {
  capture: 'connecteurs',
  transcribe: 'transcription',
  llm: 'llm',
}

interface ReglagesProps {
  onBack: () => void
  /**
   * Where to open, when the caller knows which pane it is sending the rep to.
   *
   * First run's two *Réglages ›* links both used to land on the landing
   * section, so a rep told « à choisir dans Réglages » about the language model
   * arrived on the connector list and had to find the pane themselves — which
   * is the same as not routing at all. The default stays the landing section:
   * a rep who opened this from the calendar was not sent anywhere in
   * particular.
   */
  section?: SectionId
  /**
   * Replays first run. It left the empty day's card — a rep looking at a
   * Tuesday with nothing on it is not asking for a presentation — and a
   * reference lives with the other references, under *Connecteurs*, beside the
   * dry run it ends on. Absent while first run itself is on screen.
   */
  onOnboarding?: () => void
  /**
   * The sheet is on its way out.
   *
   * Owned by `App.tsx` and not by this file, because `Échap` closes it and that
   * key is registered one component up — a sheet that ran its own exit would
   * animate on its ✕ and vanish between two frames on the keyboard. `onBack` is
   * already the dismissing one, so every way out is the same way out.
   */
  leaving?: boolean
}

export function Reglages({ onBack, section: opensOn, onOnboarding, leaving = false }: ReglagesProps) {
  const [section, setSection] = useState<SectionId>(opensOn ?? LANDING)
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
   * **The download's progress, which nothing was listening for.**
   *
   * `main.ts` broadcasts `models:progress` on every change, under a comment
   * naming the bug it was written to fix — and the renderer subscribed to eleven
   * channels, of which this was not one. So a rep who pressed *Télécharger* on a
   * 1.5 GB model watched the row read « téléchargement · 0 % » beside an
   * *Annuler* button, unchanged, **including after it finished**: the row only
   * ever moved when some other write happened to re-read the whole snapshot.
   * `bridge.ts` states the contract this broke in one line — every screen reads
   * one thing and is then kept current by a broadcast.
   *
   * The jsdom test that should have caught it (« a download in flight shows its
   * percentage ») sets 38 % **in the snapshot** and asserts the row draws it. It
   * proves the row can render a number. It never asked whether one arrives.
   */
  useBroadcast('models:progress', (payload) => {
    if (settings.state.status !== 'ready') return
    const snapshot = settings.state.value
    settings.set({
      ...snapshot,
      models: {
        ...snapshot.models,
        rows: snapshot.models.rows.map((row) =>
          row.id === payload.id
            ? { ...row, status: payload.status, progress: payload.progress, reason: payload.reason }
            : row,
        ),
      },
    })
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

  /*
    The two unsettled states are drawn **inside the sheet**, not instead of it.

    Returning a bare `Centered` here painted a full-window panel over the
    calendar with no veil and no frame — so for the length of one `settings:
    snapshot` the rep's screen was replaced by the word « Chargement… », and a
    failed read replaced it permanently with a red sentence and no way back that
    was not `Échap`. The sheet is the chrome; what is in it is the question.
  */
  if (settings.state.status === 'loading') {
    return (
      <Sheet onClose={onBack} leaving={leaving} title="Réglages">
        <Centered>Chargement…</Centered>
      </Sheet>
    )
  }
  if (settings.state.status === 'failed') {
    return (
      <Sheet onClose={onBack} leaving={leaving} title="Réglages">
        <Centered>
          <p className="text-danger text-copy">{settings.state.reason}</p>
        </Centered>
      </Sheet>
    )
  }

  const snapshot: SettingsSnapshot = settings.state.value

  /*
   * How many connectors are not `ok` — required or optional alike.
   *
   * Optional ones never move the header's general status (DEC-32) and they
   * should not: VerySwing being down is not the app being degraded. But it is
   * still something a rep has to find, and « find it » currently means opening
   * a section to look. The rail carries the count; the header still does not.
   */
  const broken = snapshot.connectors.filter((row) => row.health.state !== 'ok').length

  return (
    <Sheet
      onClose={onBack}
      leaving={leaving}
      /*
        **The pane is named by what it holds, and that name is the sheet's
        title.** It used to be « Réglages » in the window header with the
        section's own name repeated as a `pane-label` inside the pane: the same
        screen said « Réglages » once and « Connecteurs » twice. The sheet's rail
        is headed « Réglages » — which is what the *sheet* is — and the pane is
        headed by the section, once.
      */
      title={SECTIONS.find((item) => item.id === section)?.label ?? 'Réglages'}
      /*
        **What the main process refused, where the rep is standing.**

        This was a `<p className="text-danger">` at the top of the pane's
        content, which is *inside* `ReadingColumn`'s scroller. Measured on the
        real screen with `models:download` refusing the way `ipc/register.ts`
        refuses it during a call (DEC-35): the rep presses *Télécharger* at the
        bottom of the models table and the sentence is drawn **638px above the
        top of the window** at 1280×800 and **810px above** at 960×600. Nothing
        else on the screen moves — the row is unchanged and the button is still
        pressable — so the gesture read as a control that does nothing, which is
        the one thing DEC-26 forbids, on the screen a rep opens when something
        is already wrong.

        So it is lifted out of the scroller: `Sheet` draws it in the pane's own
        frame, where a scroll position cannot carry it away. `role="alert"`
        because a reader was told nothing at all, and because a refusal answers
        a gesture the rep just made — `OutcomeNotice`'s distinction: `status` is
        a wait the rep chose to start, this is the app saying no to them.

        One strip for every caller of `write`, deliberately. The subject is the
        funnel, not the download: a vault that is unavailable, an unknown
        provider and a key the provider rejects all arrive here, and a per-row
        message would be seven places to get this wrong instead of one.
      */
      notice={failure}
      nav={
        <SectionNav
          label="Sections des réglages"
          /*
            The rail says where the trouble is. Only *Connecteurs* can carry a
            count today, because it is the only section whose contents have a
            health state — the provider tables are configuration, and a rail
            that marked them would be marking a preference as a fault.
          */
          items={SECTIONS.map((item) =>
            item.id === 'connecteurs' && broken > 0
              ? {
                  ...item,
                  note: String(broken),
                  // The one note in the product that really is a warning: a
                  // connector in défaut is something wrong, not something
                  // waiting. The rail's « À valider » count is the other case
                  // and takes the default — see `SectionNavItem.noteTone`.
                  noteTone: 'warn' as const,
                  noteLabel:
                    broken === 1 ? '1 connecteur en défaut' : `${broken} connecteurs en défaut`,
                }
              : item,
          )}
          current={section}
          onSelect={setSection}
          className="w-full overflow-y-auto"
        />
      }
    >
          {/*
            One measure for the whole pane.
            
            The explanatory paragraphs were capped at `max-w-prose` and the rows
            under them were not, so a single section ran two different widths:
            « VerySwing · indisponible » sat at x≈250 and its *Réessayer* at
            x≈1400, a window apart, with a 470px paragraph above them. A rep
            reading a connector's failure and reaching for its retry crossed a
            thousand pixels of nothing. The cap is the paragraph's, applied
            once, to everything — so a row's state, its reason and its recovery
            are one glance wide.

            `.measure` and not 46rem: at 46 the paragraphs ran a hundred and
            twenty characters a line, which is unifying two measures onto the
            wrong one. The product's one reading width is also, comfortably, the
            width a connector row needs — a label, a state, a sentence of reason
            and a *Réessayer*.
          */}
          {/*
            Left, against the rail. Centring it put a two-hundred-pixel gutter
            between the nav and the first heading, which is a worse read than the
            empty space on the right: a pane that starts nowhere near the thing
            that opened it looks unfinished, where one that runs out on the right
            just looks like a column. `px-gutter` is the only space between the
            rail and the content, as everywhere else in the product.
          */}
          <div className="measure">
          {section === 'transcription' ? (
            <>
              <OfflineOnly
                value={snapshot.offlineOnly}
                busy={busy === 'offlineOnly'}
                onChange={(value) =>
                  void write('offlineOnly', () => invoke('settings:setOfflineOnly', { value }))
                }
              />
              {/*
                Beside « Cette machine uniquement » on purpose (US-19). One says where
                the client's words go, the other says what the client is told about it,
                and a rep or an administrator arriving here with « que voit le client »
                in mind is asking both questions at once. It is not a section of its
                own: a nav entry for one field would put the product's only legal
                setting behind a click nobody takes.
              */}
              <MentionSentence
                value={snapshot.mentionSentence}
                busy={busy === 'mentionSentence'}
                onSave={(value) =>
                  void write('mentionSentence', () =>
                    invoke('settings:setMentionSentence', { value }),
                  )
                }
              />
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
              onOnboarding={onOnboarding}
              onHealth={(connector, health) => {
                settings.set({
                  ...snapshot,
                  connectors: snapshot.connectors.map((row) =>
                    row.id === connector ? { ...row, health } : row,
                  ),
                })
              }}
            />
          ) : section === 'calendrier' ? (
            <Calendrier auth={snapshot.auth} />
          ) : section === 'raccourcis' ? (
            <Raccourcis />
          ) : section === 'maj' ? (
            <UpdatePanel />
          ) : (
            <DiagnosticsPanel retentionDays={snapshot.retention.diagnosticsDays} />
          )}
          </div>
    </Sheet>
  )
}

/**
 * **The one sheet in this product** (V2).
 *
 * HR-10 says one window and no modal chrome, and this is the exception the
 * design makes on purpose: Réglages is not a *place* — it is a drawer the rep
 * opens over whatever they were doing and closes again. Making it a screen cost
 * them their position on the calendar every time they went to look at a
 * connector, which is the trip the header status control exists to make short.
 *
 * Three things it owes, and each is a way modals go wrong:
 *
 *  · **A way out that is not the keyboard.** The veil closes it and the pane's
 *    own ✕ closes it. `Échap` closes it too (`app/shortcuts.ts`, installed by
 *    `App.tsx` for every route that has somewhere to go back to) — but a sheet
 *    whose only exit is a key is a sheet a rep gets stuck in.
 *  · **A frame the content cannot burst.** 920×600, and both are ceilings as
 *    well as sizes: at 960×600 — the minimum `app/main.ts` declares — the sheet
 *    takes the window less a margin rather than hanging off the bottom edge.
 *    The pane scrolls inside it; the sheet never does.
 *  · **Ease-out on the way in.** `animate-rise-in` is `var(--motion)
 *    var(--ease-out)`, the one curve this product owns for a thing arriving, and
 *    it collapses to nothing under `prefers-reduced-motion` because `--motion`
 *    does.
 */
function Sheet({
  title,
  nav,
  notice,
  onClose,
  leaving,
  children,
}: {
  title: string
  /** The sections column. Absent on the two unsettled states — there is nothing to switch. */
  nav?: ReactNode
  /**
   * What the main process refused, drawn in the frame rather than in the
   * scroller. See the call site: inside `ReadingColumn` it landed up to 810px
   * above the fold, on a press the rep made at the bottom of the pane.
   */
  notice?: string | null
  onClose: () => void
  /*
   * **The sheet leaves, and until this it did not.** It rose in over 150ms on
   * `animate-rise-in` and then vanished between two frames — measured by the
   * product's own detector as « 0 qui s'en vont » on every screen in the app
   * window. `App.tsx` holds it for one `--motion` so `.leaving` can run, and
   * the veil goes with it rather than snapping out from under a pane that is
   * still fading.
   */
  leaving: boolean
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-gutter">
      {/*
        The veil, and it is a control: pressing outside a sheet closes it, which
        is the gesture everybody already has. `aria-hidden` because the ✕ in the
        pane is the same act, named, and two accessible « fermer » targets on one
        surface is one too many.
      */}
      <div
        className={cn(
          // `duration-motion`, not the default 90ms: the veil and the sheet are one
          // surface and must leave on one clock — see `tailwind.config.js`.
          'bg-veil absolute inset-0 transition-opacity duration-motion ease-in',
          leaving && 'opacity-0',
        )}
        aria-hidden
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Réglages"
        className={cn(
          /*
            **The sheet is the size of what it holds, and it was not.**

            `h-[600px] w-[920px]`, fixed, at every viewport. Measured at
            1280×800 that left 320×200 of window unused *while cutting its own
            content off* at the bottom edge, and 155 CSS px of bare paper down
            the right of every pane — because the content is one `.measure`
            (58ch, ~490px) inside a 636px column.

            Two arguments above are right and stay: one measure for the whole
            pane, so a connector's state, its reason and its *Réessayer* are one
            glance wide; and that measure left against the rail rather than
            centred, so the pane starts near the thing that opened it. Neither
            of them asks the *sheet* to be 920px. So the sheet comes in to meet
            the column — 220 rail + 32 gutter + the measure + 32 — instead of
            the column being stretched to fill a number nobody chose.

            The height follows the window now rather than ignoring it, capped so
            it does not become a full-screen panel on a large display, and
            floored by `max-h-full` at 960×600 where the window is the smaller
            of the two.

            **The inset and this cap agreed on nothing.** The frame outside was
            `p-6` — 48px of window spent — against a cap reserving 64, so the
            sheet stopped 16px short of its own margin at every height below the
            680px ceiling, and 24 is not a step on the ladder either
            (4/6/8/12/16/20/32). `p-gutter` is the step, and 32+32 is the 64 the
            cap already names: one number, written once.
          */
          'border-card bg-card relative flex h-[min(680px,calc(100vh-64px))] max-h-full w-[784px] max-w-full overflow-hidden rounded-lg border',
          leaving ? 'leaving' : 'animate-rise-in',
        )}
      >
        {nav ? (
          /*
            The same ground the app's own rail uses, and for the same reason:
            `--bg-card-soft` is two units off the card it sits beside, so the
            whole boundary was the stroke and the fill did nothing. `--bg-subtle`
            is a step a rep can see, and the stroke goes with it. One rail, two
            places, one shape.
          */
          <div className="bg-subtle flex w-[220px] shrink-0 flex-col py-row">
            {/*
              The sheet's own rail head. `text-heading` and not the 28px rung it
              used to share with the pane title beside it: measured on
              `reglages`@1280×800 the two were « Réglages » 28px/**400** and
              « Connecteurs » 28px/**500**, one rung apart in nothing but a `<p>`
              against an `<h2>`. A rail label stands under the pane it opens, so
              it takes the rung below the title rather than the same one at a
              different weight.
            */}
            <p className="font-display text-strong mb-block px-row text-heading leading-none">
              Réglages
            </p>
            {nav}
          </div>
        ) : null}

        {/*
          **The pane says how much of itself is left, and it was the one
          scroller in the product that did not.**

          `shot.mjs --fade` reported « 0 masque(s) » on `reglages` against 3 on
          the session screen and 5 on Historique, and both shots showed a card
          sheared clean through at the sheet's bottom edge. The repo's own
          invariant — « a reading column says how much of itself is left » — was
          unhonoured in the pane with the most content in the product.

          `ReadingColumn` rather than a `.fade-below` class, because the mask is
          only half the contract: the ramp is driven by `data-above` /
          `data-below`, which something has to measure on every scroll, and the
          page turn comes with it. A bare class would have drawn a ramp of zero
          length and looked fixed.
        */}
        <main className="bg-card flex min-h-0 flex-1 flex-col">
          {/*
            Above the column and outside it, so the pane can be scrolled
            anywhere and the sentence is still on screen. `shrink-0` for the
            same reason every other strip in the product carries it: the column
            below is the thing that gives.
          */}
          {notice ? (
            <div
              role="alert"
              className="border-subtle bg-card-soft shrink-0 border-b px-gutter py-snug"
            >
              <p className="text-danger measure text-ui">{notice}</p>
            </div>
          ) : null}
          {/*
            **The title row is chrome, and chrome does not scroll.**

            It lived inside the column below, which is the one scroller on this
            pane, so the product's own page turn carried the pane's `h2` and its
            ✕ out of the window: pressing « Lire la suite de la section » to the
            end of *Connecteurs* put the title at y **−537** and the close at
            **−536** at 1280×800, **−709** and **−708** at 960×600, clipped by
            the scroller both times (`scratch/probe-reglages-turn.mjs`). What
            was left was a pane with no name, no visible way out, and one
            control offering to take the rep back up. Échap and the veil still
            closed it; neither is visible, and neither is something a rep who
            has just read to the bottom of a section knows about.

            The reasoning is the `notice` strip's, thirty lines above, applied
            to the element that needed it more: *above the column and outside
            it, so the pane can be scrolled anywhere and it is still on screen.*
            `shrink-0` for the same reason — the column is the thing that gives.

            **The rhythm the old `p-gutter` bought is kept, and that is
            measured, not reasoned.** `--rhythm`'s third claim is more room above
            a heading than below, and it was red on eight stagings of this
            component before the padding was set. Driving the shipped pane on
            both trees (`scratch/probe-title-rhythm.mjs`, `h2` to the `h3` under
            it — the pair `--rhythm` itself compares): **32 above / 17 below, at
            1280×800 and at 960×600, identical before and after this move.**

            The 32 is `pt-gutter` here instead of `p-gutter`'s top. The 17 is the
            column's `pt-row`, and it has to live *there* rather than as a margin
            on the row above: with the title outside, the column's first child is
            « Requis », and a scroller with no top padding gave that `h3` **0px
            above against 12px below** on six stagings — the same `--rhythm`
            claim, broken one element further down by the fix for it. Measured,
            not predicted: the first attempt shipped `px-gutter pb-gutter` and
            the harness said so.

            The docblock this replaces said « 32 above, 20.3 below ». The 32 is
            confirmed; 20.3 is not this measurement's number, and the two are not
            measuring the same thing — that one was taken to the first paragraph.
            Neither is the other's evidence, so this one names its own target.
          */}
          <div className="shrink-0 px-gutter pt-gutter">
            {/*
              The ✕ is at the right of it, on the baseline of the heading, and it
              is a `nav` button rather than an icon-only rectangle with a
              tooltip: it clears 24×24 and it carries a French name.
            */}
            <div className="flex items-baseline gap-row">
              <h2 className="font-display text-strong min-w-0 flex-1 truncate text-title leading-none">
                {title}
              </h2>
              {/* `min-w-[24px]`, like the calendar's month pager: a glyph this
                  narrow is 9px of target otherwise (WCAG 2.2, 24×24). */}
              {/* Drawn, not typed. « ✕ » is U+2715 and Inter 4.1 does not carry
                  it, so this close was painted by whatever the OS substituted —
                  Segoe UI Symbol on Windows (HR-2), at its own size. */}
              <Button
                variant="nav"
                className="min-w-[24px]"
                aria-label="Fermer les réglages"
                onClick={onClose}
              >
                <X aria-hidden size={14} strokeWidth={2} />
              </Button>
            </div>
          </div>
          <ReadingColumn
            subject={{ determiner: 'la', noun: 'section' }}
            className="px-gutter pb-gutter pt-row"
          >
            {children}
          </ReadingColumn>
        </main>
      </div>
    </div>
  )
}

/**
 * **The keyboard, printed** (`app/shortcuts.ts`).
 *
 * VISION.md §6 says « keyboard-first » and the app had not one global shortcut;
 * once it had six, they were invisible. A product whose accelerators are only
 * in the source is a product without accelerators.
 *
 * It reads `SHORTCUTS` rather than restating it, so a key that is added, moved
 * or dropped cannot leave a row here claiming otherwise — the pane is a *view*
 * of the table the matcher itself uses. Nothing on it is pressable: a shortcut
 * drawn as a button would be a control that does with the mouse the thing it
 * exists to do without one.
 */
function Raccourcis() {
  return (
    <section>
      {/*
        **The exceptions are read off the table, never restated beside it.**

        This sentence said « sauf Échap et Ctrl Entrée » — two exceptions, where
        `ALLOWED_WHILE_TYPING` has one. The second one it named was `valider`,
        the accelerator for `review:confirm`: the write with no idempotency key
        and no delete verb. `shortcuts.ts` removed `Ctrl Entrée` from that list
        deliberately, and its docblock calls having it there « the most dangerous
        line in this file », because two of the things a rep types at the gate
        are the follow-up mail's subject and its body and that chord sends mail
        in every mail client they have ever used. The table went on promising it
        anyway — four rows above its own `valider` row, which says « hors
        saisie ». One screen, read once and believed, disagreeing with itself.

        So it is a view of the array, for the reason the docblock above gives for
        the rows: a key that moves cannot leave a line here claiming otherwise.
      */}
      <Lede>
        Ctrl sur Windows, ⌘ sur Mac — les deux fonctionnent partout. Ils sont ignorés pendant
        que vous écrivez, sauf&nbsp;{typingExceptionKeys().join(' et ')}.
      </Lede>

      <List as="div" bare>
        {SHORTCUTS.map((shortcut) => (
          <Row as="div" key={shortcut.id} align="center">
            <span className="min-w-0 flex-1">
              <span className="text-strong text-copy">{shortcut.label}</span>
              {/* Where it works, when that is not everywhere. Four of the six
                  were silent on the screen a rep was looking at, and a table
                  that promises six global keys is worse than no table. */}
              {shortcut.where ? (
                <span className="text-muted ml-snug text-meta">{shortcut.where}</span>
              ) : null}
            </span>
            {/*
              `kbd`, and not a styled span: this is a key on a keyboard, and the
              element that says so is the one a screen reader announces as one.
            */}
            <kbd className="text-muted border-card bg-inner shrink-0 rounded-sm border px-tight py-hair font-mono text-meta">
              {shortcut.keys}
            </kbd>
          </Row>
        ))}
      </List>

      {/*
        **The notepad's own keys, from the table the editor binds**
        (`editor/note/keymap.ts`).

        They are here for the reason the six above are: `index.css` has styled
        headings, lists and quotes for that pane since it was written, and until
        the input rules were wired there was no way to make any of them — no
        toolbar, no key, nothing. A vocabulary a rep cannot find is a vocabulary
        they do not have, and the lede names the typed forms because that is how
        most people will meet them.
      */}
      {/*
        `mt-block`, because `SectionHeader` carries `mb-inline` and nothing
        above it. Measured at 960×600 this heading stood **0px under the last
        row of the table before it and 12px above its own lede** — a second
        group's name closer to the first group's contents than to its own, which
        is `--rhythm`'s third claim inverted. 20 above, 12 below. The same
        `mt-block` « Facultatifs » already carries, for the same reason.
      */}
      <SectionHeader className="mt-block">Dans le bloc-notes</SectionHeader>
      <Lede>
        En début de ligne, <Typed>#&nbsp;</Typed>, <Typed>##&nbsp;</Typed>, <Typed>-&nbsp;</Typed>,{' '}
        <Typed>1.&nbsp;</Typed>, <Typed>&gt;&nbsp;</Typed>, <Typed>---&nbsp;</Typed> et{' '}
        <Typed>```</Typed> font la même chose en tapant ; <Typed>**gras**</Typed> et{' '}
        <Typed>_italique_</Typed> aussi. Retour arrière juste après annule la transformation et
        rend les caractères.
      </Lede>

      <List as="div" bare>
        {NOTE_SHORTCUTS.map((shortcut) => (
          <Row as="div" key={shortcut.combo} align="center">
            <span className="text-strong text-copy min-w-0 flex-1">{shortcut.label}</span>
            <kbd className="text-muted border-card bg-inner shrink-0 rounded-sm border px-tight py-hair font-mono text-meta">
              {shortcut.keys}
            </kbd>
          </Row>
        ))}
      </List>
    </section>
  )
}

/** A literal a rep types, inline in a sentence. `code`, because that is what it is. */
function Typed({ children }: { children: ReactNode }) {
  return <code className="text-body bg-subtle rounded-sm px-hair font-mono">{children}</code>
}

/** The paragraph every pane opens with: muted, one column wide, never truncated. */
function Lede({ children }: { children: ReactNode }) {
  // `74ch`, not the shared `.measure`: 38rem is 87 characters at `--type-copy`,
  // and a measure is a count of characters rather than a width.
  return <p className="text-muted mb-block measure text-ui leading-relaxed">{children}</p>
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

/** What a provider costs to use, in the two words a rep needs (DEC-33). */
const COST_LABEL = {
  free: 'gratuit',
  metered: 'facturé à l’usage',
  included: 'inclus dans votre abonnement',
} as const

/**
 * **« Cette machine uniquement »** (DEC-37) — the one switch in this product
 * that refuses something.
 *
 * DEC-37 withdrew every jurisdiction claim: no `eu` value, no « UE » badge, no
 * allow-list, because a contractual term differs per client and per year and a
 * literal in a source file cannot keep it true. What it kept is this — the rep
 * asking, *in the product*, for this meeting to stay on the machine — and until
 * now the only way to ask was an environment variable, on a product whose
 * DEC-34 says none is required to run it.
 *
 * Three things the wording has to get right, because this is a promise and a
 * promise stated loosely is worse than none:
 *
 *  · it covers **both** hops. The audio goes to the transcriber and the
 *    transcript goes to the language model, and the second is the one carrying
 *    the client's name — a switch that only bound transcription would be true
 *    of the smaller half;
 *  · it is a **constraint**, not a preference: turning it on removes every
 *    remote engine from the candidate set, including one the rep had explicitly
 *    chosen, which is why the tables below change under it;
 *  · it says what it **costs**, here, rather than leaving the rep to find out
 *    when the compte-rendu does not arrive.
 */
function OfflineOnly({
  value,
  busy,
  onChange,
}: {
  value: boolean
  busy: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="mb-gutter flex items-start gap-inline">
      <input
        type="checkbox"
        checked={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-brand-700 mt-hair h-4 w-4 shrink-0"
      />
      <span className="min-w-0">
        <span className="text-strong block text-ui font-medium">
          Cette machine uniquement
        </span>
        <span className="text-muted measure mt-tight block text-meta">
          Rien de ce qui est dit ni de ce qui est écrit ne quitte cet ordinateur : ni l’audio
          envoyé à la transcription, ni le texte envoyé au modèle de langage. Les moteurs hors
          machine disparaissent des listes ci-dessous, y compris celui que vous auriez choisi.
          Sans modèle installé ici, le compte-rendu ne sera pas rédigé — l’enregistrement et la
          transcription, eux, continuent.
        </span>
      </span>
    </label>
  )
}

/**
 * **The sentence the rep reads to the client** (US-11, US-19,
 * `core/contracts/mention.ts`).
 *
 * The one setting in this pane whose value is a piece of *speech*, and the reason it
 * is a setting at all is that the wording is a legal matter belonging to the ESN
 * rather than to us. DEC-34's rule applied to it literally: declared, stored in the
 * KV store, rendered as a field.
 *
 * Four things, each of which would otherwise be a defect this repo has already had.
 *
 * **The field shows what the pill will hand over, never what is stored.** The
 * snapshot resolves through `resolveMentionSentence`, so a deployment that saved an
 * empty box and one that never opened this pane look the same here — which is true,
 * because they behave the same. A box that stayed blank would claim the product says
 * nothing, and the product says the default.
 *
 * **Saving an empty box is how you go back**, and there is a control that says so
 * rather than a trick a rep has to know: *Rétablir la phrase par défaut* is live
 * exactly when what is on screen is not the default, which is the `SettingField`
 * rule — a button is dead precisely when pressing it would do nothing (DEC-26).
 *
 * **`[field-sizing:content]` and no scroller.** A four-line sentence in a
 * three-line box is the eleven clipped textareas at the gate, and `--scrollers`
 * would find it. `.measure` on the textarea itself and not on a wrapper, because
 * `ch` resolves against the element's own font size.
 *
 * **Nothing here claims consent.** There is no second field for « le client a
 * accepté » and no sentence in the explanation that implies pressing the pill's
 * control obtained anything. The product knows what it handed to the rep; what the
 * client said is not in the record and must not look as though it is.
 */
function MentionSentence({
  value,
  busy,
  onSave,
}: {
  value: string
  busy: boolean
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const dirty = draft.trim() !== value.trim()
  const customised = value.trim() !== MENTION_SENTENCE_DEFAULT

  return (
    <section className="mb-gutter">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft.trim())
        }}
      >
        <label className="text-strong block text-ui font-medium" htmlFor="mention-sentence">
          Ce que vous dites au client
        </label>
        <p className="text-muted measure mt-tight text-meta">
          Pendant l’appel, la pastille propose de copier cette phrase en un clic : vous la collez
          dans la conversation, ou vous la lisez à voix haute. Sillage n’envoie rien et
          n’enregistre pas la réponse du client — il note seulement que la phrase vous a été
          remise. La formulation vous appartient ; celle-ci est vraie de l’outil tel qu’il
          fonctionne.
        </p>
        <textarea
          id="mention-sentence"
          value={draft}
          maxLength={MENTION_MAX_CHARS}
          onChange={(event) => setDraft(event.target.value)}
          className="measure text-body bg-inner border-subtle mt-hair w-full resize-none rounded-sm border px-snug py-hair text-ui leading-relaxed [field-sizing:content]"
        />
        <div className="mt-hair flex items-center gap-inline">
          <Button
            type="submit"
            variant="bordered"
            {...unavailable(
              busy || !dirty,
              busy ? 'enregistrement en cours' : 'aucune modification',
            )}
          >
            {/*
              Not the bare « Enregistrer » `SettingField` uses. This pane already holds
              one per provider row, and a second verb with a different meaning under the
              same accessible name is the `--a11y` failure one step up from a control
              whose only name is « ‹ » : a rep tabbing the pane, or reading it with a
              screen reader, gets two identical offers that do different things.
            */}
            Enregistrer la phrase
          </Button>
          {/*
            Not a *Supprimer*. Emptying the box is the request to come back to the
            default, and the default is what the pill would then hand over — so the
            control says what happens rather than what it clears.
          */}
          <Button
            type="button"
            variant="text"
            onClick={() => {
              setDraft(MENTION_SENTENCE_DEFAULT)
              onSave('')
            }}
            {...unavailable(
              busy || !customised,
              busy ? 'enregistrement en cours' : 'c’est déjà la phrase par défaut',
            )}
          >
            Rétablir la phrase par défaut
          </Button>
          <span className="text-muted ml-auto shrink-0 tabular-nums text-meta">
            {draft.trim().length} / {MENTION_MAX_CHARS}
          </span>
        </div>
      </form>
    </section>
  )
}

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

/**
 * How hard a checkpoint works the machine during a call.
 *
 * Named for the rep's experience rather than for the model: « rapide » is what a
 * laptop does with `small`, and « lent » is the honest word for a large model on
 * the four-year-old Windows machines this ships to (HR-2).
 */
const SPEED_LABEL = {
  fast: 'rapide',
  medium: 'assez rapide',
  slow: 'lent sur une machine modeste',
} as const

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
    <section className="mt-gutter">
      <SectionHeader>Modèles sur cette machine</SectionHeader>
      <Lede>
        Le modèle fourni avec le logiciel est déjà présent et connaît le vocabulaire de la
        société. Les autres se téléchargent à la demande : plus ils sont grands, plus ils sont
        précis et plus ils sollicitent la machine pendant la réunion.
      </Lede>

      <List as="div" bare>
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
                    <Chip variant="brand" className="ml-snug uppercase tracking-wider">
                      Chargé
                    </Chip>
                  ) : null}
                  {row.bundled ? (
                    <Chip variant="label" className="ml-snug">
                      fourni
                    </Chip>
                  ) : null}
                </span>
                <span className="text-muted block text-meta">{MODEL_STATE[row.status](row)}</span>
              </span>

              {/* `gap-snug`, not `gap-inline`: 12 inside a row also spaced 12 is
                  not a group — the same finding as the provider line above. */}
              <span className="flex shrink-0 items-center gap-snug">
                {/*
                  **Size, accuracy and speed — the three the lede promises.**

                  « plus ils sont grands, plus ils sont précis et plus ils
                  sollicitent la machine pendant la réunion » is two sentences
                  above this row, and the row itself answered two thirds of it:
                  `speed` has been on `ModelRow` since the table existed and was
                  drawn by nothing. It is the half a rep on a four-year-old
                  Windows laptop cares about most, and the one the prose can only
                  state in general.
                */}
                <span className="text-muted text-meta">
                  {row.sizeMb} Mo · précision {row.accuracy} · {SPEED_LABEL[row.speed]}
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

    /*
      **The table is named, and its name is no longer drawn twice.**

      `<SectionHeader>{title}</SectionHeader>` stood at the head of this section
      and the pane it is the whole of is now headed with the same words by the
      sheet — « Transcription » over « Transcription », « Modèle de langage »
      over « Modèle de langage ». The heading goes and the name stays, as the
      section's accessible name: a landmark with no name is a landmark nobody can
      address, and this screen holds more than one list.
    */
  return (
    <section aria-label={title}>

      {intro}

      {/* Why nothing is selected, from the registry's own refusal (DEC-26). */}
      {section.selected === null && section.reason ? (
        <p className="text-warn mb-snug measure text-ui">{section.reason}</p>
      ) : null}

      <List as="div" bare>
        {TIERS.map((tier) => {
          const rows = section.rows.filter((row) => row.tier === tier)
          if (rows.length === 0) return null
          return (
            <div key={tier}>
              <Row as="div" className="bg-subtle py-hair">
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
              *Utilisé* used to be `text-accent` — 2.41:1 then, 3.35:1 since the
              accent moved, still under AA for a word — and orange borrowed for
              a meaning it does not have. Selection is brand blue (VISION.md §6),
              and `--brand-900` on `--brand-100` is 10.55:1.
            */}
            {row.selected ? (
              <Chip variant="brand" className="ml-snug uppercase tracking-wider">
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

        {/*
          **`gap-snug`, because this cluster is a group and the row around it is
          not.** It was `gap-row` — 16 inside a row spaced 12 — so the two things
          that belong together (where the engine runs, what it costs) stood
          *further* apart than they stood from the provider's name. `--rhythm`'s
          second claim, « un groupe qui n'est pas plus serré que ce qui l'entoure
          n'est pas un groupe », red on 8 stagings from this one span.
        */}
        <span className="flex shrink-0 items-center gap-snug">
          <span className="text-muted flex items-center gap-hair text-meta">
            <span>{RESIDENCY_LABEL[row.residency]}</span>
            {row.cost === 'free' ? null : (
              <>
                <span aria-hidden>·</span>
                <span>{COST_LABEL[row.cost]}</span>
              </>
            )}
          </span>
          {/*
            **What it costs, beside where it runs.**

            `cost` has been on `ProviderRow` since the row existed, crossed the
            bridge on every settings read, and was drawn by nothing — so the one
            question a rep asks after « où ça tourne » had an answer in the
            payload and nowhere on screen. It is two words and it is the
            difference between a provider they can leave on and one that invoices
            per meeting.

            `free` says nothing: on this table it is true of exactly the local
            engines, which already say « sur la machine » next to it, and a label
            repeating the neighbouring one is noise.
          */}

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
        className="flex w-full items-center gap-snug"
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
          className="border-subtle bg-canvas min-w-0 flex-1 rounded border px-snug py-hair text-ui"
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
        className="flex w-full items-center gap-snug"
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
          className="border-subtle bg-canvas min-w-0 flex-1 rounded border px-snug py-hair text-ui"
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
  onOnboarding?: () => void
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

function Connectors({ rows, auth, probe, probeReason, onOnboarding, onHealth }: ConnectorsProps) {
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

  const required = group(rows, REQUIRED_CONNECTORS)
  const optional = group(rows, OPTIONAL_CONNECTORS)

  return (
    <section>

      {/*
        **One line per section, and none before the first control.**

        There were three paragraphs here — what the header indicator tracks, what
        the required connectors are for, what the optional ones are not for —
        about sixty words of rationale standing between the rep and the red row
        they opened this screen because of. The reasoning was written for a
        reviewer; a rep arrives here at the moment VerySwing has just broken.

        What each sentence was *doing* is kept, because the split does need
        stating (DEC-26, DEC-32): it moved onto the two headings it explains, one
        line each, where it reads as a caption rather than as a preamble.
      */}
      <SectionHeader as="h3">Requis</SectionHeader>
      <Lede>
        Audio, transcription, analyse : sans eux une réunion ne peut pas être enregistrée,
        et ce sont les seuls à faire changer l’indicateur d’état en haut de l’écran.
      </Lede>
      <List bare>
        {required.map((row) => (
          <ConnectorLine
            key={row.id}
            row={row}
            retrying={retrying === row.id}
            onRetry={() => void retry(row.id)}
          />
        ))}
      </List>

      {/*
        **The trial belongs beside the rows it disagrees with.**

        « Audio · connecté » is a device that opened. It is not a sound that
        arrived, and the difference is the whole reason `capture:essai` exists
        (DEC-45): the permission can be granted and the loopback still produce
        nothing, and the rep finds out from a compte-rendu that describes a
        monologue.

        It could only be reached from first run, and from there only through
        « Revoir la présentation › » in the *empty-day* panel — so a rep whose
        headset changed, whose Bluetooth output moved or whose grant a Windows
        update revoked had three calls on the day they needed it and no way in.
        The placement was keyed on « the day is empty » when the need is
        « capture is suspect », and this is the screen a rep opens when they
        suspect it: the row above says « connecté » and this is the control that
        can disagree.
      */}
      <EssaiAudio />

      <SectionHeader as="h3" className="mt-block">
        Facultatifs
      </SectionHeader>
      <Lede>
        Une réunion s’enregistre, se transcrit et s’analyse sans eux : leur panne se
        signale ici, avec son motif, et jamais dans l’indicateur d’état.
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
      <MicrosoftAccount auth={auth} />

      <List bare>
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

      {onOnboarding ? (
        <p className="mt-block">
          <Button variant="nav" onClick={onOnboarding}>
            Revoir la présentation ›
          </Button>
        </p>
      ) : null}
    </section>
  )
}

/**
 * The Microsoft 365 account — the credential the calendar and Outlook both
 * hang off. Drawn under *Connecteurs* with them, and again as the whole of
 * *Calendrier*, from one component so the two cannot disagree.
 */
function MicrosoftAccount({ auth }: { auth: SettingsSnapshot['auth'] }) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

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

  return (
    <List as="div" bare className="mb-snug">
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
  )
}

/**
 * *Calendrier* — the same account, said in the calendar's terms.
 *
 * *Connecteurs* lists it as a credential among faults; a rep who wants their
 * meetings to appear is not looking for a fault. The card under the month grid
 * on the calendar sends them here.
 */
function Calendrier({ auth }: { auth: SettingsSnapshot['auth'] }) {
  return (
    <section>
      <Lede>
        Avec votre compte Microsoft 365, les réunions de votre agenda Outlook apparaissent
        dans le calendrier, avec leurs participants et l’objet de l’invitation. Sillage lit
        l’agenda et n’y écrit jamais ; la relance est un brouillon dans votre boîte, jamais
        un envoi.
      </Lede>
      <MicrosoftAccount auth={auth} />
      <p className="text-muted measure mt-block text-ui leading-relaxed">
        Sans compte, le calendrier reste utilisable : les appels en cours sont détectés et
        vous pouvez y ajouter une réunion vous-même.
      </p>
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
      {/*
        `bordered`, not `link`. This is the only recovery a rep has for a broken
        connector and it had the visual weight of a footnote — an underlined
        grey word at the far edge of the row, indistinguishable from the four
        captions above it. A control that fixes something looks like a control.
      */}
      {row.health.state !== 'ok' && row.health.retryable ? (
        <BusyButton busy={retrying} busyReason="Vérification…" onClick={onRetry}>
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
        <p className="text-muted measure text-ui">
          {reason ?? 'sonde indisponible'}
        </p>
      ) : (
        <>
          {/* `.measure` on the sentence itself: it is set at `--type-ui`, one
              step below the body, so a box sized for body copy runs it to
              ninety-seven characters. */}
          <p className={`mb-snug measure text-ui ${report.ok ? 'text-muted' : 'text-warn'}`}>
            {report.summary} · {formatAgo(report.at, Date.now())}
          </p>
          <List bare>
            {report.findings.map((finding) => (
              <Finding key={finding.id} finding={finding} />
            ))}
          </List>
          {report.columnGaps.length > 0 ? (
            <p className="text-warn mt-snug text-meta">
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
    <Row className="py-snug">
      <span className="text-body min-w-0 flex-1 text-ui">
        {finding.label}
        {/*
          `.measure` on the element holding the prose, never on a wrapper. This line
          sat at 72 characters inside a padded row and went to 78 the moment the
          row went flush — one reading measure, and a sentence that only fitted
          because of a container's padding was never held by it.
        */}
        {bad ? (
          <span className="text-muted measure block text-meta">{finding.matters}</span>
        ) : null}
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
/**
 * « Mise à jour » (DEC-26, DEC-32).
 *
 * Three properties this panel has on purpose:
 *
 *  · **It always names the running version**, in every phase including the one
 *    where updating is impossible. That line is the first thing a support
 *    conversation asks for and it is not on screen anywhere else.
 *  · **It never says « à jour » when it does not know.** A build with no update
 *    metadata reports `disabled` and says so. Reporting "up to date" for a
 *    build that cannot discover otherwise would be a lie told to precisely the
 *    testers most likely to be running something stale.
 *  · **The install button disables itself with the meeting's own words.** Not
 *    "indisponible" — « une réunion est en cours d'enregistrement ». The rep
 *    then knows whether to wait thirty seconds or thirty minutes.
 */
function UpdatePanel() {
  const status = useInvoke('update:status', {})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // The main process pushes this on every updater change *and* on every session
  // transition, so the button's availability tracks the meeting without a poll.
  useBroadcast('update:changed', (payload) => status.set(payload))

  const act = useCallback(
    async (run: () => Promise<void>) => {
      setBusy(true)
      setFailure(null)
      try {
        await run()
      } catch (error) {
        setFailure(error instanceof Error ? error.message : 'opération impossible')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  if (status.state.status !== 'ready') {
    return (
      <section>
        <Lede>
          {status.state.status === 'failed' ? status.state.reason : 'Lecture de l’état…'}
        </Lede>
      </section>
    )
  }

  const update = status.state.value
  const check = () =>
    void act(async () => {
      status.set(await invoke('update:check', {}))
    })
  const download = () =>
    void act(async () => {
      status.set(await invoke('update:download', {}))
    })
  const openReleases = () =>
    void act(async () => {
      // `opened: false` is the honest answer on a host with no browser, and it
      // is said rather than swallowed — otherwise the press looks like it
      // worked and the rep waits for a window that is never coming.
      const { opened } = await invoke('update:releases:open', {})
      if (!opened) setFailure('la page des versions n’a pas pu être ouverte')
    })

  return (
    <section>

      <Lede>
        Version installée&nbsp;: <span className="text-body font-medium">{update.currentVersion}</span>
        {/*
          **`formatAgo` brings its own « il y a », and this line brought a second
          one.** Every branch of the helper was doubled or mangled by the prefix,
          not just the one the fixture renders: « il y a il y a 9 min », « il y a
          il y a 3 h », « il y a à l’instant », and « il y a mar. 15 sept. ». The
          worst of the four is the one a rep meets immediately after pressing
          *Vérifier maintenant*, on the line directly above the only control this
          panel has on every Windows build shipping today.

          The helper's two other call sites pass it through bare and were always
          right, so this was one site saying the same three words twice.
        */}
        {update.checkedAt ? ` — dernière vérification ${formatAgo(update.checkedAt, Date.now())}` : null}
      </Lede>

      {update.phase === 'disabled' ? (
        /*
          Stated, not hidden. A tester on a build that cannot update itself needs
          to know that checking again will never change anything.

          **And the remedy is a control, not a noun phrase.** This branch is not
          the exotic one: `build.win` declares neither `publisherName` nor
          `certificateFile`, so `updateTrust` returns `ok: false` and every
          Windows build shipping today — the primary platform (HR-2), for the
          first deliverable (DEC-28) — lands here. It read « Les nouvelles
          versions se téléchargent depuis la page des versions du projet » and
          then held zero links and zero buttons at both sizes: the page was
          never named and could not be reached, which is the dead end with a
          sentence in it that DEC-26 forbids. Two consecutive sentences also
          opened on the same three words in opposite registers — « à installer à
          la main » and « se téléchargent depuis ».
        */
        <div className="flex flex-col items-start gap-tight">
          <p className="text-muted text-ui">
            {update.reason ?? 'Cette version ne se met pas à jour automatiquement.'} Les nouvelles
            versions sont publiées sur GitHub.
          </p>
          <Button onClick={openReleases} {...unavailable(busy, 'Ouverture en cours…')}>
            Voir les versions publiées
          </Button>
        </div>
      ) : null}

      {update.phase === 'idle' ? (
        <div className="flex flex-col items-start gap-tight">
          <p className="text-body text-ui">Sillage est à jour.</p>
          <Button onClick={check} {...unavailable(busy, 'Vérification en cours…')}>
            Vérifier maintenant
          </Button>
        </div>
      ) : null}

      {update.phase === 'checking' ? <p className="text-muted text-ui">Recherche d’une mise à jour…</p> : null}

      {update.phase === 'available' ? (
        <div className="flex flex-col items-start gap-tight">
          <p className="text-body text-ui">Version {update.availableVersion} disponible.</p>
          <Button variant="primary" onClick={download} {...unavailable(busy, 'Téléchargement en cours…')}>
            Télécharger
          </Button>
          {/*
            Said before the click, not after. The download is most of half a
            gigabyte and the app refuses to start one during a call — a rep who
            presses this and sees nothing happen deserves to know why.
          */}
          <p className="text-muted text-meta">
            Environ 550 Mo. Le téléchargement ne démarre pas pendant une réunion, pour ne pas
            gêner l’appel en cours.
          </p>
        </div>
      ) : null}

      {update.phase === 'downloading' ? (
        <div className="flex flex-col items-start gap-tight">
          <p className="text-body text-ui" role="status">
            Téléchargement… {update.percent ?? 0}&nbsp;%
          </p>
          {/*
            Only present on a retry, and then it is the whole explanation for a
            bar that just went back to zero. Nothing underneath resumes a broken
            transfer, so silence here reads as a bug.
          */}
          {update.reason ? <p className="text-muted text-meta">{update.reason}</p> : null}
        </div>
      ) : null}

      {update.phase === 'ready' ? (
        <div className="flex flex-col items-start gap-tight">
          <p className="text-body text-ui">
            Version {update.availableVersion} prête à installer.
          </p>
          <Button
            variant="primary"
            onClick={() =>
              void act(async () => {
                const outcome = await invoke('update:install', {})
                // The app quits inside a successful install, so this only ever
                // renders on a refusal — and then the reason is the point.
                if (!outcome.started) setFailure(outcome.reason ?? 'installation impossible')
              })
            }
            {...unavailable(
              busy || !update.installable,
              busy
                ? 'Installation en cours…'
                : (update.blockedReason ?? 'installation impossible pour le moment'),
            )}
          >
            Installer et redémarrer
          </Button>
          <p className="text-muted text-meta">
            Sillage se ferme, s’installe et se rouvre. Vos réunions, vos notes et vos clés sont
            conservées.
          </p>
        </div>
      ) : null}

      {update.phase === 'error' ? (
        <div className="flex flex-col items-start gap-tight">
          <p className="text-body text-ui">{update.reason}</p>
          {/*
            Two different failures, two different buttons.

            A known `availableVersion` means the check succeeded and only the
            transfer broke, so the useful verb is *download again* — the same
            state the retries inside the module start from. Sending that case
            back through *Vérifier* was the shape of the reported clunkiness: an
            error, then a check that could only ever say « disponible » again,
            then a second click to do the thing that actually failed.
          */}
          {update.availableVersion ? (
            <Button variant="primary" onClick={download} {...unavailable(busy, 'Téléchargement en cours…')}>
              Reprendre le téléchargement
            </Button>
          ) : (
            <Button onClick={check} {...unavailable(busy, 'Vérification en cours…')}>
              Réessayer
            </Button>
          )}
        </div>
      ) : null}

      {failure ? (
        <p role="alert" className="text-danger mt-inline text-ui">
          {failure}
        </p>
      ) : null}
    </section>
  )
}

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

      <Lede>
        Les diagnostics sont conservés {retentionDays} jours puis effacés. Le contenu des
        réunions n’expire jamais et n’est supprimé que par vous.
      </Lede>

      <div className="mb-inline flex flex-wrap items-start gap-inline">
        <div>
          <BusyButton
            busy={busy}
            busyReason="Export en cours…"
            onClick={() => void exportBundle('redacted')}
          >
            Diagnostics
          </BusyButton>
          <p className="text-muted mt-hair max-w-[15rem] text-meta">
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
          <p className="text-muted mt-hair max-w-[24rem] text-meta">
            À ne transmettre qu’avec l’accord explicite du client.
          </p>
        </div>
      </div>

      {exported ? <p className="text-muted mb-inline text-meta">{exported}</p> : null}
      {failure ? (
        <p role="alert" className="text-danger mb-inline text-ui">
          {failure}
        </p>
      ) : null}

      <SectionHeader as="h3" className="mb-snug">
        Erreurs récentes
      </SectionHeader>
      {recent.state.status !== 'ready' ? (
        /*
          **« Aucune erreur récente. » was asserted when the log could not be
          read at all.**

          `events` collapses `loading` and `failed` to `[]`, and the sentence
          below reads that as « nothing broke ». So the one pane a support
          engineer opens — on DEC-27's own evidence trail — stated positively
          that the app was healthy at the exact moment it could not tell. An
          absence of evidence drawn as evidence of absence, on the screen whose
          whole job is evidence.
        */
        <p className={recent.state.status === 'failed' ? 'text-warn text-ui' : 'text-muted text-ui'}>
          {recent.state.status === 'failed'
            ? 'Le journal n’a pas pu être lu — ceci ne veut pas dire qu’il est vide.'
            : 'Lecture du journal…'}
        </p>
      ) : errors.length === 0 ? (
        <p className="text-muted text-ui">Aucune erreur récente.</p>
      ) : (
        <List bare>
          {errors.map((event) => (
            <Row key={event.id} className="py-snug text-meta">
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
