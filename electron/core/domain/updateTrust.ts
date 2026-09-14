/**
 * **An update this machine cannot verify is not an update it should install.**
 *
 * `electron-updater` downloads an installer from the release feed and runs it.
 * On Windows it will check that installer's Authenticode signature against the
 * expected publisher — *if it has one to check against*. That name comes from
 * `build.win.publisherName` or from the certificate in `build.win.certificateFile`,
 * and this build declares neither: `package.json` carries a `publish` feed, the
 * NSIS installer is produced unsigned, and the verification step is therefore
 * skipped rather than failed. What ships is a one-click « Installer et
 * redémarrer » that executes whatever the feed served, with nothing standing
 * between the rep and a swapped asset but TLS and a GitHub account.
 *
 * macOS is a different story and needs no rule here: `zip`/`dmg` updates are
 * verified by the OS against the app's own signature, and the app is ad-hoc
 * signed (`scripts/ad-hoc-sign.js`) rather than distributed through an
 * auto-update feed a stranger could reach.
 *
 * So the updater is not constructed at all on an unsigned Windows build, and
 * the panel says why. That is DEC-26's shape — a stated degradation, never a
 * silent one — and it is deliberately **not** a build failure: the first
 * deliverable is a demo installer (DEC-28), reps are on Windows (HR-2), and
 * refusing to produce an installer until somebody buys a certificate would stop
 * the product shipping to defend a feature it does not need yet. What it stops
 * is the *unverified install*, which is the part that could hurt somebody.
 *
 * Signing is what lifts it: set `publisherName` (and sign), and this returns
 * `ok` with nothing else to change.
 */

export interface BuildTrust {
  /** `build.win.publisherName`, if the packaging config declares one. */
  publisherName?: string | string[] | null
  /** `build.win.certificateFile`, if the packaging config declares one. */
  certificateFile?: string | null
}

export interface UpdateTrust {
  ok: boolean
  /** French, for the panel. Null when updates are verifiable. */
  reason: string | null
}

export const VERIFIED = { ok: true, reason: null } as const

/**
 * Whether an update downloaded on this platform could be checked before it runs.
 *
 * Platform-tested rather than capability-tested, and that is the one place this
 * rule differs from the rest of the product: the question *is* about the
 * platform's own verification mechanism, so there is nothing to probe. It is
 * declared in `scripts/check-platform.mjs` for that reason.
 */
export const updateTrust = (platform: string, win: BuildTrust | null): UpdateTrust => {
  if (platform !== 'win32') return VERIFIED
  const named =
    typeof win?.publisherName === 'string'
      ? win.publisherName.trim() !== ''
      : Array.isArray(win?.publisherName) && win.publisherName.length > 0
  const certified = typeof win?.certificateFile === 'string' && win.certificateFile.trim() !== ''
  if (named || certified) return VERIFIED
  return {
    ok: false,
    reason:
      'mise à jour automatique désactivée : cette version n’est pas signée, rien ne pourrait ' +
      'vérifier que la mise à jour vient bien de l’éditeur. Les nouvelles versions sont à ' +
      'installer à la main.',
  }
}
