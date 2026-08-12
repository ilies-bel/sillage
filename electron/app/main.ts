/**
 * Boot. Deliberately short.
 *
 * The old `main.ts` was 7,869 lines and started roughly twenty subsystems. The
 * rule that keeps this one small: main opens the store, builds the diagnostics
 * sink and the orchestrator, registers IPC, and shows a window. Anything that
 * decides something belongs in `app/session/` or `core/domain/`.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { release } from 'node:os'
import { Worker } from 'node:worker_threads'
import { Store } from '../modules/store/index.ts'
import { DB_FILENAME } from '../modules/store/schema.ts'
import { Diagnostics } from '../modules/diagnostics/index.ts'
import { CaptureSession } from '../modules/capture/index.ts'
import { MeetingApps } from '../modules/capture/MeetingApps.ts'
import { createIdentity, resolveIdentityConfig } from '../modules/identity/index.ts'
import { GraphCalendar, calendarHealth } from '../modules/calendar/index.ts'
import {
  LLM_PROVIDERS,
  OpenAiCompatibleLlm,
  configuredLlmProviders,
  descriptorFor,
  llmEndpointFor,
  llmHealth,
  llmRefusalReasons,
  selectLlm,
} from '../modules/llm/index.ts'
import {
  STT_PROVIDERS,
  descriptorFor as sttDescriptorFor,
  isLocalWhisperReady,
  prewarmEngine,
  usableSttProviders,
  offlineOnlyStt,
  preferCloudStt,
  selectProvider,
  sttCredentialFor,
} from '../modules/transcribe/index.ts'
import { SignalExtractor } from '../modules/signals/index.ts'
import {
  MODELS,
  DEFAULT_MODEL_ID,
  ModelDownloads,
  resolveWorkerPath,
  resolveInferenceConfig,
  electronPaths,
  type DownloadWorkerLike,
} from '../modules/transcribe/index.ts'
import { keychainVault, memoryVault } from '../modules/identity/index.ts'
import { modelSection, resolveSelectedModel } from '../core/domain/modelRows.ts'
import { credentialKeyFor } from '../core/contracts/secrets.ts'
import {
  CredentialCache,
  ProviderPreferenceStore,
  type SettingsContext,
} from './settingsContext.ts'
import type { ProviderTables } from './ipc/register.ts'
import { buildBoostSet, termsLearnedFrom } from '../core/domain/lexicon/boost.ts'
import { correct as correctWithLexicon } from '../core/domain/lexicon/correct.ts'
import { VsaCrm, crmHealth, missingVsaSettings, vsaConfig } from '../modules/crm/index.ts'
import { OutlookMail, mailHealth } from '../modules/mail/index.ts'
import { Outbox } from './session/Outbox.ts'
import { CompteRenduRecipe, ExtractionError } from '../modules/extract/index.ts'
import { documentToText } from '../core/domain/documentText.ts'
import { bleedReport, withoutChannelBleed } from '../core/domain/channelBleed.ts'
import { providerSection } from '../core/domain/providerRows.ts'
import { Enhancement } from './session/Enhancement.ts'
import { Orchestrator, type Broadcaster } from './session/Orchestrator.ts'
import { Agenda } from './session/Agenda.ts'
import { registerIpc, updateStatus } from './ipc/register.ts'
import { AutoUpdate } from '../modules/update/index.ts'
import { updateReadiness } from '../core/domain/updateGate.ts'
import type { UpdatePort } from '../core/contracts/update.ts'
import { runDevRecording } from './devRecord.ts'
import { loadDevEnv } from './devEnv.ts'
import type { MsalIdentity } from '../modules/identity/index.ts'
import type { CapabilityReport } from '../core/contracts/crm.ts'
import type { BootState, BootStep } from '../core/contracts/boot.ts'
import type { ProviderSection } from '../core/contracts/settings.ts'
import type { ConnectorHealth } from '../core/contracts/health.ts'
import type { DiagEnvironment, DiagRecorder } from '../core/contracts/diagnostics.ts'
import type { Meeting, MeetingContext } from '../core/contracts/meeting.ts'
import type { EnhancementStatus } from '../core/contracts/extraction.ts'

const isDev = !app.isPackaged

/** A minute after boot, then every six hours. See `startUpdateChecks`. */
const FIRST_UPDATE_CHECK_MS = 60_000
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * The portable `.exe`, which must never update itself.
 *
 * `latest.yml` only ever describes the NSIS installer — electron-builder writes
 * update metadata for `nsis` targets and for nothing else. So a portable build
 * that took the update path would download an *installer* and run it, silently
 * converting a rep who deliberately chose the no-install build into an
 * installed one, with their portable copy left behind and stale.
 *
 * `PORTABLE_EXECUTABLE_DIR` is set by electron-builder's own portable
 * launcher, so this reads a fact about how the app was started rather than a
 * setting — DEC-34 is about configuration, and there is nothing here for a rep
 * to configure. Réglages then says updates are unavailable and points at the
 * releases page, which is the honest answer for that build.
 */
const isPortableBuild = (): boolean => Boolean(process.env.PORTABLE_EXECUTABLE_DIR)

/**
 * A worker whose only job is to pull one checkpoint from Hugging Face (DEC-35b).
 *
 * The same worker file the meeting path uses, with `allowRemoteModels: true` —
 * `ModelDownloads` sets that, and it is the only caller in the product that
 * does. Spawning lives here rather than in the module because `worker_threads`
 * plus an Electron-resolved path is wiring, and `modules/transcribe` stays
 * testable without either.
 */
const spawnDownloadWorker = (modelId: string): DownloadWorkerLike => {
  const worker = new Worker(resolveWorkerPath(electronPaths()), { name: `download:${modelId}` })
  return worker as unknown as DownloadWorkerLike
}

/**
 * Before anything reads `process.env` — which the two constants below already
 * do, and `resolveProviders()` does at boot.
 *
 * `app.getAppPath()` is the repo root in development, which is where `.env`
 * lives. In a packaged build `loadDevEnv` returns immediately without touching
 * the filesystem, so this line costs nothing there.
 */
const devEnvApplied = loadDevEnv({ isDev, root: app.getAppPath() })
if (devEnvApplied.length > 0) {
  // Names only, never values — this line is in every dev console and in every
  // screen recording of a demo. Naming them is the point: "I pasted a key and
  // nothing happened" is answered by whether the key's name is on this line.
  console.log(`[env] .env applied: ${devEnvApplied.join(', ')}`)
}

/**
 * The terminal harness (`electron/app/devRecord.ts`). There is no renderer yet,
 * and step 2's "done when" is a real call — so until step 5 this is the only
 * way to start one. Never true in a packaged build.
 */
const devRecord = isDev && process.env.SILLAGE_DEV_RECORD === '1'
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5180'

/**
 * Two instances would open the same SQLite file and fight over the same audio
 * devices. Taking the lock before anything else is opened means the loser exits
 * without having touched either.
 *
 * `exit`, not `quit`: `quit` is asynchronous, so `whenReady` still resolves and
 * the loser opens the store on its way out — which is the whole thing the lock
 * exists to prevent.
 */
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

const environment = (): DiagEnvironment => ({
  appVersion: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  electron: process.versions.electron ?? 'unknown',
  node: process.versions.node,
  // Filled in properly once `electron/nativeArchGate.ts` moves under
  // `modules/capture/` in step 2. Until then the process arch is the honest
  // answer, and a wrong one here is the first thing to check on a capture bug.
  nativeArch: process.arch,
})

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    // `--bg-canvas` from `src/design/tokens.css`. It is the colour the window
    // is painted before the renderer's first frame, so a stale value here is a
    // flash of the retired cream palette on every launch.
    backgroundColor: '#f7f9fb',
    title: 'Sillage',
    webPreferences: {
      // esbuild emits CommonJS (scripts/build-electron.js), so `__dirname` is
      // real at runtime: dist-electron/electron/app → dist-electron/electron.
      preload: join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.once('ready-to-show', () => window.show())

  if (isDev) {
    void window.loadURL(DEV_SERVER)
  } else {
    void window.loadFile(join(app.getAppPath(), 'dist', 'index.html'))
  }

  return window
}

/**
 * Set as soon as the sink exists. Registered before boot rather than inside it,
 * so a failure *during* boot — the store refusing to open, say — is recorded
 * rather than surfacing as an unhandled rejection with no context.
 */
let recorder: Diagnostics | null = null

process.on('uncaughtException', (err) => {
  recorder?.record({
    severity: 'error',
    code: 'app.uncaughtException',
    module: 'app',
    message: err.message,
    detail: { name: err.name },
  })
  console.error('[sillage] uncaught:', err)
})

process.on('unhandledRejection', (reason) => {
  recorder?.record({
    severity: 'error',
    code: 'app.unhandledRejection',
    module: 'app',
    message: reason instanceof Error ? reason.message : String(reason),
    detail: {},
  })
  console.error('[sillage] unhandled rejection:', reason)
})

/**
 * The rep's choice wins, but only while it is still usable.
 *
 * A provider chosen and then un-configured — the key deleted, the ChatGPT
 * session expired, the weights removed — falls back to the ranking rather than
 * pinning the app to something that cannot run. Silently honouring a dead choice
 * is how a meeting starts with no transcription and no explanation.
 *
 * Shared by the settings tables and by the two paths a meeting actually takes,
 * because those three answering differently is the bug this whole file exists to
 * not have: the screen would name one engine and the meeting would use another.
 */
const chosen = (choice: string | null, configured: readonly string[], ranked: string | null) =>
  choice !== null && configured.includes(choice) ? choice : ranked

/**
 * Which model, if any. Selection lives in `modules/llm/registry.ts` — this only
 * turns its answer into an adapter.
 *
 * **Resolved per use, and reading the vault.** It used to be neither, and both
 * were the same mistake made twice: it called `configuredLlmProviders()` with no
 * argument, so it saw the environment and never the credential store, and it ran
 * once at boot, so it could not have noticed a key arriving anyway. Between them
 * they made the entire *Modèle de langage* pane decorative — a rep could paste a
 * key, watch the row light up, pick a provider, and get an extraction from
 * whatever the environment happened to hold, or from nothing at all.
 */
const resolveLlm = (
  context: SettingsContext,
  diagnostics: DiagRecorder,
): { port: OpenAiCompatibleLlm; id: string } | null => {
  const stored = context.credentials.keys()
  const fields = providerFieldValues(LLM_PROVIDERS, context)
  const configured = configuredLlmProviders({ stored, fields })
  const selection = selectLlm({ configured })
  const id = chosen(context.preferences.provider('llm'), configured, selection.ok ? selection.id : null)
  if (id === null) return null

  const endpoint = llmEndpointFor(id, { stored, fields })
  if (!endpoint) return null

  return {
    id,
    port: new OpenAiCompatibleLlm({
      endpoint,
      structuredOutput: descriptorFor(id)?.structuredOutput ?? false,
      diagnostics,
    }),
  }
}

/** v1 asks for one locale and never detects (DEC-22). */
const LANGUAGE = 'fr-FR'

/**
 * The three tables Réglages renders (DEC-33, DEC-34, DEC-35).
 *
 * **Recomputed on every read, not resolved once at boot.** It used to be a
 * boot-time snapshot, and the reasoning was sound while it lasted: credentials
 * came from the environment, and an environment variable cannot appear without
 * a restart. DEC-34 ended that. A rep can now paste a key, and a screen that
 * answered from a table built before they did would show them their own save
 * having no effect.
 *
 * What survives is that every provider is in the table, configured or not,
 * saying where it runs — a provider dropped from the list is indistinguishable
 * from a key that never registered.
 */
/**
 * What is in every provider's declared fields, keyed by provider then field
 * (DEC-34).
 *
 * Built from the *registry's* declaration rather than by scanning the store, so
 * a key some earlier version wrote and this one no longer declares is simply not
 * read — the alternative is a value that persists, renders nowhere and confuses
 * whoever finds it in the database.
 */
const providerFieldValues = (
  descriptors: readonly { id: string; fields?: readonly { key: string }[] | undefined }[],
  context: SettingsContext,
): Record<string, Record<string, string>> => {
  const out: Record<string, Record<string, string>> = {}
  for (const descriptor of descriptors) {
    if (!descriptor.fields?.length) continue
    out[descriptor.id] = context.preferences.fields(
      descriptor.id,
      descriptor.fields.map((field) => field.key),
    )
  }
  return out
}

const resolveProviders = (context: SettingsContext): ProviderTables => {
  // The vault is read once per call and handed to both registries as data, so
  // this is the only place in the process that touches a secret store on the
  // settings path. The modules stay pure functions of what they are given.
  const stored = context.credentials.keys()
  const sttFields = providerFieldValues(STT_PROVIDERS, context)
  const llmFields = providerFieldValues(LLM_PROVIDERS, context)

  // "Configured" means something different per tier, and the difference is not
  // cosmetic: for a cloud provider it is a stored key, for the local engine it
  // is the weights being on disk *for the dtype this machine will ask for*.
  // `usableSttProviders` is the one place that reconciles the two, so this
  // panel cannot name a different engine from the one a meeting would run on.
  const stt = usableSttProviders({ stored, fields: sttFields })
  const sttChoice = context.preferences.provider('stt')
  const sttSelection = selectProvider({
    configured: stt,
    language: LANGUAGE,
    offlineOnly: offlineOnlyStt(),
    preferCloud: preferCloudStt(),
  })

  const llm = configuredLlmProviders({ stored, fields: llmFields })
  const llmChoice = context.preferences.provider('llm')
  const llmSelection = selectLlm({ configured: llm })

  return {
    stt: providerSection(STT_PROVIDERS, {
      configured: stt,
      credentials: context.credentials.states(),
      values: sttFields,
      selected: chosen(sttChoice, stt, sttSelection.ok ? sttSelection.id : null),
      reason: sttSelection.ok ? null : sttSelection.reason,
    }),
    llm: providerSection(LLM_PROVIDERS, {
      configured: llm,
      credentials: context.credentials.states(),
      values: llmFields,
      // The ChatGPT row's diagnosis, which the module owns and this file must
      // not paraphrase: an absent grant, an expired one and a Codex installed
      // in API-key mode are three different sentences with three different
      // remedies (DEC-36).
      reasons: llmRefusalReasons(),
      selected: chosen(llmChoice, llm, llmSelection.ok ? llmSelection.id : null),
      reason: llmSelection.ok ? null : llmSelection.reason,
    }),
    models: modelSection(MODELS, {
      bundledId: DEFAULT_MODEL_ID,
      ready: context.downloads.ready(MODELS),
      activity: context.downloads.state(),
      preferred: context.preferences.model(),
    }),
  }
}

/**
 * Screen 0's audio line (DEC-30), and why it is a probe rather than a device
 * count.
 *
 * `CaptureSession.probe()` calls `abiProbe` for real across the native binary.
 * That is not a formality: it is the only thing that tells a loadable `.node`
 * apart from the asar JS stub, whose symptom — documented at the top of
 * `modules/capture/nativeModule.ts` — is "no audio devices, no capture, and no
 * error anyone could act on". It is exactly the failure a splash exists to
 * name, and it costs one pure function call.
 *
 * **What this deliberately does not do is enumerate.** Two reasons, and both
 * are in the code rather than in an opinion:
 *
 *  · `getInputDevices()` instantiates `cpal::default_host()`, which registers
 *    the process with the CoreAudio HAL and lights the orange
 *    microphone-in-use indicator in the macOS menu bar — at app launch, with no
 *    meeting running. `AudioDevices.ts` and `native-module/src/lib.rs` both
 *    carry that note because it was a shipped bug; `abiProbe` exists precisely
 *    so a boot-time capability check does not have to pay it.
 *  · The count would not mean what it appears to. `list_input_devices` pushes a
 *    synthetic `("default", "Default Microphone")` before it enumerates
 *    anything, so the input count is never zero even on a machine with no
 *    microphone, and `list_output_devices` returns an empty vector by
 *    construction on Linux. « 1 entrée » would be a number that reads as a
 *    measurement and is not one.
 *
 * So the line reports what was actually established. The devices themselves are
 * opened when a meeting starts, which is where a real count exists and where
 * `CaptureSession` already publishes `capture` health from opening them.
 */
const audioBootStep = (health: ConnectorHealth): BootStep =>
  health.state === 'ok'
    ? { state: 'ready', value: 'moteur de capture chargé' }
    : { state: 'failed', value: health.reason }

/**
 * Screen 0's transcription line: which engine a meeting started right now would
 * run on, named with the registry's own label.
 *
 * Composed from the section `resolveProviders()` already built, so the splash,
 * Réglages and the meeting cannot name three different engines. Nothing here
 * touches the network — `usableSttProviders()` reads the environment and the
 * disk, which is the whole reason this line can be answered before the window
 * opens (DEC-26).
 *
 * DEC-30: when the answer is `local-whisper` the value is « Whisper (local) »,
 * the registry's label, and it is stated exactly as a cloud engine would be.
 * There is no adjective on this line in either direction.
 */
const transcriptionBootStep = (stt: ProviderSection): BootStep => {
  if (stt.selected === null) {
    return { state: 'failed', value: stt.reason ?? 'aucun moteur de transcription disponible' }
  }
  const row = stt.rows.find((candidate) => candidate.id === stt.selected)
  return { state: 'ready', value: row?.label ?? stt.selected }
}

/** The sentence a rep reads in the health strip. Never "erreur LLM". */
const llmUnavailableReason = (context: SettingsContext): string => {
  const selection = selectLlm({
    configured: configuredLlmProviders({
      stored: context.credentials.keys(),
      fields: providerFieldValues(LLM_PROVIDERS, context),
    }),
  })
  return selection.ok ? 'modèle indisponible' : selection.reason
}

/**
 * What an extraction outcome says about the *model*, which is not the same as
 * what it says about the extraction.
 *
 * Boot health answered "is a model configured" once and then never changed, so
 * a key that expired at 14h and a provider that started returning 503s both
 * left the strip reading `ok`. DEC-26 names "LLM down" as a state a rep has to
 * be able to see.
 *
 * The kinds are not interchangeable and collapsing them would produce a strip
 * that lies in a new way instead of the old one:
 *
 *  - `llm`               the provider itself failed. Its `cause` is the
 *                        `LlmError`, so `llmHealth` reads the real reason —
 *                        auth is not retryable, a quota is.
 *  - `reply-invalid` /   the provider answered. What came back was unusable,
 *    `deterministic-leak` which is degraded-with-a-real-retry, not down: a
 *                        regeneration is the remedy and the button must work.
 *  - `empty-transcript`  not a model failure at all — nothing was ever sent.
 *                        Reporting it against the model would point the rep at
 *                        the wrong subsystem, and the honest one is capture.
 */
const llmHealthFromOutcome = (error: unknown | null, at: number): ConnectorHealth | null => {
  if (error === null) return { state: 'ok' }

  if (error instanceof ExtractionError) {
    switch (error.kind) {
      case 'llm':
        return llmHealth(error.cause ?? error, at)
      case 'reply-invalid':
      case 'deterministic-leak':
        return {
          state: 'degraded',
          reason: 'réponse du modèle inutilisable — une régénération peut suffire',
          since: at,
          retryable: true,
        }
      case 'empty-transcript':
        // Nothing to say about the model. `null` leaves the strip as it was
        // rather than inventing a verdict from a run that never happened.
        return null
    }
  }

  return llmHealth(error, at)
}

/**
 * A `MeetingContext` for a meeting that never had one.
 *
 * A manually started session has no invite, so there is no organiser, no
 * attendee list and no scheduled window — and inventing any of them would be
 * exactly the DEC-7 violation the extraction refuses. Everything interpretive
 * still comes from the transcript; this only carries the two things the rep
 * actually told us.
 */
const manualContext = (meeting: Meeting): MeetingContext => ({
  eventId: null,
  subject: meeting.title,
  agenda: '',
  organizer: { name: '', email: '', type: 'required', response: 'organizer' },
  attendees: [],
  onlineMeetingJoinUrl: null,
  categories: [],
  sensitivity: 'normal',
  scheduledStart: meeting.startedAt ?? meeting.createdAt,
  scheduledEnd: meeting.endedAt ?? meeting.updatedAt,
  seriesMasterId: null,
  timeZone: 'Europe/Paris',
})

/**
 * Async since DEC-34: reading the OS credential store is a real I/O hop, and
 * the answer decides which providers are configured — therefore which engine
 * the splash names, therefore what a meeting would run on. Doing it after the
 * window opened would mean the first frame showed a table that was about to
 * change.
 */
const boot = async (): Promise<void> => {
  const dbPath = join(app.getPath('userData'), DB_FILENAME)
  const store = new Store(dbPath)

  const diagnostics = new Diagnostics(store, { environment: environment() })
  recorder = diagnostics
  // Rolling purge, on boot. Diagnostics only — the WHERE clause in the store
  // makes it impossible for this to reach meeting content (DEC-27).
  const purged = diagnostics.purge()

  const broadcast: Broadcaster = (channel, payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }

  // ── Screen 0 (DEC-30) ────────────────────────────────────────────────────
  //
  // Three lines, and every one of them is answered by work that happens right
  // here. Nothing optional is asked: the calendar, VerySwing and Outlook are
  // wired further down and connect in the background, and none of them has a
  // field on `BootState` to report into (DEC-26).
  //
  // Two honest properties of this screen, stated because they decide how it
  // should be read:
  //
  //  · **`store` is never observably `pending`.** The store is constructed
  //    synchronously above and `boot()` throws out to `app.exit(1)` if it
  //    refuses, so by the time a renderer exists there is no third answer. The
  //    line is drawn anyway because it names the file and the schema version
  //    the app is running against, which is the first thing anyone asks on a
  //    support call and is not otherwise on screen anywhere.
  //  · **Neither is `devices` or `transcription`.** Both are synchronous —
  //    an ABI call and a disk check — and both are resolved before
  //    `createWindow()`. So the splash reports rather than waits, and the one
  //    state that would make it wait, `downloading`, is not emitted by anything
  //    yet: the weights ship inside the installer. That is stated in
  //    `core/contracts/boot.ts` and the alternative was a progress bar wired to
  //    a timer.
  let bootState: BootState = {
    store: { state: 'pending' },
    devices: { state: 'pending' },
    transcription: { state: 'pending' },
    version: app.getVersion(),
  }

  /**
   * Answers one step and republishes the whole state. Whole rather than a patch
   * because three fields are cheaper to send than to reconcile, and a splash
   * merging partial updates is a splash that can show a step going backwards.
   */
  const publishBoot = (patch: Partial<BootState>): void => {
    bootState = { ...bootState, ...patch }
    broadcast('boot:changed', bootState)
  }

  /*
   * The rep's fact, not the file's. This used to publish
   * `${DB_FILENAME} · schéma v${SCHEMA_VERSION}` — « sillage.db · schéma v3 »
   * — so the retired product's name was the first sentence Sillage said about
   * itself, on the one screen a new rep watches with undivided attention.
   * CLAUDE.md's carve-out for the old identifiers covers code, not user-facing
   * strings. The filename and schema belong in Réglages → Diagnostics, where a
   * support bundle is assembled.
   */
  publishBoot({ store: { state: 'ready', value: 'ouverte · sur cette machine' } })

  // Held, because it is also the honest seed for `capture` health further down.
  // The orchestrator seeds that connector `ok` at construction, so on a machine
  // whose native binary will not load the header status control (DEC-32) reads
  // « Tout fonctionne » until the rep starts a meeting and finds out.
  const audio = CaptureSession.probe()
  publishBoot({ devices: audioBootStep(audio) })

  // ── The settings surface (DEC-34, DEC-35) ────────────────────────────────
  //
  // The vault comes first because everything downstream reads through it: which
  // providers are configured, therefore which engine the splash names, therefore
  // what a meeting would run on.
  //
  // `memoryVault` when keytar will not load is the documented degradation and
  // the only sane one — a headless CI box, a Linux session with no keyring. The
  // cost is that keys are forgotten on exit, which is visible, and that is the
  // point: writing them somewhere less safe to avoid the inconvenience is how a
  // credential ends up in a file a `cat` away.
  let vault
  try {
    vault = keychainVault()
    await vault.get(credentialKeyFor('probe'))
  } catch (error) {
    vault = memoryVault()
    diagnostics.record({
      severity: 'warn',
      code: 'settings.vaultUnavailable',
      module: 'app',
      message: 'coffre-fort système indisponible — les clés seront oubliées à la fermeture',
      detail: { reason: error instanceof Error ? error.message : String(error) },
    })
  }

  const credentials = new CredentialCache({
    vault,
    providerIds: [...STT_PROVIDERS, ...LLM_PROVIDERS].map((provider) => provider.id),
  })
  await credentials.load()

  const downloads = new ModelDownloads({
    // The **writable** directory, not whichever one happens to hold the bundled
    // checkpoint: `resolveModelsDir` prefers `resources/` when it has content,
    // and a download that targeted the app bundle would fail on Windows under
    // Program Files and succeed-then-vanish on macOS after an update.
    modelsDir: join(app.getPath('userData'), 'whisper-models'),
    dtype: resolveInferenceConfig().dtype,
    executionProviders: resolveInferenceConfig().executionProviders,
    spawn: (modelId) => spawnDownloadWorker(modelId),
    onChange: (id, activity) => {
      // Bug 1 from the deleted service: this goes to every window, not to the
      // one that asked. Closing the settings overlay mid-download must not
      // silence the progress it started.
      broadcast('models:progress', {
        id,
        status: activity.status,
        progress: activity.progress,
        reason: activity.reason,
      })
    },
  })

  const settings: SettingsContext = {
    credentials,
    preferences: new ProviderPreferenceStore(store.appState),
    downloads,
  }

  // Resolved here rather than at `registerIpc`, so the splash and the Réglages
  // table are the same answer to the same question asked once. The *function*
  // is what IPC gets — see `resolveProviders` for why it stopped being a value.
  const providers = resolveProviders(settings)
  publishBoot({ transcription: transcriptionBootStep(providers.stt) })

  // ── The model, and the signal rail it feeds (steps 5 and 6) ──────────────
  //
  // Asked at the moment it is needed, not resolved once here. A null answer is
  // a stated degradation, not a failure — the transcript still scrolls, the
  // notepad still records, and the rail simply stays empty (DEC-26) — but it is
  // an answer that can now change while the app runs, because Réglages can
  // change it (DEC-34).
  const llm = () => resolveLlm(settings, diagnostics)
  const now = Date.now()

  /*
   * ── Self-update (DEC-26, DEC-32) ────────────────────────────────────────
   *
   * `null` outside a packaged app, and that is a statement rather than a
   * shortcut: an unpacked dev run has no `app-update.yml` to read, and letting
   * electron-updater discover that for itself produces an English exception on
   * every launch. The channels answer `disabled` on a null updater, so Réglages
   * still draws the panel and still names the running version.
   *
   * Constructed here, before the orchestrator, because the broadcast below
   * closes over both.
   */
  const updates: UpdatePort | null =
    app.isPackaged && !isPortableBuild()
      ? new AutoUpdate({ currentVersion: app.getVersion(), diagnostics })
      : null

  /**
   * Push the update panel's state to every window.
   *
   * Called on two different triggers, which is the whole reason it exists as a
   * function. The updater moving is the obvious one. The *session* moving is
   * the one that is easy to miss: `installable` is a fact about the meeting, so
   * a rep who finishes a call must see *Installer et redémarrer* become
   * available without reopening the screen — and one who starts a call must see
   * it go away.
   */
  const publishUpdateStatus = (): void => {
    broadcast('update:changed', updateStatus(updates, orchestrator.liveStates(), app.getVersion()))
  }
  updates?.onChanged(publishUpdateStatus)

  /*
   * The background loop. Two timers, both cleared on quit.
   *
   * The first check is deliberately a minute late. Boot has just spent several
   * seconds of CPU loading the Whisper checkpoint (`prewarmLocalEngine`), and
   * the rep may already be arming a call; a network round trip competing with
   * that buys nothing, because an update that appeared this morning will still
   * be there in sixty seconds.
   *
   * Every tick asks the gate twice — once before checking, once again before
   * downloading — rather than once. They are seconds apart and a meeting can
   * start in between, and the second one is the expensive question: the check
   * is a few kilobytes of YAML, the download is most of half a gigabyte.
   */
  let firstUpdateCheck: ReturnType<typeof setTimeout> | null = null
  let updateLoop: ReturnType<typeof setInterval> | null = null

  const stopUpdateChecks = (): void => {
    if (firstUpdateCheck) clearTimeout(firstUpdateCheck)
    if (updateLoop) clearInterval(updateLoop)
    firstUpdateCheck = null
    updateLoop = null
  }

  const updateTick = async (): Promise<void> => {
    if (!updates) return
    if (!updateReadiness(orchestrator.liveStates()).safe) return
    const state = await updates.check()
    if (state.phase !== 'available') return
    if (!updateReadiness(orchestrator.liveStates()).safe) return
    await updates.download()
  }

  const startUpdateChecks = (): void => {
    if (!updates) return
    firstUpdateCheck = setTimeout(() => void updateTick(), FIRST_UPDATE_CHECK_MS)
    updateLoop = setInterval(() => void updateTick(), UPDATE_CHECK_INTERVAL_MS)
  }

  // Built before the orchestrator so `onEnded` can close over it. `identity` is
  // assigned further down and read lazily, which is why `repEmail` is a
  // function: a rep can sign in after the app has booted.
  const enhancement = new Enhancement({
    recipe: () => {
      const model = llm()
      return model ? new CompteRenduRecipe({ llm: model.port, diagnostics }) : null
    },
    repEmail: () => identity?.account()?.username ?? null,
    // The id only — `enhancementStatus` below composes the answer, and it is
    // the same function the `enhancement:status` read uses.
    onStatus: (meetingId) => {
      broadcast('enhancement:status', { meetingId, status: enhancementStatus(meetingId) })
    },
    // Through the orchestrator, so `extracting` and `awaiting_confirmation`
    // are broadcast — the two states the review gate is built on.
    dispatch: (meetingId, command, reason) => orchestrator.dispatch(meetingId, command, reason),
    // Boot answered "is a model configured" once. This is what keeps answering
    // after a key expires or a provider starts returning 503s (DEC-26).
    onOutcome: (error) => {
      const health = llmHealthFromOutcome(error, Date.now())
      if (health) orchestrator.setHealth('llm', health)
    },
    diagnostics,
  })

  const orchestrator: Orchestrator = new Orchestrator(store, {
    diagnostics,
    /*
     * The plain broadcast, plus one derived one.
     *
     * A session transition changes the answer to "may this install now" without
     * changing anything the updater knows, so `update:changed` has to be
     * re-derived here. Wrapping the broadcaster is what guarantees it: every
     * transition goes through `session:changed`, so there is no path that moves
     * the machine and forgets to refresh the gate.
     */
    broadcast: (channel, payload) => {
      broadcast(channel, payload)
      if (channel === 'session:changed') publishUpdateStatus()
    },
    // Asked once per meeting, at the moment it starts — so a key added between
    // two meetings takes effect on the second one rather than at the next
    // launch. Not asked again *during* a meeting: swapping the provider under a
    // running signal rail would leave half its output from one model.
    createSignals: ({ existing, onSignal }) => {
      const model = llm()
      return model ? new SignalExtractor({ llm: model.port, onSignal, diagnostics, existing }) : null
    },
    recordingOptionsFor,
    /**
     * DEC-17's cheap half. The shipped ESN list costs nothing until a term
     * actually matches, which is why it earns its keep here rather than in the
     * prompt — generic vocabulary in a Whisper prompt dilutes the terms that
     * matter and, measurably, inserts itself.
     */
    correctorFor: (meetingId) => {
      const meeting = store.projections.getMeeting(meetingId)
      const stored = store.lexicon.forClient(meeting?.clientName ?? null)
      return (text) =>
        correctWithLexicon(
          text,
          stored.map((t) => ({ term: t.term, category: t.category, variants: t.variants })),
        )
    },
    // Said at the top of the end-of-meeting path, not at the model call. The
    // transcriber flush sits between the two, and `ended` draws no control — so
    // without this the rep presses *Terminer* and the screen goes blank for the
    // length of the flush (DEC-39).
    onEnding: (meetingId) => enhancement.begin(meetingId),
    onEnded: async (meetingId) => {
      const session = orchestrator.session(meetingId)
      if (!session) return
      const meeting = store.projections.getMeeting(meetingId)
      if (!meeting) return

      /*
       * The model reads the de-duplicated transcript; the store keeps all of
       * it. On a laptop with its speakers on, the microphone hears the far end
       * and the client is transcribed twice — once correctly on `far`, once as
       * the rep. Measured on a real call: three of five far utterances came
       * back on the rep channel at up to 91 % word overlap, which turns the
       * prompt's « (commercial) / (client) » marker from a measurement into a
       * wrong one, and mis-attributes objections and commitments that end up in
       * the CRM.
       *
       * Filtered here rather than in the store, because the transcript is the
       * record: DEC-21 verifies citations against the stored segments, and
       * `[source ▸]` points at them. A segment hidden from the model is still
       * there to verify against.
       */
      const stored = store.projections.segments(meetingId)
      const transcript = withoutChannelBleed(stored)

      const bleed = bleedReport(stored)
      if (bleed.dropped > 0) {
        // Said out loud, because the real fix is a headset and nobody discovers
        // that from a compte-rendu that is quietly correct.
        //
        // What this counts changed with DEC-42. The native module now cancels
        // the echo before transcription, so anything still arriving here is the
        // *residue* — mostly the double-talk stretches, where the canceller
        // ducks the rep by ~9 dB rather than erasing them and some of the
        // client's words survive on both channels. A count that is still large
        // is therefore not a room problem, it is a sign that cancellation is not
        // running at all: check the `[EchoCanceller]` lines in the native log
        // for the reference depth and the starved-frame count.
        diagnostics.record({
          severity: 'warn',
          code: 'capture.channelBleed',
          module: 'app',
          message: `${bleed.dropped} passage(s) du client repris sur le micro du commercial — enceintes ouvertes, résidu que l'annulation d'écho n'a pas absorbé ; un casque supprime le problème`,
          detail: { meetingId, dropped: bleed.dropped, repSegments: bleed.repSegments },
        })
      }

      await enhancement.run({
        session,
        // A manually started meeting has no calendar entry, so the context is
        // synthesised from what the rep typed. `eventId: null` is the whole
        // point of DEC-15's nullable id — everything downstream accepts it.
        context: store.projections.context(meetingId) ?? manualContext(meeting),
        // Read here rather than held anywhere, and read on every run: this path
        // serves the end of the meeting *and* a regeneration the rep asked for
        // after switching the picker, and only the second one has a different
        // answer than it did a minute ago (DEC-43).
        recipe: store.projections.recipe(meetingId),
        transcript,
        notes: documentToText(store.projections.document(meetingId)?.doc ?? null),
      })

      /*
       * The compounding half of the lexicon, and the only moment it can happen:
       * the client name is what scopes a learned term, and it is not known
       * until the extraction has resolved it.
       *
       * Nothing is hand-curated and nothing is asked of the rep — the terms are
       * the surnames and project names already on the invite. Writing them
       * under this client's scope is what makes the *second* meeting with them
       * start already boosted.
       */
      const after = store.projections.getMeeting(meetingId)
      const learned = termsLearnedFrom(
        store.projections.context(meetingId),
        after?.clientName ?? null,
      )
      if (learned.length > 0) {
        store.lexicon.addAll(learned)
        diagnostics.record({
          severity: 'info',
          code: 'lexicon.learned',
          module: 'app',
          message: `${learned.length} terme(s) appris pour ${after?.clientName}`,
          detail: { meetingId, terms: learned.length },
        })
      }
    },
  })

  /**
   * The one implementation of "where has this meeting's compte-rendu got to",
   * read by the IPC channel and pushed by the broadcast.
   *
   * `Enhancement` supplies what it has attempted; this supplies the two facts it
   * is not allowed to know — the meeting's state, which lives in the store, and
   * whether a model is configured *right now*, which is a question about the
   * credential vault and is asked per call for the reason every other read path
   * in this file asks it per call: a rep who adds a key in Réglages must not
   * have to restart before the app agrees.
   */
  const enhancementStatus = (meetingId: string): EnhancementStatus => {
    const meeting = store.projections.getMeeting(meetingId)
    if (!meeting) return { status: 'idle' }
    return enhancement.statusOf(meetingId, meeting.state, llm() !== null)
  }

  /**
   * Run the extraction for a meeting that has ended without one.
   *
   * `onEnded` and not `enhancement.run` directly: gathering the transcript, the
   * context and the rep's notes is the same job whichever way the run is
   * reached, and a second copy of it here is a second place for a retry to
   * quietly analyse less material than the first attempt did.
   */
  const runEnhancement = async (meetingId: string): Promise<void> => {
    // A meeting stranded in `extracting` is freed first, or this does nothing
    // at all: `extract` is not legal from `extracting`, so `Enhancement` would
    // dispatch, be refused, and return — the button would click and the screen
    // would not move. This is the second of the two places that call
    // `reconcile`; the first is boot, and it catches the overwhelming majority.
    // This one catches the meeting whose run vanished during *this* session.
    const meeting = store.projections.getMeeting(meetingId)
    if (meeting) enhancement.reconcile(meetingId, meeting.state)
    await orchestrator.enhance(meetingId)
  }

  /**
   * A model just became available — keep the promise the notice made.
   *
   * Called after every write in Réglages, because « il sera généré dès qu'un
   * modèle sera disponible » is a sentence the product has to be able to cash.
   * Bounded by construction: the set only ever holds meetings that ended during
   * this run of the app *and* found no model, which is a handful at worst, and a
   * meeting drops out of it the moment an attempt starts.
   */
  const drainDeferredEnhancements = (): void => {
    if (llm() === null) return
    for (const meetingId of enhancement.deferred()) void runEnhancement(meetingId)
  }

  /*
   * The same answer screen 0 draws, on the connector board.
   *
   * The orchestrator seeds `capture: { state: 'ok' }` at construction, which is
   * optimism rather than a measurement: on a machine whose native binary will
   * not load, the header status control (DEC-32) read « Tout fonctionne » until
   * a rep pressed *Démarrer* and the meeting failed. This is the one boot-time
   * fact about audio that can be established without opening a device, and it
   * is the one that decides whether a meeting can be recorded at all.
   */
  orchestrator.setHealth('capture', audio)

  orchestrator.setHealth(
    'llm',
    llm() !== null
      ? { state: 'ok' }
      : {
          state: 'down',
          reason: llmUnavailableReason(settings),
          since: now,
          // Nothing to retry: the reason is a provider nobody has configured,
          // and waiting does not configure one. DEC-26 forbids the button that
          // does nothing more than it forbids the silent failure. What *does*
          // fix it is Réglages, and `settings:setCredential` re-reads this.
          retryable: false,
        },
  )

  // ── Identity and calendar (step 3) ───────────────────────────────────────
  // Both are optional at runtime. Without an Entra registration the app is a
  // notepad that has to be started by hand, which is a stated degradation
  // (DEC-26: "Graph down → manual start, no arming"), not a failure to boot.
  const identityConfig = resolveIdentityConfig()
  let identity: MsalIdentity | null = null
  let agenda: Agenda | null = null

  if (!identityConfig) {
    orchestrator.setHealth('calendar', {
      state: 'down',
      // Written for a rep, in the screen they read it in. The name of an
      // environment variable belongs in a diagnostics bundle, not in
      // *Réglages → Facultatifs* — and `retryable: false` because there is
      // nothing here for a *Réessayer* to do (DEC-26).
      reason: 'aucune application Microsoft configurée — le calendrier reste vide',
      since: Date.now(),
      retryable: false,
    })
  } else {
    identity = createIdentity({
      config: identityConfig,
      // The *system* browser, so the rep signs in where their session and any
      // conditional-access enrolment already live.
      openBrowser: (url) => shell.openExternal(url),
      state: store.appState,
      diagnostics,
    })

    const calendar = new GraphCalendar({ identity, state: store.appState, diagnostics })
    const meetingApps = new MeetingApps()

    agenda = new Agenda({
      calendar,
      orchestrator,
      meetingAudio: () => meetingApps.current(),
      refreshMeetingAudio: () => meetingApps.refresh(),
      diagnostics,
      healthFor: calendarHealth,
      onHealth: (health) => orchestrator.setHealth('calendar', health),
      onChanged: (snapshot) => broadcast('agenda:changed', snapshot),
    })

    orchestrator.registerRetry('calendar', async () => {
      await calendar.sync()
      return { state: 'ok' }
    })
  }

  // ── The push side: VSA, Outlook drafts, and the outbox that drains both ──
  //
  // Each is independently optional, which is the whole of DEC-26 here: VSA
  // unconfigured must not stop the Outlook draft, and Microsoft not connected
  // must not stop the CRM push. The outbox takes both as nullable ports and
  // drains whatever it has.
  const vsa = vsaConfig()
  const crm = vsa ? new VsaCrm({ config: vsa, diagnostics }) : null
  const mail = identity ? new OutlookMail({ identity, diagnostics }) : null

  orchestrator.setHealth(
    'crm',
    crm
      ? { state: 'ok' }
      : {
          state: 'down',
          reason: `VerySwing non configuré (${missingVsaSettings().join(', ')})`,
          since: now,
          retryable: false,
        },
  )
  orchestrator.setHealth(
    'mail',
    mail
      ? { state: 'ok' }
      : {
          state: 'down',
          // `mail` is null exactly when there is no registration — `identity`
          // is built from the config, not from a sign-in — so "non connecté"
          // was inviting a rep to connect something that does not exist.
          reason: 'aucune application Microsoft configurée — le brouillon Outlook ne sera pas créé',
          since: now,
          retryable: false,
        },
  )

  const outbox = new Outbox({ journal: store, crm, mail, diagnostics })

  /**
   * Everything a meeting needs to start recording, resolved at the moment it
   * starts rather than at boot — because the boost terms depend on *which*
   * meeting it is (DEC-17).
   *
   * This is where the lexicon finally becomes reachable. The terms are the
   * attendee surnames, the company and the project names from the calendar
   * event, ahead of whatever previous meetings with this client already taught
   * the app (`store.lexicon.forClient`). The provider's descriptor decides
   * whether they can be used at all: a provider that cannot take hotwords must
   * not be handed them.
   */
  /**
   * Which local checkpoint a meeting would load.
   *
   * One function, two callers — `recordingOptionsFor` and the boot prewarm —
   * and that is the whole reason it exists. Prewarming a checkpoint the meeting
   * then declines to use would be worse than not prewarming at all: a
   * gigabyte held for a model nobody asked for, and the cold load still paid
   * when *Démarrer* is pressed. A second resolution path that reads the vault
   * slightly differently is exactly the decorative-settings bug this repo has
   * already had once.
   */
  function selectedLocalModel(
    stored: ReturnType<typeof credentials.keys>,
    fields: ReturnType<typeof providerFieldValues>,
  ): string | undefined {
    return (
      resolveSelectedModel({
        bundledId: DEFAULT_MODEL_ID,
        ready: downloads.ready(MODELS),
        preferred: settings.preferences.model(),
      }) ?? sttCredentialFor('local-whisper', { stored, fields })?.model
    )
  }

  /**
   * Load the local model now, so the first words of the first meeting are not
   * spent waiting for it.
   *
   * Measured before this existed: two channels each loaded their own copy of
   * the same weights, 15.2 s and 2.1 GB. The engine now shares one load
   * (`whisper/engine.ts`), and this pulls what remains of it off the meeting
   * path entirely — a 70-second test recording produced its first line at
   * 38.8 s, almost all of it this.
   *
   * Deliberately *not* awaited and deliberately silent. DEC-26: the capture
   * path has zero network dependencies and nothing downstream may stop a
   * meeting being recorded — least of all an optimisation. A prewarm that fails
   * leaves the meeting path to load the model the old way and report its own
   * failure where a rep can see it, which is the only place that report means
   * anything.
   */
  function prewarmLocalEngine(): void {
    const model = selectedLocalModel(credentials.keys(), providerFieldValues(STT_PROVIDERS, settings))
    if (!isLocalWhisperReady(model)) {
      diagnostics.record({
        severity: 'info',
        code: 'transcribe.prewarm.skipped',
        module: 'transcribe',
        message: 'modèle local absent — pas de préchargement',
        detail: { model: model ?? DEFAULT_MODEL_ID },
      })
      return
    }

    // Recorded, not swallowed. The first version of this returned a promise
    // whose rejection went nowhere, on the grounds that DEC-26 forbids an
    // optimisation from breaking a meeting — which is true, and which is not
    // the same as making it invisible. It failed on the first real launch and
    // the only evidence was a process that never grew, so there was nothing to
    // read and nothing to fix. Not blocking the app and not reporting are two
    // different decisions; only the first one was intended.
    const started = Date.now()
    void prewarmEngine(model === undefined ? {} : { model }).then(
      () => {
        diagnostics.record({
          severity: 'info',
          code: 'transcribe.prewarm.ready',
          module: 'transcribe',
          message: `modèle local préchargé en ${((Date.now() - started) / 1000).toFixed(1)} s`,
          detail: { model: model ?? DEFAULT_MODEL_ID, ms: Date.now() - started },
        })
      },
      (error: unknown) => {
        diagnostics.record({
          severity: 'warn',
          code: 'transcribe.prewarm.failed',
          module: 'transcribe',
          message: 'préchargement du modèle local impossible — la réunion le chargera',
          detail: {
            model: model ?? DEFAULT_MODEL_ID,
            error: error instanceof Error ? error.message : String(error),
          },
        })
      },
    )
  }

  function recordingOptionsFor(meetingId: string) {
    // The vault, and the rep's choice, on the path a meeting actually takes.
    // Both used to be missing here: `usableSttProviders()` was called with no
    // argument, so it saw the environment and never the credential store, and
    // the preference was read only when drawing the settings table. A rep could
    // therefore paste an ElevenLabs key, press *Utiliser*, watch the row say
    // « Utilisé », and record the meeting on a different engine (DEC-34).
    const stored = credentials.keys()
    const fields = providerFieldValues(STT_PROVIDERS, settings)
    const configured = usableSttProviders({ stored, fields })
    const selection = selectProvider({
      configured,
      language: 'fr-FR',
      offlineOnly: offlineOnlyStt(),
      preferCloud: preferCloudStt(),
    })
    const providerId = chosen(
      settings.preferences.provider('stt'),
      configured,
      selection.ok ? selection.id : null,
    )
    if (providerId === null) {
      orchestrator.setHealth('transcribe', {
        state: 'down',
        reason: selection.ok ? 'aucun moteur de transcription disponible' : selection.reason,
        since: Date.now(),
        retryable: false,
      })
      return null
    }

    const credential = sttCredentialFor(providerId, { stored, fields })
    if (!credential) return null

    const meeting = store.projections.getMeeting(meetingId)
    const context = store.projections.context(meetingId)
    const boost = buildBoostSet(context, {
      capability: sttDescriptorFor(providerId)?.boost ?? 'none',
      stored: store.lexicon.forClient(meeting?.clientName ?? null),
    })

    orchestrator.setHealth('transcribe', { state: 'ok' })

    /*
     * Where a meeting goes when the cloud upgrade dies under it, named here
     * because this is where "is it actually on disk" can be asked. Only
     * reachable when the rep opted into a cloud engine — with the default
     * (DEC-30) the selection above already *is* `local-whisper` and there is
     * nothing to name.
     *
     * It matters because a cloud provider that dies at minute six otherwise
     * costs the rest of the meeting: capture keeps running (DEC-26) but the
     * audio is discarded as it is transcribed (DEC-12), so there is nothing
     * left to re-transcribe afterwards.
     *
     * Named only when the weights are cached for the dtype this machine will
     * ask for. An engine that has to be downloaded first rescues nothing — it
     * would start a several-hundred-megabyte transfer over the network that
     * just failed, during the meeting it exists to rescue.
     */
    /*
     * The checkpoint the rep chose in Réglages (DEC-35), resolved exactly as
     * the settings table resolves it — same function, same fallbacks — so the
     * row marked « Chargé » is the one a meeting loads. It used to be read
     * straight from `SILLAGE_WHISPER_MODEL`, which meant the whole model
     * table was a picker whose choice nothing consulted.
     *
     * `sttCredentialFor` remains underneath it for the case where nothing is on
     * disk yet: it carries the bundled default, and naming it keeps the engine
     * pointed at something rather than at nothing.
     */
    const localModel = selectedLocalModel(stored, fields)

    const fallback =
      providerId !== 'local-whisper' && isLocalWhisperReady(localModel)
        ? 'local-whisper'
        : undefined

    // `model` is one field for both engines, which is safe only because the
    // cloud providers ignore it — each has exactly one model behind its
    // endpoint. So when a fallback is named, the checkpoint travels with it —
    // and when the local engine *is* the selection, the rep's checkpoint wins
    // over whatever the credential reader defaulted to.
    const model =
      providerId === 'local-whisper'
        ? localModel
        : (credential.model ?? (fallback ? localModel : undefined))

    return {
      transcribe: {
        providerId,
        ...(fallback ? { fallbackProviderId: fallback } : {}),
        apiKey: credential.apiKey,
        language: 'fr-FR',
        ...(credential.region ? { region: credential.region } : {}),
        ...(model ? { model } : {}),
        ...(boost.terms.length > 0 ? { boostTerms: boost.terms } : {}),
      },
    }
  }

  /**
   * Drain, then report. The outbox already persists every failure; this turns
   * the last one of each kind into the sentence the health strip shows, so a
   * VSA outage is a line a rep can read rather than a row that silently is not
   * there yet.
   */
  const drain = (meetingId: string): void => {
    void outbox
      .drain(meetingId)
      .then((entries) => {
        const at = Date.now()
        const failed = entries.filter((entry) => entry.state !== 'drained' && entry.lastError)
        const crmFailure = failed.find((entry) => entry.kind.startsWith('crm.'))
        const mailFailure = failed.find((entry) => entry.kind === 'mail.draft')

        if (crm) {
          orchestrator.setHealth(
            'crm',
            crmFailure ? crmHealth(new Error(crmFailure.lastError ?? ''), at) : { state: 'ok' },
          )
        }
        if (mail) {
          orchestrator.setHealth(
            'mail',
            mailFailure ? mailHealth(new Error(mailFailure.lastError ?? ''), at) : { state: 'ok' },
          )
        }
      })
      .catch((error: unknown) => {
        diagnostics.record({
          severity: 'error',
          code: 'outbox.drain.failed',
          module: 'app',
          message: error instanceof Error ? error.message : 'envoi impossible',
          detail: { meetingId },
        })
      })
  }

  /**
   * The DEC-24 capability diff, run once at connect and re-run on *Réessayer*.
   *
   * Held in a variable rather than fetched on demand because the probe is six
   * network calls: Réglages opening must not cost them, and a rep who opens it
   * three times must not pay three times. `probeVsa` never throws, so the only
   * failure this has to model is "not finished yet" — which is a sentence, not
   * an absence (DEC-26).
   */
  let probe: CapabilityReport | null = null
  let probeReason: string | null = crm
    ? 'sonde en cours…'
    : `VerySwing non configuré (${missingVsaSettings().join(', ')})`

  const runProbe = (adapter: VsaCrm): void => {
    void adapter
      .probe()
      .then((report) => {
        probe = report
        probeReason = null
      })
      .catch((error: unknown) => {
        probeReason = error instanceof Error ? error.message : 'sonde impossible'
      })
  }

  if (crm) {
    runProbe(crm)
    orchestrator.registerRetry('crm', async () => {
      await crm.reconnect()
      runProbe(crm)
      return { state: 'ok' }
    })
  }

  /**
   * Anything left undrained by the last run.
   *
   * A crash between *Valider* and the push leaves rows `pending` — which is
   * exactly what the projection is for, and pointless unless something asks.
   * Without this the intents sit until the rep happens to confirm another
   * meeting, which is indistinguishable from having lost them.
   *
   * Deduplicated by meeting: `drain()` is per meeting and already single-flight,
   * so three pending intents for one call are one pass, not three.
   */
  for (const meetingId of new Set(store.projections.drainable().map((e) => e.meetingId))) {
    drain(meetingId)
  }

  /**
   * Anything the last run was still *writing*.
   *
   * The sibling of the drain above, and the more damaging of the two. A quit or
   * a crash while the model is being called leaves the meeting persisted in
   * `extracting` with no run behind it, and that state has no exit: the notice
   * says « Rédaction du compte-rendu… » and draws no control, the review gate
   * is closed with *Analyse en cours…*, and `extract` is illegal from
   * `extracting` so *Rédiger le compte-rendu* is refused before it starts. The
   * rep is left watching a sentence that will never change, on a call they
   * actually recorded. See `Enhancement.reconcile`.
   *
   * A wide window rather than the default page: a meeting stranded three weeks
   * ago is exactly the one nobody has managed to open since, and it costs one
   * indexed read per launch to free it.
   */
  const stranded = store.projections
    .listMeetings(500)
    .filter((meeting) => enhancement.reconcile(meeting.id, meeting.state))
  if (stranded.length > 0) {
    diagnostics.record({
      severity: 'warn',
      code: 'enhancement.interrupted.boot',
      module: 'app',
      message: `${stranded.length} compte(s)-rendu interrompus par un arrêt de l’application — remis en attente`,
      detail: { meetingIds: stranded.map((meeting) => meeting.id) },
    })
  }

  registerIpc(ipcMain, {
    drain,
    store,
    orchestrator,
    diagnostics,
    recorder: diagnostics,
    exportDirectory: app.getPath('downloads'),
    identity,
    agenda,
    // A function, not the value resolved above: a key stored from Réglages has
    // to change the very next read (DEC-34), and the boot-time table would have
    // shown the rep their own save doing nothing.
    providers: () => resolveProviders(settings),
    enhancementStatus,
    runEnhancement,
    // Every write in Réglages, because any of them can be the one that makes a
    // model usable — and a meeting is sitting in `ended` on the strength of the
    // promise that when one is, it will be analysed.
    onSettingsChanged: drainDeferredEnhancements,
    credentials: {
      set: (providerId, value) => credentials.set(providerId, value),
      clear: (providerId) => credentials.clear(providerId),
    },
    preferences: settings.preferences,
    models: {
      start: (modelId) => downloads.start(modelId),
      cancel: (modelId) => downloads.cancel(modelId),
      section: () => resolveProviders(settings).models,
    },
    capabilities: () => ({ report: probe, reason: probeReason }),
    // Read lazily: `boot:changed` and this channel must never disagree, and a
    // value captured here would freeze the state at registration time.
    bootState: () => bootState,
    updates,
    appVersion: app.getVersion(),
  })

  diagnostics.record({
    severity: 'info',
    code: 'app.boot',
    module: 'app',
    message: 'application démarrée',
    detail: { purgedDiagnostics: purged, dev: isDev },
  })

  app.on('before-quit', () => {
    agenda?.stop()
    stopUpdateChecks()
    store.close()
  })

  // Restore, then arm. Deliberately after `registerIpc`: the renderer may ask
  // for its state at any point during this, and an unregistered channel is an
  // error dialog rather than a "connexion…" placeholder.
  if (identity && agenda) {
    const signedIn = identity
    const loop = agenda
    void (async () => {
      const account = await signedIn.restore()
      broadcast('auth:changed', account ? { status: 'signedIn', account } : { status: 'signedOut' })
      // Signed out, the first tick still runs: it publishes an empty agenda with
      // a reason, which is what the sign-in prompt is rendered from.
      loop.start()
    })()
  }

  if (devRecord) {
    // No window on purpose: it would only load a dev server that does not exist
    // until step 5, and its "page failed to load" error is the loudest thing on
    // screen during a run whose whole output is text.
    runDevRecording({
      store,
      orchestrator,
      dbPath,
      onFinished: (code) => app.exit(code),
    })
    return
  }

  createWindow()

  // After the window, never before it: the load is several seconds of CPU and
  // the rep should be looking at the app while it happens, not at nothing.
  prewarmLocalEngine()

  // Last, and never awaited. Nothing about this app's job depends on it
  // (DEC-26), and a slow release feed must not delay a window that is already
  // on screen.
  startUpdateChecks()
}

app.on('second-instance', () => {
  const [existing] = BrowserWindow.getAllWindows()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
  }
})

app.on('window-all-closed', () => {
  // Windows is the primary platform (HR-2) and its convention is to quit.
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

void app.whenReady().then(async () => {
  try {
    await boot()
  } catch (err) {
    // Nothing works without the store, and a window showing an empty agenda is
    // a worse failure than an honest exit: the rep would believe their meetings
    // were gone.
    console.error('[sillage] boot failed:', err)
    app.exit(1)
  }
})
