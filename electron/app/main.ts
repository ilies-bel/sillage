/**
 * Boot. Deliberately short.
 *
 * The old `main.ts` was 7,869 lines and started roughly twenty subsystems. The
 * rule that keeps this one small: main opens the store, builds the diagnostics
 * sink and the orchestrator, registers IPC, and shows a window. Anything that
 * decides something belongs in `app/session/` or `core/domain/`.
 */
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Notification,
  powerMonitor,
  screen,
  shell,
  systemPreferences,
} from 'electron'
import { join } from 'node:path'
import { release } from 'node:os'
import { Worker } from 'node:worker_threads'
import { allowedByResidency } from '../core/domain/residency.ts'
import { updateTrust, type BuildTrust } from '../core/domain/updateTrust.ts'
import { Overlay, type OverlayWindowOptions } from './windows/Overlay.ts'
import { Store } from '../modules/store/index.ts'
import { DB_FILENAME } from '../modules/store/schema.ts'
import { Diagnostics } from '../modules/diagnostics/index.ts'
import { CaptureSession } from '../modules/capture/index.ts'
import {
  actionFor,
  capturePermissionHealth,
  capturePermissionView,
  type AccessStatus,
  type CaptureAccess,
} from '../core/domain/capturePermission.ts'
import type { CapturePermission } from '../core/contracts/permissions.ts'
import {
  ESSAI_LAST_KEY,
  ESSAI_MEETING_ID,
  ESSAI_SECONDS,
  EssaiRecordSchema,
  essaiHealth,
  type EssaiResult,
} from '../core/contracts/essai.ts'
import { SPEECH_FLOOR } from '../core/domain/inputLevel.ts'

/** The trial's meter tick. The same cadence `Recording` draws a meeting's at. */
const ESSAI_POLL_MS = 100
import { MeetingApps } from '../modules/capture/MeetingApps.ts'
import { getMicHoldingApps } from '../modules/capture/AudioDevices.ts'
import { EMPTY_WINDOW, type CalendarPort } from '../core/contracts/calendar.ts'
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
import { MAIL_SCOPES, OutlookMail, mailHealth } from '../modules/mail/index.ts'
import { Outbox } from './session/Outbox.ts'
import { CompteRenduRecipe, ExtractionError } from '../modules/extract/index.ts'
import { documentToText } from '../core/domain/documentText.ts'
import { bleedReport, withoutChannelBleed } from '../core/domain/channelBleed.ts'
import { providerSection } from '../core/domain/providerRows.ts'
import { Enhancement } from './session/Enhancement.ts'
import { Orchestrator, type Broadcaster } from './session/Orchestrator.ts'
import { Agenda } from './session/Agenda.ts'
import { watchPower } from './session/PowerWatch.ts'
import { registerIpc, updateStatus } from './ipc/register.ts'
import { AutoUpdate } from '../modules/update/index.ts'
import { updateReadiness } from '../core/domain/updateGate.ts'
import type { PushIntentKind } from '../core/contracts/push.ts'
import type { UpdatePort } from '../core/contracts/update.ts'
import { runDevRecording } from './devRecord.ts'
import { loadDevEnv } from './devEnv.ts'
import type { MsalIdentity } from '../modules/identity/index.ts'
import type { CapabilityReport } from '../core/contracts/crm.ts'
import type { BootState, BootStep } from '../core/contracts/boot.ts'
import type { ProviderSection } from '../core/contracts/settings.ts'
import type { ConnectorHealth } from '../core/contracts/health.ts'
import type { DiagEnvironment, DiagRecorder } from '../core/contracts/diagnostics.ts'
import { TRANSCRIPTION_LANGUAGE } from '../core/contracts/transcript.ts'
import { meetingAnchor } from '../core/contracts/meeting.ts'
import type { Meeting, MeetingContext } from '../core/contracts/meeting.ts'
import { AD_HOC_NOMINAL_MS } from '../core/domain/adHoc.ts'
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
 * `build.win`'s signing fields, baked in by `scripts/build-electron.js`.
 *
 * A `define`, not a runtime read: electron-builder does not promise to keep the
 * `build` block in the `package.json` it writes into the asar, and an updater
 * that decided whether it could verify itself from a field that may have been
 * stripped would fail **open**. `globalThis` rather than a bare identifier so
 * `node --test` — which does no bundling and therefore no substitution — sees
 * `undefined` instead of a ReferenceError.
 */
const WIN_BUILD: BuildTrust | null =
  (globalThis as { __SILLAGE_WIN_BUILD__?: BuildTrust }).__SILLAGE_WIN_BUILD__ ?? null

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

/**
 * Windows needs this before it will show a toast at all.
 *
 * On macOS a `Notification` works with no ceremony; on Windows — the primary
 * platform (HR-2) — the Action Center refuses one from a process with no
 * AppUserModelID, silently. It is the packaged app id, so a toast is attributed
 * to Sillage rather than to `electron.app.Electron`, and setting it off Windows
 * is a documented no-op rather than a platform branch.
 */
app.setAppUserModelId('fr.ilies-bel.sillage')

/**
 * **The main window**, held so the rest of the file can say *which* window.
 *
 * There used to be exactly one, so « the window » and `getAllWindows()[0]` were
 * the same thing and three places said the second. They stopped being the same
 * thing the moment the in-meeting widget existed (`app/windows/Overlay.ts`):
 * `second-instance` could raise a 232-pixel pill instead of the app, `activate`
 * would refuse to reopen the window because a widget was still floating, and
 * the 14:30 notification's click focused every window there was — which on
 * Windows pulls the call out of full screen to show a pill that was already on
 * top of it.
 */
let mainWindow: BrowserWindow | null = null

/**
 * What to tear down when the main window goes.
 *
 * Set by `boot()`, because the thing it closes — the widget — is constructed
 * there with the store behind it, and read here, because `createWindow` is
 * module-level and runs before any of that on a macOS `activate`. Null until
 * boot has finished, which is the only moment where there is nothing to tear
 * down.
 */
let closeSecondaryWindows: (() => void) | null = null

/**
 * Put the widget back where the state machine says it should be.
 *
 * Set by `boot()` for the same reason `closeSecondaryWindows` is, and called
 * from `activate` — macOS only, and the case is real: the rep closes the main
 * window during a call, which takes the widget with it (the comment on
 * `window-all-closed` explains why it has to), then reopens the app from the
 * Dock. `createWindow()` brings the app back; without this the rest of the call
 * has no pill, because nothing else re-evaluates it until the next transition
 * and a recording has none.
 */
let resyncOverlay: (() => void) | null = null

/**
 * The height of the renderer's title band, and of the Windows controls overlay
 * drawn over it. One number, so the two rectangles are the same rectangle.
 */
const TITLE_BAR_HEIGHT = 36

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
    // There is no chrome. The frame's title bar is hidden and the renderer
    // reserves the same strip as bare drag space (`src/ui/TitleBar.tsx`); the
    // OS keeps its own controls over it — traffic lights on macOS, the Window
    // Controls Overlay on Windows. Neither option is a platform test: each
    // host ignores the other's.
    //
    // The overlay wears the page's own ground rather than a brand fill:
    // `#f7f9fb` is `--bg-canvas` and `#4a5a67` is `--text-body`, both from
    // `src/design/tokens.css`. They were `#036696` on `#ffffff` — a saturated
    // `--brand-700` band across the top of every screen — and the strip is
    // now invisible on both platforms instead of being the loudest rectangle
    // in the product. A value here that drifts from the token is a seam along
    // the top edge on Windows only, which is the platform nothing is written
    // on (HR-2), so the two hexes are named above as well as written.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f7f9fb', symbolColor: '#4a5a67', height: TITLE_BAR_HEIGHT },
    trafficLightPosition: { x: 14, y: 11 },
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

  mainWindow = window
  window.on('closed', () => {
    if (mainWindow !== window) return
    mainWindow = null
    // The widget goes with it. Without this, `window-all-closed` never fires
    // on Windows, `before-quit` never runs, and the meeting the pill is
    // reporting on is left recording in a process the rep cannot reach.
    closeSecondaryWindows?.()
  })

  if (isDev) {
    void window.loadURL(DEV_SERVER)
  } else {
    void window.loadFile(join(app.getAppPath(), 'dist', 'index.html'))
  }

  return window
}

/**
 * Restore, show and focus the main window, and optionally send it to a meeting.
 *
 * Three callers, and all three are the app navigating on a press the rep made
 * elsewhere: the 14:30 notification (DEC-46), the sleep notice
 * (`app/session/PowerWatch.ts`, the other of DEC-46's exactly two) and the
 * widget's « Ouvrir » (`window:focus`). `show()` before `focus()` and both before
 * the broadcast — a renderer told to navigate while its window is still minimised
 * navigates somewhere nobody can see, and on Windows a minimised window ignores
 * `focus()` until it is shown.
 *
 * **`null` is forward and nowhere, and it is a caller's answer rather than an
 * absence** (R33-3). The window is raised and no `session:open` is sent, so the
 * route stays where the rep left it — which is what the sleep notice asks for
 * once another call is recording: `src/App.tsx`'s handler is an unconditional
 * `setRoute` and the router knows nothing about what is live, so the decision is
 * made here, where both facts are.
 *
 * False when there is no main window to raise. That is a real state — on macOS
 * the rep can close the window and leave the app running — and the caller is
 * told rather than left to assume, so the widget's button can say so instead of
 * appearing to do nothing (DEC-26).
 */
const focusMainWindow = (
  meetingId: string | null,
  broadcast: (channel: 'session:open', payload: { meetingId: string }) => void,
): boolean => {
  const window = mainWindow
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (meetingId !== null) broadcast('session:open', { meetingId })
  return true
}

/**
 * The widget's window, created here because this is where Electron lives.
 *
 * Every flag on it is load-bearing and none of them is a style:
 *
 *  · **`frame: false`, `transparent: true`** — the pill has rounded ends and
 *    floats over somebody's face. A titlebar would be the largest thing on it.
 *  · **`alwaysOnTop` at the `screen-saver` level** — `'floating'` is not above a
 *    full-screen video call, which is where every call this product records
 *    actually happens.
 *  · **`setVisibleOnAllWorkspaces(…, { visibleOnFullScreen: true })`** —
 *    the macOS half of the same sentence. A full-screen app is its own Space,
 *    and a window that is not marked for them is simply not there.
 *  · **`skipTaskbar`** — it is not an application, it is a control panel for the
 *    one that is. A second Sillage entry in the taskbar is a second thing to
 *    close.
 *  · **`resizable: false`, `minimizable: false`, `maximizable: false`** — it
 *    sizes itself from its own content (`widget:resize`), and the two other
 *    verbs have no meaning for a pill.
 *  · **`focusable: true`** — it has a text field in it. A non-focusable window
 *    cannot be typed into, which would make the note a control that draws a
 *    caret and accepts nothing. It is never *given* focus by the app
 *    (`showInactive`); the rep clicking it is the only way it takes any.
 */
const createOverlayWindow = (options: OverlayWindowOptions): BrowserWindow => {
  const window = new BrowserWindow({
    ...options,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // The renderer paints the pill; anything painted here is a rectangle around
    // it. `transparent: true` needs this to be `#00000000` on Windows, where a
    // named colour is composited opaque.
    backgroundColor: '#00000000',
    title: 'Sillage — enregistrement',
    webPreferences: {
      preload: join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  /*
   * **Out of the screen share.**
   *
   * This window floats above everything, on every Space, including a
   * full-screen call — which is also, exactly, what a rep is sharing when they
   * share their screen. What is on it is the client's own name, a live
   * transcript of what that client is saying, and the rep's private commercial
   * notes (« prix bloqué à 550 »). An ESN rep sharing CVs or a deck in the
   * middle of a negotiation is an ordinary call, and before this window existed
   * the product put nothing on screen during one, so this exposure is entirely
   * new.
   *
   * `setContentProtection` excludes the window from capture on both of this
   * product's platforms — macOS and Windows — and costs the one thing it should
   * cost: a demo of Sillage over a screen share does not show the widget.
   * Weighed against a client reading their own transcript in a shared window,
   * that is not close.
   */
  window.setContentProtection(true)
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
    origin: 'foreign',
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
    origin: 'foreign',
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
 * **« Cette machine uniquement »** (DEC-37), as the rep asked for it.
 *
 * The stored preference first and the environment second, which is DEC-34's
 * « `process.env` is a development override and is read last » — and until
 * there was a preference at all, the environment was the *only* way to ask,
 * on a product that says no environment variable is required to run it.
 */
const offlineOnly = (context: SettingsContext): boolean =>
  context.preferences.offlineOnly() ?? offlineOnlyStt()

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
  const offline = offlineOnly(context)
  const configured = allowedByResidency(
    configuredLlmProviders({ stored, fields }),
    LLM_PROVIDERS,
    offline,
  )
  const selection = selectLlm({ configured, offlineOnly: offline })
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
  /*
   * The constraint is applied to the **candidate set**, not to the ranking.
   * `chosen` below takes the rep's explicit pick whenever it is configured, so
   * a constraint honoured only by `selectProvider` is one that an earlier
   * *Utiliser* walks straight around (`core/domain/residency.ts`).
   */
  const offline = offlineOnly(context)
  const stt = allowedByResidency(
    usableSttProviders({ stored, fields: sttFields }),
    STT_PROVIDERS,
    offline,
  )
  const sttChoice = context.preferences.provider('stt')
  const sttSelection = selectProvider({
    configured: stt,
    language: LANGUAGE,
    offlineOnly: offline,
    preferCloud: preferCloudStt(),
  })

  /*
   * And the language model, which never honoured it at all: `selectLlm` was
   * called with no `offlineOnly`, so a rep who asked for the audio to stay on
   * the machine had the **transcript** posted to a hosted model — the audio is
   * only half of what leaves, and it is not the half with the client's name in
   * it.
   */
  const llm = allowedByResidency(
    configuredLlmProviders({ stored, fields: llmFields }),
    LLM_PROVIDERS,
    offline,
  )
  const llmChoice = context.preferences.provider('llm')
  const llmSelection = selectLlm({ configured: llm, offlineOnly: offline })

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
/**
 * ── the capture permissions, and the only place they are asked for ──────────
 *
 * `core/domain/capturePermission.ts` decides what the statuses *mean*; this is
 * the three Electron calls that read and change them. It lives here rather than
 * in `modules/capture` because two of the three are about the app's own
 * relationship with the OS — a prompt and a settings pane — and not about the
 * audio boundary; the module opens devices and does not own consent.
 *
 * **Everything is capability-tested and nothing is platform-tested.** Windows
 * is the primary platform (HR-2) and has none of these permissions to grant, so
 * a `process.platform === 'darwin'` here would be the mac-first branch that
 * decides behaviour on the machine it was typed on. `getMediaAccessStatus`
 * throws where it does not exist, `askForMediaAccess` is simply absent, and the
 * settings pane is a URL the OS either handles or does not — so all three
 * degrade to « we did not measure it », which the domain treats as usable.
 */
const accessStatus = (kind: 'microphone' | 'screen'): AccessStatus => {
  try {
    const status = systemPreferences.getMediaAccessStatus?.(kind)
    return typeof status === 'string' ? (status as AccessStatus) : 'unknown'
  } catch {
    // Linux, and any host that does not implement it. Not a refusal.
    return 'unknown'
  }
}

const captureAccess = (): CaptureAccess => ({
  microphone: accessStatus('microphone'),
  screen: accessStatus('screen'),
})

/**
 * macOS's privacy panes, for a permission that has already been refused once.
 *
 * The OS will not prompt twice — it silently returns the old answer — so this
 * is the only remedy left, and it is why `capturePermissionHealth` distinguishes
 * *denied* from *not-determined* at all. `openExternal` on a scheme the host
 * does not know rejects, which is the Windows case and is nothing to report:
 * the domain never asks for this unless a permission was measured as refused,
 * and on Windows nothing is.
 */
const PRIVACY_PANE: Record<NodeJS.Platform | 'default', Record<'microphone' | 'screen', string>> = {
  darwin: {
    microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  },
  /*
   * **Windows measures a refusal too, and the button that offered to fix it
   * opened an Apple URL.**
   *
   * The comment above this used to end « and on Windows nothing is », which
   * Electron's own typings contradict: `getMediaAccessStatus` is annotated
   * `@platform win32,darwin` and documents the Windows 10 global microphone
   * switch. With that switch off the status is `denied`, so
   * `capturePermissionHealth` returns `degraded, retryable: true`, the screen
   * draws *Autoriser*, and pressing it called `shell.openExternal` on
   * `x-apple.systempreferences:…` — a scheme Windows does not know — swallowed
   * the rejection, re-measured, and returned the identical `degraded`. A
   * pressable control that can never do anything, for ever, on the primary
   * platform (HR-2): the exact thing DEC-26 forbids, offered by the code that
   * says it exists to prevent it.
   *
   * `ms-settings:` is the equivalent, and there is no screen-recording
   * permission to open on Windows — the key is there so the record is total,
   * and it lands on the privacy root rather than pretending to a pane that does
   * not exist.
   */
  win32: {
    microphone: 'ms-settings:privacy-microphone',
    screen: 'ms-settings:privacy',
  },
  /** Anywhere else, `openExternal` rejects and the caller swallows it. */
  default: { microphone: '', screen: '' },
} as Record<NodeJS.Platform | 'default', Record<'microphone' | 'screen', string>>

/** The pane for this host, or the empty pair where there is none to open. */
const privacyPane = (): Record<'microphone' | 'screen', string> =>
  PRIVACY_PANE[process.platform] ?? PRIVACY_PANE.default

/**
 * What *Autoriser* does — and the reason the screen-recording half is a
 * `desktopCapturer` call rather than an ask API.
 *
 * There is no `askForMediaAccess('screen')`: on macOS the TCC prompt for screen
 * recording is fired by *attempting* a capture, and `getSources` is the cheapest
 * attempt there is. It reads nothing we keep, opens no device on the audio path,
 * and on Windows it is an ordinary enumeration that succeeds.
 */
const requestCaptureAccess = async (): Promise<void> => {
  const before = captureAccess()

  if (actionFor(before.microphone) === 'ask') {
    await systemPreferences.askForMediaAccess?.('microphone')
  } else if (actionFor(before.microphone) === 'open') {
    const pane = privacyPane().microphone
    if (pane) await shell.openExternal(pane).catch(() => undefined)
  }

  if (actionFor(before.screen) === 'ask') {
    // The prompt is the point; the sources are thrown away.
    await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false }).catch(() => undefined)
  } else if (actionFor(before.screen) === 'open') {
    const pane = privacyPane().screen
    if (pane) await shell.openExternal(pane).catch(() => undefined)
  }
}

/**
 * ── consent, as the onboarding row draws it ─────────────────────────────────
 *
 * The same statuses `capturePermissionHealth` reads, in the platform-neutral
 * shape `core/contracts/permissions.ts` declares — so the renderer can tell a
 * refusal from a permission nobody has answered without learning what host it
 * is running on.
 *
 * **`canOpenSettings` is a capability, not a platform test.** It is « is there
 * a pane URL for the channel that is missing », which is empty on a host with
 * no such pane, and the row then draws no button rather than one that opens
 * nothing. The pane *choice* stays here too: the renderer says « open the
 * settings », never which of the two.
 */
const capturePermissionNow = (): CapturePermission => {
  const access = captureAccess()
  const panes = privacyPane()
  const missingScreen = actionFor(access.screen) !== 'nothing'
  const pane = missingScreen ? panes.screen : panes.microphone
  return capturePermissionView(access, pane !== '', Date.now())
}

/**
 * The pane for whichever channel is missing — screen first, because on the host
 * that has one it is the permission people refuse and the one whose absence
 * costs the far end of the call.
 */
const openCapturePane = async (): Promise<boolean> => {
  const access = captureAccess()
  const panes = privacyPane()
  const pane = actionFor(access.screen) !== 'nothing' ? panes.screen : panes.microphone
  if (!pane) return false
  return shell
    .openExternal(pane)
    .then(() => true)
    .catch(() => false)
}

/**
 * **The 14:30 starts and nothing happens.**
 *
 * The agenda knew the meeting, labelled it « PRÊT », and drew *Enregistrer* —
 * on a window behind Teams, Outlook and a browser, which is where this app sits
 * for the whole of a rep's day. There was no `Notification` and no `Tray`
 * anywhere in `electron/`: the one moment the product exists for was the one
 * moment it said nothing.
 *
 * So the OS says it, once, on the arming edge — `Agenda.onArmed` fires at the
 * transition and never on the tick, so a call cannot produce a notification
 * every thirty seconds. Clicking it brings the window forward and opens that
 * meeting, which is the whole of what a rep wants at 14:30.
 *
 * **It never starts a recording.** A capture that began because an OS
 * notification was clicked is a capture nobody agreed to, on a call that may be
 * a private conversation the rep stepped into (DEC-4's reasoning, one screen
 * earlier). It offers; the rep presses.
 *
 * Failing is free: `Notification.isSupported()` is false on a Linux without a
 * daemon and on a macOS where the user has turned them off, and everything here
 * is wrapped — a meeting arms, and is on screen, whether or not the OS agreed
 * to mention it (DEC-26).
 */
const announceMeeting = (
  meetingId: string,
  subject: string,
  open: (meetingId: string) => void,
): void => {
  try {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: subject || 'Réunion',
      // What it is offering, in one line, and it is an offer. « Enregistrer ? »
      // and not « Enregistrement en cours » — nothing has started.
      body: 'La réunion commence. Ouvrir Sillage pour l’enregistrer ?',
      silent: false,
    })
    notification.on('click', () => open(meetingId))
    notification.show()
  } catch {
    // A notification that will not show is not a meeting that will not record.
  }
}

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
  /*
   * **`meetingAnchor`, not `startedAt ?? createdAt`** — the one anchor for when
   * a meeting is (`core/contracts/meeting.ts`). This read the two later fields
   * and skipped the first, so a meeting the rep *placed* at 14:30 on the app's
   * own calendar got a context saying it was at 14:00, the moment they typed it.
   * `meeting:create` takes `scheduledStart` and `NewMeeting.tsx` sends it: « a
   * meeting that is not in anybody's Exchange still belongs in it ».
   */
  scheduledStart: meetingAnchor(meeting),
  /*
   * **And a bound rather than a timestamp of the past.**
   *
   * This was `meeting.endedAt ?? meeting.updatedAt`, and on a meeting that has
   * not ended `updatedAt` is *now* — so the context of a call about to happen
   * claimed it was already over, and everything downstream that asks « is this
   * slot still live » answered no.
   *
   * `AD_HOC_NOMINAL_MS` is the number, and it is not a new decision:
   * `core/domain/adHoc.ts` already made it for the same class of object — a call
   * with no stated end — and `adHocContext`'s docblock names this function as
   * its mirror. « `scheduledEnd` *bounds* the session …; it is not a claim about
   * when the call will end … An hour is the bound that behaves like the ordinary
   * case. » A rep-placed meeting has exactly as much of an end as a detected
   * one: none. `EndOfMeetingWatch` still ends a call on silence rather than on
   * this clock.
   */
  scheduledEnd: meeting.endedAt ?? meetingAnchor(meeting) + AD_HOC_NOMINAL_MS,
  seriesMasterId: null,
  timeZone: 'Europe/Paris',
})

/**
 * **A calendar that is always empty, so that arming no longer requires Graph.**
 *
 * `Agenda` used to be constructed only in the `else` of the Entra branch, and the
 * comment there argued the gate was structural: *"`decideArming` takes an event
 * and reads `event.sensitivity`, so arming with no event is structurally
 * impossible rather than merely unimplemented."* That was true of every rule the
 * product had. It is not true of `core/domain/adHoc.ts`, which decides from a
 * microphone reading and a clock and never looks at an event — so the gate now
 * costs the thing it was protecting.
 *
 * It cost it on the worst build to lose it. DEC-28 calls a demo installer with no
 * client tenant the *first deliverable*, and a demo machine is precisely where
 * nobody has completed an Entra registration: the configuration most reps see
 * first was the one configuration in which nothing would ever offer to record
 * anything.
 *
 * Two methods and no network. `syncedAt: 0` is honest — nothing was ever
 * synced — and `Agenda` is given no `onHealth` in this branch, so a calendar that
 * is *absent* is never reported as a calendar that is *well*.
 */
const NULL_CALENDAR: CalendarPort = {
  window: () => EMPTY_WINDOW,
  sync: async () => EMPTY_WINDOW,
}

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

  // Declared before the recorder that uses it, and that order is the fix: a
  // `const` referenced from a callback that could run first is a temporal dead
  // zone, and the callback here is « record a diagnostic », which is precisely
  // what runs when something goes wrong during boot.
  const broadcast: Broadcaster = (channel, payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }

  const diagnostics = new Diagnostics(store, {
    environment: environment(),
    // `diag:appended` was declared in the contract and subscribed to by
    // Réglages, and published by nobody — so the pane read its two hundred rows
    // on mount and then sat still while the thing the rep was watching for
    // happened. See `DiagnosticsOptions.onRecorded`.
    onRecorded: (event) => broadcast('diag:appended', { event }),
  })
  recorder = diagnostics
  // Rolling purge, on boot. Diagnostics only — the WHERE clause in the store
  // makes it impossible for this to reach meeting content (DEC-27).
  const purged = diagnostics.purge()

  /**
   * Bring the window forward and open the meeting — the OS notification's click
   * and nothing else sends this.
   *
   * `show()` before `focus()`, and both before the broadcast: a renderer told to
   * navigate while its window is still minimised navigates somewhere nobody can
   * see, and on Windows a minimised window ignores `focus()` until it is shown.
   */
  const announceArmed = (meetingId: string, subject: string): void => {
    announceMeeting(meetingId, subject, (id) => {
      focusMainWindow(id, broadcast)
    })
  }

  /**
   * The in-meeting widget (`app/windows/Overlay.ts`).
   *
   * Constructed here and shown by nothing but `syncOverlay` below, so « when is
   * there a pill on screen » has exactly one answer: while a meeting is
   * recording.
   */
  const overlay = new Overlay(
    {
      create: createOverlayWindow,
      // Primary first, which is what `placeWindow` falls back to when a saved
      // position names a display that has been unplugged.
      areas: () => [
        screen.getPrimaryDisplay().workArea,
        ...screen
          .getAllDisplays()
          .filter((display) => display.id !== screen.getPrimaryDisplay().id)
          .map((display) => display.workArea),
      ],
      load: (window) => {
        /*
         * The same bundle and the same preload as the main window, told which
         * of the two it is by a query string (`src/main.tsx`).
         *
         * A second HTML entry would mean a second Vite input, a second build
         * output and a second place for the design tokens to be imported from —
         * for a renderer that shares every contract, every token and the whole
         * bridge with the first one. `loadFile`'s `search` is the packaged half
         * of the same thing, and it has to be spelled separately because a
         * `file://` URL with a query is not what `loadFile` takes.
         */
        if (isDev) void window.loadURL(`${DEV_SERVER}?window=widget`)
        else
          void window.loadFile(join(app.getAppPath(), 'dist', 'index.html'), {
            search: 'window=widget',
          })
      },
      focusMain: (meetingId) => focusMainWindow(meetingId, broadcast),
      // The stacking direction, when the renderer did not ask — a display going
      // away, or a drag across the display's midline. See `widget:placed`.
      placed: ({ above }) => broadcast('widget:placed', { above }),
      /*
       * Addressed to the leaving window and never broadcast: a fan-out would tell
       * a new pill to fade out too. `Overlay.show()` now reaps a leaving window
       * rather than letting the two overlap, so the two-windows-at-once case is
       * shorter than it was — and « shorter » is not « impossible », and the
       * addressing is what makes this correct rather than lucky. See
       * `widget:leave`.
       */
      leave: (window) => {
        if (!window.isDestroyed()) window.webContents.send('widget:leave', {})
      },
    },
    store.appState,
  )

  /**
   * **The displays are the main process's business, and nothing was watching
   * them.**
   *
   * `placeWindow`'s quarter-overlap rule exists because this one window is
   * unrecoverable off-screen — frameless, always on top, absent from the
   * taskbar — and there was no `display-removed` listener anywhere in `electron/`
   * or `src/`, so it ran only at creation and on the reply to a `widget:resize`.
   * A rep who dragged the pill onto a second monitor and closed the lid got it
   * back when the *next turn of the call* changed the frame's height, which is
   * never on the one failure the pill is up to report.
   *
   * Three events and not one. `display-removed` is the case that motivates it;
   * `display-metrics-changed` is the same loss without an unplug — a resolution
   * change, a scale change, or a taskbar that grew, all of which move a work
   * area's edges under a window sitting against them; and `display-added` is the
   * benign half that must still be heard, because the rescue is idempotent and a
   * monitor coming back is the moment a clamped pill can go back where it was
   * asked to be. `displaysChanged` is a no-op with no window, which is most of
   * the time.
   */
  screen.on('display-removed', () => overlay.displaysChanged())
  screen.on('display-added', () => overlay.displaysChanged())
  screen.on('display-metrics-changed', () => overlay.displaysChanged())

  /**
   * There is a pill on screen exactly while a meeting is recording.
   *
   * Driven from the same broadcast the renderer is, rather than from the
   * commands: `armed`, a crash sweep, a deferred quit and a rep pressing
   * *Terminer* all reach the state machine by different routes and all of them
   * end in a transition, so this is the one place that cannot be forgotten.
   */
  closeSecondaryWindows = () => overlay.hide()

  const syncOverlay = (): void => {
    const recording = orchestrator.liveIds().some((id) => orchestrator.stateOf(id) === 'recording')
    if (recording) overlay.show()
    // `dismiss`, not `hide`: this is the transition-driven path — the recording
    // stopped — and it is the only one of the three that can afford a frame of
    // animation. The window closing with the main window and the deferred quit
    // both still call `hide()`, and both reasons are in its docblock.
    else overlay.dismiss()
  }
  resyncOverlay = syncOverlay

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
  /*
   * The native module, **and then what the operating system will let it hear.**
   *
   * The probe answered only « does the binary load », which is a real question
   * and not the one that costs a rep a meeting. On macOS the screen-recording
   * grant is the prompt people refuse, and refusing it loses the far end of
   * every call while the recording looks perfectly healthy — the meter moves,
   * the transcript fills, and the compte-rendu comes back describing a
   * monologue. `core/domain/capturePermission.ts` turns the two statuses into a
   * sentence that names which side goes missing.
   */
  const audio = ((): ConnectorHealth => {
    const loaded = CaptureSession.probe()
    // A module that will not load is the worse fact and keeps the row.
    if (loaded.state !== 'ok') return loaded
    return capturePermissionHealth(captureAccess(), Date.now()) ?? loaded
  })()
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
  /*
   * **And not on a build whose updates could not be checked** — which is every
   * Windows build today (`core/domain/updateTrust.ts`).
   *
   * `electron-updater` runs the installer it downloaded, and verifies its
   * signature against an expected publisher only if the packaging config
   * declares one. `build.win` declares neither `publisherName` nor a
   * certificate, so the check is *skipped* rather than failed, and « Installer
   * et redémarrer » executed whatever the feed served. The updater is simply
   * not built in that case, and the panel says why — the same shape as a
   * portable build, which has nowhere to install to.
   */
  const trust = updateTrust(process.platform, WIN_BUILD)
  const updates: UpdatePort | null =
    app.isPackaged && !isPortableBuild() && trust.ok
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
    broadcast(
      'update:changed',
      updateStatus(updates, orchestrator.liveStates(), app.getVersion(), trust.reason),
    )
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

  /**
   * Whether a push is on the wire right now.
   *
   * A holder rather than a direct reference: `Outbox` is constructed four
   * hundred lines below this, and the answer is only ever asked for after a rep
   * has confirmed something — long after. `false` until then is correct and is
   * also what an app with no outbox at all would say.
   */
  const pushInFlight = { ask: (): boolean => false }

  /**
   * Which kinds of push intent have a connector behind them, at all.
   *
   * A holder for the same reason as the one above: `crm` and `mail` are built
   * four hundred lines below. Until they are, nothing has confirmed anything, so
   * « everything is routable » is both true and unreachable.
   */
  const connectors = { routable: (_kind: PushIntentKind): boolean => true }

  /**
   * Whether the twenty-second dry run currently holds both devices (DEC-45).
   *
   * A holder for the same reason as the two above: `runEssai` is declared eight
   * hundred lines below and the orchestrator has to be able to ask.
   */
  const essai = { running: (): boolean => false }

  const updateTick = async (): Promise<void> => {
    if (!updates) return
    if (!updateReadiness(orchestrator.liveStates(), pushInFlight.ask()).safe) return
    const state = await updates.check()
    if (state.phase !== 'available') return
    if (!updateReadiness(orchestrator.liveStates(), pushInFlight.ask()).safe) return
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
    /*
     * **Which VerySwing account this call belongs to.**
     *
     * `CrmPort.resolveAccount` was declared, implemented and tested and called
     * by nobody, so `facts.account` was `UNRESOLVED_ACCOUNT` on every meeting
     * this product has ever produced — which made the opportunity structurally
     * impossible (`reviewGate.ts` reads `edits.accountId !== null`) and shipped
     * every compte-rendu task as an orphan with no `linkType`.
     *
     * A closure rather than the port, for the reason every other dependency here
     * is one: `crm` is `null` until VerySwing is configured and a rep can
     * configure it from Réglages mid-session (DEC-34), so a value captured here
     * would pin the answer to whatever existed at boot. It is read at the end of
     * a meeting, long after `crm` is initialised.
     */
    resolveAccount: (query) => {
      const port = crm
      return port ? port.resolveAccount(query) : Promise.resolve([])
    },
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
    routable: (kind) => connectors.routable(kind),
    essaiRunning: () => essai.running(),
    /*
     * The plain broadcast, plus one derived one.
     *
     * A session transition changes the answer to "may this install now" without
     * changing anything the updater knows, so `update:changed` has to be
     * re-derived here. Wrapping the broadcaster is what guarantees it: every
     * transition goes through `session:changed`, so there is no path that moves
     * the machine and forgets to refresh the gate.
     */
    /*
     * **And the order of these two is deliberately not load-bearing.**
     *
     * `session:changed` reaches the widget's renderer, which used to reload
     * `widget:state` and redraw the pill as « Aucun enregistrement » *while it was
     * fading out* — measured in the packaged app at 17 ms into a 150 ms fade. The
     * obvious fix is here: call `syncOverlay()` first, so `widget:leave` arrives
     * before the transition does. It was rejected. `useInvoke.reload()` keeps its
     * previous value until the new one lands, so the read that blanks the card can
     * already be in flight; and the card is changed by five other broadcasts as
     * well, none of which this function orders. The rule belongs where the window
     * is — a window that has been told to go away stops taking state — and it is
     * in `src/widget/Widget.tsx`, with the measurement. Reordering here would look
     * like a fix and would move the problem out of sight of the test that holds it.
     */
    broadcast: (channel, payload) => {
      broadcast(channel, payload)
      if (channel === 'session:changed') {
        publishUpdateStatus()
        syncOverlay()
      }
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
      const terms = stored.map((t) => ({ term: t.term, category: t.category, variants: t.variants }))
      /*
       * **And the term is recorded as heard** (`Lexicon.observe`).
       *
       * `correct()` has always returned `applied` — « the enrichment signal for
       * `hits` », in its own words — and nothing anywhere consumed it beyond a
       * diagnostic line. So `hits` was zero on every row of every install, and
       * `forClient`'s `ORDER BY hits DESC` ranked nothing: the promise that « a
       * term that keeps turning up in real calls survives truncation ahead of
       * one added once and never spoken » was ordered by `created_at` alone.
       * `observe` was declared, implemented, unit-tested, and called by its test
       * and nothing else — the shape `check-ports.mjs` exists to catch, one
       * layer below where that check looks.
       *
       * Only rows this meeting actually loaded are counted: `applied` also
       * carries the shipped ESN list, which lives in code and has no row to
       * increment. One small UPDATE per corrected segment, on the capture path —
       * and `Recording.#corrected` calls this inside the try/catch that exists
       * so a correction table can never cost the sentence (DEC-26).
       */
      const rows = new Map(stored.map((t) => [t.term, t]))
      return (text) => {
        const result = correctWithLexicon(text, terms)
        for (const term of result.applied) {
          const row = rows.get(term)
          if (row) store.lexicon.observe(row.scope, row.scopeKey, term)
        }
        return result
      }
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
          origin: 'authored',
          message: `${bleed.dropped} passage(s) du client repris sur le micro du commercial — enceintes ouvertes, résidu que l’annulation d’écho n’a pas absorbé ; un casque supprime le problème`,
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
          origin: 'authored',
          /*
           * The client's name is the client's. `redactMessage` is a denylist and
           * « Néovia Santé » is not on it, so this line reached the bundle whose
           * button says « Peut être envoyé au support » with the name in it. The
           * allowlist in `redactDetail` answers `[string:13]`, which says the
           * same thing about the shape and nothing about the client.
           */
          message: `${learned.length} terme(s) appris pour un client`,
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
  /*
   * And the last trial, if there was one, outranks it — see `runEssai`. Read
   * through the schema rather than cast: a row written by an older build, or a
   * hand-edited store, must not be able to put a malformed sentence on the
   * connector board.
   */
  const lastEssai = (() => {
    const raw = store.appState.get(ESSAI_LAST_KEY)
    if (!raw) return null
    try {
      return EssaiRecordSchema.parse(JSON.parse(raw))
    } catch {
      return null
    }
  })()
  orchestrator.setHealth('capture', essaiHealth(lastEssai) ?? audio)

  /*
   * **`Autoriser` had nothing behind it, on the one connector that cannot be
   * repaired after the call.**
   *
   * Onboarding step 2 draws its rows from `REQUIRED_CONNECTORS` — capture,
   * transcription, analysis — and offers *Autoriser* on a row whose health is
   * `retryable`. `#truthful` now refuses to publish that claim for a connector
   * nobody registered a retry for, which was the right fix and closed the last
   * door: no retry was registered for `capture`, so all three rows fell through
   * to *Réglages ›*, and Réglages' *Requis* card draws its control on exactly
   * the same condition. Install the app, refuse the macOS prompt, and there was
   * no screen in the product that could ask again — while the OS quietly stopped
   * prompting, because it had already been answered.
   *
   * So: ask, then re-measure. The re-measure is the whole point — the OS may
   * have said no, may need a relaunch before it says yes (screen recording
   * does, on macOS), or may be a managed device where nothing will ever change.
   * All three come back as a sentence rather than as a button that appeared to
   * do nothing.
   */
  orchestrator.registerRetry('capture', async () => {
    const loaded = CaptureSession.probe()
    if (loaded.state !== 'ok') return loaded
    await requestCaptureAccess()
    return capturePermissionHealth(captureAccess(), Date.now()) ?? { state: 'ok' }
  })

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

  /*
   * Constructed before the branch, because neither of its signals is a Graph
   * signal. `micHolders` is the strong one — which application holds a
   * microphone — and it is what lets the no-Entra build below still detect an
   * unscheduled call.
   */
  const meetingApps = new MeetingApps({ micHolders: getMicHoldingApps })

  if (!identityConfig) {
    orchestrator.setHealth('calendar', {
      state: 'down',
      /*
       * Written for a rep, in the screen they read it in. The name of an
       * environment variable belongs in a diagnostics bundle, not in
       * *Réglages → Facultatifs* — and `retryable: false` because there is
       * nothing here for a *Réessayer* to do (DEC-26).
       *
       * **And what is actually lost is now one thing, not two.**
       *
       * This sentence has been rewritten twice, and each time the reason was that
       * it described the wrong amount of damage. It first named only the
       * calendar, while a rep on this build also silently lost *every* offer to
       * record — no *Prêt*, no 14:30 notification (DEC-46), no armed row —
       * because `Agenda` was constructed only in the `else` below. So a second
       * clause was added saying so.
       *
       * That clause is now false, and in the good direction. `Agenda` is built in
       * both branches over `NULL_CALENDAR`, and `core/domain/adHoc.ts` needs no
       * event: a conferencing application holding a microphone is detected, and
       * offered, with no Microsoft account at all. What a rep on this build loses
       * is the calendar — the five-minute anticipation, the attendees, the objet —
       * and not the detection.
       *
       * DEC-26 is that a degradation is stated, never silent. It is equally that
       * it is stated *accurately*: a sentence claiming more is gone than is gone
       * costs the rep a feature they have.
       */
      reason:
        'aucune application Microsoft configurée — le calendrier reste vide ; ' +
        'les appels en cours sont tout de même détectés et proposés à l’enregistrement, ' +
        'sans les participants ni l’objet de l’invitation',
      since: Date.now(),
      retryable: false,
    })

    /*
     * Arming with no calendar. Every rule that reads an event simply never
     * fires — `nextArmable` folds an empty list — and `decideAdHoc` does all the
     * work. No `onHealth`: the calendar's health is the `down` set just above,
     * and a `NULL_CALENDAR` that "syncs" successfully every five minutes must
     * never overwrite it with `ok`.
     */
    agenda = new Agenda({
      calendar: NULL_CALENDAR,
      // Never « synchronisation en cours » here: nothing will ever sync.
      initialReason: 'aucun calendrier connecté — les appels en cours sont détectés sans lui',
      orchestrator,
      /*
        **The rep's own meetings, so they claim their own conversations**
        (`core/domain/arming.ts`'s `ownClaims`).

        `null` bounds are unbounded, so the range is passed through as given; the
        limit is generous because a claim window is at most ninety minutes wide
        and a day rarely holds more. `listMeetings` already leaves out the
        unaccepted ad-hoc offers, which is exactly right here: an offer nobody
        took is not a conversation the rep placed.
      */
      ownMeetings: (from, to) => store.projections.listMeetings(200, { from, to }),

      meetingSignal: () => meetingApps.current(),
      refreshMeetingSignal: (wantProcessList) => meetingApps.refresh({ processList: wantProcessList }),
      diagnostics,
      onChanged: (snapshot) => broadcast('agenda:changed', snapshot),
      onArmed: ({ meetingId, subject }) => announceArmed(meetingId, subject),
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

    agenda = new Agenda({
      calendar,
      orchestrator,
      /*
        **The rep's own meetings, so they claim their own conversations**
        (`core/domain/arming.ts`'s `ownClaims`).

        `null` bounds are unbounded, so the range is passed through as given; the
        limit is generous because a claim window is at most ninety minutes wide
        and a day rarely holds more. `listMeetings` already leaves out the
        unaccepted ad-hoc offers, which is exactly right here: an offer nobody
        took is not a conversation the rep placed.
      */
      ownMeetings: (from, to) => store.projections.listMeetings(200, { from, to }),
      meetingSignal: () => meetingApps.current(),
      refreshMeetingSignal: (wantProcessList) => meetingApps.refresh({ processList: wantProcessList }),
      diagnostics,
      healthFor: calendarHealth,
      onHealth: (health) => orchestrator.setHealth('calendar', health),
      onChanged: (snapshot) => broadcast('agenda:changed', snapshot),
      onArmed: ({ meetingId, subject }) => announceArmed(meetingId, subject),
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
  /*
   * **The demo build has no VerySwing tenant** (DEC-28), so `crm` is null and
   * every `crm.*` intent a rep confirms is queued rather than attempted — which
   * is right, and which used to leave the meeting in `pushing` for the life of
   * the database. See `MeetingSessionOptions.routable`.
   */
  connectors.routable = (kind) => (kind === 'mail.draft' ? mail !== null : crm !== null)

  /*
   * Outlook's remedy is a **sign-in**, and it had none.
   *
   * `mailHealth` reports `retryable: true` for the two token failures — « session
   * Microsoft expirée », « reconnexion à Microsoft nécessaire » — which drew a
   * live *Réessayer* in Réglages that could not possibly work: nothing was
   * registered, so `Orchestrator.retry` returned the same failure it was given.
   * `#truthful` now clears that claim, so without this the row would correctly
   * offer nothing at all. What it should offer is the interactive re-acquire,
   * which is the thing that actually fixes an expired token.
   *
   * `signIn()` and not a silent refresh: the whole of these two errors is that
   * the silent path has already failed and Microsoft wants a human. It is the
   * same call the *Se connecter* button in Réglages makes.
   */
  if (identity) {
    orchestrator.registerRetry('mail', async () => {
      await identity.signIn()
      /*
       * **Signing in is not the same as being able to draft, and this used to
       * report `ok` for both.**
       *
       * `Mail.ReadWrite` is consented separately from the sign-in, and the
       * module enumerates the 403 that follows when it is not. A retry that
       * returned `{ state: 'ok' }` on the strength of a completed sign-in
       * painted Outlook green and failed at *Valider* — the one moment the rep
       * is told nothing can go wrong any more. So the thing a draft actually
       * needs is acquired, and its failure is the connector's own sentence.
       */
      try {
        await identity.token(MAIL_SCOPES)
        return { state: 'ok' }
      } catch (error) {
        return mailHealth(error, Date.now())
      }
    })
  }

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
  pushInFlight.ask = () => !outbox.settledSynchronously()

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
          origin: 'authored',
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
            // The memory gate attaches what it measured here. Without it a
            // refusal is just a sentence, and the sentence was wrong once.
            ...(error instanceof Error && error.cause ? { cause: error.cause } : {}),
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
    const offline = offlineOnly(settings)
    const configured = allowedByResidency(
      usableSttProviders({ stored, fields }),
      STT_PROVIDERS,
      offline,
    )
    const selection = selectProvider({
      configured,
      language: TRANSCRIPTION_LANGUAGE,
      offlineOnly: offline,
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
        language: TRANSCRIPTION_LANGUAGE,
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

        /*
         * **And the meeting is told the pass is over.**
         *
         * `pushSettled` had an entry in `UserCommand`, a rule in `TRANSITIONS`
         * and the only *guarded* rule in the whole table — and **no call site
         * anywhere in the product**. So pressing *Valider* moved a meeting into
         * `pushing` and left it there for the life of the database: `done` was
         * unreachable, and with it « Validée » on the agenda row, « Déjà
         * validée. » at the gate, and `settled` in the recipe picker. A call that
         * shipped hours ago read « Envoi… » forever, and
         * `Guards.allIntentsSettled` — correct code, tested — never ran.
         *
         * Dispatched after **every** pass, not only a clean one, and the guard is
         * what decides: all intents terminal (drained *or* failed) moves to
         * `done`, anything still pending stays in `pushing`, which is the DEC-26
         * reading — a VSA outage leaves the row visibly mid-flight rather than
         * quietly « done » with nothing in the CRM. A meeting that is not in
         * `pushing` refuses the command and the refusal is a no-op, so a
         * boot-time re-drain of an old meeting costs nothing.
         */
        orchestrator.dispatch(meetingId, 'pushSettled')
      })
      .catch((error: unknown) => {
        diagnostics.record({
          severity: 'error',
          code: 'outbox.drain.failed',
          module: 'app',
          origin: 'foreign',
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
  /*
   * **And every row the last process was still POSTing**, which is the half that
   * had no recovery at all. `drainable()` is `state = 'pending'`; a row that got
   * as far as `push.started` is `draining`, and `Outbox.#reclaim` — the thing
   * that settles it as « envoi interrompu — vérifiez dans l'outil distant avant
   * de relancer » — runs as the first line of `#drain`. So a meeting whose only
   * non-terminal row was `draining` was never named here, never drained, never
   * reclaimed, and said « envoi en cours » for the life of the database about a
   * compte-rendu that may or may not be in the client's CRM.
   */
  const stalled = store.projections.interrupted()
  for (const meetingId of new Set(
    [...store.projections.drainable(), ...stalled].map((e) => e.meetingId),
  )) {
    drain(meetingId)
  }
  if (stalled.length > 0) {
    diagnostics.record({
      severity: 'warn',
      code: 'outbox.interrupted.boot',
      module: 'app',
      origin: 'authored',
      message: `${stalled.length} envoi(s) interrompus par un arrêt de l’application — à vérifier dans l’outil distant`,
      detail: { intentIds: stalled.map((entry) => entry.intentId) },
    })
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
  /*
   * **And a meeting stranded in `recording`, which had no recovery at all.**
   *
   * `Enhancement.reconcile` handles `extracting` and deliberately cannot handle
   * this one: its `dispatch` dep is narrowed to the three extraction commands,
   * because ending a meeting is the state machine's business and not the
   * recipe's. So the sweep does it here.
   *
   * A meeting is in `recording` at boot because the previous process did not end
   * it — a crash, a SIGKILL, a battery, or a window closed during a call, which
   * on Windows is the ordinary gesture of getting the app out of the way (the
   * `before-quit` handler above now defers the quit and ends it, but that only
   * covers the gesture). There is no capture behind it: the device was released
   * when the process died. So the session screen drew a recording pill over
   * nothing, the review gate refused the meeting, `Agenda` would not re-arm it —
   * `arm` is illegal from `recording` — and nothing anywhere could end it.
   *
   * `ended` is the honest state and the one every surface already handles:
   * whatever was transcribed is in the store (DEC-12 persists as it arrives),
   * the rep's notes are theirs, and `ended` is precisely DEC-39's deferred case,
   * so the compte-rendu is written from what survived. The reason is recorded,
   * because « the app stopped » and « the rep pressed Terminer » are different
   * facts about one transition.
   */
  const interrupted = store.projections
    .listMeetings(500)
    .filter((meeting) => meeting.state === 'recording')
    .filter(
      (meeting) =>
        orchestrator.dispatch(meeting.id, 'end', 'l’application s’est arrêtée pendant l’enregistrement')
          .ok,
    )
  if (interrupted.length > 0) {
    diagnostics.record({
      severity: 'warn',
      code: 'recording.interrupted.boot',
      module: 'app',
      origin: 'authored',
      message: `${interrupted.length} enregistrement(s) interrompus par un arrêt de l’application — terminés`,
      detail: { meetingIds: interrupted.map((meeting) => meeting.id) },
    })
  }

  const stranded = store.projections
    .listMeetings(500)
    .filter((meeting) => enhancement.reconcile(meeting.id, meeting.state))
  if (stranded.length > 0) {
    diagnostics.record({
      severity: 'warn',
      code: 'enhancement.interrupted.boot',
      module: 'app',
      origin: 'authored',
      message: `${stranded.length} compte(s)-rendu interrompus par un arrêt de l’application — remis en attente`,
      detail: { meetingIds: stranded.map((meeting) => meeting.id) },
    })
  }

  /**
   * **The dry run** (`core/contracts/essai.ts`, DEC-45).
   *
   * Twenty seconds of real capture on both channels, reporting what each one
   * heard, storing nothing and transcribing nothing. It is the only thing in the
   * product that answers « will this actually record my next call » before the
   * call — every other subsystem is recoverable afterwards and capture is not.
   *
   * Three things are load-bearing.
   *
   * **It refuses while a meeting is recording.** Opening a second handle on the
   * same devices is exactly the failure `CaptureSession.start` guards against
   * internally, and the guarantee that a meeting keeps recording (DEC-26) is not
   * one to test against an onboarding screen.
   *
   * **It reuses the meeting meter.** The frames go out on `audio:level` under
   * `ESSAI_MEETING_ID`, so what a rep watches here is the same instrument, drawn
   * from the same `takeLevels` pull, as the header during a call (DEC-38). A
   * second, trial-only meter would be a second thing that can disagree.
   *
   * **It always stops.** The stop is in a `finally` and the timer is `unref`ed:
   * a trial must never be the reason a device stays open or the process refuses
   * to exit.
   */
  let essaiRunning = false
  essai.running = () => essaiRunning
  const runEssai = async (): Promise<EssaiResult> => {
    if (essaiRunning) throw new Error('Un essai est déjà en cours.')
    if (orchestrator.recording()) {
      throw new Error('Une réunion est en cours d’enregistrement — l’essai attendrait la fin.')
    }
    const loaded = CaptureSession.probe()
    if (loaded.state !== 'ok') throw new Error(loaded.reason)

    essaiRunning = true
    const session = new CaptureSession({ diagnostics, clock: () => Date.now() })
    const peak = { rep: 0, far: 0 }
    const startedAt = Date.now()
    let poll: ReturnType<typeof setInterval> | null = null

    try {
      await session.start()
      await new Promise<void>((resolve) => {
        poll = setInterval(() => {
          try {
            const levels = session.takeLevels()
            peak.rep = Math.max(peak.rep, levels.rep)
            peak.far = Math.max(peak.far, levels.far)
            broadcast('audio:level', {
              meetingId: ESSAI_MEETING_ID,
              rep: levels.rep,
              far: levels.far,
              floor: SPEECH_FLOOR,
            })
          } catch {
            // A meter that throws loses its tick. It never ends the trial.
          }
          if (Date.now() - startedAt >= ESSAI_SECONDS * 1000) resolve()
        }, ESSAI_POLL_MS)
        poll.unref?.()
      })
    } finally {
      if (poll) clearInterval(poll)
      essaiRunning = false
      // Awaited, and its failure swallowed: a device that will not close is a
      // diagnostic, not a reason to fail a trial that already has its answer.
      await session.stop().catch(() => undefined)
    }

    const result: EssaiResult = {
      rep: { heard: peak.rep > SPEECH_FLOOR, peak: Math.min(1, peak.rep) },
      far: { heard: peak.far > SPEECH_FLOOR, peak: Math.min(1, peak.far) },
      floor: SPEECH_FLOOR,
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
    }

    /*
     * **Kept, and folded into the capture row.**
     *
     * This used to be returned and nothing else. The rep read « Vous seriez
     * capté, le client non », closed the card, and the header went back to
     * « Tout fonctionne » — the exact failure the trial exists to catch,
     * surviving a rep who ran the trial and understood it.
     *
     * It outranks `audio`, the boot probe, because it is the stronger fact: the
     * probe says a device can be opened, this says sound arrived on each side.
     * A later trial replaces it; nothing else does.
     */
    const record = { ...result, at: Date.now() }
    store.appState.set(ESSAI_LAST_KEY, JSON.stringify(record))
    /*
     * **Re-measured, never the boot constant.**
     *
     * This was `essaiHealth(record) ?? audio`, and `audio` is a `const` computed
     * once at startup — so a trial that *passed* (both channels heard, so
     * `essaiHealth` returns null) republished whatever the boot probe had said
     * minutes or hours earlier. The rep who ran the twenty-second trial to prove
     * their machine works, and proved it, got the stale failure back. The
     * registered retry twenty lines above already does the right thing, which is
     * to ask the OS again.
     */
    orchestrator.setHealth(
      'capture',
      essaiHealth(record) ?? capturePermissionHealth(captureAccess(), Date.now()) ?? { state: 'ok' },
    )
    return result
  }

  registerIpc(ipcMain, {
    drain,
    pushInFlight: pushInFlight.ask,
    store,
    orchestrator,
    diagnostics,
    recorder: diagnostics,
    exportDirectory: app.getPath('downloads'),
    identity,
    agenda,
    // For the gate's *Client* picker only — one read, never a write, and never
    // fatal: see `accountCandidates` in register.ts.
    crm,
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
    // Read the same way a meeting reads it, so the switch on screen and the
    // next recording cannot disagree.
    offlineOnly: () => offlineOnly(settings),
    models: {
      start: (modelId) => downloads.start(modelId),
      cancel: (modelId) => downloads.cancel(modelId),
      section: () => resolveProviders(settings).models,
    },
    // *Demander* (DEC-21). The same per-use resolution the recipe gets, and for
    // the same reason: a key pasted in Réglages has to reach the very next
    // question, not the next launch (DEC-34).
    llm,
    essai: runEssai,
    // Consent, measured on demand. `main.ts` is the only file that knows a
    // privacy pane is a URL, and it hands the renderer a capability instead.
    capturePermission: { read: capturePermissionNow, openSettings: openCapturePane },
    capabilities: () => ({ report: probe, reason: probeReason }),
    // Read lazily: `boot:changed` and this channel must never disagree, and a
    // value captured here would freeze the state at registration time.
    bootState: () => bootState,
    updates,
    // Why there is no updater, when there is none — « indisponible dans cette
    // build » is true of a portable install and misleading about an unsigned
    // one, where the reason is the thing the rep needs to know.
    noUpdaterReason: trust.reason,
    appVersion: app.getVersion(),
    // The two window gestures the widget has, and nothing else: it cannot
    // create a window, cannot close one, and cannot move itself anywhere it
    // was not dragged.
    widget: {
      resize: (box) => overlay.resize(box),
      passThrough: (through) => overlay.passThrough(through),
      focusMain: (meetingId) => overlay.focusMain(meetingId),
      left: (afterMs) => overlay.left(afterMs),
      measuring: (withinMs) => overlay.measuring(withinMs),
    },
    broadcastMark: (meetingId, mark) => broadcast('moment:marked', { meetingId, mark }),
    broadcastForget: (meetingId, markId) => broadcast('moment:forgotten', { meetingId, markId }),
  })

  diagnostics.record({
    severity: 'info',
    code: 'app.boot',
    module: 'app',
    message: 'application démarrée',
    detail: { purgedDiagnostics: purged, dev: isDev },
  })

  // **And neither does the machine going to sleep, or off** —
  // `app/session/PowerWatch.ts`. `windows` is where Windows' `session-end` is
  // heard: it is a window event, not an `app` one (HR-2, and that file says why).
  // `onOpen` is passed a `null` when the watch decides the notice's click must not
  // navigate — another call is recording — and `focusMainWindow` answers that by
  // raising the window and broadcasting nothing (R33-3).
  watchPower({ power: powerMonitor, windows: { all: () => BrowserWindow.getAllWindows(), onOpened: (listener) => { app.on('browser-window-created', (_event, window) => listener(window)) } }, orchestrator, store, diagnostics, notification: Notification, onOpen: (id) => focusMainWindow(id, broadcast) })

  /**
   * **A window closing does not get to abandon a recording.**
   *
   * This stopped the agenda, stopped update checks and closed the store, and
   * never ended a live meeting. On Windows — the primary platform —
   * `window-all-closed` quits, so the ordinary gesture of getting the app out of
   * the way during a call ended the call with nothing: the transcriber was never
   * flushed, so the tail was lost (`stopRecording`'s own docblock calls it « the
   * part with the next steps in it »), and the meeting was left in `recording`,
   * which `Enhancement.reconcile` does not recover — it returns false for
   * anything that is not `extracting`, so unlike its sibling case there was no
   * boot recovery either. With `autoInstallOnAppQuit` a staged update then ran
   * on the way out.
   *
   * The app already knew how to ask the question: `updateReadiness` refuses a
   * ten-second installer while a call is live, two hundred lines above. It just
   * never asked it here.
   *
   * The quit is deferred, not refused. `end` is dispatched so the state machine
   * moves and the renderer hears it, and `stopRecording` is awaited so both
   * providers flush — but **enhancement is not waited for**: it can take minutes,
   * and a rep who pressed close would be looking at a window that will not go
   * away. The meeting lands in `ended`, which is exactly DEC-39's deferred case;
   * `drainDeferredEnhancements` picks it up on the next launch.
   *
   * **And for a dozen rounds « `stopRecording` is awaited so both providers
   * flush » waited for nothing at all** (R32-1). The `dispatch` one line above it
   * fires `void #enhance(id)`, whose body runs synchronously to `await
   * this.stopRecording(id)` — which runs *that* body synchronously past
   * `#recordings.delete(meetingId)`. So this handler's own call found no
   * recording and returned immediately. Measured on the real `Store` and the real
   * `Orchestrator`, with a transcriber that flushes a tail segment inside `stop()`
   * the way `LocalWhisperSession.#shutdown()` and every REST provider do: **0**
   * tail segments in the log with `onEnded` injected, which is the only
   * configuration this file ever produces, against 1 without it — and the flush
   * then landed 20 ms after `store.close()`, throwing « database is not open »
   * inside the provider where nothing records it. `Orchestrator.stopRecording`
   * memoises the flush per meeting now, so this `await` awaits the one
   * `#enhance` started.
   *
   * **Two questions, because ending a recording and flushing one are not the same
   * event.** `PowerWatch` moves the meeting out of `recording` synchronously
   * inside the OS handler — it has to, the machine may never come back — so on
   * Windows' `session-end` (« Se déconnecter », a shutdown: the one power branch a
   * rep on the primary platform can reach) the `recording` filter below finds
   * nothing and this handler did not even `preventDefault()`. Measured: « defers
   * the quit? **false** », store closed, tail lost — strictly worse after
   * `b2cc981` than before it. So `orchestrator.flushing()` is asked as well, and
   * the deferred path waits for whatever anyone else started with
   * `settleRecordings()`, which is bounded exactly as `outbox.settle()` is and for
   * the same reason.
   */
  let quitting = false
  app.on('before-quit', (event) => {
    const recording = orchestrator
      .liveIds()
      .filter((id) => orchestrator.stateOf(id) === 'recording')

    /*
     * **A push already on the wire is the other thing a quit may not abandon.**
     *
     * `review:confirm` fires the drain without awaiting it, so « press *Valider*,
     * close the window » — which on Windows quits — killed the process mid-POST
     * and left the row `draining`. The boot sweep reclaims it now, but reclaiming
     * means telling the rep to go and look in VerySwing, and waiting eight
     * seconds for the answer that is already coming is better than that.
     */
    const settling = !outbox.settledSynchronously()

    /*
     * **And a tail already being flushed is the third**, which is not the same
     * question as the first: `PowerWatch` and the widget's own *Terminer* both end
     * a recording through `dispatch`, which starts the flush and leaves the meeting
     * `ended`. The filter above cannot see that, so this is what makes « on the way
     * out » true for a Windows session end (see the docblock).
     */
    const flushing = orchestrator.flushing()

    if (!quitting && (recording.length > 0 || settling || flushing)) {
      quitting = true
      event.preventDefault()
      void (async () => {
        const endFailed = (meetingId: string, error: unknown): void => {
          diagnostics.record({
            severity: 'error',
            code: 'app.quit.endFailed',
            module: 'app',
            origin: 'foreign',
            message: error instanceof Error ? error.message : 'arrêt impossible',
            detail: { meetingId },
            meetingId,
          })
        }
        for (const meetingId of recording) {
          try {
            orchestrator.dispatch(meetingId, 'end', 'fermeture de l’application')
            /*
             * **Started here and waited for once, below, with a bound.**
             *
             * `stopRecording` memoises the flush per meeting, so this call and the
             * one `#enhance` makes on the same edge are the same flush — which is
             * the whole of R32-1's fix, and it is what lets this be `void`. It is
             * deliberately not awaited *here*: a provider's `stop()` is bounded by
             * its own budget and the local engine's is **thirty seconds**, so
             * awaiting each meeting in turn is an unbounded wait on the way out and
             * a window that will not go away. One bounded wait covers every flush,
             * including the ones this handler did not start.
             */
            void orchestrator.stopRecording(meetingId).catch((error: unknown) => {
              endFailed(meetingId, error)
            })
          } catch (error) {
            endFailed(meetingId, error)
          }
        }
        /*
         * Every flush in flight: the ones started just above, the one `PowerWatch`
         * began inside `WM_ENDSESSION` — which is why the meeting may already be
         * `ended` here — and the one the rep's own *Terminer* began a moment before
         * they closed the window. Bounded, because the tail is worth waiting for
         * and a window that never goes away is not.
         */
        if (!(await orchestrator.settleRecordings())) {
          diagnostics.record({
            severity: 'warn',
            code: 'app.quit.flushUnsettled',
            module: 'app',
            origin: 'authored',
            message:
              'la transcription n’avait pas fini de vider sa file à la fermeture — la fin de l’enregistrement peut manquer',
            detail: {},
          })
        }
        if (!(await outbox.settle())) {
          diagnostics.record({
            severity: 'warn',
            code: 'app.quit.pushUnsettled',
            module: 'app',
            message:
              'un envoi était encore en cours à la fermeture — il sera repris au prochain démarrage',
            detail: {},
          })
        }
        app.quit()
      })()
      return
    }

    agenda?.stop()
    stopUpdateChecks()
    // Before `store.close()`: the widget's own `moved` handler writes the saved
    // origin through the store, and a pill destroyed after the database is shut
    // would throw on the way out.
    overlay.hide()
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
  // The *main* window, never « the first window there is ». With a meeting
  // recording, the first window there is may be a 232-pixel pill, and a rep who
  // launched the app a second time because they could not find it would be
  // handed the thing that was already on top of everything.
  const existing = mainWindow
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
  } else {
    createWindow()
  }
})

app.on('window-all-closed', () => {
  // Windows is the primary platform (HR-2) and its convention is to quit.
  if (process.platform !== 'darwin') app.quit()
})

/**
 * **The widget does not count as a window, for either of these.**
 *
 * `window-all-closed` does not fire while any window is open, and the widget is
 * a window — so a rep on Windows who closes the app during a call would leave a
 * process with no way back into it: no taskbar entry (`skipTaskbar`), no tray,
 * and a pill whose largest control ends the recording. The recording would
 * survive the gesture, which is tempting, and then the compte-rendu would run
 * in a process the rep believes they closed and can never reach the gate.
 *
 * So the widget is closed with the main window, and the deferred quit in
 * `before-quit` does what it already did: end the live meeting properly rather
 * than abandon it. `mainWindow.on('closed')` is what makes the event fire at
 * all — `overlay.hide()` there, before Electron counts.
 */
app.on('activate', () => {
  // Same reasoning as `second-instance`: an open widget is not an open app.
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  /*
   * And the widget comes back with it. Closing the main window during a call
   * takes the pill with it — it has to, or `window-all-closed` never fires and
   * the meeting is left recording in a process with no way back into it — and
   * reopening from the Dock brought the app back and not the widget, so the rest
   * of the call had nothing on top of Teams. Nothing else re-evaluates it: the
   * sync is driven by transitions, and a recording in progress has none.
   */
  resyncOverlay?.()
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
