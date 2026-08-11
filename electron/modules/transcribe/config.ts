/**
 * Which transcription providers this machine can actually use. The mirror of
 * `modules/llm/config.ts`, for the same reason: the registry decides *which
 * provider is allowed* and stays pure, while this decides *which one is
 * configured* and is the only file in the module that reads a credential.
 *
 * ## Where a key comes from, and in which order (DEC-34)
 *
 * **The vault first.** A key typed into Réglages goes to the OS credential
 * store and is handed back to this module as `stored`. That is the supported
 * path, the only one available in a packaged build, and the only one a rep can
 * use — nobody sets an environment variable on a laptop handed to them by IT.
 *
 * **`process.env` second, and only as a development override.** It stays
 * because a developer running `SILLAGE_OPENAI_API_KEY=… npm start` should not
 * have to click through a settings screen first, and because CI has no
 * keychain. It is a fallback, never the interface.
 *
 * `local-whisper` is configured whichever way round: it has no credential at
 * all. That is the point of HR-4 — the weights ship inside the installer, so
 * there is a transcriber on a laptop with no network, no key and no account,
 * and the meeting path can never be blocked on one.
 */
import { descriptorFor } from './registry.ts'

export interface SttCredential {
  providerId: string
  apiKey: string
  /** Interpolated into the endpoint hostname by Azure. Validated downstream. */
  region?: string
  /** Which checkpoint a local engine loads. Ignored by the cloud providers. */
  model?: string
}

/**
 * Everything a reader may look at.
 *
 * Passed as one object rather than two positional arguments so a caller cannot
 * silently supply the environment where the vault was meant — the mistake would
 * typecheck, and its symptom would be a key entered in Réglages that appears to
 * save and never takes effect.
 */
export interface SttCredentialSource {
  /** Provider id → key, as read from `SecretVault`. The supported path. */
  stored?: Readonly<Record<string, string>>
  /**
   * Provider id → field key → value, from the settings store (DEC-34). The
   * non-secret half of a provider's configuration — Azure's region is the one
   * that exists here — kept out of the keychain because it is not a secret and
   * has to be readable back on screen.
   */
  fields?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Development override only. Defaults to the real environment. */
  env?: NodeJS.ProcessEnv
}

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim()
  return text ? text : undefined
}

/** The vault wins; the environment is the fallback underneath it. */
const keyFor = (
  providerId: string,
  source: Required<SttCredentialSource>,
  envVar: string,
): string | undefined => trimmed(source.stored[providerId]) ?? trimmed(source.env[envVar])

/** The settings store wins; the environment is the fallback underneath it. */
const fieldFor = (
  providerId: string,
  source: Required<SttCredentialSource>,
  key: string,
  envVar: string,
): string | undefined => trimmed(source.fields[providerId]?.[key]) ?? trimmed(source.env[envVar])

type Reader = (source: Required<SttCredentialSource>) => SttCredential | null

const READERS: Record<string, Reader> = {
  /**
   * No key, and never absent. `apiKey: ''` is honest rather than sloppy: the
   * local engine has no credential, and the field exists because the cloud
   * adapters share the type.
   */
  /**
   * No key, and never absent. `apiKey: ''` is honest rather than sloppy: the
   * local engine has no credential, and the field exists because the cloud
   * adapters share the type.
   */
  'local-whisper': ({ env }) => ({
    providerId: 'local-whisper',
    apiKey: '',
    ...(trimmed(env.SILLAGE_WHISPER_MODEL) ? { model: trimmed(env.SILLAGE_WHISPER_MODEL)! } : {}),
  }),

  'azure-fr': (source) => {
    const apiKey = keyFor('azure-fr', source, 'SILLAGE_AZURE_SPEECH_KEY')
    if (!apiKey) return null
    return {
      providerId: 'azure-fr',
      apiKey,
      // France Central by default, because a French ESN's resource is where its
      // reps are. Editable, since somebody else's is not.
      region: fieldFor('azure-fr', source, 'region', 'SILLAGE_AZURE_SPEECH_REGION') ?? 'francecentral',
    }
  },

  'groq-whisper': (source) => {
    const apiKey = keyFor('groq-whisper', source, 'SILLAGE_GROQ_API_KEY')
    return apiKey ? { providerId: 'groq-whisper', apiKey } : null
  },

  'openai-whisper': (source) => {
    const apiKey = keyFor('openai-whisper', source, 'SILLAGE_OPENAI_API_KEY')
    return apiKey ? { providerId: 'openai-whisper', apiKey } : null
  },

  'deepgram': (source) => {
    const apiKey = keyFor('deepgram', source, 'SILLAGE_DEEPGRAM_API_KEY')
    return apiKey ? { providerId: 'deepgram', apiKey } : null
  },

  'elevenlabs': (source) => {
    const apiKey = keyFor('elevenlabs', source, 'SILLAGE_ELEVENLABS_API_KEY')
    return apiKey ? { providerId: 'elevenlabs', apiKey } : null
  },
}

const filled = (source: SttCredentialSource = {}): Required<SttCredentialSource> => ({
  stored: source.stored ?? {},
  fields: source.fields ?? {},
  env: source.env ?? process.env,
})

/** The credential for one provider, or null when it is not configured. */
export const sttCredentialFor = (
  providerId: string,
  source: SttCredentialSource = {},
): SttCredential | null => READERS[providerId]?.(filled(source)) ?? null

/**
 * The ids to hand `selectProvider({ configured })`.
 *
 * Ordered by the registry table rather than by `Object.keys`, so the list a
 * settings screen renders matches the list the selector ranks.
 */
export const configuredSttProviders = (source: SttCredentialSource = {}): string[] => {
  const resolved = filled(source)
  return Object.keys(READERS)
    .filter((id) => descriptorFor(id) !== undefined && READERS[id]!(resolved) !== null)
    .sort((a, b) => sttOrder(a) - sttOrder(b))
}

const sttOrder = (id: string): number => ORDER.indexOf(id)
const ORDER = [
  'local-whisper',
  'azure-fr',
  'elevenlabs',
  'deepgram',
  'groq-whisper',
  'openai-whisper',
]

/** HR-4. The rep chose to keep the audio on the machine. */
export const offlineOnlyStt = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.SILLAGE_STT_OFFLINE_ONLY === '1'

/**
 * DEC-30's opt-in: take the cloud accuracy upgrade when one is configured.
 *
 * Off means local wins whenever its weights are on disk, which is the default
 * the decision asks for. Read from the environment like every other STT switch
 * here — the same seam a Réglages toggle will write to once settings are
 * persisted rather than read from `process.env` at boot.
 */
export const preferCloudStt = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.SILLAGE_STT_PREFER_CLOUD === '1'
