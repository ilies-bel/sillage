/**
 * The provider registry (ARCHITECTURE.md §5.D).
 *
 * HR-4 and HR-5 are data here, not branches: every row says whether it runs on
 * the machine and Réglages shows it. It does not *filter* — where a client's
 * audio may be processed is a contractual decision, and the app states what it
 * knows rather than deciding for whoever signs (DEC-37).
 *
 * `offlineOnly` is the exception and stays absolute: it is the rep asking, in
 * the product, for this meeting's audio not to leave the machine.
 *
 * This file is pure. It resolves *which* provider, never *how* to talk to one;
 * that keeps the whole selection rule unit-testable with no network and no
 * credentials.
 */
import type { SttProviderDescriptor } from '../../core/contracts/providers.ts'

/**
 * Every provider the app knows about, each saying where it runs.
 *
 * The table is the whole list: a provider the app declines to show is
 * indistinguishable from a bug, and someone who pasted a key would spend the
 * demo wondering where it went. Réglages renders the row, says where the audio
 * would go, and the operator decides.
 */
export const STT_PROVIDERS: SttProviderDescriptor[] = [
  {
    id: 'local-whisper',
    label: 'Whisper (local)',
    tier: 'local',
    auth: 'none',
    capabilities: { residency: 'local', streaming: false, languages: ['fr-FR'], cost: 'free' },
    // Whisper's `initial_prompt` is a genuine boost channel: ESN vocabulary and
    // the attendee surnames from the calendar event go in verbatim (DEC-17).
    boost: 'initialPrompt',
  },
  {
    id: 'azure-fr',
    label: 'Azure Speech (France Central)',
    tier: 'cloud',
    auth: 'apiKey',
    capabilities: { residency: 'remote', streaming: false, languages: ['fr-FR'], cost: 'metered' },
    // Optional, and defaulted to France Central — but editable, because someone
    // whose resource lives in Sweden Central needs to be able to say so without
    // an environment variable they have no way to set.
    fields: [
      { key: 'region', label: 'Région', placeholder: 'francecentral', required: false },
    ],
    // Not a mistake, and worth stating because Azure *does* have phrase lists:
    // they are a feature of the speech SDK's WebSocket protocol, not of the
    // short-audio REST endpoint this adapter uses. Claiming `phraseList` here
    // would mean silently dropping every boost term (DEC-17 says
    // capability-detected, never assumed). Streaming is `false` for the same
    // reason — the REST endpoint returns one final result per upload.
    boost: 'none',
  },
  {
    id: 'deepgram',
    label: 'Deepgram',
    tier: 'cloud',
    auth: 'apiKey',
    // The one streaming row in the table, which is why it outranks the batch
    // engines the moment the rep opts into a cloud upgrade.
    capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'metered' },
    boost: 'keyterms',
  },
  {
    id: 'groq-whisper',
    label: 'Groq (Whisper large v3 turbo)',
    tier: 'cloud',
    auth: 'apiKey',
    capabilities: { residency: 'remote', streaming: false, languages: ['fr-FR'], cost: 'metered' },
    boost: 'initialPrompt',
  },
  {
    id: 'openai-whisper',
    label: 'OpenAI (whisper-1)',
    tier: 'cloud',
    auth: 'apiKey',
    capabilities: { residency: 'remote', streaming: false, languages: ['fr-FR'], cost: 'metered' },
    boost: 'initialPrompt',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs Scribe',
    tier: 'cloud',
    auth: 'apiKey',
    // Offered since DEC-33. This row could not exist before: the requirement it
    // withdrew excluded the vendor by name, so there was no adapter to write.
    capabilities: { residency: 'remote', streaming: false, languages: ['fr-FR'], cost: 'metered' },
    // Scribe's `/v1/speech-to-text` takes no prompt, no phrase list and no
    // keyterm array — the vocabulary controls belong to their TTS side, not to
    // this endpoint. Claiming a boost channel would mean silently dropping every
    // ESN term the lexicon learned (DEC-17: capability-detected, never assumed),
    // and dropping them on the provider a rep chose *for* accuracy is worse than
    // not offering it. `streaming` is false for the same kind of reason: the
    // realtime API is a separate product surface this adapter does not speak.
    boost: 'none',
  },
]

export const descriptorFor = (id: string): SttProviderDescriptor | undefined =>
  STT_PROVIDERS.find((p) => p.id === id)

export interface SelectionInput {
  /**
   * Provider ids that are actually usable right now.
   *
   * For the cloud providers that means a credential is stored. For
   * `local-whisper` it means the model is on disk — which is a real condition,
   * not a formality, and treating the local engine as unconditionally present
   * would make the "nothing is available" case unreachable and its message
   * dead code.
   */
  configured: string[]
  /** BCP-47, `fr-FR` in v1. */
  language: string
  /** HR-4. The rep chose to keep the audio on the machine. */
  offlineOnly?: boolean
  /**
   * The opt-in half of DEC-30: take the accuracy upgrade when it is available.
   *
   * Off by default, which is what makes local the default rather than merely
   * the floor. It exists because DEC-30 *amends* DEC-2 rather than deleting it
   * — cloud STT is still allowed — and without an opt there is no such thing as
   * opt-in: a stored Azure key would be listed as usable in Réglages and then
   * never used, with no reason shown next to it.
   */
  preferCloud?: boolean
}

export type Selection = { ok: true; id: string } | { ok: false; reason: string }

/**
 * Rank order, and why it is this way round (DEC-30):
 *
 *   1. local         — the default. No network dependency, no per-minute cost,
 *                      nothing leaving the machine, no processor contract. It is the
 *                      only engine that cannot be taken away mid-meeting, which
 *                      is what makes DEC-26 true downstream of capture as well
 *                      as inside it.
 *   2. streaming     — lowest latency of the upgrades
 *   3. batch         — one flush of latency
 *
 * Nothing breaks ties within a step any more. It used to: of two upgrades that
 * behaved the same, the one with a contractual EU residency term was picked.
 * That term is no longer something a row asserts (DEC-37), so the tie falls
 * through to table order — which is a stated order in one file, rather than a
 * jurisdiction claim the software cannot keep true.
 *
 * Local ranks *first*, not last. A meeting running on the machine's own engine
 * is a meeting running normally; the cloud engines are an accuracy upgrade and
 * are reached only when the rep opts in (`preferCloud`) — at which point the
 * order among them is the old one, and local drops to the floor it also is.
 *
 * "Configured" for `local-whisper` means the weights are on disk, so this
 * cannot select an engine that would have to download itself first.
 */
export const selectProvider = (input: SelectionInput): Selection => {
  const configured = new Set(input.configured)
  const eligible = STT_PROVIDERS.filter((p) => {
    if (!configured.has(p.id)) return false
    if (!p.capabilities.languages.includes(input.language)) return false
    if (input.offlineOnly && p.capabilities.residency !== 'local') return false
    return true
  })

  const rank = (p: SttProviderDescriptor): number => {
    if (p.capabilities.residency === 'local') return input.preferCloud ? 6 : 0
    return p.capabilities.streaming ? 2 : 4
  }

  const best = eligible.slice().sort((a, b) => rank(a) - rank(b))[0]
  if (best) return { ok: true, id: best.id }

  // Say which constraint bit. "aucun fournisseur disponible" sends someone to
  // read this file; naming the constraint sends them to the setting.
  if (input.offlineOnly) {
    return { ok: false, reason: `mode hors ligne: aucun moteur local ne gère ${input.language}` }
  }
  return { ok: false, reason: `aucun fournisseur de transcription ne gère ${input.language}` }
}
