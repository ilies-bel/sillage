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
 * **The whole paragraph the panel prints, composed here and nowhere else.**
 *
 * The panel used to supply a sentence of its own after the reason it was
 * handed, and the two halves could not be read together: the reason comes from
 * `core/domain/` and the panel is in `src/`, which may import `core/contracts/`
 * only — so no test could see the composed text, and both sizes of the shipped
 * renderer printed, on every Windows build (HR-2):
 *
 *   « mise à jour automatique désactivée : … vient bien de l’éditeur. Les
 *     nouvelles versions sont à installer à la main. Les nouvelles versions
 *     sont publiées sur GitHub. »
 *
 * Two consecutive sentences opening on the same three words, under a paragraph
 * opening lowercase. On the other `disabled` producer — the build with no
 * updater — the join had no punctuation at all: « … dans cette build Les
 * nouvelles versions sont publiées sur GitHub. »
 *
 * So the reason is a finished paragraph: cause, then the one remedy sentence,
 * `isWrittenSentence`-shaped (`core/contracts/health.ts`). The destination it
 * names is the control the panel puts underneath it — *Voir les versions
 * publiées* — because a named page a rep cannot reach is the dead end DEC-26
 * forbids, and a remedy stated twice is the same page named twice.
 */
export const MANUAL_INSTALL =
  'Les nouvelles versions sont à installer à la main, depuis la page des versions ' +
  'publiées sur GitHub.'

/**
 * What a build with no updater at all reports — an unpacked dev run, a portable
 * install, a build with no `app-update.yml`.
 *
 * Here rather than beside either of its two callers (`app/ipc/register.ts` and
 * `modules/update/AutoUpdate.ts`, which may not import each other) because it
 * was written out twice already and the panel appended a third fragment to it.
 * It is the same slot in the same paragraph as `updateTrust`'s reason, so it is
 * held to the same shape by the same test.
 */
export const NO_UPDATER = `Mise à jour automatique indisponible dans cette build. ${MANUAL_INSTALL}`

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
      'Mise à jour automatique désactivée : cette version n’est pas signée, rien ne pourrait ' +
      'vérifier que la mise à jour vient bien de l’éditeur. ' +
      MANUAL_INSTALL,
  }
}
