/**
 * What the Entra app registration is, and where it comes from.
 *
 * There is no client secret here and there must never be one. The registration
 * is a **public client** (DEC-1, multi-tenant from day one): "Allow public
 * client flows" on, redirect `http://localhost`, no credential under
 * *Certificates & secrets*. The client id it produces is public information —
 * it identifies the application, it does not authorise anything — so it ships in
 * plain sight and the rep's own sign-in is what grants access.
 */

/**
 * `organizations`, not `common`: work and school accounts only.
 *
 * `common` would also accept personal Microsoft accounts, which have no
 * Exchange calendar of the kind this product reads and would fail later, after
 * a sign-in that appeared to succeed.
 */
export const MULTI_TENANT_AUTHORITY = 'https://login.microsoftonline.com/organizations'

export interface IdentityConfig {
  clientId: string
  authority: string
  /**
   * Fixed loopback port, when the registration pins one. Omitted, MSAL picks a
   * free port and Entra accepts it — `http://localhost` matches any port for a
   * public client, which is exactly why no port is hard-coded by default.
   */
  redirectPort?: number
}

/**
 * The registration is not in the repo because it is not ours to create: it lives
 * in the tenant that will run the demo. Absent, this returns null and the
 * calendar connector comes up `down` with a reason a human can act on, rather
 * than the app failing at the first Graph call (DEC-26).
 */
export const resolveIdentityConfig = (
  env: NodeJS.ProcessEnv = process.env,
): IdentityConfig | null => {
  const clientId = env.SILLAGE_ENTRA_CLIENT_ID?.trim()
  if (!clientId) return null

  const port = Number(env.SILLAGE_ENTRA_REDIRECT_PORT ?? '')
  return {
    clientId,
    // A single-tenant override exists for the case where a client refuses
    // multi-tenant consent. It is the exception; the default is DEC-1.
    authority: env.SILLAGE_ENTRA_AUTHORITY?.trim() || MULTI_TENANT_AUTHORITY,
    ...(Number.isInteger(port) && port > 0 ? { redirectPort: port } : {}),
  }
}
