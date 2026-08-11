/**
 * Resolves which Anthropic-compatible endpoint the app should talk to.
 *
 * By default this is Anthropic's public API, authenticated with `x-api-key`.
 * When ANTHROPIC_BASE_URL is set the app instead targets an Anthropic-compatible
 * gateway (corporate LLM proxy, LiteLLM in Anthropic mode, …). Gateways front the
 * real key server-side and authenticate callers with a bearer token, so in that
 * mode we send `Authorization: Bearer …` and never `x-api-key` — sending both
 * would leak the tenant credential in a header the gateway forwards upstream.
 *
 * Env vars mirror the names used by Claude Code so a single set of corporate
 * settings works for both:
 *   ANTHROPIC_BASE_URL    gateway root, e.g. https://llm.example.com (no /v1)
 *   ANTHROPIC_AUTH_TOKEN  bearer token; falls back to the per-provider key the
 *                         caller already holds (env or Settings → AI Providers)
 */

export interface AnthropicEndpoint {
  /** Root URL without a trailing slash. Append `/v1/...` to build a request. */
  baseURL: string;
  /** True when pointed at a gateway rather than api.anthropic.com. */
  isGateway: boolean;
  /** Auth headers for a raw HTTP call, given the credential the caller holds. */
  authHeaders: (credential: string) => Record<string, string>;
  /**
   * Bearer token to hand the Anthropic SDK, or null when the SDK should
   * authenticate with `apiKey` in the normal way.
   */
  authToken: (credential: string) => string | null;
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * Read fresh on every call: dotenv runs during Electron bootstrap, which can land
 * after this module is first imported, so caching at module scope would snapshot
 * an empty environment.
 */
export function getAnthropicEndpoint(): AnthropicEndpoint {
  const baseURL = (process.env.ANTHROPIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const envToken = (process.env.ANTHROPIC_AUTH_TOKEN || '').trim();

  if (!baseURL) {
    return {
      baseURL: DEFAULT_BASE_URL,
      isGateway: false,
      authHeaders: (credential: string) => ({ 'x-api-key': credential }),
      authToken: () => null,
    };
  }

  const resolveToken = (credential: string): string => envToken || credential;

  return {
    baseURL,
    isGateway: true,
    authHeaders: (credential: string) => ({
      Authorization: `Bearer ${resolveToken(credential)}`,
    }),
    authToken: (credential: string) => resolveToken(credential),
  };
}
