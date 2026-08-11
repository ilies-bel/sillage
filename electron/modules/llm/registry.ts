/**
 * The LLM provider registry — the same idea as `modules/transcribe/registry.ts`,
 * for a different capability (ARCHITECTURE.md §5.D).
 *
 * HR-5 is **data** here: every row declares whether it runs on the machine, and
 * the screen shows it. What this file does *not* do is refuse a provider over
 * it. Where a transcript may legally be processed depends on the client, the
 * contract and what the transcript contains — the app is in no position to
 * decide that on the operator's behalf, and rows stopped claiming it (DEC-37).
 * It states what it knows and lets them choose.
 *
 * The one thing it still guarantees is `offlineOnly`: when the rep asks for
 * nothing to leave the machine, that is a request made *in* the product about
 * *this* meeting, and it is honoured absolutely.
 *
 * This file is pure: no network, no fs, no Electron, no `process.env`. Which
 * key is present is the caller's problem (`config.ts`); *which provider that
 * makes legal* is decided here, and can therefore be tested with no
 * credentials at all.
 *
 * There is no `language` input, unlike the STT registry. Every model in the
 * table writes French; that it does so is a property of the instruction
 * (HR-6, DEC-22), not of the provider. A knob nobody turns is a knob that
 * eventually gets turned wrong.
 */
import type { LlmProviderDescriptor } from '../../core/contracts/providers.ts'

/**
 * Every provider the app knows about, each saying where it runs.
 *
 * The table is the whole list, exactly as in the STT registry — a provider the
 * app declines to *show* is indistinguishable from a bug, and the rep who
 * pasted that key will spend the demo wondering where it went. Réglages renders
 * the row, states where the data would go, and the operator decides.
 *
 * `structuredOutput` is "can this provider be held to a JSON schema *natively*",
 * and it is claimed only where it is true of the endpoint we actually call. When
 * false, `modules/extract/` still gets a validated object — the adapter parses
 * and revalidates against the caller's zod schema either way (DEC-7). Claiming
 * it falsely would not lose validation; it would lose the *first* attempt to
 * every large extraction, which is the expensive one.
 */
export const LLM_PROVIDERS: LlmProviderDescriptor[] = [
  {
    id: 'local-openai',
    label: 'Modèle local (Ollama / vLLM / LM Studio)',
    tier: 'self-hosted',
    auth: 'apiKey',
    // HR-5's floor. Nothing leaves the machine, so where it is processed is not
    // a question anyone has to answer — which is why this row is the one that
    // can never be blocked, and why the fallback lands here.
    capabilities: { residency: 'local', streaming: true, languages: ['fr-FR'], cost: 'free' },
    // Both required, and neither is guessed. Ollama, vLLM and LM Studio all
    // reject an unknown model name, so a default would fail at the first
    // extraction with a 404 that reads like an outage — an unset model is a
    // configuration gap and must read as one.
    fields: [
      {
        key: 'url',
        label: 'URL du serveur',
        placeholder: 'http://localhost:11434/v1',
        required: true,
      },
      { key: 'model', label: 'Modèle', placeholder: 'llama3.1:8b', required: true },
    ],
    // The three servers behind this row disagree: LM Studio takes
    // `response_format: json_schema`, Ollama takes `format`, vLLM takes
    // `guided_json`, and an arbitrary OpenAI-compatible server takes none of
    // them. One id cannot honestly claim a capability three implementations
    // implement differently, so it claims none and the adapter asks for JSON in
    // the prompt and revalidates. Capability-detected, never assumed.
    structuredOutput: false,
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    tier: 'cloud',
    auth: 'apiKey',
    // A hosted API: the transcript of a client call is the payload, and it
    // leaves this machine to be processed. Which jurisdiction that lands in is
    // a contract question with a different answer per client, so the row does
    // not answer it (DEC-37) — it says the audio leaves, which is true.
    capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'metered' },
    // `response_format: { type: 'json_schema' }` on La Plateforme.
    structuredOutput: true,
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI (France Central / Sweden Central)',
    tier: 'cloud',
    auth: 'apiKey',
    // A regional deployment pins data at rest and in transit to the chosen
    // region, under the tenant's own contract. That is worth having and it is
    // still not something *this table* can assert: the region is whatever the
    // operator's endpoint points at, which is why `config.ts` requires the host
    // to be given explicitly rather than defaulted.
    capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'metered' },
    // Required rather than defaulted for that reason: a default host would be a
    // default region, chosen by us, on somebody else's deployment.
    fields: [
      {
        key: 'endpoint',
        label: 'Point de terminaison',
        placeholder: 'https://mon-esn.openai.azure.com',
        required: true,
      },
      { key: 'deployment', label: 'Déploiement', placeholder: 'gpt-4o', required: true },
    ],
    structuredOutput: true,
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT (abonnement)',
    tier: 'cloud',
    // The grant `codex login` obtained, borrowed off disk — see
    // `chatgptGrant.ts` for why this app reads that flow's result rather than
    // running one of its own. `oauth` because there is no key to type, which is
    // the only thing this field promises the screen.
    auth: 'oauth',
    // Same destination as the row below it — `chatgpt.com` is OpenAI — so the
    // answer is identical and is stated identically. A subscription does not
    // move where the transcript is processed.
    capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'included' },
    // Optional, and the escape hatch for the one thing about this row that is
    // certain to rot: the endpoint serves a short, account-specific list of
    // names and refuses everything else in words. Codex's own `config.toml`
    // answers for almost everyone; this is for when it does not.
    fields: [
      { key: 'model', label: 'Modèle', placeholder: 'celui de Codex', required: false },
    ],
    // The Codex endpoint takes `text.format: json_schema`. Not an assumption:
    // it is the one thing that makes this row worth having over the Platform
    // API for an extraction held to `LlmInterpretation` (DEC-7).
    structuredOutput: true,
  },
  {
    id: 'openai',
    label: 'OpenAI (clé API)',
    tier: 'cloud',
    auth: 'apiKey',
    capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'metered' },
    structuredOutput: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    tier: 'cloud',
    auth: 'apiKey',
    capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'metered' },
    // Tool-shaped, not `response_format`-shaped, and not reachable through the
    // OpenAI-compatible adapter at all — which is why `config.ts` has no reader
    // for it and the row can never report itself configured.
    structuredOutput: false,
  },
  {
    id: 'groq',
    label: 'Groq',
    tier: 'cloud',
    auth: 'apiKey',
    // US processing. Fast and cheap, and it is the one someone will be tempted
    // to reach for during the demo — which is exactly why the row exists rather
    // than the provider being left out.
    capabilities: { residency: 'remote', streaming: true, languages: ['fr-FR'], cost: 'metered' },
    structuredOutput: true,
  },
]

export const descriptorFor = (id: string): LlmProviderDescriptor | undefined =>
  LLM_PROVIDERS.find((p) => p.id === id)

export interface LlmSelectionInput {
  /**
   * Provider ids that are usable right now. For a hosted provider that means a
   * stored credential; for `local-openai` it means a base URL is configured.
   *
   * The local row is not implicitly present. HR-5 makes it *always selectable*,
   * not always installed — treating an unconfigured Ollama as available would
   * make "aucun modèle configuré" unreachable and its message dead code, and
   * the failure would surface as a connection refused mid-extraction instead.
   */
  configured: string[]
  /** HR-4/HR-5. The rep chose to keep the transcript on the machine. */
  offlineOnly?: boolean
}

export type LlmSelection = { ok: true; id: string } | { ok: false; reason: string }

/**
 * Rank order, and why it is this way round:
 *
 *   1. hosted with native schema binding — best extraction
 *   2. hosted without it                 — one revalidation round trip more
 *   3. local                             — the floor (HR-5)
 *
 * Local ranks last rather than first for the same reason it does in the STT
 * registry: demo beat #3 is judged on whether the compte-rendu reads like the
 * rep's own, and a 7B model on a laptop is a *floor*, not a default. It still
 * wins whenever nothing above it is usable — which is the case this ordering
 * exists to guarantee.
 *
 * Within one rank the table order decides, which is why `chatgpt` sits above
 * `openai`: they reach the same models in the same place, and one of them is
 * already paid for. Someone with both configured did not do that in order to be
 * billed twice.
 *
 * Nothing breaks ties inside a tier any more. It used to: of two providers that
 * would extract equally well, the one with a contractual EU residency term was
 * taken. Rows stopped asserting that term (DEC-37) — it is a per-client, per-
 * contract fact the software cannot keep true — so a tie now falls through to
 * table order, which is written down here and stays written down.
 */
export const selectLlm = (input: LlmSelectionInput): LlmSelection => {
  const configured = new Set(input.configured)
  const eligible = LLM_PROVIDERS.filter((p) => {
    if (!configured.has(p.id)) return false
    if (input.offlineOnly && p.capabilities.residency !== 'local') return false
    return true
  })

  const rank = (p: LlmProviderDescriptor): number => {
    if (p.capabilities.residency === 'local') return 4
    return p.structuredOutput ? 0 : 2
  }

  const best = eligible.slice().sort((a, b) => rank(a) - rank(b))[0]
  if (best) return { ok: true, id: best.id }

  // Name the constraint that bit. "aucun fournisseur disponible" sends someone
  // to read this file; naming the constraint sends them to the setting.
  if (input.offlineOnly) {
    return {
      ok: false,
      reason: 'mode hors ligne: aucun modèle local n’est configuré (renseignez l’URL du serveur)',
    }
  }
  return { ok: false, reason: 'aucun modèle de langage n’est configuré' }
}
