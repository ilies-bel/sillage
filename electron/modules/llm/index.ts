/**
 * The LLM module's surface, plus the one translation `app/` needs: a failure
 * into a `ConnectorHealth` a human can act on — the same job
 * `modules/calendar/index.ts` does for Graph.
 *
 * The state split is the interesting part, and it follows DEC-26 rather than
 * HTTP. Almost every LLM failure is `degraded`, not `down`: the meeting is still
 * being recorded (nothing downstream may stop capture), the rep's own notes are
 * untouched (DEC-5), and a compte-rendu that has to be regenerated is an
 * inconvenience. Only a refused key is `down`, because until someone edits a
 * setting nothing will work — and it is the one case with `retryable: false`,
 * since a retry button there is the dead affordance DEC-26 forbids.
 */
import type { ConnectorHealth } from '../../core/contracts/health.ts'
import { LlmError } from '../../core/contracts/llm.ts'

export { LLM_PROVIDERS, descriptorFor, selectLlm } from './registry.ts'
export type { LlmSelection, LlmSelectionInput } from './registry.ts'
export {
  configuredLlmProviders,
  llmEndpointFor,
  llmRefusalReasons,
  DEFAULT_CHATGPT_MODEL,
} from './config.ts'
export type { LlmEndpointConfig } from './config.ts'
export { readCodexGrant, codexAuthPath, codexModel, CHATGPT_BASE_URL } from './chatgptGrant.ts'
export type { CodexGrant, GrantResult } from './chatgptGrant.ts'
export {
  OpenAiCompatibleLlm,
  contentOf,
  responseTextOf,
  jsonText,
  toJsonSchema,
  DEFAULT_COMPLETE_TIMEOUT_MS,
  DEFAULT_STRUCTURED_TIMEOUT_MS,
} from './OpenAiCompatibleLlm.ts'
export type { FetchLike, OpenAiCompatibleOptions } from './OpenAiCompatibleLlm.ts'

export const llmHealth = (error: unknown, at: number): ConnectorHealth => {
  if (error instanceof LlmError) {
    switch (error.kind) {
      case 'auth':
        // Not retryable: waiting does not correct a key. Someone has to open
        // the settings, and the banner should say that rather than spin.
        return {
          state: 'down',
          reason: 'clé API du modèle invalide ou absente — vérifiez la configuration',
          since: at,
          retryable: false,
        }
      case 'quota':
        return {
          state: 'degraded',
          reason: 'quota du fournisseur de modèle atteint — réessayez dans quelques instants',
          since: at,
          retryable: true,
        }
      case 'timeout':
        return {
          state: 'degraded',
          reason: 'le modèle n’a pas répondu à temps',
          since: at,
          retryable: true,
        }
      case 'server':
        return {
          state: 'degraded',
          reason: 'fournisseur de modèle temporairement indisponible',
          since: at,
          retryable: true,
        }
      case 'network':
        return {
          state: 'degraded',
          reason: 'fournisseur de modèle injoignable — vérifiez la connexion',
          since: at,
          retryable: true,
        }
      case 'schema':
        // The connector is healthy; this reply was not. Regenerating is the
        // remedy, so the retry affordance is real.
        return {
          state: 'degraded',
          reason: 'réponse du modèle non conforme au format attendu',
          since: at,
          retryable: true,
        }
      case 'unknown':
        // A 4xx we caused — a model name that does not exist on this server, a
        // context overflow. `retryable` carries the adapter's own verdict rather
        // than a guess made here.
        return { state: 'down', reason: error.message, since: at, retryable: error.retryable }
    }
  }

  return {
    state: 'down',
    reason: error instanceof Error ? error.message : 'modèle de langage indisponible',
    since: at,
    retryable: true,
  }
}
