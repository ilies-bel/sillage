/**
 * `.env`, in development only.
 *
 * THE BUG THIS FIXES
 * ------------------
 * The repo shipped a `.env`, a `.env.example` and `dotenv` in `package.json` —
 * and nothing imported any of them. Every variable in that file was dead: the
 * app read `process.env` directly, so a key pasted into `.env` reached nobody.
 * The symptom was the worst kind, because it looks like a provider outage:
 * `configuredLlmProviders()` returns `[]`, `selectLlm` reports that no model is
 * configured, and the rep who just pasted a key spends the demo wondering where
 * it went. Exactly the failure `registry.ts` lists refused providers to avoid.
 *
 * WHY NOT `dotenv`
 * ----------------
 * It is a *devDependency*, so it is absent from the packaged app. Importing it
 * from `main.ts` would work on the machine where it was typed and throw
 * MODULE_NOT_FOUND in the installer — the mac-first failure shape HR-2 warns
 * about, wearing different clothes. The parser below is twenty lines, has no
 * dependency to be absent, and is unit-tested without Electron.
 *
 * TWO RULES, BOTH DELIBERATE
 * --------------------------
 *  · **The real environment always wins.** A variable already set in the shell
 *    (or by CI, or by `cross-env`) is never overwritten. `.env` is a default,
 *    not an override, so `SILLAGE_OPENAI_API_KEY=… npm start` behaves the way
 *    everyone expects and CI is never quietly reconfigured by a stray file.
 *  · **Development only.** A packaged app must not read a `.env` sitting next to
 *    its binary; that would be a configuration file the installer never wrote
 *    and the rep cannot see. Credentials in the packaged app come from the
 *    `SecretVault` (Keychain / Credential Manager), never from disk.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Parses `.env` text. Pure: no fs, no `process`, no Electron.
 *
 * Supports what a `.env` actually contains and nothing more — `KEY=value`, an
 * optional `export ` prefix, `#` comments, blank lines, and single or double
 * quoted values. A `#` inside quotes is content, because API keys and URLs
 * contain them and a naive comment-strip silently truncates the key to
 * something that fails authentication with a 401 nobody can explain.
 */
export const parseDotEnv = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = withoutExport.indexOf('=')
    if (eq <= 0) continue

    const key = withoutExport.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    let value = withoutExport.slice(eq + 1).trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1)
    } else {
      // Unquoted only: strip a trailing ` # comment`. Requires the whitespace,
      // so a `#` inside a token (`sk-a#b`, a URL fragment) survives.
      const comment = value.search(/\s+#/)
      if (comment !== -1) value = value.slice(0, comment).trimEnd()
    }
    out[key] = value
  }
  return out
}

export interface DevEnvOptions {
  /** `!app.isPackaged`. Passed in so this file never imports Electron. */
  isDev: boolean
  /** Repo root — where `.env` lives. */
  root: string
  /** Injected so a test needs no filesystem. */
  env?: NodeJS.ProcessEnv
  read?: (path: string) => string
}

/**
 * Applies `.env` to `env`, returning the names applied (for the boot log).
 *
 * Returns `[]` for every uninteresting case — packaged, no file, empty file —
 * because "no `.env`" is the normal state, not an error worth a warning.
 */
export const loadDevEnv = ({
  isDev,
  root,
  env = process.env,
  read = (path: string) => readFileSync(path, 'utf8'),
}: DevEnvOptions): string[] => {
  if (!isDev) return []

  let text: string
  try {
    text = read(join(root, '.env'))
  } catch {
    return []
  }

  const applied: string[] = []
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (env[key] !== undefined) continue
    env[key] = value
    applied.push(key)
  }
  return applied
}
