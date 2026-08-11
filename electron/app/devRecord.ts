/**
 * A meeting, started from the terminal, with no renderer.
 *
 * The renderer is step 5 and the "done when" for step 2 is a real call — so
 * until there is a window to press a button in, this is the only way to find
 * out whether two labelled channels of French actually reach SQLite. It is a
 * harness, not a feature: `main.ts` reaches it only under
 * `SILLAGE_DEV_RECORD=1`, and it is the one file in `app/` allowed to print.
 *
 * It deliberately refuses rather than degrades. If the native module will not
 * load there is no recording to be had, and a harness that starts anyway and
 * prints nothing for ten minutes teaches the wrong thing about the pipeline.
 */
import type { Store } from '../modules/store/index.ts'
import { CaptureSession } from '../modules/capture/index.ts'
import { isLocalWhisperReady, DEFAULT_MODEL_ID } from '../modules/transcribe/index.ts'
import type { TranscriptSegment } from '../core/contracts/transcript.ts'
import type { Orchestrator } from './session/Orchestrator.ts'

/** Static ESN vocabulary (DEC-17). The per-meeting terms come from the calendar in step 3. */
const ESN_TERMS = [
  'TJM',
  'régie',
  'forfait',
  'intercontrat',
  'staffing',
  'ESN',
  'AT',
  'astreinte',
  'CDI',
  'portage',
  'appel d’offres',
  'avant-vente',
]

const label = (channel: string): string => (channel === 'rep' ? 'MOI ' : 'EUX ')

const clock = (ms: number): string => {
  const total = Math.round(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export interface DevRecordDeps {
  store: Store
  orchestrator: Orchestrator
  /** Printed once, so a run that wrote nothing can be checked against the file. */
  dbPath: string
  /** Called when the harness is finished, so `main.ts` owns the exit. */
  onFinished: (code: number) => void
}

/**
 * How often the live echo re-reads the projection.
 *
 * It polls SQLite rather than listening to the orchestrator's broadcast, and
 * that is the point: the broadcast fires whether or not the write succeeded,
 * while step 2's "done when" is about what is *in the database*. A segment that
 * appears on screen and not in this loop is exactly the failure worth catching.
 */
const POLL_MS = 500

/**
 * Which provider to use, and whether it can actually run.
 *
 * `local-whisper` is the default because it needs no key and no network, but
 * "no key" is not the same as "ready": the weights have to be on disk for the
 * dtype this machine will ask for. Saying so here is cheaper than discovering
 * it as a 466 MB download starting the moment someone says bonjour.
 */
const resolveProvider = (): { providerId: string; apiKey: string; note: string } => {
  const requested = process.env.SILLAGE_DEV_STT?.trim() || 'local-whisper'
  const apiKey = process.env.SILLAGE_DEV_STT_KEY?.trim() ?? ''

  if (requested === 'local-whisper') {
    const model = process.env.SILLAGE_DEV_WHISPER_MODEL?.trim() || DEFAULT_MODEL_ID
    const cached = isLocalWhisperReady(model)
    return {
      providerId: requested,
      apiKey: '',
      note: cached
        ? `${model} déjà en cache`
        : `${model} PAS en cache — il sera téléchargé au démarrage (plusieurs centaines de Mo)`,
    }
  }
  return {
    providerId: requested,
    apiKey,
    note: apiKey ? 'clé fournie' : 'AUCUNE clé — définir SILLAGE_DEV_STT_KEY',
  }
}

export const runDevRecording = (deps: DevRecordDeps): void => {
  const { store, orchestrator, dbPath, onFinished } = deps

  // Before anything is created: a meeting row for a recording that cannot start
  // is worse than no row, because it looks like a meeting that produced nothing.
  const probe = CaptureSession.probe()
  if (probe.state !== 'ok') {
    console.error(`\n  ✗ capture indisponible — ${probe.reason ?? 'raison inconnue'}\n`)
    onFinished(1)
    return
  }

  const { providerId, apiKey, note } = resolveProvider()
  const meetingId = `dev-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
  const startedAt = Date.now()

  orchestrator.create({ id: meetingId, title: 'Test micro + audio système', context: null })
  const armed = orchestrator.dispatch(meetingId, 'arm', 'harnais de développement')
  if (!armed.ok) {
    console.error(`\n  ✗ ${armed.reason}\n`)
    onFinished(1)
    return
  }
  const started = orchestrator.dispatch(meetingId, 'start', 'harnais de développement')
  if (!started.ok) {
    console.error(`\n  ✗ ${started.reason}\n`)
    onFinished(1)
    return
  }

  console.log('')
  console.log(`  réunion    ${meetingId}`)
  console.log(`  provider   ${providerId} (${note})`)
  console.log(`  base       ${dbPath}`)
  console.log('')
  console.log('  Parlez dans le micro (MOI) et faites jouer du son (EUX).')
  console.log('  Ctrl-C pour arrêter et relire ce qui a été écrit.')
  console.log('')

  const print = (segment: TranscriptSegment): void => {
    console.log(`  ${clock(segment.startMs)} ${label(segment.channel)} ${segment.text.trim()}`)
  }

  let echoed = 0
  const echo = setInterval(() => {
    const segments = store.projections.segments(meetingId)
    for (const segment of segments.slice(echoed)) print(segment)
    echoed = segments.length
  }, POLL_MS)

  let stopping = false
  const stop = (): void => {
    if (stopping) return
    stopping = true
    clearInterval(echo)
    console.log('\n  … arrêt, on attend la fin des transcriptions en vol')

    void orchestrator
      .stopRecording(meetingId)
      .then(() => {
        orchestrator.dispatch(meetingId, 'end', 'harnais de développement')
        const segments = store.projections.segments(meetingId)
        const rep = segments.filter((s) => s.channel === 'rep').length
        console.log(`\n  ${segments.length} segment(s) en base — ${rep} MOI, ${segments.length - rep} EUX\n`)
        for (const segment of segments) print(segment)
        console.log('')
        onFinished(0)
      })
      .catch((err: unknown) => {
        console.error('\n  ✗ arrêt en échec:', err)
        onFinished(1)
      })
  }

  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  void orchestrator
    .startRecording(meetingId, {
      transcribe: {
        providerId,
        apiKey,
        language: 'fr-FR',
        model: process.env.SILLAGE_DEV_WHISPER_MODEL?.trim() || DEFAULT_MODEL_ID,
        boostTerms: ESN_TERMS,
      },
    })
    .then(() => {
      console.log(`  ● enregistrement démarré en ${Date.now() - startedAt} ms\n`)
    })
    .catch((err: unknown) => {
      clearInterval(echo)
      console.error('\n  ✗ démarrage impossible:', err instanceof Error ? err.message : err)
      onFinished(1)
    })
}
