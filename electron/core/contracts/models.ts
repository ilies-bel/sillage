/**
 * The local transcription models Réglages manages (DEC-35).
 *
 * A provider row answers "which engine", and for `local-whisper` that is not
 * the whole question: the engine is one thing and the *checkpoint* it loads is
 * another, with its own size, its own speed and its own download. This is the
 * second half.
 *
 * Three kinds of row, and the order matters because it is the order of DEC-35:
 *
 *   a. `bundled` — shipped inside the installer. No key, no download, no
 *      network. The deployment this is built for sits behind a VPN that may
 *      block huggingface.co outright, so an engine that must reach the internet
 *      to start is not a local engine at all.
 *   b. everything else — fetched from Hugging Face on demand, with progress.
 *   c. cloud engines are *providers*, not models, and are not in this table.
 *
 * ## Why `ready` is not a boolean the worker sets
 *
 * The previous implementation flipped a model to "downloaded" when its worker
 * emitted `ready`. That is the wrong authority. A dtype change or a torn
 * external-data companion leaves the graph stub on disk and the weights absent,
 * the badge says installed, and ONNX Runtime aborts at load with a `file_size`
 * error — mid-meeting, on the engine that exists to be the one that cannot fail.
 * `ready` here means **the bytes were re-counted on disk afterwards**
 * (`isModelCached`), and nothing else may set it.
 */
import { z } from 'zod'

export const ModelStatusSchema = z.enum([
  /** Not on this machine. The only status from which a download may start. */
  'absent',
  /** Bytes are arriving. `progress` is meaningful. */
  'downloading',
  /** The worker finished; the disk is being re-counted. Brief, and never skipped. */
  'verifying',
  /** Verified present. The only status `selectProvider` may treat as configured. */
  'ready',
  /** The rep cancelled. Partial bytes may remain, and are cleaned before a retry. */
  'cancelled',
  /** The download or the verification failed. `reason` says which, in French. */
  'error',
  /**
   * The app restarted while this was downloading, so there is no live worker.
   *
   * A distinct state rather than `error`, because nothing went wrong and the
   * sentence a rep reads must not say it did. Resolving it is a re-check of the
   * disk: complete on disk becomes `ready`, otherwise `absent`.
   */
  'interrupted',
])
export type ModelStatus = z.infer<typeof ModelStatusSchema>

export const ModelRowSchema = z
  .object({
    /** The Hugging Face repo id, e.g. `Xenova/whisper-small`. Stable across versions. */
    id: z.string().min(1),
    label: z.string().min(1),
    sizeMb: z.number().int().positive(),
    speed: z.enum(['fast', 'medium', 'slow']),
    /** French, because it is rendered verbatim (HR-6). */
    accuracy: z.enum(['correcte', 'bonne', 'très bonne']),
    /**
     * Shipped in the installer. Cannot be downloaded and cannot be removed —
     * it is the floor DEC-30 relies on, and a screen that offers to delete the
     * floor is offering to break the product with one click.
     */
    bundled: z.boolean(),
    status: ModelStatusSchema,
    /** 0–100. Only meaningful while `downloading`; 0 otherwise. */
    progress: z.number().min(0).max(100),
    /** Why it failed, French, rendered inline. Non-null exactly when `error`. */
    reason: z.string().nullable(),
    /** The checkpoint the local engine would load right now. */
    selected: z.boolean(),
  })
  .refine((row) => (row.status === 'error') === (row.reason !== null), {
    message: 'un modèle en erreur doit dire pourquoi, et lui seul (DEC-26)',
    path: ['reason'],
  })
  .refine((row) => !row.bundled || row.status !== 'downloading', {
    // `bundled` is a fact about the installer, not about the disk. It ships
    // present, and a packaged build where it is missing is a packaging bug —
    // but a developer checkout that has not run `fetch-whisper-model` yet is
    // an ordinary state, and a contract that made it unrepresentable would
    // crash Réglages on a fresh clone instead of explaining it. So `absent` is
    // allowed and only *downloading* is not: the bundled row has no remote to
    // download from.
    message: 'le modèle fourni avec le logiciel ne se télécharge pas (DEC-35a)',
    path: ['status'],
  })
export type ModelRow = z.infer<typeof ModelRowSchema>

export const ModelSectionSchema = z.object({
  rows: z.array(ModelRowSchema),
  /** The id the local engine would load. Null when none is ready, which the bundled row prevents. */
  selected: z.string().nullable(),
})
export type ModelSection = z.infer<typeof ModelSectionSchema>

/**
 * One model's progress, pushed while a download runs.
 *
 * Broadcast to every live window rather than answered to the caller that
 * started it. The old implementation bound these events to the `WebContents`
 * that sent the start request, and closing the settings overlay mid-download
 * made `sender.isDestroyed()` true: the bytes kept arriving and no surface ever
 * heard about it again. A download is app state, not a reply.
 */
export const ModelProgressSchema = z.object({
  id: z.string().min(1),
  status: ModelStatusSchema,
  progress: z.number().min(0).max(100),
  reason: z.string().nullable(),
})
export type ModelProgress = z.infer<typeof ModelProgressSchema>
