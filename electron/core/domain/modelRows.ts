/**
 * The model table Réglages renders (DEC-35), as a pure function.
 *
 * The sibling of `providerRows.ts`, and split from it for the same reason: the
 * catalogue lives in `modules/transcribe/whisper/`, the download state lives in
 * `app/`, and `core/` may import neither. Both are passed in, so the whole rule
 * — which checkpoint is offered, which is usable, which is downloading, which
 * one the engine would load — is testable with no Electron, no worker thread and
 * no bytes on disk.
 *
 * ## What "ready" is allowed to mean here
 *
 * Only what the caller proved by counting bytes. This function never infers
 * readiness from a download having finished, because that inference is exactly
 * the bug the previous implementation shipped: a worker emitted `ready`, the
 * badge flipped, and a torn external-data companion meant ONNX Runtime aborted
 * at load — mid-meeting, on the engine that exists to be the one that cannot
 * fail. `ready` is a list the caller computed from `isModelCached`.
 */
import type { ModelRow, ModelSection, ModelStatus } from '../contracts/models.ts'

/** The half of a catalogue entry this needs. `WhisperModel` satisfies it. */
export interface ModelDescriptorLike {
  id: string
  label: string
  sizeMb: number
  speed: 'fast' | 'medium' | 'slow'
  accuracy: 'correcte' | 'bonne' | 'très bonne'
}

/** One model's live download, as `app/` knows it. */
export interface ModelActivity {
  status: ModelStatus
  progress: number
  reason: string | null
}

export interface ModelRowsInput {
  /**
   * The checkpoint shipped inside the installer (DEC-35a).
   *
   * It is a *different* claim from "present on disk": a packaged build always
   * ships it, a developer checkout that has not run `fetch-whisper-model` has
   * the row and not the bytes. Both are drawn; only the second says so.
   */
  bundledId: string
  /** Ids whose files were verified on disk. The only source of `ready`. */
  ready: readonly string[]
  /** In-flight or recently finished downloads, keyed by model id. */
  activity?: Readonly<Record<string, ModelActivity>>
  /**
   * The checkpoint the local engine would load, if the caller has a preference
   * stored. Null falls through to the resolution below.
   */
  preferred?: string | null
}

/**
 * What a row with no live download reports.
 *
 * `ready` when the bytes are there, `absent` otherwise — and nothing in
 * between, because every other status describes an operation in progress and
 * there is none.
 */
const restingStatus = (id: string, ready: readonly string[]): ModelStatus =>
  ready.includes(id) ? 'ready' : 'absent'

/**
 * An in-flight status only overrides the resting one while it is still about
 * something happening.
 *
 * A finished download that left the disk complete is `ready` on the strength of
 * the disk, not of the event — so a stale `complete` entry in the activity map
 * cannot outvote a model someone deleted from `userData` behind the app's back.
 */
const statusFor = (id: string, input: ModelRowsInput): ModelActivity => {
  const live = input.activity?.[id]
  const resting = restingStatus(id, input.ready)
  if (!live) return { status: resting, progress: 0, reason: null }
  if (live.status === 'downloading' || live.status === 'verifying') return live
  if (live.status === 'error' || live.status === 'cancelled' || live.status === 'interrupted') {
    // A failure is worth keeping on screen — but not once the bytes arrived by
    // some other route, which is what a `ready` disk means.
    return resting === 'ready' ? { status: 'ready', progress: 100, reason: null } : live
  }
  return { status: resting, progress: resting === 'ready' ? 100 : 0, reason: null }
}

/**
 * Which checkpoint the local engine loads.
 *
 * The rep's preference wins, but only while it is actually loadable: a model
 * that was selected and then deleted must not leave the engine pointing at
 * nothing. The bundled one is the fallback precisely because DEC-35a makes it
 * the one that is always there, and the first ready row is the fallback after
 * *that* for the developer checkout where the bundled bytes were never fetched.
 */
export const resolveSelectedModel = (input: ModelRowsInput): string | null => {
  const usable = (id: string | null | undefined): id is string =>
    typeof id === 'string' && input.ready.includes(id)
  if (usable(input.preferred)) return input.preferred
  if (usable(input.bundledId)) return input.bundledId
  return input.ready[0] ?? null
}

export const modelRows = (
  catalogue: readonly ModelDescriptorLike[],
  input: ModelRowsInput,
): ModelRow[] => {
  const selected = resolveSelectedModel(input)
  return catalogue.map((model) => {
    const { status, progress, reason } = statusFor(model.id, input)
    return {
      id: model.id,
      label: model.label,
      sizeMb: model.sizeMb,
      speed: model.speed,
      accuracy: model.accuracy,
      bundled: model.id === input.bundledId,
      status,
      // Pinned to the status rather than passed through, so a stale 87% cannot
      // sit under a row that has since failed or finished.
      progress: status === 'downloading' ? progress : status === 'ready' ? 100 : 0,
      reason: status === 'error' ? (reason ?? 'échec du téléchargement') : null,
      selected: model.id === selected,
    }
  })
}

export const modelSection = (
  catalogue: readonly ModelDescriptorLike[],
  input: ModelRowsInput,
): ModelSection => ({
  rows: modelRows(catalogue, input),
  selected: resolveSelectedModel(input),
})
