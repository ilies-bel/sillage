#!/usr/bin/env node
/**
 * Render one screen of the Sillage renderer in a plain Chromium: write a PNG,
 * and — with `--scan` — run impeccable's detector inside that same rendered page.
 *
 *   node scripts/harness/shot.mjs <screen> [out.png] [options]
 *
 *   --viewport WxH   default 1440x900
 *   --expand         unclip the inner scrollers so `fullPage` means the screen
 *   --no-expand      keep them clipped even on a screen whose plan expands
 *   --scan [out.json]  run the impeccable browser detector on the staged screen
 *   --no-png         scan only
 *   --geometry       measure the hanging markers against the box they hang in
 *   --targets        measure every control against WCAG 2.2's 24×24 minimum
 *   --prose          count the characters a line of each prose surface really holds
 *   --echo           fail on a visible string the screen draws more than once
 *   --a11y           names on controls, labels on fields, and the heading ladder
 *   --contrast       every text run against the ground it is painted on (WCAG AA)
 *   --scrollers      content hidden inside a scroller the arming guard cannot see
 *   --motion         every transition through the tokens, and silent under reduced motion
 *   --fade           every fading mask against the line box it fades over
 *   --census         how many rungs of one ladder a screen stands on at once
 *   --rhythm         every painted gap, padding and margin against the declared scale
 *   --cells          a growing cell short of its text while its fixed siblings hold slack
 *   --sans-entra     stage any screen with **no Entra app registration** — the
 *                    case the first demo ships in (DEC-28). Signed out with
 *                    nothing to sign into, empty agenda, calendar and Outlook
 *                    `down` and not retryable.
 *
 * Screens: splash · agenda · agenda-empty · agenda-semaine · agenda-liste ·
 * agenda-client · agenda-search · session · review · review-rail ·
 * review-rail-inerte · review-valider · review-sans-opportunite-valider · review-refus ·
 * widget-survol ·
 * review-transcription ·
 * review-transcription-introuvable · historique · reglages ·
 * agenda-appel-imprevu · agenda-sans-entra · session-sans-entra · review-sans-entra ·
 * reglages-sans-entra
 *
 * How it works: the renderer talks to the main process through `window.app`,
 * which only exists because the Electron preload put it there. `bridge-stub.mjs`
 * installs the same two-method object via `page.addInitScript`, so it is in
 * place before `main.tsx` runs and every screen loads real-shaped data instead
 * of an error state.
 *
 * Run it from anywhere — `playwright` is resolved out of the repo's own
 * node_modules by the import below.
 */
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { installAppBridge } from './bridge-stub.mjs'
import { fileURLToPath } from 'node:url'
import { pinnedNow } from './pinnedNow.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(path.join(REPO, 'package.json'))
const { chromium } = require('playwright')

const URL_BASE = process.env.SILLAGE_URL ?? 'http://localhost:5180'

/**
 * **The dev server on the other end has to be serving *this* checkout.**
 *
 * `URL_BASE` is a hardcoded port, and every round of this repo is measured from
 * a worktree while the live checkout keeps a `npm run dev -- --port 5180` of its
 * own. So the default aims the whole instrument — `smoke.mjs`'s 156 stagings and
 * all ten checks — at whichever tree happens to own 5180, and nothing anywhere
 * said which tree that was.
 *
 * Driven, in the round that added this: `.measure` was deleted from the review
 * gate's refusal in a worktree and `--prose` reported « aucune ligne au-delà de
 * 75 caractères », twice, at both sizes. The same run against the worktree's own
 * port reports « 197 car./ligne — p.text-danger [hors .measure] ». A check that
 * stays green over a defect that is in the tree is worse than no check: the
 * falsification step this repo requires of every new instrument — revert the fix
 * and watch it go red — silently becomes a no-op for anyone in a worktree.
 *
 * Vite answers that question itself. `/@fs/<abs>` is served only for paths inside
 * the server's own `server.fs.allow` root, so the checkout this file lives in is
 * **200** from its own dev server and **403** from any other — measured both ways
 * between two servers on one machine. No version string to keep in step, nothing
 * to stamp, and it stays right when the two trees hold identical source, which is
 * exactly when the confusion is invisible.
 *
 * The path is normalised rather than branched on: Vite takes a POSIX-shaped
 * `/@fs/C:/…` on Windows too (HR-2), so there is no platform signal here.
 */
const FS_PROBE = '/@fs/' + REPO.replace(/\\/g, '/').replace(/^\/+/, '')

async function servingThisRepo(base) {
  let response
  try {
    response = await fetch(`${base}${FS_PROBE}/package.json`)
  } catch (error) {
    return { ok: false, why: `injoignable — ${error.message}` }
  }
  if (response.status === 200) return { ok: true }
  return {
    ok: false,
    why:
      response.status === 403
        ? 'un autre dépôt — Vite y refuse le chemin de ce checkout'
        : `réponse inattendue ${response.status} sur ${FS_PROBE}/package.json`,
  }
}

/**
 * **Wait until nothing on the page is moving, then measure.**
 *
 * `--contrast` already carries half of this rule and states why:
 * `getComputedStyle` returns the current *animated* value, which is how the
 * bundled detector reads a resting 14:1 button as 4.0:1. Geometry has the same
 * hole one property over and it is worse, because `getBoundingClientRect`
 * **includes transforms** — a control inside a card that is 97% of the way
 * through its arrival measures 23.26px, which is a WCAG failure reported against
 * a 24px control and a 3px « the chevron moved under the pointer » reported
 * against a chevron that did not move. Both of those are measured: they are what
 * `widget-ouvert` produced on the first run after DEC-50 put a `scale` on the
 * pill, and an intermittent failure on a stage that has nothing to do with the
 * feature is the worst shape a check can have.
 *
 * Called in two places and both are needed. Here, before the eight checks, which
 * covers every stage at once. And **inside** a stage, by name, wherever the stage
 * itself measures a box — the post-`drive` call cannot help those, because they
 * have already happened by then.
 *
 * Infinite animations are excluded rather than waited for: the motion self-test
 * injects one deliberately and a spinner would hang this for ever. The wait is
 * **bounded and silent** — a page that legitimately never settles must still be
 * measured and reported on, because a harness that refuses to look is the false
 * green this repo has shipped five times.
 */
/**
 * A frame nothing is moving on — **including a departure the renderer is holding.**
 *
 * `getAnimations()` answers for what the compositor is running. A departure is
 * not only that: the element stays mounted on a JS timer for one `--motion`
 * after its exit finishes, so there is a window where every animation has
 * settled and a surface is still on screen wearing `scale(0.92)`.
 *
 * That window is not a frame to measure. `widget-pause-refus` found it the hour
 * the panel learnt to leave when the meeting ends: eleven controls reported at
 * **22 px** against the 24 px floor, and 22 is 24 × 0.92 — the exit's own scale,
 * measured on a panel that was on its way out. Nothing was under-sized; the
 * instrument was reading a frame the rep cannot press on.
 *
 * So a class ending `-leaving` counts as motion. It is the renderer's own name
 * for the state (`widget-panel-leaving`, `widget-card-leaving`, `.leaving`), and
 * `useDeparture` removes the element rather than the class, so waiting for it to
 * go is waiting for the hold to end.
 */
const settled = (page) =>
  page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming?.().iterations !== Infinity)
          .every((a) => a.playState !== 'running') &&
        document.querySelector('[class*="-leaving"], .leaving') === null,
      undefined,
      { timeout: 2_000 },
    )
    .catch(() => undefined)

/**
 * **Every painted frame of a departure, and the moment the element detaches.**
 *
 * A census of what is animating — which is what `--motion` takes — cannot answer
 * the question a departure actually poses: *was the last thing a rep saw a fade
 * or a snap*. Round 18 found `useDismiss` tearing its surface off the screen at
 * 0.44 opacity while every check stayed green, and the same measurement run on
 * `useDeparture` in round 19 gave 0.237 / 0.241 / 0.238. Nothing in this file
 * could see either.
 *
 * `MutationObserver` for the detach, because it is the one event that is exact,
 * and `requestAnimationFrame` for the opacity, so « the last value painted » is
 * the last one a rep could have seen.
 *
 * `target` picks the element that leaves; `press` is the control that sends it.
 */
const departureOf = (page, target, press) =>
  page.evaluate(
    async ({ target, press }) => {
      const going = document.querySelector(target)
      if (!going) return { error: `rien à écarter pour ${target}` }
      const control = document.querySelector(press)
      if (!control) return { error: `le contrôle ${press} est introuvable` }
      const parent = going.parentElement
      const samples = []
      let detachedAt = null
      const started = performance.now()
      const observer = new MutationObserver(() => {
        if (!going.isConnected && detachedAt === null) detachedAt = performance.now() - started
      })
      observer.observe(parent, { childList: true, subtree: true })
      const tick = () => {
        if (!going.isConnected) return
        samples.push(Number(getComputedStyle(going).opacity))
        requestAnimationFrame(tick)
      }
      control.click()
      requestAnimationFrame(tick)
      await new Promise((resolve) => setTimeout(resolve, 900))
      observer.disconnect()
      return { samples, detachedAt }
    },
    { target, press },
  )

/**
 * A departure is a fade or it is a failure.
 *
 * Two claims, and the second is the one a class name cannot make: frames were
 * painted *between* the two ends, and the last of them was at zero. An element
 * held on screen for a whole `--motion` and spending all of it transparent
 * passes the first and fails the second, which is exactly what the widget card's
 * exit did when it was written as a transition under a filled arrival.
 *
 * **`session-attente-sortie` argues the opposite about the same measurement, and
 * the argument is now measured rather than inherited.** That stage records the
 * last sampled opacity flaking at 0.40 and 0.56 « under `smoke.mjs`'s four
 * parallel lanes », and measures a held *duration* instead. The tracer it was
 * written against re-queried `[role="status"].leaving` every frame; this one
 * follows one node and stops on `isConnected`, so the last sample is the last
 * frame the element was alive for however starved the loop got.
 *
 * Driven on the three app-window sites added this round, five rounds of
 * `reglages-sortie`, `review-source-sortie` and `agenda-ligne-sortie` at both
 * smoke sizes, four in flight at a time (`scratch/x-stress.mjs`): **30 mesures,
 * 0 échec, min 0.000, médiane 0.000, max 0.000** against a 0.05 threshold. The
 * distribution has no tail to trip over. Re-run that before widening the
 * threshold, and re-run it before narrowing it.
 */
const judgeDeparture = (what, exit) => {
  if (exit.error) throw new Error(`${what} : ${exit.error}`)
  if (exit.detachedAt === null) throw new Error(`${what} : l’élément ne part jamais`)
  const between = exit.samples.filter((value) => value > 0.02 && value < 0.98).length
  const last = exit.samples[exit.samples.length - 1] ?? 1
  if (exit.samples.length < 4 || between < 2) {
    throw new Error(
      `${what} : ${exit.samples.length} image(s) peintes dont ${between} entre les deux — ` +
        `l’élément disparaît entre deux images (${exit.samples.map((v) => v.toFixed(2)).join(' ')})`,
    )
  }
  if (last > 0.05) {
    throw new Error(
      `${what} : dernière opacité peinte ${last.toFixed(3)} à ${Math.round(exit.detachedAt)} ms — ` +
        'l’élément est arraché avant la fin de son propre fondu',
    )
  }
  console.log(
    `   ${what} : ${exit.samples.length} images, dernière opacité ${last.toFixed(3)}, ` +
      `détachée à ${Math.round(exit.detachedAt)} ms`,
  )
}

/**
 * **A departure nobody presses for, and the node it happened to.**
 *
 * `departureOf` follows an element it is handed. That is the wrong instrument
 * for `useLeaving`, where the question is *which* element leaves: the hook
 * splices the departed row back into the list it left, and the whole defect it
 * shipped with was that React had already removed the original `<li>` and the
 * splice put a **different** element back, created already wearing `.leaving`.
 * A transition interpolates from the last value the browser painted on that
 * element, so a node that was never painted has nothing to fade from — and
 * every assertion that reads the CSS *rule* off it still passes, because the
 * rule is on the class and the class is there.
 *
 * So this one records every candidate standing before the trigger, then follows
 * whichever of them the renderer marks. A leaver that is not in that set is the
 * finding, not the measurement.
 *
 * `trigger` is a Node-side callback rather than a selector because these
 * departures have no control: the clock moves, a broadcast arrives, and a row
 * stops being upcoming.
 */
const heldDepartureOf = async (page, selector, trigger, ms = 900) => {
  await page.evaluate(({ selector }) => {
    const w = /** @type {any} */ (window)
    const standing = new Set(document.querySelectorAll(selector))
    const started = performance.now()
    w.__held = { samples: [], detachedAt: null, fresh: null, seen: false }
    let going = null
    const observer = new MutationObserver(() => {
      if (going !== null && !going.isConnected && w.__held.detachedAt === null) {
        w.__held.detachedAt = performance.now() - started
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    w.__heldStop = () => observer.disconnect()
    const tick = () => {
      if (going === null) {
        going = document.querySelector(`${selector}.leaving`)
        if (going === null) return requestAnimationFrame(tick)
        w.__held.seen = true
        w.__held.fresh = !standing.has(going)
      }
      if (!going.isConnected) {
        if (w.__held.detachedAt === null) w.__held.detachedAt = performance.now() - started
        return
      }
      w.__held.samples.push(Number(getComputedStyle(going).opacity))
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, { selector })
  await trigger()
  await page.waitForTimeout(ms)
  return page.evaluate(() => {
    /** @type {any} */ (window).__heldStop?.()
    return /** @type {any} */ (window).__held
  })
}

/**
 * `judgeDeparture`, plus the claim only a held departure can make: the element
 * that left is one the rep had been looking at.
 */
const judgeHeld = (what, exit) => {
  if (!exit.seen) throw new Error(`${what} : rien n’a porté « leaving » — aucune sortie`)
  if (exit.fresh) {
    throw new Error(
      `${what} : la ligne qui s’en va est un élément **neuf**, créé en portant la sortie — ` +
        'une transition part de la dernière valeur peinte et un nœud jamais peint n’en a pas',
    )
  }
  judgeDeparture(what, exit)
}

/**
 * **VISION §6's own ceiling, in milliseconds** — « Motion: ≤150ms ». The one carve-out
 * (DEC-50) is the widget's *arrival*, a card drawn over another application; a page turn
 * inside a document on the app's own paper is not that surface.
 */
const MOTION_CEILING_MS = 150

/**
 * How long after the ceiling the second sample is taken.
 *
 * Long enough that a scroll still under way has moved by more than the rounding
 * `at()` does, and short enough that the whole post-press wait stays well under
 * the 360 ms these stages used to spend. Chromium ran a 747 px `behavior: 'smooth'`
 * page turn in 415 ms, so at 150 ms it is a third of the way through an ease and
 * moving at its fastest: 60 ms of that is hundreds of pixels, not one.
 */
const MOTION_RESAMPLE_MS = 60

/**
 * How long a **staging** loop waits after pressing a page turn.
 *
 * Staging is not measurement: these loops print no position and assert nothing
 * about where a column landed — they only need the React commit that publishes
 * the next label, because `measure` runs from a `ResizeObserver` and leaves one
 * commit between the scroll and the button. So they carry no second sample and
 * no refusal; what they *did* carry was a flat 380 ms, spent inside a 415 ms
 * animation for as long as they have existed.
 *
 * Derived from the two measured numbers rather than chosen, so a stage cannot
 * come to be staged on a wait longer than the ceiling the same file enforces.
 */
const STAGING_TURN_MS = MOTION_CEILING_MS + MOTION_RESAMPLE_MS

/**
 * **Press a control that scrolls, and refuse a scroll still moving at the ceiling.**
 *
 * The hole this closes is structural and stayed open for as long as the page turn
 * existed. `--motion` reads `transitionDuration` and `animationDuration`; a scroll
 * animation has **neither**, so Chromium's `behavior: 'smooth'` — whose duration
 * Chromium picks, measured at 415 ms on this very gate, nearly 3× the ceiling and
 * the only motion in the product above it — was invisible to all nine measured
 * checks. `check-motion.mjs` holds every *spelling* of an animated scroll to one
 * file and by construction cannot ask what that file says; `scroll.test.ts` pins
 * the decision in-lane. Neither of those is a duration, and a duration only exists
 * in a browser pressing the real control.
 *
 * `settled` cannot answer it either: a scroll animation is not a `getAnimations()`
 * entry, which is the same blind spot one API over.
 *
 * So it is measured here, where the control is already being pressed: two samples
 * of the guarded columns, the first at the ceiling and the second
 * `MOTION_RESAMPLE_MS` later. Equal means the scroll was over by 150 ms; different
 * means it was not, and the stage says so instead of printing a mid-flight
 * position as if it were a landing — which is what these stages did for as long as
 * they have existed, because 360 ms of waiting sat *inside* a 415 ms animation and
 * the tail of every press landed during the next query.
 *
 * It is deliberately **not** a `--scroll` flag. A check cannot observe a scroll
 * animation without pressing the control that starts one, so a flag would be this
 * stage again under another name.
 *
 * Returns the settled position, so the caller's « did this press move anything »
 * comparison is made against a reading that has *stopped changing* rather than
 * against whatever the clock happened to catch.
 */
const pressAndSettle = async (page, { control, at, how, label }) => {
  await control.click({ timeout: 4000 })
  await page.waitForTimeout(MOTION_CEILING_MS)
  const atCeiling = await at()
  await page.waitForTimeout(MOTION_RESAMPLE_MS)
  const afterwards = await at()
  if (atCeiling !== afterwards) {
    throw new Error(
      `${how} : « ${label} » — un tour de page encore en mouvement ` +
        `${MOTION_CEILING_MS} ms après la pression (${atCeiling} puis ${afterwards}, ` +
        `${MOTION_RESAMPLE_MS} ms plus tard) ; VISION §6 plafonne le mouvement à ` +
        `${MOTION_CEILING_MS} ms et le garde en impose six à huit par gate (DEC-4)`,
    )
  }
  return afterwards
}

/**
 * The verb on a day-list row that holds a meeting — **one word, now**.
 *
 * It was `/^(Ouvrir|Enregistrer)$/`, and the docblock argued for the set: « the
 * armed meeting carries a filled *Enregistrer*; every other row carries an
 * outline *Ouvrir*, because opening a meeting that exists and starting a capture
 * are two different acts ». They were the same act. Driven at the bridge
 * (`src/screens/agenda/__tests__/verbs.test.tsx`), a press on the armed row
 * reaches **no IPC channel at all** — it is `onOpen`, exactly like every
 * *Ouvrir* beside it — while the *upcoming* row wore the same word over
 * `agenda:arm`, which is a different act, and neither of the three reached
 * `session:command`. The capture verb was on the two controls that do not
 * capture, and this constant is the place the harness agreed to stop asking.
 *
 * A row that holds a meeting says *Ouvrir*. A row that holds only an invite says
 * *Préparer* and is a different stage's business (`agenda-demarrer-tot`), which
 * is why this is no longer a set: « the way into this row » and « the way to arm
 * an invite » are two questions and one regex answered both.
 */
const OPEN_ROW = /^Ouvrir$/

/**
 * **The whole verb vocabulary of the calendar's right-hand column, declared.**
 *
 * The half of « one verb, one act » a photograph can hold.
 *
 * `src/screens/agenda/__tests__/verbs.test.tsx` owns the other half: it presses
 * every control on the screen and refuses a word that covers two acts, or an act
 * that goes by two words. It can do that because it has a bridge that records
 * every `invoke`. A stage cannot — a press here navigates — so what a stage can
 * assert is the *vocabulary*, and that turns out to be the half that failed.
 *
 * What failed: *Enregistrer* sat on two day rows and neither of them reached
 * `session:command`. The capture verb in this product is **Démarrer** — it is
 * what `Session.tsx` puts on the press that opens the microphone, and what the
 * header puts on the one control here that does. So the rule is narrow and
 * checkable from the paint: **no control inside the day list may carry the
 * capture verb**, and every verb it does carry must be one the product declared.
 *
 * Run on *every* agenda stage rather than on the one that happened to stage the
 * collision, because « how many words does this screen spend » is a fact about
 * the screen and the stage that photographed it was asserting « at least one
 * *Enregistrer* » — it got louder as the defect got worse. `agenda-demarrer-tot`
 * asked for « at least two » of the same word. Both were counting the wrong thing
 * as hard as they could.
 */
const ROW_VERBS = new Set(['Ouvrir', 'Préparer'])

/**
 * Every verb the product uses for « a microphone opens now ». Nothing in the day
 * list may say one: `agenda:arm` and `onOpen` are the only two acts on offer
 * there, and neither of them records.
 */
const CAPTURE_VERB = /^(Enregistrer|Démarrer)$/

/**
 * **Wait for *En attente de validation*, which no agenda stage ever did.**
 *
 * `Agenda` asks `history:search` for the `à valider` backlog through
 * `useHistorySearch`, which debounces 200 ms, and the stub answers `history:search`
 * after 150 ms of its own. `settled()` waits for animations and for a held
 * departure; it does not wait for a question nobody has asked yet. Measured on
 * the shipped screen at 1280×800 and at 960×600 with a probe that sampled the
 * DOM twice (`scratch/probe-backlog.mjs`):
 *
 *     before (the instant every stage photographs) : rien
 *     after  (+1500 ms)                            : « 3 appels en attente de validation »
 *
 * So the section that catches DEC-4's quietest failure — a compte-rendu recorded,
 * written and never confirmed — has **never been photographed**, its count has
 * never been photographed, and neither has the left rail's `À valider N` note,
 * which is fed by the same answer. Eight measured checks × eight agenda stages ×
 * two sizes, all green, none of them looking at it. `--motion` went from « 66
 * élément(s) animé(s) » to 68 the moment the wait was added, which is the size of
 * what was missing from the census.
 *
 * Keyed on the heading's **role** for the section: the rail's note contains the
 * same sentence casefolded, and `getByText` is a strict-mode violation across
 * the two.
 */
const waitForBacklog = async (page) => {
  const backlog = page.getByRole('heading', { name: 'En attente de validation' })
  /*
   * **The rail's note, and it is required.** A wait that swallows its own
   * failure is not a wait: with `.catch(() => undefined)` — which is how this
   * shipped — the stage went straight back to photographing the pre-answer
   * screen, and green. Falsified by slowing the stub's `history:search` from
   * 150 ms to 9000 ms and driving `agenda` at 1280×800: the swallowing version
   * printed « ✓ agenda », this one fails on the locator.
   *
   * It is the **rail's** note and not the section's heading, because the section
   * is conditional on the day as well as on the answer — `PendingGates` returns
   * null on a day with nothing owed, since « rien à valider » is a congratulation
   * a rep reads on no morning.
   *
   * The precondition, measured rather than assumed, because the docblock this
   * replaces claimed the count was « drawn on every agenda screen » and it is
   * not: `ui/Rail.tsx` builds `noteLabel` only under `pending !== null &&
   * pending > 0`, so a *fixture that owes nothing* would reach this line and
   * time out. Every scenario that calls this owes three — probed at the instant
   * `openAgenda()` resolves and again 1500 ms later, on `agenda`, on
   * `agenda-appel-imprevu`, at both sizes:
   *
   *     at openAgenda()  : 0 nœud(s) portant la phrase
   *     +1500 ms         : 14, « 3 appels en attente de validation »
   *
   * A new stage whose fixture owes nothing has to say so here rather than be
   * given the `.catch` back.
   */
  try {
    await page
      .getByText(/appels? en attente de validation/)
      .first()
      .waitFor({ timeout: 5_000 })
  } catch {
    throw new Error(
      'la réponse à la question « à valider » n’a jamais atteint l’écran : le rail ne ' +
        'porte pas son compte. Soit `history:search` reste sans réponse, soit la mise en ' +
        'scène ne doit rien — auquel cas `Rail.tsx` ne dessine pas de note et c’est ici ' +
        'qu’il faut le dire, pas dans un `.catch`.',
    )
  }
  /*
   * The section itself, when there is one. Attempted and not required: the two
   * halves fail differently, and only the rail's is a fact about every stage
   * that calls this.
   */
  await backlog.waitFor({ timeout: 1_500 }).catch(() => undefined)
  await settled(page)
}

const assertRowVerbs = async (page) => {
  const found = await page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) return null
    return [...main.querySelectorAll('li button')].map((button) => ({
      label: (button.textContent ?? '').trim(),
      row: (button.closest('li')?.textContent ?? '').trim().slice(0, 60),
    }))
  })
  if (found === null) throw new Error('aucun <main> : la liste du jour n’est pas à l’écran')

  const capturing = found.filter((control) => /^(Enregistrer|Démarrer)$/.test(control.label))
  if (capturing.length > 0) {
    throw new Error(
      `${capturing.length} contrôle(s) de la liste du jour portent le verbe de capture — ` +
        capturing.map((c) => `« ${c.label} » sur « ${c.row} »`).join(' ; ') +
        '. Aucun n’ouvre un micro : agenda:arm arme, onOpen navigue, et ' +
        'session:command n’est atteint que depuis « Démarrer une réunion ».',
    )
  }

  const undeclared = [...new Set(found.map((c) => c.label))].filter(
    (label) => !ROW_VERBS.has(label),
  )
  if (undeclared.length > 0) {
    throw new Error(
      `verbe(s) non déclaré(s) sur une ligne du jour : ${undeclared
        .map((label) => `« ${label} »`)
        .join(', ')} — déclare-les dans ROW_VERBS avec l’acte qu’ils nomment`,
    )
  }
  return found
}

/**
 * **A row that lights up under the cursor has to be a row that answers.**
 *
 * `DayPane` states the rule and applied it to one of its two branches: « the
 * stretch follows the word ». A row whose control is *Ouvrir* is a target across
 * its whole width, because `onOpen` is navigation and navigation is reversible;
 * a row whose control is *Préparer* is not, because `onArm` mints a meeting and
 * « the rep clicked somewhere in a 1050px rectangle » is not how a recording of
 * a client call begins. That half is right and this check does not touch it.
 *
 * What was wrong is the *paint*. `hover:bg-subtle` sat on the `li`
 * unconditionally, so the rows that are not targets lit the full row under the
 * cursor exactly like the rows that are — and answered nothing when pressed.
 * Measured before the fix, at 1280×800 and at 960×600:
 *
 *     vue      lignes  cible + survol  survol SANS cible  ni l'un ni l'autre
 *     jour        6          3                2                  1
 *     semaine    11          5                5                  1
 *     liste      14          9                5                  0
 *
 * The five on *Liste* and on the week are the upcoming invites — the offer
 * `agenda-demarrer-tot` exists to protect — and the odd one out on the day view
 * was the backlog's own *Ouvrir*, the one row in the product with that word and
 * neither the rectangle nor the ground.
 *
 * Nothing could see it. `--targets` measures the button's own box; `--geometry`
 * measures declared hangs; `--scan` reports occlusion, which this *is* — the
 * stretched pseudo covers the row's text — but reports it identically on the
 * rows where it is correct. No pass in this harness has ever moved the pointer.
 *
 * So this one does: transitions off, hover the row's leading cell (away from the
 * control), read the ground, and require « the ground moved » to be exactly
 * « the control's `::after` covers the row ». Both directions — a target that
 * says nothing is as wrong as a ground that promises nothing.
 */
const assertRowAffordance = async (page) => {
  /*
   * Transitions off first, for the same reason `--contrast` does it:
   * `getComputedStyle` answers with the *current animated value*, and the row's
   * ground is on a `transition`. A reading taken 0 ms after the pointer lands is
   * a reading of the resting colour; one taken mid-way is a reading of a frame.
   */
  const sheet = await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  try {
    const rows = await page.evaluate(() => {
      const out = []
      for (const li of document.querySelectorAll('main ul > li')) {
        const box = li.getBoundingClientRect()
        /*
         * Wholly inside the viewport, and « wholly » is load-bearing. A row
         * whose top is on screen and whose centre is not has its `mouse.move`
         * clamped to the bottom edge, so the pointer lands on the row below and
         * this reports « a target that does not say so » about a row it never
         * hovered. That is the false positive the first run of this check
         * produced on `agenda-liste`, one row past the fold.
         */
        if (box.height === 0 || box.top < 0 || box.bottom > innerHeight) continue
        const control = li.querySelector('button')
        const after = control ? getComputedStyle(control, '::after') : null
        out.push({
          // The leading cell — the clock — which is text on every row grammar
          // this scroller draws, so the point is never on the control itself.
          x: Math.round(box.x + 40),
          y: Math.round(box.y + box.height / 2),
          verb: control ? (control.textContent ?? '').trim() : null,
          row: (li.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 44),
          target: after !== null && after.position === 'absolute' && after.content !== 'none',
          resting: getComputedStyle(li).backgroundColor,
        })
      }
      return out
    })

    const offences = []
    for (const [index, row] of rows.entries()) {
      await page.mouse.move(row.x, row.y)
      const hovered = await page.evaluate((at) => {
        const li = [...document.querySelectorAll('main ul > li')].filter((node) => {
          const box = node.getBoundingClientRect()
          return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight
        })[at]
        return li ? getComputedStyle(li).backgroundColor : null
      }, index)
      const lit = hovered !== null && hovered !== row.resting
      if (lit && !row.target) {
        offences.push(
          `« ${row.row} » s’allume au survol (${row.resting} → ${hovered}) et n’est pas une ` +
            `cible : seul le contrôle « ${row.verb ?? 'aucun'} » répond`,
        )
      }
      if (!lit && row.target) {
        offences.push(
          `« ${row.row} » est une cible sur toute sa largeur et ne le dit pas — aucun fond au ` +
            'survol',
        )
      }
    }
    if (offences.length > 0) {
      throw new Error(
        `${offences.length} ligne(s) dont le survol et la cible ne coïncident pas :\n   ` +
          offences.join('\n   ') +
          '\n  Le fond au survol se dessine à la même condition que `after:inset-0` ' +
          '(DayPane, PendingGates).',
      )
    }
    return rows.length
  } finally {
    // The pointer is left where the eight measured passes expect it: nowhere.
    // A stage that ends under a hover photographs a hovered screen.
    await page.mouse.move(0, 0)
    await sheet.evaluate((node) => node.remove())
  }
}

/**
 * impeccable's in-page detector, run against what the browser actually painted.
 *
 * The skill's own URL mode (`detect.mjs http://localhost:5180`) cannot see this
 * app: it opens the page in a bare Chrome, where `window.app` is missing and
 * every screen renders its error state, so it scans a spinner and reports
 * nothing. Every browser-mode pass this repo has had came back empty for that
 * reason, not because the screens are clean.
 *
 * The script is handed to `page.evaluate`, which goes through CDP rather than a
 * `<script>` element, so `index.html`'s `script-src 'self'` does not apply —
 * that is the CSP wall the earlier passes hit with `addScriptTag`.
 */
const DETECTOR =
  process.env.IMPECCABLE_DETECTOR ??
  path.join(os.homedir(), '.claude/skills/impeccable/scripts/detector/detect-antipatterns-browser.js')

/**
 * Open the gate, expand the nth field's source and follow it into the record.
 *
 * The order is the rep's: the value first, then « où est-ce que ça a été dit ? ».
 * There is no URL for this state and there should not be one — it is a gesture
 * on one column answered by the other.
 */
async function followSource(page, index) {
  await SCREENS.review.drive(page)
  await page.getByRole('button', { name: /^source/ }).nth(index).click()
  await page.getByRole('button', { name: /Voir dans la transcription/ }).first().click()
  // Either verdict: the citation was found, or the reader says it was not.
  await page
    .getByText(/Citation du champ|est introuvable dans la transcription/)
    .first()
    .waitFor()
  // The smooth scroll has to land before the camera fires.
  await page.waitForTimeout(700)
}

/**
 * **Both frames of a page turn's label, the right way round.**
 *
 * `ReadingColumn` draws one control in two states and they are two different
 * grammatical frames — « Lire la suite **du** compte-rendu » going down,
 * « Remonter dans **le** compte-rendu » coming back — so a label that is correct
 * in one is wrong in the other. Asked of every turn on the page, by *shape*
 * rather than by string: the verb is the caller's (the gate's rail says « Voir la
 * suite de ce qui part » where a document says « Lire la suite … »), and a check
 * that pinned one verb would silently stop visiting the other surface.
 */
const GENITIVE = /^(du|des|de la|de l’|de |d’)/

function turnGrammar(label) {
  const up = /^Remonter dans (.+)$/.exec(label)
  if (up && GENITIVE.test(up[1])) {
    return `« ${label} » : « Remonter dans » prend le nom, pas le génitif`
  }
  const down = /\bla suite (.+)$/.exec(label)
  if (down && !GENITIVE.test(down[1])) {
    return `« ${label} » : « la suite » prend le génitif, pas le nom`
  }
  return null
}

/**
 * Press one reading column's page turn until the column is at its end, then
 * measure the control that is left there.
 *
 * Takes the column itself, because the two callers name it differently: the
 * session screen draws three of these and the one worth reading is found by a
 * line of its own content, while the onboarding has exactly one inside `main`.
 */
async function readToTheEnd(page, column, { mustPress = true } = {}) {
  await column.waitFor()
  /*
   * Inside the column, **or** in the row docked under it — `ReadingColumn` puts
   * the turn below the scroller now, so it stops covering the text it points
   * at, and its DOM position moves from « inside » to « sibling ». Still scoped
   * to this column: the wrapper holds exactly one scroller and one turn, so a
   * press cannot land on another column's control. `Review`'s own
   * `main.fade-below` keeps its turn inside, which is why both are tried.
   *
   * The harness's own advice on a failing stage, taken: « c'est le sélecteur
   * qu'il faut rendre moins littéral ». The property asserted below — an
   * overflowing column offers a turn, and every press moves something — is
   * unchanged.
   */
  const turn = column
    .locator('.turn-ground button')
    .or(column.locator('xpath=..').locator('> .turn-ground button'))
  const state = () =>
    column.evaluate((el) => ({
      above: el.dataset.above,
      below: el.dataset.below,
      top: Math.round(el.scrollTop),
    }))

  let presses = 0
  for (let attempt = 0; attempt < 60; attempt++) {
    const before = await state()
    if (before.above === 'true' && before.below === 'false') break
    if ((await turn.count()) === 0) {
      throw new Error(
        `la colonne ne tient pas dans sa boîte et n’offre aucun tour de page ` +
          `(above=${before.above} below=${before.below})`,
      )
    }
    await turn.click()
    presses++
    // The scroll is animated; `scrollElementBy` lands within a frame or two.
    await page.waitForTimeout(300)
    const after = await state()
    // A control that is present and does nothing is the shape this repo keeps
    // producing — the guard's own remedy at the gate was one for two rounds.
    if (after.top === before.top) {
      throw new Error(`presse ${presses} : le contrôle « ${await turn.innerText()} » n’a rien bougé`)
    }
  }

  const end = await state()
  // A stage whose column fits cannot exercise the state it is named after, which
  // is the first shape on this repo's list. `mustPress` is false for a caller
  // that has already pressed this column and proved there was something hidden.
  if (mustPress && presses === 0) {
    throw new Error('la colonne était déjà lue : cette mise en scène ne mesure plus rien')
  }
  if (end.above !== 'true' || end.below !== 'false') {
    throw new Error(`la colonne n’a pas atteint sa fin après ${presses} presse(s) : ${JSON.stringify(end)}`)
  }
  // The control has to be *on screen* there, not merely in the tree: it is
  // sticky to the foot of its own scroller, which is the property that makes it
  // reachable at every scroll position.
  const box = await turn.boundingBox()
  const view = page.viewportSize()
  if (!box || box.y < 0 || box.y + box.height > view.height) {
    throw new Error(`le contrôle de remontée est hors de l’écran : ${JSON.stringify(box)}`)
  }

  await assertTurnGrammar(page)
  return { presses }
}

/**
 * Every page turn on the page, held to `turnGrammar`.
 *
 * Its own guard first: a sweep that visited nothing is the third shape on this
 * repo's list, and on a stage that has just read a column to its end there is
 * one of these by construction.
 */
async function assertTurnGrammar(page) {
  const labels = (await page.locator('.turn-ground button').allInnerTexts()).map((l) => l.trim())
  if (labels.length === 0) throw new Error('aucun tour de page sur l’écran : rien de mesuré')
  const wrong = labels.map(turnGrammar).filter((problem) => problem !== null)
  if (wrong.length > 0) throw new Error(wrong.join(' ; '))
  return labels
}

/** The screens, and how a rep would reach each one. */
const SCREENS = {
  /*
   * The boot every rep really gets: the weights ship inside the installer, so
   * all three steps answer in under a second and the splash is a screen that
   * flashes. Staged mid-answer, which is the only moment it is on screen.
   */
  splash: {
    scenario: 'splash',
    async drive(page) {
      await page.getByRole('heading', { name: 'Sillage' }).waitFor()
      // Two steps answered, one still pending — which is the window's own state
      // for the few hundred milliseconds this screen exists.
      await page.getByText('ouverte · sur cette machine').waitFor()
      await page.getByText('Whisper (local)', { exact: false }).waitFor()
    },
  },

  /*
   * The `downloading` variant, which `core/contracts/boot.ts` declares for a
   * boot-time fetch that does not exist yet — the weights ship inside the
   * installer. It has its own scenario so it can be looked at, and so it can
   * never again be mistaken for what a first run does.
   */
  'splash-telechargement': {
    scenario: 'splash-telechargement',
    async drive(page) {
      await page.getByRole('heading', { name: 'Sillage' }).waitFor()
      await page.getByRole('progressbar').waitFor()
      await page.getByText('Téléchargement unique', { exact: false }).waitFor()
    },
  },

  agenda: {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByText('Néovia Santé — cadrage renfort data').first().waitFor()
      await page.getByText('Passées').waitFor()
      await waitForBacklog(page)
      await assertRowVerbs(page)
      await assertRowAffordance(page)
    },
  },

  /*
   * DEC-31's own case: a day with nothing on it still draws the grid, the list
   * and the search bar. The day is found by its accessible name rather than by
   * date, so the shot does not expire the moment the fixtures move.
   */
  /*
   * **A month the calendar was never asked about.**
   *
   * `modules/calendar/delta.ts` syncs yesterday through a week ahead — eight
   * days — while the grid draws six weeks, so *Mois* asserted « Aucune réunion
   * ce jour-là. » about thirty-four of forty-two days on which nothing had been
   * looked up, and explained that emptiness with the **arming** reason: an empty
   * Thursday three weeks out was accounted for by « Teams émet du son ». Nobody
   * can widen the window for free — a delta link bakes its range in — so the
   * honest move is to say which days the answer covers.
   */
  'agenda-hors-fenetre': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Mois', exact: true }).last().click()
      // Two months on, which no sync window reaches.
      await page.getByRole('button', { name: 'Mois suivant' }).click()
      await page.waitForTimeout(200)
      await page.getByRole('button', { name: 'Mois suivant' }).click()
      await page.waitForTimeout(400)
      await page.getByText(/hors de la période synchronisée/).first().waitFor()
      await waitForBacklog(page)
      await assertRowVerbs(page)
      await assertRowAffordance(page)
    },
  },

  'agenda-empty': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      /*
       * A day **inside** the sync window, which is what DEC-31 is about: the
       * grid is drawn and usable on a day with nothing on it. A day the calendar
       * was never asked about is a different sentence and its own stage
       * (`agenda-hors-fenetre`) — conflating them is exactly the claim the
       * window field was added to stop.
       */
      /*
       * The first empty day that is also **inside the sync window** — which is
       * what DEC-31 is about: the grid drawn and usable on a day with nothing on
       * it. A day the calendar was never asked about says something different
       * and has its own stage (`agenda-hors-fenetre`); conflating the two is the
       * claim the window field was added to stop, so the stage steps forward
       * until it finds the case it is here to photograph rather than accepting
       * whichever sentence turns up.
       */
      const days = page.getByRole('button', { name: /aucune réunion$/ })
      const said = page.getByText(
        /Aucune réunion ce jour-là|Aucune réunion sur cette période|Plus aucune réunion/,
      )
      /*
       * Re-anchored on *Aujourd'hui* between attempts, and that is not belt and
       * braces. A month grid draws the trailing days of the previous month, so
       * the first empty cell is usually one of those — and clicking it moves the
       * grid to that month, where every later cell is also outside the window.
       * One stray click and the scan could never reach the days it is looking
       * for. The fixture's free days are four to seven ahead.
       */
      const total = await days.count()
      let found = false
      for (let i = 0; i < Math.min(total, 42); i += 1) {
        /*
          The **calendar's** own *Aujourd'hui* — its pager's way back to today.
          The left rail now holds an item by the same name (V2), which is the
          home destination and not a pager, so the selector is scoped to the
          grid rather than made more literal.
        */
        await page
          .getByRole('region', { name: 'Calendrier' })
          .getByRole('button', { name: 'Aujourd’hui' })
          .click()
        await page.waitForTimeout(120)
        await days.nth(i).click()
        await page.waitForTimeout(220)
        if ((await said.count()) > 0) {
          found = true
          break
        }
      }
      if (!found) throw new Error('aucun jour vide dans la fenêtre synchronisée')
      // Whichever of the three the range calls for — a past day does not say
      // « à venir » about itself, which is the whole point of the copy.
      await said.first().waitFor()
      await waitForBacklog(page)
      await assertRowVerbs(page)
      await assertRowAffordance(page)
    },
  },

  /*
   * The first-run sequence, replayed from Réglages › Connecteurs. A rep who
   * installs on Tuesday with no calls until Thursday opens the app on nothing,
   * and what this product has to show them is already true: three beats and
   * twenty seconds of real capture (DEC-45), rather than a fabricated demo
   * meeting that would sit in *Historique* afterwards.
   */
  'reglages-presentation': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('button', { name: /Revoir la présentation/ }).click()
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
    },
  },

  /** The calendar's account, said in the calendar's terms. */
  'reglages-calendrier': {
    scenario: 'reglages',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('button', { name: 'Calendrier', exact: true }).click()
      await page.getByText(/agenda Outlook/).waitFor()
    },
  },

  'agenda-semaine': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Semaine' }).click()
      await page.getByText('Néovia Santé — cadrage renfort data').first().waitFor()
      await waitForBacklog(page)
      await assertRowVerbs(page)
      await assertRowAffordance(page)
    },
  },

  'agenda-liste': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Liste' }).click()
      await page.getByText('Néovia Santé — cadrage renfort data').first().waitFor()
      await waitForBacklog(page)
      await assertRowVerbs(page)
      await assertRowAffordance(page)
    },
  },

  /*
   * **Every upcoming invite can be started, not only the armed one.**
   *
   * The row's control used to render inside `{meetingId ? … : null}`, and an
   * upcoming calendar event that has produced no meeting yet has none — so four
   * of the five upcoming rows on this very screen had no control at all, and the
   * row is not clickable either. A sales call that starts ten minutes early left
   * the rep with the header's *Démarrer une réunion*, which creates a meeting
   * with `eventId: null` and drops the attendees, the subject, and with them
   * « Interlocuteurs », `speakerLabel`'s one chance to name the far channel, and
   * the strongest signal account resolution has.
   *
   * The stage asserts the *count*, because that is the thing that regressed and
   * the thing a screenshot cannot state: one filled primary on the armed row
   * (HR-7 — there is at most one, and it owns the screen's weight), and a
   * bordered arm control on each remaining upcoming row. Photographing a screen
   * with buttons on it would pass either way.
   *
   * **The word is *Préparer* and it used to be *Enregistrer*, and this stage was
   * counting the collision rather than the feature.** « at least two
   * *Enregistrer* on the week » went *greener* the worse the ambiguity got: the
   * armed row wore the same word over a different act, so a week holding one
   * offer and one invite satisfied it with two controls that do two things.
   * Driven at the bridge (`src/screens/agenda/__tests__/verbs.test.tsx`), neither
   * of them reached `session:command` — the capture verb was on two presses that
   * do not capture. So the count is of the arm control by its own name, and
   * `assertRowVerbs` below refuses the capture verb anywhere in the list.
   */
  'agenda-demarrer-tot': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Semaine' }).click()
      await page.getByText('Banque Delcourt — négociation du cadre tarifaire 2026').first().waitFor()
      await waitForBacklog(page)
      const armable = page.getByRole('button', { name: 'Préparer', exact: true })
      const count = await armable.count()
      if (count < 2) {
        throw new Error(
          `only ${count} « Préparer » on the week — an upcoming invite with no meeting must still be armable`,
        )
      }
      await assertRowVerbs(page)
      await assertRowAffordance(page)
    },
  },

  /*
   * **The arming gesture, walked — and no screenshot in this repo had ever
   * walked it.**
   *
   * A rep sees a call coming and presses *Préparer*. `Agenda.armNow` asks
   * `agenda:arm`, re-reads the snapshot and calls `onOpen(meetingId)`, so the
   * press ends on a session screen or it ends nowhere. Every stage that touched
   * this control **counted** it — `agenda-demarrer-tot` asserts « at least two
   * *Préparer* on the week » — and counting a button is orthogonal to whether
   * pressing it arrives.
   *
   * It did not arrive. `bridge-stub.mjs` answered `` `evt-${eventId}` `` where
   * `Agenda.meetingIdFor` is a sha1 digest, so the id named no meeting and the
   * whole of what the rep saw, measured at both sizes, was
   *
   *     réunion introuvable: evt-evt-delcourt-tjm
   *     Retour
   *
   * So this stage presses a named row and photographs where the press lands, and
   * what it asserts is the thing the picture cannot state on its own: that the
   * session screen belongs to **the invite that was pressed**, by its objet.
   * Landing on *a* session screen is what the defect would look like too, if the
   * stub had invented an id that happened to exist.
   *
   * `review` is the scenario, and that is the fixture's own arbitration rather
   * than a preference. `#arm` declines while another call is recording, and
   * `m-neovia-cadrage` is `recording` on `agenda` and on `historique`; it is the
   * standing offer *past* the call on `compte-rendu` and on both enhancement
   * scenarios; `agenda-appel-imprevu` is `entra: false` and its snapshot carries
   * no events at all, so there is no invite on it to press. `review` is the one
   * staged day with nothing live and no standing offer — the one day on which
   * arming an invite is what the shipped `Agenda` does. The refusal is the stage
   * below, and it is the same press on the ordinary afternoon.
   *
   * No *Démarrer* is pressed: arming is an offer a human accepts (HR-7), so the
   * screen it lands on is a session that has not started, and that is the whole
   * point of the gesture.
   */
  'agenda-preparer': {
    scenario: 'review',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Semaine' }).click()
      await page.getByText('Banque Delcourt — négociation du cadre tarifaire 2026').first().waitFor()
      await waitForBacklog(page)
      await rowNamed(page, 'Banque Delcourt — négociation')
        .getByRole('button', { name: 'Préparer', exact: true })
        .click()
      /*
       * **The error page first, and the order is the assertion.**
       *
       * « réunion introuvable » draws no header at all, so a run that waits for
       * the objet fails on a *locator timeout* — « the screen was slow », which
       * is the reading that kept this open for the life of the fixture. Measured
       * with the defect put back (`return { meetingId: \`evt-${eventId}\` }`), at
       * both sizes: with this check second the stage said « Timeout 5000ms
       * exceeded, waiting for getByLabel('Objet de la réunion') »; with it first
       * it names the id and the channel.
       */
      const lost = page.getByText(/réunion introuvable/)
      await Promise.race([
        page.getByLabel('Objet de la réunion').waitFor({ timeout: 5_000 }),
        lost.first().waitFor({ timeout: 5_000 }),
      ]).catch(() => undefined)
      if ((await lost.count()) > 0) {
        throw new Error(
          `la pression a mené à « ${(await lost.first().innerText()).trim()} » : ` +
            'l’identifiant rendu par `agenda:arm` ne nomme aucune réunion que `meeting:get` ' +
            'puisse ouvrir, et le rep se retrouve devant une page d’erreur au lieu de l’appel',
        )
      }
      /*
       * The objet, read off the header field the session screen draws it in —
       * `Agenda.#arm` passes the event's `context` to `orchestrator.create`, so
       * the meeting carries the invite's subject and that is what a rep uses to
       * tell « the call I pressed » from « a call ».
       */
      const objet = page.getByLabel('Objet de la réunion')
      await objet.waitFor({ timeout: 5_000 })
      const landed = await objet.inputValue()
      if (landed !== 'Banque Delcourt — négociation du cadre tarifaire 2026') {
        throw new Error(
          `*Préparer* sur la ligne Banque Delcourt a ouvert « ${landed} » — la réunion armée ` +
            'doit être celle de l’invitation pressée (`armNow` renvoie l’événement du rep, ' +
            'jamais l’offre en cours)',
        )
      }
      // HR-7: what the rep is offered next is *Démarrer*, and it is a second press.
      await page.getByRole('button', { name: 'Démarrer', exact: true }).first().waitFor()
    },
  },

  /*
   * **The other half of the same press: the refusal, named.**
   *
   * `arm` is illegal beside a live recording, and `CLAUDE.md` says the refusal
   * names the live call — a rule that only exists because the sentence said
   * « Une réunion est déjà en cours d’enregistrement » and stopped, one round
   * ago, leaving a rep with two overlapping calls unable to tell which one the
   * product meant. It was fixed in `Agenda.armNow` and photographed nowhere: the
   * stub answered every press with an id, so this screen was unreachable from the
   * harness whatever the sentence said.
   *
   * `agenda` is the scenario because Néovia is `recording` on it — the ordinary
   * afternoon, a call under way and the 16:00 invite already on the week. The
   * assertion is on the **name**: a refusal that does not carry « Néovia Santé »
   * is the defect that rule was written for, and it renders identically otherwise.
   *
   * It is drawn on the page, in the calendar's own `role="alert"`, and that is
   * also under assertion here — this was a `window.alert`, which HR-10 forbids
   * and which no screenshot can contain.
   */
  'agenda-preparer-refus': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Semaine' }).click()
      await page.getByText('Banque Delcourt — négociation du cadre tarifaire 2026').first().waitFor()
      await waitForBacklog(page)
      await rowNamed(page, 'Banque Delcourt — négociation')
        .getByRole('button', { name: 'Préparer', exact: true })
        .click()
      const alert = page.locator('[role="alert"]').filter({ hasText: 'en cours d’enregistrement' })
      await alert.first().waitFor({ timeout: 5_000 })
      const said = (await alert.first().innerText()).replace(/\s+/g, ' ').trim()
      if (!said.includes('Néovia Santé')) {
        throw new Error(
          `le refus ne nomme pas l’appel en cours : « ${said} » — un rep qui a deux appels ` +
            'qui se chevauchent ne peut pas savoir lequel terminer (DEC-26)',
        )
      }
      // The rep is still on the calendar: a refusal never navigates.
      await page.getByRole('region', { name: 'Calendrier' }).waitFor()
      await settled(page)
    },
  },

  /* One client chip pressed — the filter path, not the typed-query path. */
  'agenda-client': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      /*
        On the calendar the axes appear when the rep asks for them — under a day
        list they would read as filters on that list, which they are not.
        Focusing the field is the ask, and it is the gesture that precedes
        reaching for a chip anyway.
      */
      await page.getByLabel('Rechercher un client, un sujet, une transcription ou une note').focus()
      await page.getByRole('button', { name: 'Néovia Santé', exact: true }).click()
      /*
        A **row**, not a pause.

        The chip list comes from the store's distinct client names and the rows
        come from its meetings, so the two can disagree — and they did: the
        fixture offered « Néovia Santé », the client the whole thing is built
        around, and had no row for it, so this stage photographed « Aucun appel
        ne correspond » for five review rounds. A screenshot of an empty state
        is indistinguishable from a screenshot of a working filter unless
        somebody reads the words, and the timeout made it silent.
      */
      await rowNamed(page, 'cadrage renfort data').getByRole('button', { name: 'Ouvrir' }).waitFor()
      await assertRowVerbs(page)
      await assertRowAffordance(page)
    },
  },

  /*
   * **A call found by its own name**, which is what a rep types first — and
   * which the product could not do at all: its « four searchable surfaces » were
   * three, all of them *contents* of a call, so « Néovia » matched nothing
   * unless somebody had said the word aloud and the transcriber had spelled it
   * that way. The client name was offered as a filter chip one row above the box
   * that could not find it.
   */
  'agenda-search-client': {
    scenario: 'historique',
    async drive(page) {
      await openAgenda(page)
      await page.getByPlaceholder(/mot dit en réunion/).first().fill('Néovia')
      await page.getByText('Résultats').first().waitFor()
      // The row is found *by its name*, and the excerpt says which surface hit.
      await page.getByText('Intitulé').first().waitFor()
    },
  },

  'agenda-search': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page
        .getByLabel('Rechercher un client, un sujet, une transcription ou une note')
        .fill('TJM')
      await page.getByRole('list', { name: 'Résultats' }).waitFor()
      await page.getByText('leur grille achats plafonne le TJM', { exact: false }).waitFor()
    },
  },

  session: {
    scenario: 'session',
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: OPEN_ROW })
        .click()
      await page.getByRole('button', { name: 'Terminer' }).waitFor()
      /*
        The rail, by a slot of its own slate.

        It waited on « Rien ne migre dans vos notes. », the sentence that used to
        close the rail — a promise about a thing that does not happen, drawn
        permanently over a client call, now made on first run instead
        (`SignalRail.tsx`). A slot label is the better landmark for the same
        reason the caption above it went: the rail *is* seven labelled slots, so
        the wait is on what the pane is rather than on a line about it.
      */
      await page.getByText('Démarrage', { exact: true }).first().waitFor()
      // A speech-shaped level history over a broadcast — the same channel the
      // main process would use, and the whole width of the meter, so the still
      // shows the widget as a rep sees it rather than flat.
      await page.evaluate(() => window.__harness.replaySession('m-neovia-cadrage'))
      /*
        The meter's *bars*, not its key.

        The stage waited on the word « client », which the meter drops below a
        1080px header — the pill took 404 of 960 pixels at the window's own
        minimum and the meeting's title group got sixty-six, so the wording goes
        and the instrument stays. Waiting on a legend that is legitimately
        absent at one supported size is a stage that photographs one viewport
        and hangs on another, which is exactly the class `smoke.mjs` exists for.
      */
      await page.locator('[aria-label="Niveau d’entrée"], .meter-key, [class*="meter"]').first().waitFor({ state: 'attached' })
      await page.waitForTimeout(200)
    },
  },

  /**
   * The same call set to the free recipe (DEC-43).
   *
   * A scenario rather than a click on the picker, because what is worth
   * photographing is the *rail*: with no slate declared there are no rows to
   * draw in advance, and the footer says why. Shot mid-call, which is the moment
   * the difference is visible — after the analysis both recipes show a document.
   */
  'session-libre': {
    scenario: 'libre',
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: OPEN_ROW })
        .click()
      await page.getByRole('button', { name: 'Terminer' }).waitFor()
      await page.getByText('le plan du compte-rendu sera décidé à la fin', { exact: false }).waitFor()
      await page.evaluate(() => window.__harness.replaySession('m-neovia-cadrage'))
      // The meter names its own channels on screen now, so the stage waits on
      // what a rep can actually read rather than on a tooltip.
      // The instrument, not its legend — see the note in `session` above.
      await page.locator('.meter-key, [class*="meter"]').first().waitFor({ state: 'attached' })
      await page.waitForTimeout(200)
    },
  },

  /**
   * The screen that used to be blank: a meeting that has ended with no model to
   * analyse it. Unreachable on a machine that has one configured, which is why
   * it needs a scenario of its own rather than a click path.
   */
  /**
   * **The one exit nobody presses for** — the end-of-meeting notice going when
   * the compte-rendu it was waiting for arrives.
   *
   * `reglages-sortie` beside it covers the gesture and they are different code:
   * `useDismiss` intercepts a close, `useDeparture` holds a condition. It has to
   * be a stage for the reason that one does — `.leaving` is on nothing at rest,
   * so `--motion` against a settled screen measures a strip that never moves and
   * passes.
   *
   * It also asserts **what** leaves, which is the half a unit test can state and
   * only the shipped renderer can prove. The status is already `idle` while the
   * strip is still on screen, and `idle` draws nothing — so a version reading the
   * live status fades out blank, and one holding the row in a list fades out
   * wearing the sentence from two states ago (`useLeaving.test.tsx` pins that).
   * The text is read back mid-flight and has to still be the one the rep was
   * looking at.
   */
  'session-attente-sortie': {
    scenario: 'enhancement-attente',
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: OPEN_ROW })
        .click()
      await page.getByText('Compte-rendu en attente', { exact: false }).waitFor()

      /*
       * The tracer is armed **before** the broadcast, so its zero is the frame
       * `.leaving` lands on. The first version started it after the 60 ms
       * settling wait and the `exit` round-trip below, and then reported « tenu
       * 95 ms » on a hold that was actually ~160 — measuring a real duration
       * from the wrong origin, which reads exactly like a defect.
       */
      await page.evaluate(() => {
        const w = /** @type {any} */ (window)
        w.__held = { from: null, held: null }
        const until = performance.now() + 5_000
        let seen = null
        const tick = () => {
          const now = performance.now()
          if (now > until) return
          const el = document.querySelector('[role="status"].leaving')
          if (el) {
            seen = el
            if (w.__held.from === null) w.__held.from = now
          } else if (seen !== null && w.__held.held === null) {
            w.__held.held = now - w.__held.from
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })

      // A model appears and the run finishes: `idle`, on the broadcast, with
      // nothing pressed. That is the path, not a convenience for the stage.
      await page.evaluate(() =>
        window.__harness.emit('enhancement:status', {
          meetingId: 'm-neovia-cadrage',
          status: { status: 'idle' },
        }),
      )
      await page.waitForSelector('[role="status"].leaving', { timeout: 5_000 })

      /*
       * Two frames in, not at the instant the class lands: `getComputedStyle`
       * reports the *current animated* value, so read immediately it is still the
       * resting 1 and the assertion below would fail on a working exit. The same
       * caveat `reglages-sortie` and `--contrast` carry. Well inside the 150ms
       * the strip survives.
       */
      await page.waitForTimeout(60)
      const exit = await page.evaluate(() => {
        const el = document.querySelector('[role="status"].leaving')
        if (!el) return null
        const style = getComputedStyle(el)
        const root = getComputedStyle(document.documentElement)
        return {
          text: el.textContent ?? '',
          opacity: style.opacity,
          duration: style.transitionDuration,
          easing: style.transitionTimingFunction,
          motion: root.getPropertyValue('--motion').trim(),
          easeIn: root.getPropertyValue('--ease-in').trim(),
          easeOut: root.getPropertyValue('--ease-out').trim(),
        }
      })
      if (!exit) throw new Error('l’avis a disparu avant la mesure')
      if (!exit.text.includes('Compte-rendu en attente')) {
        throw new Error(
          `l’avis s’en va en disant « ${exit.text.slice(0, 60)} » — attendu la phrase qui y était`,
        )
      }
      // Going, not arriving.
      if (Number(exit.opacity) >= 1) throw new Error(`opacité ${exit.opacity} — l’avis ne part pas`)
      /*
       * **Every property, not the joined string** — `.includes()` here
       * certified the exact defect these stages exist to stop.
       *
       * `.leaving` transitions *two* properties. A substring match on the
       * joined `transition-timing-function` is satisfied by **one** of them
       * carrying `--ease-in`. Driven: opacity on `--ease-overshoot` and
       * transform on `--ease-in` passed all four assertions on both stages at
       * both sizes, with the element at **opacity 0.000 at 60 ms of a 150 ms
       * exit** — ninety milliseconds of a held, mounted, fully transparent
       * surface, which is verbatim what `.widget-leaving`'s docblock measured
       * and fixed. The duration check beside it already used `.every()`; the
       * curve check did not, and nothing else in the loop could see it.
       *
       * Split on top-level commas only: `cubic-bezier(0.64, 0, 0.78, 0)`
       * carries three of its own.
       */
      const curves = exit.easing.split(/,(?![^(]*\))/).map((part) => part.trim())
      if (!curves.every((curve) => curve === exit.easeIn)) {
        throw new Error(
          `courbe(s) de sortie ${JSON.stringify(curves)} — chaque propriété doit porter ` +
            `--ease-in ${exit.easeIn}`,
        )
      }
      if (!exit.duration.split(',').every((d) => d.trim() === '0.15s')) {
        throw new Error(`durée de sortie ${exit.duration} — attendu --motion ${exit.motion}`)
      }
      /*
       * **And it reaches zero before it goes.** Neither exit stage sampled near
       * the end, and that is where the first rung of this ladder was broken:
       * `useDismiss` armed its timer in the press handler rather than after the
       * commit, so the 150 ms expired 110 ms into the fade and the sheet snapped
       * out from **44 % opaque** — three runs, 0.438 / 0.446 / 0.408. An exit
       * that is cut short is the blink the exit exists to remove, and « opacity
       * < 1 at 60 ms » cannot see it.
       */
      /*
       * **The held duration, not the last sampled opacity — and the first
       * version of this was the second kind of wrong in one round.**
       *
       * It sampled opacity every animation frame and asserted the last value
       * before detach was ~0. Alone that passed; under `smoke.mjs`'s four
       * parallel lanes it failed at 0.40 and 0.56, because a loaded machine
       * detaches the element *between* two frames and the last **sampled**
       * opacity is not the last **painted** one. A check whose verdict depends
       * on how busy the machine is will be waved through the first time it cries
       * wolf, which is the failure `--contrast`'s docblock records.
       *
       * The contract is not « what opacity was it at the end », it is « was it
       * held for one `--motion` ». That is what `useDeparture` promises, it is
       * deterministic, and a truncated hold is exactly the defect: arming the
       * timer in the press handler rather than after the commit spent 40 ms of
       * the 150 on a frame that had not painted yet.
       */
      await page.waitForTimeout(400)
      const held = await page.evaluate(() => /** @type {any} */ (window).__held.held)
      // `--motion` as declared, in ms. `150ms` / `0.15s`, the two spellings
      // `src/app/useDismiss.ts` reads, kept here so the stage has no import.
      const declared = exit.motion.endsWith('ms')
        ? Number.parseFloat(exit.motion)
        : Number.parseFloat(exit.motion) * 1000
      const floor = declared * 0.8
      if (held !== null && held < floor) {
        throw new Error(
          `l’avis n’est tenu que ${Math.round(held)} ms — --motion vaut ${exit.motion}, ` +
            `la sortie est coupée avant d’avoir été vue`,
        )
      }
      // And it is gone rather than stranded: the hold is one --motion, no more.
      await page.waitForSelector('[role="status"].leaving', { state: 'detached', timeout: 5_000 })
    },
  },

  'session-attente': {
    scenario: 'enhancement-attente',
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: OPEN_ROW })
        .click()
      await page.getByText('Compte-rendu en attente', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'Choisir un modèle' }).waitFor()
    },
  },

  /**
   * The answer to « Terminer » — the compte-rendu beside the rep's own notes,
   * on the screen they are already on (DEC-5, DEC-14).
   *
   * A scenario rather than a click path for the reason `session-attente` is one:
   * it is the state after an extraction, and the harness has no extraction. It
   * is drawn here without anything being pressed, in a column of its own beside
   * the slate — which is the behaviour worth photographing, twice over: the
   * previous screen showed the rep their own notes and a button and nothing that
   * was the output, and the one before this showed the document *or* the slate,
   * never the two together.
   */
  'session-compte-rendu': {
    scenario: 'compte-rendu',
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: OPEN_ROW })
        .click()
      await page.getByRole('button', { name: 'Relire et valider' }).waitFor()
      await page.getByText('Le budget de la plateforme data', { exact: false }).waitFor()
    },
  },

  /**
   * **The other end of a reading column** (`ui/ReadingColumn.tsx`).
   *
   * Every stage that carries a reading column photographs it at `scrollTop` 0,
   * so for as long as that component has existed its *second* state has been
   * driven by nothing — and the label it draws there read « Remonter dans **du**
   * compte-rendu » on six surfaces. Nothing else could have seen it: the
   * component has no test that can bite, because jsdom measures every box as
   * zero, so `above` and `below` are both false and the control does not render;
   * `--a11y` asks whether a control *has* a name, never whether the name is
   * French; and `check:french` reads prose for the straight apostrophe.
   *
   * So this stage reads the column to its end — four presses at 1280×800, eight
   * at 960×600 — and holds the control it finds there to three things: every
   * press moved the scroller, the column really is at `data-above="true"`, and
   * both labels are the right way round grammatically. The last is asked of
   * **every** page turn the page draws rather than of one string, and it knows
   * nothing about the verb: the gate says « Voir la suite de ce qui part » where
   * this column says « Lire la suite du compte-rendu », and a check that assumed
   * one verb would be a check that quietly stopped visiting the other surface.
   */
  'session-remonter': {
    scenario: 'compte-rendu',
    async drive(page) {
      await SCREENS['session-compte-rendu'].drive(page)
      await readToTheEnd(
        page,
        page.locator('.fade-below').filter({ hasText: 'Le budget de la plateforme data' }).first(),
      )
    },
  },

  /**
   * *Demander*, with an answer on screen (DEC-21).
   *
   * Staged through the gesture, because there is no URL for it and no default
   * state that shows it: the panel is a text field until somebody asks
   * something, and the whole of what is worth looking at — the prose, the
   * citations with their timestamps, and the one quote the app could **not**
   * find in the recording — exists only after a question.
   *
   * The suggestion chip rather than typing: it is the path a rep takes on their
   * first question, and it exercises the same code.
   */
  /**
   * First run, all three steps (`core/contracts/onboarding.ts`).
   *
   * Step 2 is the one worth photographing — the required subsystems, live, with
   * the control that fixes each one — so the stage walks to it and stops. Step 1
   * and step 3 are prose and are shot by `onboarding` and `onboarding-essai`.
   */
  onboarding: {
    scenario: 'onboarding',
    async drive(page) {
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
    },
  },

  'onboarding-besoins': {
    scenario: 'onboarding',
    async drive(page) {
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByRole('heading', { name: 'Ce dont Sillage a besoin' }).waitFor()
      /*
        Wait for a *remedy*, not for a verdict word.

        This waited on « prêt », which is only one of the three verdicts and is
        the one a fresh install does not have — so the moment the fixture started
        telling the truth about first launch, the stage that photographs first
        launch hung for thirty seconds. The remedy button is what step 2 is for
        and it exists in every unhealthy state.
      */
      await page.getByRole('button', { name: /^(Autoriser|Réglages)/ }).first().waitFor()
    },
  },

  /**
   * **The capture row's other states, which no stage could reach.**
   *
   * Step 2 is one row with five states and the harness photographed one of them
   * — a permission nobody had answered — so « refusé », the machine-wide
   * microphone switch and the managed device were drawn by code nothing had
   * ever looked at. They are the states a rep meets *after* something went
   * wrong, which is when a screen has to be right.
   *
   * Each waits on the word the row says, not on a button: the managed device is
   * the state whose whole point is that there is **no** button, and a stage that
   * waited for one would hang on the row it exists to photograph.
   */
  'onboarding-refus': {
    scenario: 'onboarding-refuse',
    async drive(page) {
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByRole('heading', { name: 'Ce dont Sillage a besoin' }).waitFor()
      await page.getByText('refusé', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Ouvrir les réglages' }).waitFor()
    },
  },

  'onboarding-micro': {
    scenario: 'onboarding-micro',
    async drive(page) {
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByText('micro bloqué', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Ouvrir les réglages' }).waitFor()
    },
  },

  'onboarding-gere': {
    scenario: 'onboarding-gere',
    async drive(page) {
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByText('bloqué', { exact: true }).waitFor()
      await page.getByText(/votre service informatique/).waitFor()
      // The state whose remedy is a sentence. A pane cannot lift a profile, so
      // offering one would be the dead control DEC-26 forbids.
      if ((await page.getByRole('button', { name: 'Ouvrir les réglages' }).count()) !== 0) {
        throw new Error('un appareil géré ne peut pas être réparé par un panneau de réglages')
      }
    },
  },

  'onboarding-essai': {
    scenario: 'onboarding',
    async drive(page) {
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByRole('heading', { name: 'Votre premier appel' }).waitFor()
    },
  },

  /**
   * **Step 3's second screenful, and whether the control that reveals it works.**
   *
   * The beats name the pill and the detector now (US-18), which is 941 pixels of
   * content in the 660 the column gets at 1280×800 and the 460 it gets at
   * 960×600 — so the last beat, « Vous validez, une fois », is below the fold at
   * **both** sizes, on the one screen a rep sees exactly once. Before this, `<main>`
   * carried `overflow-y-auto` and nothing else: measured at 960×600, 54 pixels
   * behind a hard edge with no mask and no control, and invisible to all nine
   * checks — `--scrollers` skips a landmark, rightly, because a landmark *is* the
   * page's own scroll region.
   *
   * So this stage asks the one question none of the nine asks, which is
   * `review-garde-mort`'s: the turn exists while something is hidden, **every
   * press moves the scroller**, and the last beat ends up whole inside the column.
   * Waiting for the button to exist would pass on a dead control, and a stage that
   * measured nothing would be worse than no stage.
   */
  'onboarding-suite': {
    scenario: 'onboarding',
    async drive(page) {
      await SCREENS['onboarding-essai'].drive(page)
      const column = page.locator('main .fade-below')
      await column.waitFor()

      // A stage whose fixture cannot exercise its own property is the first shape
      // on this repo's list: if step 3 fits, there is nothing here to reveal.
      const hidden = await column.evaluate((el) => el.scrollHeight - el.clientHeight)
      if (hidden < 40) {
        throw new Error(`rien sous la ligne de flottaison (${hidden} px) : cette étape ne mesure rien`)
      }

      const whole = () =>
        page.evaluate(() => {
          const col = document.querySelector('main .fade-below')
          const last = [...document.querySelectorAll('ol > li')].find((li) =>
            li.textContent?.includes('Vous validez'),
          )
          if (!col || !last) return false
          const box = col.getBoundingClientRect()
          const beat = last.getBoundingClientRect()
          return beat.top >= box.top - 1 && beat.bottom <= box.bottom + 1
        })

      for (let press = 0; press < 8 && !(await whole()); press++) {
        /*
          The control inside the column, never a label: this stage used to name
          « Lire la suite » and the verb is the caller's — the gate's rail says
          « Voir la suite de ce qui part » — so a surface that changed verbs would
          have left this loop `break`ing on the first iteration and failing two
          lines below with a sentence about the beat instead of about the button.
        */
        // Same reach as `readToTheEnd`: the turn is the scroller's sibling now.
        const turn = column
          .locator('.turn-ground button')
          .or(column.locator('xpath=..').locator('> .turn-ground button'))
        if ((await turn.count()) === 0) break
        const before = await column.evaluate((el) => el.scrollTop)
        await turn.first().click()
        await page.waitForTimeout(500)
        const after = await column.evaluate((el) => el.scrollTop)
        if (after <= before) {
          throw new Error(`le tour de page n’a rien déplacé (scrollTop ${before} → ${after})`)
        }
      }

      if (!(await whole())) {
        throw new Error('le dernier temps de l’étape 3 reste coupé après les tours de page')
      }
      /*
        And then the *other* end of the same column, which this stage stopped one
        press short of — measured: with R32-2's interpolation put back, this stage
        stayed green at both sizes, because « the last beat is whole » is reached
        while there is still something below, so the control it was left on still
        said « Lire la suite ». Step 3 feeds « cette étape », the one determiner
        that is neither an article nor contracted, so this is the column that
        reads worst in the ascending frame: « Remonter dans de cette étape », on
        the one screen a rep sees exactly once.
      */
      await readToTheEnd(page, column, { mustPress: false })
    },
  },

  'session-demander': {
    scenario: 'compte-rendu',
    async drive(page) {
      await SCREENS['session-compte-rendu'].drive(page)
      /*
        Typed, not clicked.

        It pressed a suggestion chip — and the chips are scaffolding that a
        narrow column cannot afford: below a 430px container they are dropped, so
        at 960, the window's own minimum, the stage had nothing to press. Typing
        the question is what a rep does after their first one anyway, and it
        works at every width the product supports.
      */
      await page
        .getByLabel('Poser une question sur cet appel')
        .fill('Qu’est-ce qui a été dit sur le TJM ?')
      await page.getByRole('button', { name: 'Demander' }).click()
      /*
        The answer first, then its last citation.

        Waiting only on the tail — « introuvable dans la transcription » — was
        racing the render of a list that arrives in one commit, and the stage
        failed twice in eight runs. The prose is what lands first, so waiting on
        it is waiting for the panel to have answered at all.
      */
      await page.getByText(/revient dessus à/).waitFor()
      await page.getByText('introuvable dans la transcription', { exact: false }).waitFor()
    },
  },

  review: {
    scenario: 'review',
    // The panel is taller than 900px — see the note beside `addStyleTag` below.
    expand: true,
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: OPEN_ROW })
        .click()
      await page.getByRole('button', { name: 'Relire et valider' }).click()
      await page.getByText('Prêt à envoyer').waitFor()
      /*
        The gate as it *opens*: scrolled to the one field the extraction could
        not verify, and with the live control in the primary slot being the one
        that shows the rest of the payload. `Valider` is not on screen yet and
        that is the design — see `review-valider` for the other half.
      */
      await page.getByText('⚠ faible').first().waitFor()
      await page.waitForTimeout(600)
    },
  },

  /*
   * **The gate's field rail groups by ground, and this is the number.**
   *
   * The rail drew eleven value boxes on three nested grounds and let the
   * strokes do the grouping. Measured on the shipped page before the change:
   * the `<aside>` `rgb(249,251,253)`, the container `rgb(253,254,254)`, a value
   * box `rgb(255,255,255)` — **1.010:1** between the last two, and
   * **fifty-eight** border sides inside the container, counted here.
   *
   * **Why ΔL\*, and not the contrast ratio this repo measures everywhere
   * else.** WCAG's ratio is the right instrument for a mark against its ground
   * and the wrong one for two near-white grounds against each other: it is a
   * ratio, so at the dark end a hair of luminance buys a large number and at
   * the light end a visible step buys almost none. The widget's old
   * `--widget-soft` #1b2a35 was thrown out as « too faint to group with » at
   * **1.176:1** — a larger ratio than anything the light palette can state, on
   * a step that is ΔL* 6.64. CIE L* is perceptually uniform and comparable
   * across both ends, a just-noticeable difference is about 1, and the floor
   * below is 2.5 — two and a half JNDs, which is the least a *region* can be
   * and still be one.
   *
   * Shipped today: the container is ΔL* **2.94** from the aside, a value box
   * ΔL* **4.42** from the container, and there are **no** horizontal rules
   * inside it. Falsified against all three ways back: `bg-card` on the
   * container (box falls to 0.42), the field's `border-subtle border`, and the
   * container's `divide-y`.
   */
  'review-rail': {
    scenario: 'review',
    expand: true,
    async drive(page) {
      await SCREENS.review.drive(page)
      await settled(page)
      await measureRail(page, { inert: false })
    },
  },

  /*
   * **The same claim, in the state where nine of the eleven boxes are gone.**
   *
   * A field the gate cannot ship has no fill on purpose — it is text on the
   * ground, which is what read-only means here — so its step is 0.00 by design.
   * The first draft of `review-rail` handled that with
   * `.filter((el) => !el.readOnly)`, which removes nothing on the nominal screen
   * and silently drops nine of eleven rows here: driven, « boîtes mesurées :
   * 11 → 2 », verdict PASSE. A floor declared for a grammar and applied to two
   * rows of it is a floor nobody is holding.
   *
   * So the rail is measured in both states and every row is classified rather
   * than filtered — see `measureRail`, which fails on a census that is not
   * eleven.
   */
  'review-rail-inerte': {
    // The scenario is `review`; the inert state is reached by the rep's own
    // press, which is what `review-sans-opportunite` drives.
    scenario: 'review',
    expand: true,
    async drive(page) {
      await SCREENS['review-sans-opportunite'].drive(page)
      await settled(page)
      await measureRail(page, { inert: true })
    },
  },

  /**
   * The same gate once **both** columns have been read to the end.
   *
   * The guard covers the document and the mail draft as well as the rail —
   * those are the two strings that actually leave the machine — so reaching
   * *Valider* takes one press per column, and the primary slot names which one
   * it is showing each time.
   */
  /*
   * **The ninth attack, and it needed its own gate.**
   *
   * `review-garde` above is one rep in one sitting, so by the time it reaches
   * its eighth attack that rep has legitimately read both columns end to end —
   * and coverage is a *set*, so going back is free and correct. This one has to
   * start clean, because what it is about is a column that was counted as read
   * **before its content existed**.
   *
   * One click on *Transcription*, nothing else. `TranscriptReader` fetches its
   * own record and draws « Chargement… » until it lands, and that placeholder
   * fills the column — `scrollHeight === clientHeight`, so it is « covered » the
   * instant it paints. The transcript then replaced it, nothing re-measured (a
   * scroller's own box does not change when its content grows, and nobody
   * scrolls when content appears), and four presses of the rail's page turn put
   * *Valider* on screen with the compte-rendu at `scrollTop` 0 and seventeen
   * hundred pixels of transcript never shown. That press writes the VerySwing
   * task, and `POST /v1/crm/tasks` has no idempotency key.
   *
   * Held by three things now, and the stage is here because none of them is
   * visible in a unit test: the coverage set remembers the **content** height
   * it was covered at, the view key says « chargement » until the record lands,
   * and the observer watches the column's content and not only its box.
   */
  'review-garde-transcription': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      await page.waitForTimeout(900)
      await page.getByRole('button', { name: 'Transcription', exact: true }).click()
      await page.waitForTimeout(900)
      /*
       * The rail's own page turns, pressed the way a rep presses them — and only
       * the rail's. A working guard eventually offers the *document* a turn
       * instead, which is the refusal; a broken one runs the rail out and puts
       * the decision in the slot.
       */
      for (let i = 0; i < 20; i++) {
        const turn = page.getByRole('button', { name: /ce qui part/ })
        if ((await turn.count()) === 0) break
        await turn.first().click()
        await page.waitForTimeout(250)
      }
      if ((await page.getByRole('button', { name: /^Valider/ }).count()) > 0) {
        throw new Error(
          'le gate s’arme après un simple clic sur « Transcription » : la colonne a été comptée lue pendant son chargement',
        )
      }
      /*
       * And it names the way to what is still unread.
       *
       * This waited on « Lire la suite de la transcription » — a page turn of the
       * transcript, which is the one thing that control could not usefully be: the
       * compte-rendu is what the guard is waiting on and it is not in that column, so the
       * turn moved the transcript forever and armed nothing (`review-garde-tapis`, and
       * `unread`'s docblock for the two measurements). The refusal this stage exists to
       * prove is unchanged; what it asserts about the *remedy* is now the control that can
       * actually reach it.
       */
      await page.getByRole('button', { name: 'Revenir au compte-rendu' }).first().waitFor()
    },
  },

  /*
   * **The tenth attack, and it is a *return* the guard must leave free.**
   *
   * `review-garde`'s four free returns are all inside one document. This one
   * leaves it: read both columns, arm *Valider*, then press `source ▸` and
   * « Voir dans la transcription › » — the gesture DEC-21 exists to produce, and
   * the one thing this product has that a general-purpose notetaker does not.
   *
   * It used to cost the arming. The fix for the ninth attack made the transcript
   * a *view* of the document column, so following a citation put another
   * document in the measured box and the coverage went with it: on a fifty-minute
   * call, **fifty page turns** to get *Valider* back, under a sentence naming the
   * compte-rendu while the only control offered named the transcript, with an
   * escape — one click on « Lecture » — that nothing on screen mentioned.
   *
   * The ninth attack is still refused, in `review-garde-transcription`, and it
   * has to stay that way: these two are the pair, and a fix for either that
   * breaks the other is the oscillation this guard has been through twice.
   */
  'review-garde-citation': {
    scenario: 'review',
    async drive(page) {
      await SCREENS['review-valider'].drive(page)
      await page.getByRole('button', { name: /^Valider/ }).waitFor()

      await page.getByRole('button', { name: /^source/ }).nth(2).click()
      await page.getByRole('button', { name: /Voir dans la transcription/ }).first().click()
      await page.getByText(/Citation du champ/).first().waitFor()
      await page.waitForTimeout(700)

      if ((await page.getByRole('button', { name: /^Valider/ }).count()) === 0) {
        const asked = await page
          .getByRole('button', { name: /(la suite|Remonter)/ })
          .allInnerTexts()
        throw new Error(
          `suivre une citation a désarmé « Valider » — le gate demande ${JSON.stringify(asked)}`,
        )
      }

      // And back, which must also be free: the compte-rendu was read once.
      await page.getByRole('button', { name: 'Lecture', exact: true }).click()
      await page.waitForTimeout(500)
      await page.getByRole('button', { name: /^Valider/ }).waitFor()
    },
  },

  /*
   * **The eleventh attack, and the third instance of one shape.**
   *
   * Read both columns, arm *Valider*, then open five `[source ▸]` panels — which
   * is a rep checking the evidence on five of eleven rows, and the behaviour
   * DEC-21 exists to produce. It used to cost the arming: the panels open
   * *inline*, inside the rail the guard measures, so the content grew past
   * `GROWTH_SLACK` and the coverage was deleted. Closing them again left the
   * screen pixel-identical to the armed one and still refused — two page turns
   * to recover at 1280×800, five at 960×600.
   *
   * *Demander* was the first (`data-unmeasured`, in the other column) and the
   * transcript was the second. The sentence is the same each time: the guard
   * measures what ships, and evidence does not ship.
   */
  'review-garde-sources': {
    scenario: 'review',
    async drive(page) {
      await SCREENS['review-valider'].drive(page)
      await page.getByRole('button', { name: /^Valider/ }).waitFor()

      const sources = page.getByRole('button', { name: /^source/ })
      const count = Math.min(5, await sources.count())
      for (let i = 0; i < count; i++) {
        await sources.nth(i).click()
        await page.waitForTimeout(150)
      }
      await page.waitForTimeout(400)

      if ((await page.getByRole('button', { name: /^Valider/ }).count()) === 0) {
        const asked = await page.getByRole('button', { name: /(la suite|Remonter)/ }).allInnerTexts()
        throw new Error(
          `ouvrir ${count} sources a désarmé « Valider » — le gate demande ${JSON.stringify(asked)}`,
        )
      }

      // And closing them is free too: the screen is the one that was armed.
      for (let i = count - 1; i >= 0; i--) {
        await sources.nth(i).click()
        await page.waitForTimeout(120)
      }
      await page.waitForTimeout(400)
      await page.getByRole('button', { name: /^Valider/ }).waitFor()
    },
  },

  /*
   * **The twelfth attack, and it is a *correction* the guard must leave free.**
   *
   * Arm *Valider*, then type a paragraph into the follow-up mail body — which is
   * the thing a rep does on this screen, in the field whose whole purpose is to
   * be edited. `GROWTH_SLACK` is a hundred pixels and nine lines of typing is
   * more than that, so the button left the screen and recovering it cost six
   * page turns at 1280×800 and nine at 960×600, re-showing a column already read
   * to look at text the rep had just written and was staring at.
   *
   * `Review.tsx` states that exact behaviour, fifty lines above the rule, as the
   * thing the latch exists to prevent.
   */
  /**
   * **The page turn is the only way back, so it has to get there.**
   *
   * `review-garde` and its four siblings all prove the guard *refuses*, which is the
   * property that protects the client's CRM. None of them asks the other half: that the
   * control the refusal offers actually **arms** the gate. So a page turn that moved
   * nothing was green on eight measured checks and 108 stagings, and DEC-4's one
   * confirmation gate — the only thing in this product that writes into a client's system
   * of record — was unreachable after either of the two most ordinary gestures on the
   * screen.
   *
   * Measured on the shipped renderer before this stage existed: drag the compte-rendu's
   * scrollbar thumb to the end, or press the `source ▸` on a row the gate's own opening
   * jump put above the fold, and *Valider* never appears — **forty presses**, at 1280×800
   * and at 960×600. The direction was read off the recorded band rather than off
   * `el.scrollTop`, and the step was a fixed page rather than the band's edge, so the
   * control aimed into a clamp or oscillated across a gap it could never close.
   *
   * Both gestures are driven here, and what is asserted is *progress*: every press must
   * move a scroller, and the gate must arm within sixteen. `review-garde` asserts that the
   * button exists; existence is what a dead control has.
   *
   * The printed count is worth reading rather than only the pass: measured at 7 and 6
   * presses at 1280×800, 9 and 8 at 960×600. Reverting the *step* — a fixed page instead
   * of the covered band's edge — is « inatteignable » at both sizes; reverting the
   * *direction* costs more, which is a regression this stage shows in its own output
   * rather than hides behind a threshold.
   *
   * **Those numbers moved when US-14 made the scroll instant, and the movement was the
   * stage's own.** It used to wait a flat 360 ms after each press, which was *inside* the
   * 415 ms smooth animation — so the tail of every press landed during the next query and
   * the count it printed was understated. It was 6 and 5 / 10 and 7 against a scroller
   * still moving. The rep's cost did not change; what changed is that the stage reads a
   * settled position.
   *
   * **And « settled » is now measured rather than waited out** (`pressAndSettle`, US-17).
   * The flat wait was the only thing standing where a duration should have been, and it
   * could not fail: a scroll animation carries neither `transitionDuration` nor
   * `animationDuration`, so `--motion` never saw the 415 ms and `settled` cannot see it
   * either — a scroll is not a `getAnimations()` entry. Two samples per press, at 150 ms
   * and at 210 ms, and a disagreement between them *fails the stage*. Measured on the
   * pre-`a511d30` renderer: red on the first press at both sizes, the columns 637 px apart
   * across the two samples at 1280×800 (`1427/1802` then `790/1802`) and 680 px at 960×600.
   * Green after, on byte-identical trails at 7/6 and 9/8 presses — and 150 ms cheaper per
   * press: the four runs took 39.6 s and now take 33.6 s.
   */
  'review-garde-mort': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      await page.waitForTimeout(900)

      const ship = () => page.getByRole('button', { name: /^Valider/ })
      // Asked apart from the turn deliberately: they are the same rectangle by design
      // (« the one control that ships is never the rectangle the rep just pressed »), so a
      // driver that pressed whatever matched would press *Valider* and report success.
      const turn = () =>
        page.locator('button').filter({ hasText: /Lire la suite|Remonter|Voir la suite/ }).first()

      /** Where both guarded columns are, so a press that moves nothing can be named. */
      const at = () =>
        page.evaluate(() =>
          // Every scroller tall enough to be a column, found by geometry rather than by a
          // selector: the rail carries neither `data-guarded` nor `fade-below`, and a
          // selector that missed it would read « nothing moved » on a press that moved it.
          [...document.querySelectorAll('#root *')]
            .filter((el) => el.scrollHeight - el.clientHeight > 8 && el.clientHeight > 120)
            .map((el) => `${Math.round(el.scrollTop)}/${Math.round(el.scrollHeight - el.clientHeight)}`)
            .join(' '),
        )

      /**
       * Press the turn until the gate arms, and say how many it took.
       *
       * **Two assertions, and the second is the one that matters.** Reachability alone is
       * a loose guard — a control that takes twelve presses where it should take eight is
       * reachable and still wrong — so every press is required to *move something*. « Does
       * this control do anything » is the question none of the eight measured checks asks,
       * and the answer was no for two of the most ordinary gestures on this screen.
       */
      const reach = async (how, ceiling) => {
        for (let press = 0; press <= ceiling; press += 1) {
          if ((await ship().count()) > 0) return press
          if ((await turn().count()) === 0) {
            throw new Error(`${how}: ni *Valider* ni tour de page — le gate n’offre plus rien`)
          }
          const before = await at()
          const label = (await turn().innerText()).replace(/\s+/g, ' ').trim()
          const after = await pressAndSettle(page, { control: turn(), at, how, label })
          if (before === after && (await ship().count()) === 0) {
            throw new Error(
              `${how}: « ${label} » n’a rien déplacé (${before}) et *Valider* n’est pas ` +
                'apparu — contrôle mort, et le gate est inatteignable (DEC-4)',
            )
          }
        }
        throw new Error(
          `${how}: *Valider* toujours absent après ${ceiling} pressions — le tour de page ` +
            'ne déplace rien et le gate est inatteignable (DEC-4)',
        )
      }

      // The thumb dragged to the end: a jump, so it contributes no coverage — and the
      // control has to take the rep back to the band it skipped.
      await page.evaluate(() => {
        const doc = document.querySelector('main.fade-below')
        if (!doc) return
        doc.scrollTop = doc.scrollHeight
        doc.dispatchEvent(new Event('scroll'))
      })
      await page.waitForTimeout(500)
      const afterThumb = await reach('pouce de l’ascenseur au bas du compte-rendu', 16)

      /*
       * And the same from the rail, reached the way a rep reaches it: `source ▸` on a row
       * the opening jump left above the fold, which scrolls the rail without the app
       * marking it. Driven on a second load, because the first has already covered both
       * columns by the time it arms.
       */
      await page.reload({ waitUntil: 'domcontentloaded' })
      await SCREENS.review.drive(page)
      await page.waitForTimeout(900)
      const sources = page.locator('button').filter({ hasText: 'source ▸' })
      if ((await sources.count()) < 2) throw new Error('aucune citation à suivre dans le rail')
      await sources.nth(1).click()
      await page.waitForTimeout(600)
      const afterSource = await reach('citation suivie au-dessus du pli', 16)

      console.log(
        `     garde: *Valider* atteint en ${afterThumb} pression(s) après le pouce, ` +
          `${afterSource} après la citation`,
      )
    },
  },
  /**
   * **The same question, from the one tab where the answer was no — and « it moved » was
   * what hid it.**
   *
   * `review-garde-mort` presses until the gate arms and refuses a press that moves nothing.
   * In the *Transcription* tab every press moved something, forever: the control read
   * `docRef` — the transcript's scroller while that tab is open — against a band `measure`
   * deliberately stops updating, which is the compte-rendu's. So it aimed at the
   * compte-rendu's covered edge inside the transcript, fell back to a page when it was
   * already there, and came straight back. Measured on the shipped renderer before the fix:
   * **752 ↔ 1427 of 16 972** for twenty-five presses at 1280×800 and **547 ↔ 1030 of
   * 17 172** for fourteen at 960×600, with *Valider* never appearing and the sentence under
   * the slot saying « il reste du compte-rendu, à gauche » the whole time. The compte-rendu
   * was unarmable **by construction** while that tab was open, not by accident.
   *
   * Reached by the gesture DEC-21 exists to produce — `source ▸` then « Voir dans la
   * transcription › » — on a gate the rep has read nothing of yet, which is the ordinary
   * order: the gate opens jumped to the one `⚠ faible` row, so checking that row's evidence
   * is the first thing a rep does.
   *
   * Two assertions, and the second is what `review-garde-mort` could not ask. The gate has
   * to **arm**, which is the reachability half. And no press may land the columns on a
   * position they have already been on: « something moved » is satisfied by a treadmill,
   * and a repeat is the treadmill's signature. `review-garde-transcription` is the other
   * half of this pair and stays as it was — opening the tab still arms nothing.
   */
  'review-garde-tapis': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      await page.waitForTimeout(900)

      // The DEC-21 route into the tab, on a gate nothing has been read on yet.
      const sources = page.locator('button').filter({ hasText: 'source ▸' })
      if ((await sources.count()) < 3) throw new Error('aucune citation à suivre dans le rail')
      // The third, like `review-garde-citation`: the two deterministic rows carry no span
      // (DEC-7) and their panel offers no jump, so a lower index opens a dead end.
      await sources.nth(2).click()
      await page.getByRole('button', { name: /Voir dans la transcription/ }).first().click()
      await page.getByText(/Citation du champ/).first().waitFor()
      await page.waitForTimeout(800)

      const ship = () => page.getByRole('button', { name: /^Valider/ })
      // Every shape the guard's own remedy takes, including the one that leaves the tab:
      // a driver that only knew the page turn's wording would report « plus rien » on a
      // screen that is offering the right control.
      const turn = () =>
        page
          .locator('button')
          .filter({ hasText: /Lire la suite|Remonter|Voir la suite|Revenir au compte-rendu/ })
          .first()

      const at = () =>
        page.evaluate(() =>
          [...document.querySelectorAll('#root *')]
            .filter((el) => el.scrollHeight - el.clientHeight > 8 && el.clientHeight > 120)
            .map(
              (el) =>
                `${Math.round(el.scrollTop)}/${Math.round(el.scrollHeight - el.clientHeight)}`,
            )
            .join(' '),
        )

      /**
       * Armed — asked so that « the gate offers nothing » cannot be the same instant as
       * « the gate is armed », seen twice.
       *
       * `measure` runs from a `ResizeObserver` and publishes `below` as React state, so the
       * press that finishes a column leaves one commit between the scroll and the button.
       * Measured: at 1280×800 the sixth press armed the gate and the two queries either
       * side of that commit answered « no *Valider* » and « no page turn » — a false
       * « inatteignable » on a screen whose *Valider* was already painted. So the absence
       * of a control is a question to ask again with a bound, never a conclusion.
       */
      const armed = async () => {
        if ((await ship().count()) > 0) return true
        if ((await turn().count()) > 0) return false
        await ship().first().waitFor({ timeout: 2000 }).catch(() => undefined)
        return (await ship().count()) > 0
      }

      const CEILING = 26
      const been = new Set([await at()])
      const trail = []
      for (let press = 0; press <= CEILING; press += 1) {
        if (await armed()) {
          console.log(
            `     tapis: *Valider* atteint en ${press} pression(s) depuis l’onglet ` +
              `Transcription (${trail.join(' → ')})`,
          )
          return
        }
        if ((await turn().count()) === 0) {
          throw new Error(
            `depuis l’onglet Transcription : ni *Valider* ni tour de page après ` +
              `${press} pression(s) — le gate n’offre plus rien (DEC-4)`,
          )
        }
        const label = (await turn().innerText()).replace(/\s+/g, ' ').trim()
        // Same instrument as `review-garde-mort`: a treadmill and a scroll still moving
        // are two different defects and this stage would have printed the second as a
        // position, so both are asked here.
        const after = await pressAndSettle(page, {
          control: turn(),
          at,
          how: 'depuis l’onglet Transcription',
          label,
        })
        trail.push(after)
        if (been.has(after)) {
          throw new Error(
            `depuis l’onglet Transcription : « ${label} » ramène les colonnes sur une ` +
              `position déjà vue (${after}) — tapis roulant, et le compte-rendu reste ` +
              'inarmable tant que cet onglet est ouvert (DEC-4)',
          )
        }
        been.add(after)
      }
      throw new Error(
        `depuis l’onglet Transcription : *Valider* toujours absent après ${CEILING} ` +
          `pressions (${trail.slice(-6).join(' → ')}) — le gate est inatteignable (DEC-4)`,
      )
    },
  },
  'review-garde-frappe': {
    scenario: 'review',
    async drive(page) {
      await SCREENS['review-valider'].drive(page)
      await page.getByRole('button', { name: /^Valider/ }).waitFor()

      const body = page.locator('textarea').last()
      await body.click()
      // Twelve lines: well past the hundred-pixel allowance, and an ordinary
      // paragraph in a client email.
      await body.press('End')
      for (let i = 0; i < 12; i++) {
        await body.type(`\nLigne ${i} de la relance que le commercial écrit lui-même.`)
      }
      await page.waitForTimeout(500)

      if ((await page.getByRole('button', { name: /^Valider/ }).count()) === 0) {
        const asked = await page.getByRole('button', { name: /(la suite|Remonter)/ }).allInnerTexts()
        throw new Error(
          `écrire dans un champ a désarmé « Valider » — le gate demande ${JSON.stringify(asked)}`,
        )
      }
    },
  },

  'review-valider': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      /*
        Match on the *shape* of the two controls rather than on their wording.

        This waited on `/^Afficher /` and on the exact string `Valider`, and both
        changed the same week: the reveal control became a page turn (« Lire la
        suite du compte-rendu » / « Voir la suite de ce qui part ») and the
        primary started naming what it ships (« Valider malgré 1 champ non
        vérifié »). The stage then failed at every viewport — so the one screen
        that photographs the armed gate, which is the product's headline claim,
        could not be photographed by the documented design pass, and nothing said
        so until a reviewer tried.

        `/(la suite|Remonter)/` is the page turn in both of its directions — it
        points *up* when the unread band is above, which is the ordinary case at
        this gate because it opens by jumping the rail to the first `⚠ faible`
        row. `/^Valider/` is the primary in both of its states. A copy change
        that breaks *these* has changed what the controls are, not how they are
        worded, and should fail here.

        The loop is bounded well above the number of turns two columns need: the
        document is about three screenfuls at 800px and nine at 960.
      */
      await page.waitForTimeout(900)
      for (let i = 0; i < 40; i++) {
        const turn = page.getByRole('button', { name: /(la suite|Remonter)/ })
        if ((await turn.count()) === 0) break
        await turn.first().click()
        await page.waitForTimeout(STAGING_TURN_MS)
      }
      await page.getByRole('button', { name: /^Valider/ }).waitFor()
      await page.waitForTimeout(400)
    },
  },

  /*
   * **A tick that draws nothing in a column must not un-read that column.**
   *
   * `viewOf('rail')` was keyed on the whole checked set. Driven here at both
   * sizes before the fix: arm the gate, untick « Brouillon de relance », and
   * *Valider* is gone — replaced by « Il reste des champs à lire, plus haut. »
   * over a page turn reading « Remonter dans ce qui part ». Eight presses at
   * 960×600 to get it back, over a rail whose text and `scrollHeight` are
   * identical before and after (1159/1159, measured across all eight tick sets).
   *
   * The stage asserts the whole of the rule and not only the half that moved,
   * because a key that invalidated *nothing* would pass the first assertion: the
   * Outlook draft leaves the button standing, and the opportunity — which does
   * turn nine rows read-only and insert a paragraph at the top of this column —
   * still takes it away. That second one is DEC-4 and is the reason the guard
   * exists.
   */
/**
   * **`source ▸` arriving and leaving — the one departure `index.css` names as
   * open.**
   *
   * That file's `.leaving` note ends « Measured: eleven panels on the review
   * gate, 438px of DEC-21 evidence between them, `transition: all 0s`, gone one
   * frame after the press. It is **open**, not declined. » This is that panel,
   * and neither half of it existed: it appeared between two frames as well.
   *
   * It has to be a stage for the reason `reglages-sortie` and `widget-sortie`
   * are stages: `.leaving` is on nothing at rest, so `--motion` run against a
   * settled screen measures a panel that never moves and passes. The class
   * arrives through a React state update inside `useDeparture`, so it is waited
   * for rather than assumed.
   *
   * Both halves are asserted, and by their **curves**, because the failure this
   * repo has already shipped once on an exit is a departure wearing the arrival's
   * ease — an expo-out spending 73% of its change in the first 35ms, which is a
   * blink. Ease-out on the way in, ease-in on the way out (VISION §6).
   */
  'review-source-sortie': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      const source = page.getByRole('button', { name: /^source/ }).first()
      await source.click()

      const panel = page.locator('[data-unmeasured].animate-rise-in').first()
      await panel.waitFor({ timeout: 5_000 }).catch(() => {
        throw new Error(
          'source ▸ ouvre sans arrivée — le panneau de provenance apparaît entre deux ' +
            'images, sur le geste que DEC-21 existe pour inviter',
        )
      })
      const arrival = await panel.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          name: style.animationName,
          duration: style.animationDuration,
          ease: style.animationTimingFunction,
        }
      })
      if (arrival.name !== 'riseIn' || !arrival.ease.startsWith('cubic-bezier(0.22, 1,')) {
        throw new Error(
          `source ▸ arrive sans la courbe d’entrée du produit : ${JSON.stringify(arrival)}`,
        )
      }

      await page.waitForTimeout(300)
      await source.click()
      const going = page.locator('[data-unmeasured].leaving').first()
      await going.waitFor({ timeout: 5_000 }).catch(() => {
        throw new Error(
          'source ▸ se ferme sans départ — le panneau disparaît une image après la ' +
            'pression, ce que src/design/index.css nomme comme ouvert',
        )
      })
      const exit = await going.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          property: style.transitionProperty,
          duration: style.transitionDuration,
          ease: style.transitionTimingFunction,
          opacity: Number(style.opacity),
        }
      })
      if (!exit.ease.includes('cubic-bezier(0.64, 0, 0.78, 0)')) {
        throw new Error(
          `source ▸ s’en va sans --ease-in : ${JSON.stringify(exit)} — une sortie qui porte ` +
            'la courbe d’arrivée est un clignotement (VISION §6)',
        )
      }
      if (!/opacity/.test(exit.property)) {
        throw new Error(`source ▸ s’en va sans transition d’opacité : ${exit.property}`)
      }

      /*
       * **And the rule is not the paint.** Everything above reads
       * `transition-property`, `transition-duration` and
       * `transition-timing-function` off the leaving element — which is what the
       * stylesheet *intends*. A node created already wearing `.leaving` carries
       * every one of those and paints none of them, because a transition
       * interpolates from the last value the browser painted and a node that
       * was never painted has none. That is verbatim the shape `useLeaving`
       * shipped on the agenda's row, three call sites away, and this stage's
       * assertions would all have passed over it.
       *
       * So the panel is opened once more and its departure frame-sampled with
       * the same judge the widget window has used since round 19: frames
       * between the two ends, and the last of them at zero. `departureOf`
       * presses the control itself, so the tracer is armed before the press —
       * the property `reglages-sortie` states one level up.
       */
      await page.waitForTimeout(300)
      await source.click()
      await panel.waitFor({ timeout: 5_000 })
      await page.waitForTimeout(300)
      /*
       * `departureOf` takes a selector for the control because it presses from
       * inside the page, in the same task it arms the tracer in. The product
       * gives this button no attribute of its own, so the harness marks it here
       * rather than asking the renderer for a hook it has no other use for.
       */
      await source.evaluate((el) => el.setAttribute('data-harness-press', ''))
      judgeDeparture(
        'source ▸',
        await departureOf(page, '[data-unmeasured].animate-rise-in', '[data-harness-press]'),
      )
      // Reopened and left on camera mid-flight, the way `reglages-sortie` leaves
      // its sheet — the photograph is still of a departure in progress.
      await source.click()
      await panel.waitFor({ timeout: 5_000 })
      await page.waitForTimeout(300)
      await source.click()
      await page.locator('[data-unmeasured].leaving').first().waitFor({ timeout: 5_000 })
    },
  },

  'review-decocher': {
    scenario: 'review',
    async drive(page) {
      await SCREENS['review-valider'].drive(page)
      const valider = () => page.getByRole('button', { name: /^Valider/ })
      await valider().waitFor()

      const tick = (name) => page.getByRole('checkbox', { name })
      await tick(/Brouillon de relance/).click()
      await page.waitForTimeout(400)

      if ((await valider().count()) === 0) {
        const asked = await page.getByRole('button', { name: /(la suite|Remonter)/ }).allInnerTexts()
        throw new Error(
          'décocher le brouillon Outlook a désarmé « Valider » — le rail ne dessine pas ' +
            `cette intention et le gate demande ${JSON.stringify(asked)} (DEC-4)`,
        )
      }

      // The other direction: an intent this column *does* draw still withholds it.
      await tick(/Opportunité/).click()
      await page.waitForTimeout(400)
      if ((await valider().count()) !== 0) {
        throw new Error(
          'décocher l’opportunité n’a pas désarmé « Valider » — neuf lignes de cette ' +
            'colonne viennent de passer en lecture seule sans que le commercial les ait vues (DEC-4)',
        )
      }
      await tick(/Opportunité/).click()
      await page.waitForTimeout(400)
      await valider().waitFor()
    },
  },

  /*
   * The gate with a citation followed into the record (DEC-21).
   *
   * Staged through the gesture rather than by a URL, because there is no URL:
   * a rep opens the source of the one field the extraction could not verify,
   * and presses the link under the quote. The screenshot is what they then see
   * — which is the whole feature, and is invisible in a shot of the gate.
   *
   * Not expanded. The reader is a scroller by design and the point of it is
   * that the cited line is scrolled *to*; unclipping it would photograph the
   * whole call and lose the one thing worth looking at.
   */
  /*
   * The verified case: the citation is found, highlighted and scrolled to.
   * Row 2 is *Besoin*, whose quote `spanVerification.ts` matched.
   */
  'review-transcription': { scenario: 'review', drive: (page) => followSource(page, 2) },

  /*
   * The other verdict, and the one Granola has no equivalent of: the field the
   * extraction could *not* verify. The reader says so at the top rather than
   * opening silently at 0:00 and leaving the rep to hunt for a sentence that is
   * not in the record.
   */
  'review-transcription-introuvable': {
    scenario: 'review',
    drive: (page) => followSource(page, 9),
  },

  historique: {
    scenario: 'historique',
    // The list plus the open row is taller than 900px.
    expand: true,
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Tout l’historique ›' }).click()
      await page.getByRole('list', { name: 'Appels enregistrés' }).waitFor()
      // One row open, so the four sections of DEC-25 are on screen.
      await page
        /*
          Not « Groupe Lefort — découverte… »: the row's two lines no longer
          repeat the client. The objet a rep types opens on the client's own name
          almost every time, so `meetingHeading` strips the prefix it duplicates
          — the title says the client once and the subtitle says what the call
          was about.
        */
        .getByRole('button', { name: /Groupe Lefort.*découverte du besoin plateforme/ })
        .click()
      /*
        **The one caption the record still has, asked for as a heading.**

        This waited on `getByText('Compte-rendu')`, and that caption is gone — the
        document opens on its own `#` heading. What matters more is that the old
        wait never proved the caption was there in the first place: measured on the
        open record, that substring matches **three** elements and not one — the
        page turn « Lire la suite du compte-rendu », the search excerpt's own
        « Compte-rendu » label under the collapsed row, and « Tâche compte-rendu
        (VerySwing) » in *Envois*. So it still passed with the caption deleted, and
        it would have passed on a record that never opened.

        `getByRole('heading')` is one element (measured: 1 for « Extraction », 0 for
        « Transcription » and « Compte-rendu »), and a heading is exactly what a
        pane caption is — so this wait now goes red if either deleted caption comes
        back, and red if the two kept ones stop being headings.
      */
      await page.getByRole('heading', { name: 'Extraction' }).waitFor()
      await page.getByText('deux ingénieurs DevOps confirmés', { exact: false }).first().waitFor()
    },
  },

  reglages: {
    scenario: 'reglages',
    // The Connecteurs pane ends in the tenant probe, well below the fold.
    expand: true,
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('navigation', { name: 'Sections des réglages' }).waitFor()
      await page.getByRole('heading', { name: 'Requis' }).waitFor()
      await page.getByRole('heading', { name: 'Facultatifs' }).waitFor()
      await page.getByRole('button', { name: 'Réessayer' }).first().waitFor()
    },
  },

  /**
   * **Réglages on its way out — the app window's only exit, held mid-flight.**
   *
   * `widget-sortie` beside it does this for the pill, and for a long time the
   * pill was the only thing in the product that left at all: `--motion` reported
   * « 0 qui s'en vont, 0 @keyframes de sortie » on all eight app screens, so
   * `--ease-in` — declared, argued over forty lines of `tokens.css` and pinned
   * by shape in `tokens.test.ts` — was worn by one element, in the other window.
   *
   * It has to be a **stage** and cannot be a declaration check, for the reason
   * `widget-sortie` exists: `.leaving` is on nothing at rest, so `--motion` run
   * against the settled screen measures a sheet that never moves and passes. The
   * class arrives through a React state update inside `useDismiss`, which is why
   * it is waited for rather than assumed — a stage that shot the frame before it
   * landed would report « rien à mesurer » and go green, which this repo has
   * shipped three times.
   *
   * The veil is asserted with it. It fades on the same duration, because a
   * backdrop snapping out from under a pane that is still fading is the sheet
   * reading as two surfaces on two clocks.
   */
  'reglages-sortie': {
    scenario: 'reglages',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('navigation', { name: 'Sections des réglages' }).waitFor()
      /*
       * **The keyboard first, because it is the way that was broken.** `Échap`
       * closes through `App.tsx`'s shortcut table, not through the sheet, so it
       * was a route change that unmounted the dialog between two frames while
       * the ✕ beside it animated — measured, « ✕ → leaving, Échap → unmounted ».
       * Both run the same `dismissReglages` now, and a stage that only pressed
       * the button would not have noticed the difference.
       */
      await page.keyboard.press('Escape')
      await page.waitForSelector('[role="dialog"].leaving', { timeout: 5_000 })
      // Let it finish leaving, then do it again with the control.
      await page.waitForTimeout(250)
      await page.getByRole('button', { name: 'Réglages' }).first().click()
      await page.getByRole('navigation', { name: 'Sections des réglages' }).waitFor()
      /*
       * **The tracer is installed before the press, and that is the whole of
       * why it works.** The first version of this assertion read the sheet's
       * opacity *after* the `exit` round-trip above — by which time the sheet
       * had already unmounted, so `querySelector` returned null and the check
       * resolved to « nothing to say ». A check that cannot fail is the thing
       * this stage exists to stop, one level up.
       *
       * So a rAF loop is armed first and records every frame of the departure.
       *
       * **And it is a guard, not a reproduction — stated because the difference
       * matters.** The defect that prompted it (`useDismiss` arming its timer in
       * the press handler, so the sheet snapped out from 44 % opaque) was found
       * by frame-sampling the *real* path and is **not** reproducible on this
       * stage: the harness's `reglages` scenario keeps the sheet mounted after
       * `onClose`, so an early timer has nothing to remove and the fade runs to
       * completion either way. Driven both ways here, both green. What this
       * assertion does catch is a truncation on any path where the surface does
       * unmount — which is every one of them in the shipped app. Claiming it
       * reproduces the original would be the eleventh time prose in this repo
       * was wrong about the code.
       */
      await page.evaluate(() => {
        const w = /** @type {any} */ (window)
        /*
         * Shaped for `judgeDeparture` — `samples` and `detachedAt`, the same two
         * values `departureOf` hands it — because the local rule this used to
         * carry was the weaker of the two and certified the defect. The `when`
         * is the clock `departureOf` uses, so the millisecond in the message
         * means the same thing on both windows.
         */
        w.__exit = { samples: [], detachedAt: null, veilZero: null }
        let seen = null
        const started = performance.now()
        const until = started + 5_000
        const tick = () => {
          if (performance.now() > until) return
          const el = document.querySelector('[role="dialog"].leaving')
          if (el) {
            seen = el
            const opacity = Number(getComputedStyle(el).opacity)
            w.__exit.samples.push(opacity)
            const veil = document.querySelector('.bg-veil')
            if (veil && w.__exit.veilZero === null) {
              const v = Number(getComputedStyle(veil).opacity)
              if (v <= 0.01 && opacity > 0.2) w.__exit.veilZero = opacity
            }
          } else if (seen !== null && !seen.isConnected) {
            w.__exit.detachedAt = performance.now() - started
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })

      await page.getByRole('button', { name: 'Fermer les réglages' }).click()
      await page.waitForSelector('[role="dialog"].leaving', { timeout: 5_000 })

      /*
       * **This stage asserts for itself, and has to.** `--motion` samples the
       * settled page some 400ms after `drive` returns, and by then `useDismiss`
       * has called `onClose` and the sheet is unmounted — so the census would
       * count an element that is no longer there and report « 0 qui s'en vont »
       * while passing. `widget-sortie` escapes that only because nothing in the
       * harness destroys its window, so `.widget-leaving` persists for ever.
       *
       * `widget-entree` already sets the precedent the README states: a stage
       * that needs a value *at an instant* takes it at that instant rather than
       * leaning on a census of the resting frame.
       */
      /*
       * Two frames in, not at the instant the class lands: `getComputedStyle`
       * reports the *current animated* value, so read immediately it is still
       * the resting 1 and the assertion below would fail on a working exit.
       * `--contrast` carries the same caveat about the same API. Well inside the
       * 150ms the sheet survives.
       */
      await page.waitForTimeout(60)
      const exit = await page.evaluate(() => {
        const el = document.querySelector('[role="dialog"].leaving')
        if (!el) return null
        const style = getComputedStyle(el)
        const root = getComputedStyle(document.documentElement)
        return {
          opacity: style.opacity,
          duration: style.transitionDuration,
          easing: style.transitionTimingFunction,
          motion: root.getPropertyValue('--motion').trim(),
          easeIn: root.getPropertyValue('--ease-in').trim(),
          easeOut: root.getPropertyValue('--ease-out').trim(),
        }
      })
      if (!exit) throw new Error('la feuille a disparu avant la mesure')
      // Going, not arriving.
      if (Number(exit.opacity) >= 1) throw new Error(`opacité ${exit.opacity} — la feuille ne part pas`)
      // On the tokens, and on the *exit* end of the motion (VISION.md §6).
      /*
       * **Every property, not the joined string** — `.includes()` here
       * certified the exact defect these stages exist to stop.
       *
       * `.leaving` transitions *two* properties. A substring match on the
       * joined `transition-timing-function` is satisfied by **one** of them
       * carrying `--ease-in`. Driven: opacity on `--ease-overshoot` and
       * transform on `--ease-in` passed all four assertions on both stages at
       * both sizes, with the element at **opacity 0.000 at 60 ms of a 150 ms
       * exit** — ninety milliseconds of a held, mounted, fully transparent
       * surface, which is verbatim what `.widget-leaving`'s docblock measured
       * and fixed. The duration check beside it already used `.every()`; the
       * curve check did not, and nothing else in the loop could see it.
       *
       * Split on top-level commas only: `cubic-bezier(0.64, 0, 0.78, 0)`
       * carries three of its own.
       */
      const curves = exit.easing.split(/,(?![^(]*\))/).map((part) => part.trim())
      if (!curves.every((curve) => curve === exit.easeIn)) {
        throw new Error(
          `courbe(s) de sortie ${JSON.stringify(curves)} — chaque propriété doit porter ` +
            `--ease-in ${exit.easeIn}`,
        )
      }
      if (!exit.duration.split(',').every((d) => d.trim() === '0.15s')) {
        throw new Error(`durée de sortie ${exit.duration} — attendu --motion ${exit.motion}`)
      }

      /*
       * **And the sheet reaches zero before it unmounts, and the veil goes with
       * it.** This stage asserted « opacity < 1 at 60 ms » and never looked
       * again, which is how the sheet shipped snapping out from 44 % opaque for
       * the whole life of `useDismiss`: the timer was armed in the press handler,
       * before React had committed and the browser had painted `.leaving`, so it
       * expired 110 ms into a 150 ms fade. The veil beside it was on
       * `--motion-fast` and reached 0 at 118 ms with the sheet at 0.865.
       */
      /*
       * Read on a timer rather than on a detach: whether this sheet unmounts at
       * all is a separate question from whether its fade completes, and the
       * tracer answers the one this stage is about either way. 400 ms is two and
       * a half `--motion`s.
       */
      await page.waitForTimeout(400)
      const ends = await page.evaluate(() => /** @type {any} */ (window).__exit)
      /*
       * **The shared judge, and not a local rule three claims short of it.**
       *
       * This read « at least 3 frames » and stopped. `judgeDeparture` — which
       * has existed since round 19 and was wired to the widget window and to
       * nothing else — asks three more things of the same samples: that the
       * element *detached*, that at least two frames were painted **between**
       * the two ends, and that the last one was at zero. All three are the
       * claims « a class name is on the element » cannot make.
       *
       * The difference is not theoretical. `useDismiss` latched its `leaving`
       * flag for the life of the hook, so the sheet this stage reopens was
       * already transparent and already wearing the exit before the press; the
       * ✕ then did nothing, the sheet never left, and every one of the four
       * assertions here passed — « ✓ reglages-sortie 1280×800 … 2 qui s'en vont,
       * dans le bon sens », both smoke sizes. Under the judge the same run says
       * « l'élément ne part jamais ».
       *
       * The app window had **no** frame-sampled exit at all: three call sites,
       * all three in `widget-*`, while the four surfaces that leave in the
       * window a rep actually works in were covered by reading the CSS *rule*
       * off the element. A rule is what the stylesheet intends; a sample is
       * what was painted.
       */
      judgeDeparture('réglages', ends)
      if (ends.veilZero !== null) {
        throw new Error(
          `le voile est à zéro alors que la feuille est encore à ${ends.veilZero} — ` +
            `deux surfaces sur deux horloges`,
        )
      }
    },
  },

  /*
   * The dry run, after it has answered — and answered with the case that
   * matters: the rep was heard and the machine was not, which is the failure a
   * rep cannot discover on their own because their own voice is in the
   * transcript and the recording looks like it worked.
   */
  'onboarding-essai-fait': {
    scenario: 'onboarding',
    async drive(page) {
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByRole('heading', { name: 'Votre premier appel' }).waitFor()
      await page.getByRole('button', { name: /^Essai de/ }).click()
      await page.getByText('c’est la moitié qui compte le plus').waitFor()
    },
  },

  /*
   * The gate with the opportunity unchecked — the configuration nobody had
   * photographed, and the one where nine live textareas used to be controls
   * over a payload that would never exist.
   */
  /*
   * **The gesture that used to defeat the gate's own guard.**
   *
   * The gate opens by jumping the rail to the first `⚠ faible` row, which on
   * this document lands it at the bottom — so « the end has been reached » was
   * true before the rep had done anything, and reading the *document* alone
   * armed *Valider* with seven of eleven fields never drawn, *Client* among
   * them. The guard measures the band the rep has actually been shown now, and
   * a jump the app performed leaves behind only where it landed.
   *
   * The stage performs the attack and photographs the refusal: the document read
   * to its end, the rail still holding an unread band, and the control pointing
   * *up* — which is where the unread part is, and which the old one could not
   * even express.
   */
  'review-garde': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      // Past the 700ms window in which the gate's own jump is still settling —
      // a measurement taken inside it records where the scroll lands, not what
      // it animated over, and the stage is about what happens afterwards.
      await page.waitForTimeout(900)
      // Only the document column, to its very end.
      for (let i = 0; i < 20; i++) {
        const done = await page.evaluate(() => {
          const doc = document.querySelector('main.fade-below')
          if (!doc) return true
          if (doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 8) return true
          doc.scrollBy({ top: doc.clientHeight - 64 })
          doc.dispatchEvent(new Event('scroll'))
          return false
        })
        await page.waitForTimeout(120)
        if (done) break
      }
      const refuses = async (how) => {
        if ((await page.getByRole('button', { name: /^Valider/ }).count()) > 0) {
          throw new Error(`le gate s’arme après « ${how} » alors qu’une bande n’a jamais été affichée`)
        }
      }
      await refuses('lecture du seul compte-rendu')

      /*
       * The three other ways a band can be skipped, each of which the guard has
       * to survive because none of them is reading:
       *
       *  · an instant `scrollTo` to the end — a rep's « End » key, a script, a
       *    browser restoring a scroll position;
       *  · a flick, which moves in frame-sized steps and is contiguous, so it is
       *    *allowed* to extend — the assertion is that flicking downwards from a
       *    column already at its end covers nothing new;
       *  · a resize, which changes what a scroll coordinate means underneath a
       *    range recorded in the old one.
       */
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('.fade-below')) {
          el.scrollTo({ top: el.scrollHeight })
          el.dispatchEvent(new Event('scroll'))
        }
      })
      await page.waitForTimeout(300)
      await refuses('un scrollTo instantané au bas des deux colonnes')

      for (let i = 0; i < 20; i++) {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('.fade-below')) {
            el.scrollBy({ top: 400 })
            el.dispatchEvent(new Event('scroll'))
          }
        })
        await page.waitForTimeout(16)
      }
      await refuses('un flick rapide vers le bas')

      await page.setViewportSize({ width: 1600, height: 1200 })
      await page.waitForTimeout(400)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.waitForTimeout(400)
      await refuses('un redimensionnement en cours de lecture')

      /*
       * **The two that walked through the latch.**
       *
       * `covered` exists so a rep typing into « Objections » cannot disarm the
       * button by growing the column under their own caret. It was content-blind
       * and viewport-blind, and both showed:
       *
       *  · **the Transcription tab** — a rep checking a quote, which is the
       *    DEC-21 gesture this product is proudest of, opens the transcript,
       *    reads it to the end and comes back to *Lecture*. The transcript is
       *    shorter than the document, so the column was « covered », and
       *    *Valider* went live with 1700 of the compte-rendu's 2447 pixels never
       *    drawn — the whole « EMAIL DE RELANCE » block among them, subject,
       *    recipients and body of the mail that goes to the client;
       *  · **a window that shrinks** — opened where both columns fit the guard is
       *    satisfied and correctly so; shrunk, the latch kept saying it.
       */
      await page.getByRole('button', { name: 'Transcription', exact: true }).click()
      await page.waitForTimeout(400)
      for (let i = 0; i < 30; i++) {
        const done = await page.evaluate(() => {
          const doc = document.querySelector('main.fade-below')
          if (!doc || doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 8) return true
          doc.scrollBy({ top: doc.clientHeight - 64 })
          doc.dispatchEvent(new Event('scroll'))
          return false
        })
        await page.waitForTimeout(90)
        if (done) break
      }
      await page.getByRole('button', { name: 'Lecture', exact: true }).click()
      await page.waitForTimeout(400)
      await refuses('avoir lu la transcription puis être revenu au compte-rendu')

      await page.setViewportSize({ width: 1280, height: 3000 })
      await page.waitForTimeout(500)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.waitForTimeout(600)
      await refuses('avoir ouvert grand puis rétréci la fenêtre')

      // And the control still says which way the unread band lies.
      await page.getByRole('button', { name: /Remonter|la suite/ }).first().waitFor()

      /*
       * **The eighth: the payload changed after it was read.**
       *
       * Arming honestly — both columns turned page by page — and then unchecking
       * « Opportunité » is a rep changing *what leaves* after the guard was
       * satisfied. Nine rows go read-only and a warn paragraph is inserted at the
       * top of the rail saying their corrections will not travel; a rep sitting
       * at the bottom of the rail sees neither, and the latch went on saying the
       * column had been read. The stamp now carries the checked set, so the rail
       * is unread again and the page turn is what shows them the sentence.
       */
      for (let i = 0; i < 40; i++) {
        const turn = page.getByRole('button', { name: /(la suite|Remonter)/ }).first()
        if ((await turn.count()) === 0) break
        await turn.click()
        await page.waitForTimeout(STAGING_TURN_MS)
      }
      if ((await page.getByRole('button', { name: /^Valider/ }).count()) === 0) {
        throw new Error('la garde ne s’arme plus après une lecture honnête des deux colonnes')
      }
      await page.getByLabel(/Opportunité/).first().uncheck()
      await page.waitForTimeout(400)
      await refuses('avoir décoché une intention après avoir tout lu')

      /*
       * **And the other half: going back to something already read is free.**
       *
       * Every refusal above is a page turn charged to a rep, so the guard is only
       * honest if it charges for text they have *not* seen. Stamping one view at
       * a time charged for the return trip too — thirteen turns to fix one word,
       * six of them re-showing the compte-rendu they had just read — which is the
       * behaviour the latch exists to prevent, one level down. These four assert
       * the set: re-tick the intention, and switch to « Modifier » and back.
       */
      const arms = async (how) => {
        await page.waitForTimeout(400)
        if ((await page.getByRole('button', { name: /^Valider/ }).count()) === 0) {
          const turn = await page.getByRole('button', { name: /(la suite|Remonter)/ }).first()
          throw new Error(
            `la garde refait payer une lecture déjà faite — ${how} : « ${await turn.textContent()} »`,
          )
        }
      }
      await page.getByLabel(/Opportunité/).first().check()
      await arms('avoir remis la coche : le contenu est identique')

      await page.getByRole('button', { name: 'Modifier', exact: true }).click()
      await arms('« Modifier » montre le compte-rendu déjà lu, dans un textarea')
      await page.getByRole('button', { name: 'Lecture', exact: true }).click()
      await arms('le retour à « Lecture » pour relire la correction')

      /*
       * And the window that comes back. Shrinking correctly disarms — the text
       * reflows and there is more below the fold than there was — but restoring
       * the geometry that *was* read has to restore the button with it. It did
       * not: the record was deleted rather than kept, so five page turns were
       * charged for six pixels, and the asymmetry gave it away — growing to 1400
       * and back was already free. A rep undocking a laptop does this.
       */
      await page.setViewportSize({ width: 1280, height: 500 })
      await page.waitForTimeout(500)
      await refuses('avoir rétréci la fenêtre sous une colonne déjà lue')
      await page.setViewportSize({ width: 1280, height: 800 })
      await arms('avoir rendu à la fenêtre la taille où la lecture avait été faite')
    },
  },

  /*
   * **The one irreversible press, driven.**
   *
   * `review:confirm` is the only thing in this product that writes to a client's
   * CRM, and it had no driven proof anywhere: the packaged-app run deliberately
   * never reaches the gate — a meeting with no transcript reaches no gate — and
   * the renderer's own tests run in jsdom, where every box measures zero and the
   * guard therefore fails open. The bug that shipped for a round lived exactly
   * in that gap: real layout, real scroll arithmetic, no coverage.
   *
   * So this stage reads both columns the way a rep does, presses the button, and
   * asserts the payload actually left — with the fields the rep would have
   * corrected in it.
   */
  'review-valide': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      await page.waitForTimeout(900)

      // Read both columns by their own controls, which is the only way to arm.
      for (let i = 0; i < 40; i++) {
        const turn = page.getByRole('button', { name: /(la suite|Remonter)/ }).first()
        if ((await turn.count()) === 0) break
        await turn.click()
        await page.waitForTimeout(STAGING_TURN_MS)
      }

      /*
        And a correction typed *after* reading must not take the button away.
        The columns grow as a rep types, and a guard without a latch would
        re-arm on their own keystrokes over the sentence they are correcting —
        which is the behaviour the old boolean existed to prevent and which was
        never the bug.
      */
      await page
        .locator('#field-objections')
        .fill('le TJM 2025 a été accepté après relecture, sur plusieurs lignes pour faire grandir la colonne')
      await page.waitForTimeout(400)

      const valider = page.getByRole('button', { name: /^Valider/ })
      if ((await valider.count()) === 0) {
        throw new Error('le bouton disparaît pendant que le commercial corrige')
      }
      await valider.click()

      // The stub records every call; the confirm has to be there, with the
      // eleven-field payload and the three checked intents.
      const sent = await page.evaluate(() =>
        (window.__harness?.calls ?? []).find((c) => c.channel === 'review:confirm'),
      )
      if (!sent) throw new Error('« Valider » n’a rien envoyé')
      if (!sent.payload?.edits?.compteRendu) throw new Error('la charge utile n’a pas de compte-rendu')
      if ((sent.payload?.intentIds ?? []).length === 0) throw new Error('aucune intention cochée')
      await page.getByText(/Envoi|envoyé|Calendrier/).first().waitFor()
    },
  },

  /*
   * **Nothing had ever opened the picker, let alone pressed it** (R33-1, US-8).
   *
   * US-8 put a control on the DEC-4 screen and a panel under it — 230 px, three
   * `.measure` paragraphs and two `Button`s — and across 122 stagings not one of
   * the ten measured checks had ever visited it: no stage clicked the chip. So
   * this stage leaves the panel **open** at the end, which is the only way
   * `--geometry`, `--targets`, `--prose`, `--a11y`, `--contrast`, `--scrollers`,
   * `--motion`, `--fade`, `--echo` and `--scan` get to see it at either size.
   *
   * And on the way there it drives the press, because opening is the cheap half.
   */
  'review-modele': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      await page.waitForTimeout(900)
      await page.getByRole('button', { name: /^Modèle :/ }).click()
      // The panel's own content, not merely its box: the consequence sentence is
      // the one thing a rep must read before the press, and it is the thing a
      // copy change would silently take away.
      await page.getByText(/Réécrire remplace le compte-rendu, les champs et le brouillon/).waitFor()
      await page.getByRole('button', { name: /^Réécrire avec/ }).waitFor()
    },
  },

  /**
   * **A rewrite that cannot run took *Valider* away, said nothing, and gave it
   * back over the document it had promised to replace** (R33-1).
   *
   * `register.ts` answers `changed: true` and fires `runEnhancement` without
   * awaiting it. On the build DEC-28 ships first — and on any machine whose model
   * key has expired — `Enhancement.run` finds no recipe, records
   * `enhancement.deferred` and returns *without moving the machine*, so the gate
   * stays open and no document ever arrives. The one sentence this screen had for
   * a rewrite was drawn in the `!open` branch under `state === 'extracting'`,
   * which is precisely the branch a deferred rewrite never reaches.
   *
   * Measured on the shipped renderer before the fix, on a gate the rep had read
   * to the end, at both smoke sizes:
   *
   *     avant : valider=true   puce « Modèle : Prise de besoin commercial ▸ »
   *     après : valider=false  remède « Lire la suite du compte-rendu »
   *             phrases sur la réécriture : []
   *     ré-armé après 5 tours de page (8 à 960×600) : valider=true
   *             puce « Modèle : Compte-rendu libre ▸ »
   *             document « # Néovia Santé — cadrage renfort data / ## Résumé »
   *
   * One press, five to eight page turns, and DEC-4's one irreversible control
   * back over the document the screen had just said was being replaced, under a
   * chip naming the recipe that did not run. `POST /v1/crm/tasks` has no
   * idempotency key.
   *
   * **Three things are asserted and the third is the one a unit test cannot
   * reach.** The sentence is on screen. The chip names the *document* — which is
   * also what keeps « Réécrire avec « Compte-rendu libre » » on the screen as the
   * retry, since `others` excludes the current value. And *Valider* is back with
   * **zero** page turns: jsdom measures every box as zero, so the coverage reset
   * and its cost were invisible to every renderer test in the repo, and the only
   * place that number exists is real layout.
   *
   * The stub stages the machine this happens on: `meeting:recipe` answers
   * `regenerating: true` for besoin-commercial → libre the way the shipped
   * handler does, and `enhancement:status` answers `{status:'idle'}`, which is
   * what the real `statusOf` answers for an `awaiting_confirmation` meeting whose
   * rewrite was deferred.
   */
  'review-modele-differe': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      await page.waitForTimeout(900)

      // Read both columns first: the withdrawal is only visible on a gate that
      // was armed, which is also the only state in which it costs anything.
      for (let i = 0; i < 40; i++) {
        const turn = page.getByRole('button', { name: /(la suite|Remonter)/ }).first()
        if ((await turn.count()) === 0) break
        await turn.click()
        await page.waitForTimeout(STAGING_TURN_MS)
      }
      const ship = () => page.getByRole('button', { name: /^Valider/ })
      await ship().waitFor()

      await page.getByRole('button', { name: /^Modèle :/ }).click()
      await page.getByRole('button', { name: /^Réécrire avec/ }).click()
      await page.waitForTimeout(700)

      // The fact, in the rep's own language, on the open gate — which had nothing
      // at all before this.
      await page.getByText(/n’a pas démarré/).first().waitFor()

      /*
       * And the cost, counted. Every press of a page turn here would be a page of
       * a document that did not change, so the number has to be zero — and it is
       * printed rather than only asserted, because a fix that traded five turns
       * for two would pass a `> 0` threshold.
       */
      let presses = 0
      for (; presses < 12; presses += 1) {
        if ((await ship().count()) > 0) break
        const turn = page
          .locator('button')
          .filter({ hasText: /Lire la suite|Remonter|Voir la suite/ })
          .first()
        if ((await turn.count()) === 0) break
        await turn.click()
        await page.waitForTimeout(STAGING_TURN_MS)
      }
      if ((await ship().count()) === 0) {
        throw new Error(
          'une réécriture qui n’a pas démarré laisse « Valider » injoignable : DEC-4 n’a plus de porte',
        )
      }
      if (presses > 0) {
        throw new Error(
          `une réécriture qui n’a pas démarré coûte ${presses} tour(s) de page sur un écran ` +
            'qui n’a pas changé d’un pixel',
        )
      }

      // The chip names the document, so the retry is still offered.
      const chip = (await page.getByRole('button', { name: /^Modèle :/ }).innerText())
        .replace(/\s+/g, ' ')
        .trim()
      if (!chip.includes('Prise de besoin commercial')) {
        throw new Error(
          `la puce dit « ${chip} » alors que le compte-rendu affiché est celui de l’ESN — ` +
            'et « Réécrire avec « Compte-rendu libre » » n’est plus offert',
        )
      }
      console.log(`     réécriture différée: « Valider » revenu en ${presses} tour(s), puce « ${chip} »`)
    },
  },

  /*
   * **The prose given the provenance the fields already had** (DEC-21).
   *
   * Eleven typed rows each carried a `[source ▸]` and the twenty-four hundred
   * pixels of compte-rendu beside them carried none — on the screen whose whole
   * argument is that a claim must be checkable, about the string VerySwing
   * actually receives. The only part of that prose which *claims* to be verbatim
   * is what sits inside guillemets, so that is what leads to the record.
   */
  'review-citation-prose': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      await page.waitForTimeout(900)
      const quoted = page
        .locator('main.fade-below button')
        .filter({ hasText: '«' })
        .first()
      await quoted.click()
      /*
        The reader, opened on that fragment — the same one `source ▸` opens, and
        the same one that says « introuvable » and seeds its search when the
        quotation is not in the record.

        Waited on by its *search field*, which is the one thing present in both
        outcomes: a quote that is found lights a turn and says where, one that is
        not says so and offers the nearest passages. A stage that waited on
        either sentence would pass on one branch and hang on the other.
      */
      await page.getByPlaceholder('Rechercher dans la transcription…').waitFor()

      /*
       * **And the bullets, which are the operative half.**
       *
       * Provenance used to stop at the quotations: five followable fragments
       * across twenty-eight substantive lines, and **none at all on the twelve
       * bullets** — « Envoyer 3 CV avec les TJM associés » being the commitment
       * that becomes the VerySwing task, and the least checkable thing on a
       * screen whose whole argument is that nothing ships unchecked. The spans
       * were already on the cited items; they just never left the extraction.
       *
       * Counted rather than eyeballed, because « some bullets are followable »
       * is exactly the claim a screenshot cannot settle.
       */
      await page.getByRole('button', { name: 'Lecture', exact: true }).click()
      await page.waitForTimeout(500)
      const bullets = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('main.fade-below .relative')].filter((row) =>
          row.querySelector('[data-hangs="marqueur"]')?.textContent?.trim().startsWith('-'),
        )
        return {
          total: rows.length,
          sourced: rows.filter((row) => row.querySelector('button')).length,
        }
      })
      if (bullets.total === 0) throw new Error('aucune puce trouvée dans le compte-rendu')
      if (bullets.sourced < bullets.total) {
        throw new Error(
          `${bullets.total - bullets.sourced} puce(s) sur ${bullets.total} sans provenance — ` +
            'chacune est une affirmation qui part dans VerySwing sans moyen de la vérifier',
        )
      }
    },
  },

  /*
   * **The count on the one press that writes into a client's CRM, in the state
   * where nine of the eleven rows go nowhere.**
   *
   * `review-sans-opportunite` drives that state and stops at the sentence: it
   * never reaches the button, and no `review-garde*` stage unchecks anything. So
   * the gate went on printing « Valider malgré 1 champ non vérifié » over
   * `objections` — a row that is `readOnly`, is not in the payload, and cannot be
   * corrected from the view the button is in — with the explanatory sentence
   * **555 px above the top of its own scroller** at 1280×800 and 829 at 960×600.
   * The label was byte-identical with and without an opportunity: two materially
   * different payloads, one sentence, in front of a `POST /v1/crm/tasks` with no
   * idempotency key and a `CrmPort` with no delete verb.
   *
   * The gate has to be *armed* for the button to exist at all — « never draw an
   * inert primary » — so this reads both columns to the end the way
   * `review-valider` does, and then reads the label.
   *
   * Asked of the count rather than of a literal: the label is generated from it,
   * and pinning the string would pass the day the count is wrong and the copy
   * changes.
   */
  'review-sans-opportunite-valider': {
    scenario: 'review',
    async drive(page) {
      await SCREENS['review-sans-opportunite'].drive(page)
      await page.waitForTimeout(900)
      for (let i = 0; i < 40; i++) {
        const turn = page.getByRole('button', { name: /(la suite|Remonter)/ })
        if ((await turn.count()) === 0) break
        await turn.first().click()
        await page.waitForTimeout(STAGING_TURN_MS)
      }
      const primary = page.getByRole('button', { name: /^Valider/ })
      await primary.waitFor()
      await settled(page)

      const shipping = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[id^="row-"]')]
        return rows.filter((row) => {
          const field = row.querySelector('textarea, input')
          return field !== null && !field.readOnly && (row.textContent ?? '').includes('faible')
        }).length
      })
      const label = (await primary.first().textContent()) ?? ''
      const claimed = /Valider malgré (\d+) champ/.exec(label)
      const counted = claimed === null ? 0 : Number(claimed[1])
      if (counted !== shipping) {
        throw new Error(
          `« ${label.trim()} » compte ${counted} champ(s) non vérifié(s) alors que ${shipping} ` +
            'partent : le bouton nomme un champ que la rep ne peut pas corriger ici',
        )
      }

      /*
       * And the sentence is reachable from the count, which is the other half:
       * with nothing correctable in the rail, pressing the header's count used
       * to focus a `readOnly` textarea — the dead control DEC-26 refuses.
       */
      const notice = page.locator('#rail-inert-notice')
      if ((await notice.count()) === 0) {
        throw new Error('la phrase qui dit où va la correction n’a pas d’ancre')
      }
    },
  },

  /**
   * **DEC-4's only refusal, photographed.**
   *
   * `f630dcd` — round 17's headline fix — made `review:confirm` refuse a press
   * that would create nothing, so the one gate is not spent on the empty set.
   * The refusal is rendered by one `role="alert"` paragraph in `Review.tsx`, and
   * **no stage has ever drawn it**: the stub answered `ok: true` to every press,
   * so across 154 stagings none of the ten measured checks had seen the sentence.
   *
   * What that hid, measured on the shipped renderer through a Playwright driver
   * before this stage existed: the alert runs **197 characters a line at 1280×800
   * and 145 at 960×600**, outside `.measure`, against `--prose`'s ceiling of 75.
   * It is the widest line of prose in the product — round 17's record was 185 in
   * *Historique* — and it is the sentence a rep reads at the one human gate after
   * pressing the one irreversible control.
   *
   * Reached by the rep's own gesture rather than by a harness flag: unticking the
   * three rows is what makes `draftIntents` return nothing, and the stub applies
   * the handler's own rule. The three unticks come **first**, because the rail's
   * view key carries the payload — changing it after arming is what
   * `review-garde`'s eighth attack is about — so the reading is done against the
   * payload actually pressed.
   *
   * Left on screen at the end, which is the point: this is the only way
   * `--prose`, `--a11y`, `--contrast`, `--echo`, `--geometry`, `--targets`,
   * `--scrollers`, `--motion`, `--fade` and `--scan` ever look at it.
   */
  'review-refus': {
    scenario: 'review',
    async drive(page) {
      await SCREENS.review.drive(page)
      await page.waitForTimeout(900)

      for (const name of [/Tâche compte-rendu/, /Opportunité/, /Brouillon de relance/]) {
        await page.getByRole('checkbox', { name }).first().uncheck()
        await page.waitForTimeout(250)
      }

      for (let i = 0; i < 40; i += 1) {
        const turn = page.getByRole('button', { name: /(la suite|Remonter)/ }).first()
        if ((await turn.count()) === 0) break
        await turn.click()
        await page.waitForTimeout(STAGING_TURN_MS)
      }
      const primary = page.getByRole('button', { name: /^Valider/ })
      if ((await primary.count()) === 0) {
        throw new Error(
          'aucune intention cochée et « Valider » est injoignable : la refus de DEC-4 ne peut pas être atteint',
        )
      }
      await primary.first().click()
      const alert = page.locator('[role="alert"]')
      await alert.first().waitFor()

      /*
       * The gate is refused and **not spent**: the button is still there, the rep
       * can tick a row and press again. A refusal that also removed the control
       * would be the unrecoverable `pushing` state by another route.
       */
      if ((await primary.count()) === 0) {
        throw new Error('le refus a emporté le bouton — la porte de DEC-4 est fermée derrière lui')
      }
      const said = (await alert.first().innerText()).replace(/\s+/g, ' ').trim()
      if (!said.startsWith('Rien ne serait créé')) {
        throw new Error(`le refus dit « ${said} », pas la phrase que register.ts renvoie`)
      }
      console.log(`     refus: « ${said} », bouton toujours présent`)
    },
  },

  'review-sans-opportunite': {
    scenario: 'review',
    expand: true,
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: OPEN_ROW })
        .click()
      await page.getByRole('button', { name: 'Relire et valider' }).click()
      await page.getByText('Prêt à envoyer').waitFor()
      await page.getByRole('checkbox', { name: /Opportunité/ }).click()
      await page.getByText(/Les valeurs ci-dessous ne partiront pas/).waitFor()
    },
  },

  /**
   * **A call found by a mark the rep typed during it.**
   *
   * `searchableRecord` folded four surfaces — the objet, the transcription, the
   * notes and the compte-rendu — and not the fifth, which is the only one a rep
   * can write from inside the call: a `MomentMark`'s note, typed one-handed on
   * the widget over the client's face. « prix : ils bloquent à 550 » was in the
   * record and `550` did not find it, so the surface the product built for a rep
   * who is talking was write-only. Photographed here because the label is new —
   * « Moments marqués », the widget's own word — and it is the longest of the
   * five, which is what the row's first column is now sized for.
   */
  'historique-marque': {
    scenario: 'historique',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Tout l’historique ›' }).click()
      await page.getByRole('list', { name: 'Appels enregistrés' }).waitFor()
      await page.getByPlaceholder(/mot dit en réunion/).first().fill('relancer les achats')
      await page.getByText('Moments marqués').first().waitFor()
      await page.getByText(/relancer les achats avant le 15/).first().waitFor()
    },
  },

  /**
   * **The truncation, said out loud, with the corpus it is fifty of.**
   *
   * `history:search` returns at most fifty rows, and the sentence that says so
   * had never been drawn by any stage: the fixture held nine calls. It is the
   * case both halves of the cap were wrong in — the *result* cap was reported one
   * row early, so exactly fifty matches with nothing hidden still told a rep to
   * narrow a finished search; and the *scan* cap was not reported at all, so call
   * five hundred and one was simply unfindable while `scanned`, the field that
   * would have said so, travelled on every answer and was read by no screen.
   * `--scenario historique-annees` is eighteen months of calls, built from the
   * same nine rows.
   */
  'historique-tronque': {
    scenario: 'historique-annees',
    expand: true,
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Tout l’historique ›' }).click()
      await page.getByRole('list', { name: 'Appels enregistrés' }).waitFor()
      await page.getByPlaceholder(/mot dit en réunion/).first().fill('TJM')
      await page.getByText(/Affinez la recherche pour en voir d’autres/).waitFor()
      await page.getByText(/sur 812 appels parcourus/).waitFor()
    },
  },

  /*
   * *Demander* on the reader — the screen it was written for, and the one where
   * its citations lead somewhere: the record's own transcription is in the same
   * box, so following a quote lights the turn it came from.
   */
  'historique-demander': {
    scenario: 'historique',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Tout l’historique ›' }).click()
      await page.getByRole('list', { name: 'Appels enregistrés' }).waitFor()
      await page
        .getByRole('button', { name: /Groupe Lefort.*découverte du besoin plateforme/ })
        .click()
      // « Extraction » — the one caption the record still has. See `historique`.
      await page.getByRole('heading', { name: 'Extraction' }).waitFor()
      // Typed rather than clicked, for the reason `session-demander` carries:
      // the suggestion chips are dropped in a narrow column.
      await page
        .getByLabel('Poser une question sur cet appel')
        .fill('Qu’est-ce qui a été dit sur le TJM ?')
      await page.getByRole('button', { name: 'Demander' }).click()
      const cite = page.locator('button').filter({ hasText: '«' }).first()
      await cite.waitFor()
      await cite.click()
      // The lit turn, in the record's own transcription.
      await page.locator('li.bg-brand-50').first().waitFor()
    },
  },

  /*
   * The dry run where a rep in trouble will actually look for it: under the
   * *Requis* rows, the one of which says « Audio · connecté » — a device that
   * opened, which is not a sound that arrived (DEC-45).
   */
  'reglages-essai': {
    scenario: 'reglages',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('heading', { name: 'Requis' }).waitFor()
      await page.getByRole('button', { name: /^Essai de/ }).click()
      await page.getByText(/c’est la moitié qui compte le plus/).first().waitFor()
      /*
       * **And the row above it stops saying « connecté ».**
       *
       * The trial's verdict used to be returned and thrown away: a rep read
       * « Vous seriez capté, le client non », closed the card, and the *Requis*
       * row still said « Audio · connecté » with the header still saying « Tout
       * fonctionne ». Twenty seconds of listening is the strongest fact this
       * product has about capture and it outranks the boot probe, which only
       * establishes that a device can be opened.
       */
      const audio = page.getByRole('listitem').filter({ hasText: 'Audio' }).first()
      await audio.getByText('à vérifier').waitFor()
    },
  },

  /*
   * The keyboard, printed (`app/shortcuts.ts`). Its own stage because it is its
   * own pane, and because a table that drifts from the matcher is exactly the
   * kind of thing nobody looks at again.
   */
  /*
   * **The STT table, which the harness had never rendered.**
   *
   * No stage opened *Transcription* or *Modèle de langage* — the one
   * `getByRole('button', {name: 'Transcription'})` in this file is the review
   * gate's tab — and the fixture's provider rows were missing `fields`, which
   * `ProviderRowSchema` requires and `ProviderLine` reads as `row.fields.length`.
   * So both panes threw, the whole app went blank, and every later pane click
   * timed out. « 74 mises en scène jouées » and its six measured checks had
   * therefore **never touched** the surfaces where HR-4, DEC-30, DEC-34 and
   * DEC-35 live. The shipped app was fine — `e2e.mjs` opens all six panes
   * against the real bridge — so what was lost was the measurement, which is
   * the fifth time this fixture has flattered the app.
   */
  'reglages-transcription': {
    scenario: 'reglages',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('button', { name: 'Transcription', exact: true }).click()
      // The local engine is the default and says so (DEC-30), never « dégradé ».
      await page.getByText('Whisper (local)').first().waitFor()
    },
  },

  /*
   * And the language-model table, where DEC-34's « no environment variable »
   * lives: every provider setting is a declared field rendered as a text input.
   */
  'reglages-modele': {
    scenario: 'reglages',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('button', { name: 'Modèle de langage', exact: true }).click()
      await page.getByText(/Mistral|ChatGPT|Claude|Azure/).first().waitFor()
    },
  },

  /*
   * **« Cette machine uniquement », on** (DEC-37).
   *
   * The one switch in this product that refuses something, and the state worth
   * photographing is the one *after* the press: the copy promises that every
   * off-machine engine leaves the lists below, and a fixture that flipped a
   * flag and answered the same tables would show that promise being broken in
   * the same screenshot that makes it.
   */
  'reglages-hors-ligne': {
    scenario: 'reglages',
    expand: true,
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('button', { name: 'Transcription', exact: true }).click()
      await page.getByRole('checkbox', { name: /Cette machine uniquement/ }).check()
      // The row, not the group header: « fournisseur cloud » also occurs in the
      // lede above it, and a selector that matches prose is a stage that passes
      // while the thing it is about is still on screen.
      await page.getByText('Azure Speech — France Centre').waitFor({ state: 'detached' })
    },
  },

  'reglages-raccourcis': {
    scenario: 'reglages',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('button', { name: 'Raccourcis clavier' }).click()
      await page.getByRole('heading', { name: 'Raccourcis clavier' }).waitFor()
      // The label alone: the row also prints *where* a scoped shortcut works,
      // and a stage that matched the whole row would break every time that
      // scope is worded differently.
      await page.getByText('Valider', { exact: true }).waitFor()
    },
  },

  /*
   * ── the first demo's own case (DEC-28) ──────────────────────────────────
   *
   * There is no Entra app registration and there will not be one for a while:
   * it lives in a tenant we do not control. So the four screens a rep touches
   * are staged with `entra: false` — no calendar, nothing to sign into, no
   * Outlook — because that is the build that gets demonstrated, and DEC-31,
   * DEC-32 and DEC-26 are all claims about *this* configuration.
   *
   * `--sans-entra` puts any other screen in the same state.
   */
  'agenda-sans-entra': {
    scenario: 'agenda',
    entra: false,
    async drive(page) {
      await openAgenda(page)
      // The grid itself, not a placeholder (DEC-31): a real, pressable day.
      await page.getByRole('button', { name: /aucune réunion$/ }).first().waitFor()
      await page.getByRole('button', { name: 'Démarrer une réunion' }).waitFor()
      await waitForBacklog(page)
      await assertRowVerbs(page)
      await assertRowAffordance(page)
    },
  },

  /*
   * **The call nobody put in Outlook** — the one axis on which Granola was
   * straightforwardly better, staged on the build where it is the only offer
   * there is.
   *
   * Deliberately `entra: false`. Detection used to require a calendar event as
   * the first half of a conjunction, and `Agenda` was constructed only when Entra
   * was configured — so this configuration, which DEC-28 calls the first
   * deliverable, was the one in which nothing would ever offer to record
   * anything. What has to be on screen is an armed row with no calendar entry
   * behind it, on a day whose grid is empty.
   */
  /*
   * **The one exit in the product that no stage watched.**
   *
   * Three rungs leave in the app window — the Réglages sheet (`useDismiss`), the
   * `source ▸` panel and the end-of-meeting strip (`useDeparture`), and a row of
   * the day (`useLeaving`). The first two have had a stage since they were
   * written. The third never did, and it is the one `useLeaving` exists for: its
   * own docblock names the agenda's offered row as the instance two reviewers
   * kept reporting.
   *
   * It shipped inverted. The hook decided its departures in an effect, i.e.
   * after the commit that had already taken the row's `<li>` out of the
   * document, so the splice put a **new** element back wearing `.leaving` —
   * eleven painted frames, none of them between the two ends, first opacity
   * 0.000, last 0.000, detached at 246 / 257 ms. The row blinked out and left a
   * hole for a quarter of a second, which is a worse frame than no exit at all.
   * `--motion` could not see it: the census reads the resting frame, and by the
   * time it runs the row is gone.
   *
   * Driven the way the world drives it — the clock moves past a meeting's end
   * and the `agenda:changed` that follows rebuilds the day — because there is no
   * control on this screen that removes a row. `heldDepartureOf` follows
   * whichever `<li>` the renderer marks, out of the ones standing before the
   * trigger, so « a new element wearing the exit » is a failure and not a
   * measurement.
   */
  'agenda-ligne-sortie': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      // One resting frame painted on the rows before anything moves: that frame
      // is the value the exit has to interpolate away from.
      await page.waitForTimeout(400)
      judgeHeld(
        'ligne du jour',
        await heldDepartureOf(page, 'li', async () => {
          await page.clock.setFixedTime(new Date(pinnedNow() + 12 * 3_600_000))
          await page.evaluate(async () => {
            const w = /** @type {any} */ (window)
            const snapshot = await w.app.invoke('agenda:snapshot', {})
            if (w.__harness.emit('agenda:changed', { ...snapshot }) === 0) {
              throw new Error('personne n’écoute agenda:changed')
            }
          })
        }),
      )
    },
  },

  'agenda-appel-imprevu': {
    scenario: 'agenda-appel-imprevu',
    entra: false,
    async drive(page) {
      await openAgenda(page)
      // The offer itself, named for what it is rather than for a process.
      await page.getByText('Appel non planifié — Teams').first().waitFor()
      await waitForBacklog(page)
      /*
       * **And it is the row the screen gave its weight to, which is the assertion
       * that survived the verb.**
       *
       * This used to read « `DayPane` draws the one filled primary on the day as
       * *Enregistrer*, and *Ouvrir* on everything else », and counted the word.
       * The word was wrong: driven at the bridge
       * (`src/screens/agenda/__tests__/verbs.test.tsx`), a press on the armed row
       * reaches **no IPC channel at all** — it is `onOpen`, the same act as every
       * *Ouvrir* under it — while an upcoming invite carried the same word over
       * `agenda:arm`, and the only control on the screen that reaches
       * `session:command` is the header's *Démarrer une réunion*. So the stage
       * was asserting « at least one control carries the capture verb » on a
       * screen where nothing that carries it captures.
       *
       * What distinguishes an offer from a row in the history is not a word: it
       * is « PRÊT » and the fill (US-26, HR-7). Both are read off the paint here,
       * and the fill is read as a computed colour rather than as a class, because
       * a class name is a declaration and this is a photograph.
       */
      const offer = page
        .locator('li')
        .filter({ hasText: 'Appel non planifié — Teams' })
        .getByRole('button')
        .first()
      await offer.waitFor()
      const ink = await offer.evaluate((button) => ({
        label: (button.textContent ?? '').trim(),
        background: getComputedStyle(button).backgroundColor,
      }))
      if (ink.label !== 'Ouvrir') {
        throw new Error(
          `l’appel détecté porte « ${ink.label} » — la ligne armée ouvre la session, ` +
            'elle ne démarre pas de capture (Agenda.armNow)',
        )
      }
      if (/^rgba?\(\s*255,\s*255,\s*255/.test(ink.background)) {
        throw new Error(
          `l’appel détecté ne porte pas le contrôle plein du jour : fond ${ink.background}. ` +
            'La détection a produit une ligne et l’écran ne dit pas laquelle est la sienne.',
        )
      }
      await page.getByText('Prêt').first().waitFor()
      await assertRowVerbs(page)
      await assertRowAffordance(page)
      // The grid is still drawn and still empty (DEC-31): this offer did not come
      // from a calendar, and none of the other days may claim it did.
      await page.getByRole('button', { name: 'Démarrer une réunion' }).waitFor()
    },
  },

  'session-sans-entra': {
    scenario: 'session',
    entra: false,
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: OPEN_ROW })
        .click()
      await page.getByRole('button', { name: 'Terminer' }).waitFor()
    },
  },

  'review-sans-entra': {
    scenario: 'review',
    entra: false,
    expand: true,
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: OPEN_ROW })
        .click()
      await page.getByRole('button', { name: 'Relire et valider' }).click()
      /*
        `expand: true` unclips the rail, so the whole payload is on screen and
        the gate's live control is already *Valider* — the scroll guard is
        satisfied by there being nothing below a fold. Without the expansion it
        would be *Afficher le reste de ce qui part*, which is the `review`
        screen's own case.
      */
      await page.getByText('Prêt à envoyer').waitFor()
      await page.getByText('Aucun destinataire au calendrier.').waitFor()
    },
  },

  /*
   * **The in-meeting widget, collapsed** (`src/widget/Widget.tsx`).
   *
   * Its own window (`?window=widget`), which is why the stage carries a query
   * rather than a gesture: there is no route to it from inside the app, and
   * there must not be — it is created by the main process when a meeting starts
   * recording and destroyed when it stops.
   *
   * Photographed over the page's own canvas rather than over a video call. That
   * is a limitation worth stating: the six checks measure the pill against the
   * app's paper, and the contrast the *rep* sees is against whatever Teams is
   * painting. The shadow is what carries that separation, and a screenshot is
   * the one thing that cannot verify it.
   */
  widget: {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.replayWidget())
      await page.waitForTimeout(120)
    },
  },

  /*
   * **The same pill, over a dark call — the ground eight stages could not put
   * it on.**
   *
   * The stage above states the limitation and then leaves it: « the contrast
   * the *rep* sees is against whatever Teams is painting. The shadow is what
   * carries that separation, and a screenshot is the one thing that cannot
   * verify it. » Both sentences are true and together they are the ninth
   * instance of `CLAUDE.md`'s « a comment is not a check » — the blind spot was
   * named, in the right file, and nothing measured it for three rounds.
   *
   * What shipped inside it: the card is `1.05:1` against Teams' dark theme, its
   * border `1.74:1`, and `--shadow-overlay`'s 38 % black — the layer whose own
   * token comment says it « still reads as elevation over a dark call » —
   * `1.13:1`. Every carrier of the boundary was dark, on the one surface in the
   * product that floats over a ground it does not own. Over `#f7f9fb`, where
   * all eight stages photograph it, the same card measures `16.38:1`.
   *
   * A screenshot cannot verify it; **a stage can**, because the host ground is
   * the one thing the harness is free to choose. It paints `html` the colour of
   * a dark conferencing window and then asks the shipped composition, not the
   * stylesheet, whether anything still separates the card from it.
   *
   * The formula below is `contrast()`'s and is written out again rather than
   * shared, for two reasons worth stating: that one runs in the page on a
   * census of ink over its *own* ground, and this one asks a different question
   * — one boundary against a ground the product never sees in this process.
   * Sharing them would mean a census that takes a host colour, which is a
   * parameter with exactly one caller.
   */
  'widget-sombre': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.replayWidget())
      await page.waitForTimeout(120)
      /*
       * The panel open, so the 340px card is measured too and not only the
       * pill. The first version of this stage measured « whatever
       * `.shadow-overlay` happens to be on screen », which in the collapsed
       * scenario is one element out of four.
       */
      await page.getByRole('button', { name: /le panneau/ }).click()
      await page.getByPlaceholder('Noter ce moment…').waitFor()
      await page.waitForTimeout(120)

      /*
       * **First: is the window actually transparent?**
       *
       * This is the assertion; painting a host below is only what makes the
       * screenshot legible. `index.html` paints `html, body, #root` with
       * `--bg-canvas` so the app does not flash white before its stylesheet
       * lands; `main.tsx` cleared two of those three on this route, and `#root`
       * — the element that fills the window — kept `rgb(247, 249, 251)`. A
       * transparent, frameless, always-on-top window was laying an opaque sheet
       * of the app's paper over the client's video, `HALO` and all, with the
       * shadow that separates the card from the call falling onto it.
       *
       * Nothing caught it for the same reason nothing caught the contrast: over
       * `#f7f9fb`, an opaque `#f7f9fb` rectangle is invisible by construction.
       */
      const opaque = await page.evaluate(() =>
        [...document.querySelectorAll('.shadow-overlay')].flatMap((card) => {
          const found = []
          for (let node = card.parentElement; node; node = node.parentElement) {
            const style = getComputedStyle(node)
            const paints =
              style.backgroundImage !== 'none' ||
              !/rgba\([^)]*,\s*0\s*\)|transparent/.test(style.backgroundColor)
            if (paints) {
              found.push(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''} ${style.backgroundColor}`)
            }
          }
          return found
        }),
      )
      if (opaque.length > 0) {
        throw new Error(
          `la fenêtre n’est pas transparente — ${[...new Set(opaque)].join(', ')} peint par-dessus l’appel`,
        )
      }

      /*
       * **Then every ground there is — all 16 777 216 of them.**
       *
       * This has been wrong twice, and both versions are worth keeping because
       * they are one mistake at two scales: a sample chosen by the same person
       * who chose the value is not independent of it.
       *
       * The first painted one `HOST`, `#1f1f1f`, and asserted against it — the
       * same instrument as the six-row table in `tokens.css` it was written to
       * enforce, with the same hole. `#1f1f1f` is the rim's *best* point, so the
       * stage passed while the property was false from about `#3a3a3a` to
       * `#656565`, bottoming out at 2.38:1.
       *
       * The second swept the 256 greys and justified it: « greys are the worst
       * case — a saturated host is further from this desaturated card on at
       * least one channel ». **Both halves of that are wrong.** Contrast is a
       * function of luminance, not of per-channel distance, so the sentence
       * argues about the wrong quantity. And the conclusion fails for a reason
       * the sentence could not reach: the rim is *translucent*, so it composites
       * per channel in gamma space and its result is therefore **not** a
       * function of the ground's luminance alone. Measured — rgb(210,0,64) and
       * rgb(105), whose luminances agree to four decimals, give **3.14:1 and
       * 3.63:1**. Half a point apart at the same luminance.
       *
       * So the cube is swept. The true minimum is **3.13:1 at rgb(212,0,0)** —
       * saturated red, which a full-screen video reaches far more often than any
       * grey. With the transfer function in a lookup table and one table per
       * carrier per channel, all 16.7 M grounds cost about 50 ms, which is the
       * other half of the lesson: sampling never bought anything here.
       *
       * The card's own colours do not depend on what is behind it, so they are
       * read once from the shipped composition.
       */
      const measured = await page.evaluate(() => {
        const rgb = (value) => (value.match(/[\d.]+/g) || []).map(Number)
        return [...document.querySelectorAll('.shadow-overlay')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            const style = getComputedStyle(el)
            /*
             * Tailwind composes `shadow-overlay` as
             * `var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0
             * 0 #0000), var(--tw-shadow)`, so the computed value *opens* with
             * two `rgba(0, 0, 0, 0)` placeholders. Reading « the first colour in
             * the box-shadow » measured one of those and reported the rim at
             * 1.00:1 — a check that finds a defect for the wrong reason is one
             * that will also clear for the wrong reason.
             */
            const shadows = (style.boxShadow.match(/rgba?\([^)]*\)/g) ?? [])
              .map(rgb)
              .filter((layer) => (layer[3] ?? 1) > 0)
            return {
              name:
                el.getAttribute('aria-label') ||
                el.className.split(' ').find((c) => c.startsWith('w-[')) ||
                'surface',
              fill: rgb(style.backgroundColor),
              border: rgb(style.borderTopColor),
              shadows,
            }
          })
      })

      if (measured.length === 0) throw new Error('aucune surface flottante à mesurer')

      const channel = (v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      /** The transfer function for all 256 byte values, once. */
      const LUT = Float64Array.from({ length: 256 }, (_, i) => channel(i))
      const lum = ([r, g, b]) =>
        0.2126 * LUT[Math.round(r)] + 0.7152 * LUT[Math.round(g)] + 0.0722 * LUT[Math.round(b)]
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      /*
       * A carrier's luminance contribution for every possible ground byte,
       * precomputed per channel. An opaque colour ignores the ground; a
       * translucent one — the rim — composites into it, and that is the whole
       * reason the cube below is swept rather than the luminance axis.
       */
      const carrier = ([r, g, b, a = 1]) => {
        const mix = (c) =>
          Float64Array.from({ length: 256 }, (_, i) => LUT[Math.round(a * c + (1 - a) * i)])
        return [mix(r), mix(g), mix(b)]
      }

      /*
       * 3:1 is the floor a non-text boundary is held to (WCAG 1.4.11), and the
       * assertion is on the *best* of the carriers rather than on each: a light
       * rim is meant to replace the dark fill over a dark call, not to join it.
       * What must never happen again is all of them being under the floor at
       * once, on any ground at all.
       */
      const FLOOR = 3
      for (const surface of measured) {
        /*
         * VISION §6's own sentence about this window — « the edge is lighter
         * than the fill … whichever way the video goes, one of the two edges
         * still separates it » — as a predicate. A shadow layer lighter than
         * the card is the rim; if none is, the composition has lost it.
         */
        const hasRim = surface.shadows.some((layer) => lum(layer) > lum(surface.fill))
        if (!hasRim) {
          throw new Error(`${surface.name} : aucun liseré clair dans l’ombre — --widget-rim a quitté la composition`)
        }
        const carriers = [surface.fill, surface.border, ...surface.shadows].map(carrier)
        let worst = Infinity
        let worstGround = null
        for (let r = 0; r < 256; r++) {
          for (let g = 0; g < 256; g++) {
            for (let b = 0; b < 256; b++) {
              const ground = 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b]
              let best = 0
              for (const [cr, cg, cb] of carriers) {
                const seen = ratio(0.2126 * cr[r] + 0.7152 * cg[g] + 0.0722 * cb[b], ground)
                if (seen > best) best = seen
              }
              if (best < worst) {
                worst = best
                worstGround = [r, g, b]
              }
            }
          }
        }
        if (worst < FLOOR) {
          throw new Error(
            `${surface.name} : sur rgb(${worstGround}) le meilleur porteur du bord est ` +
              `${worst.toFixed(2)}:1 — rien ne sépare la fenêtre de l’appel (plancher ${FLOOR}:1)`,
          )
        }
        surface.worst = worst
        surface.worstGround = worstGround
      }
      console.log(
        '   pire fond sur 16 777 216: ' +
          measured
            .map((s) => `${s.name} ${s.worst.toFixed(2)}:1 @rgb(${s.worstGround})`)
            .join(' | '),
      )

      /*
       * And a ground for the picture. The numbers above are swept; this is so a
       * human opening the PNG sees the window over something other than the
       * app's own paper. `#1f1f1f` is Teams' dark theme.
       */
      await page.addStyleTag({
        content: 'html { background: #1f1f1f !important; background-image: none !important; }',
      })
      await page.waitForTimeout(50)
    },
  },

  /*
   * **The pill leaving the screen — the only exit animation in the product, and
   * nothing had ever measured it.**
   *
   * `Overlay.dismiss()` broadcasts `widget:leave`, the renderer applies
   * `.widget-leaving`, and the main process destroys the window after the duration
   * the renderer resolved. No stage emitted that broadcast, so on 104 stagings and
   * eight checks the class was visited by none of them — and it shipped for a round
   * wearing `--ease-out`, the *entering* curve, which spends 73% of its change in
   * the first 35ms: a blink, then 88ms of a fully transparent always-on-top window
   * still over the rep's call. Measured, opacity above 0.05 for 62 of 150ms.
   *
   * **The picture is not the point, and cannot be.** An exit ends at opacity zero,
   * so any screenshot taken after the checks have run is a blank card — which is
   * why this stage is worth having anyway: `smoke.mjs` drives every stage with
   * `--no-png`, and what it takes from this one is `--motion`, which now asks which
   * end of the motion the slow part belongs to. The assertion below is the class
   * being applied, so the stage is held together by a real property of the product
   * rather than by a photograph of nothing.
   */
  'widget-sortie': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.emit('widget:leave', {}))
      /*
       * Waited for rather than assumed: the class arrives through a React state
       * update, and a stage that measured the frame before it landed would report
       * « rien à mesurer » and pass — which is exactly the shape of check this
       * repo has shipped three times.
       */
      await page.waitForSelector('.widget-leaving', { timeout: 5_000 })
    },
  },

  /*
   * **The pill arriving — the other end of the one motion a rep watches, and the
   * end that had never been decided at all** (DEC-50).
   *
   * `widget-sortie` beside it exists because the exit was measured and found to be
   * a blink. The *entrance* was worse and nobody had looked: measured on the real
   * window, the 340×205 panel had `transitionDuration: 0s`, `animationName: none`
   * and `transform-origin: 170px 102.594px` — dead centre, the CSS initial,
   * regardless of which way it stacks. It appeared between two frames over another
   * application's video call at the instant the rep presses *Enregistrer*.
   *
   * Four things are asserted here and every one of them is a bound DEC-50 states.
   * Three of the four are only reachable from a stage: `--motion` reads
   * declarations and can never ask what the *main process was told*, and
   * `tokens.test.ts` reads a file and can never ask what reached an element.
   *
   * **The gate is the one worth the most.** `getBoundingClientRect` includes
   * transforms, so a pill that is scaling when `widget:resize` goes out reports a
   * box 8% small and the main process sizes a frameless always-on-top window to
   * it — which is the clipped first frame the whole `MEASURE_DEADLINE_MS` /
   * `FIRST_FRAME_MS` handshake exists to end, reintroduced by the polish that was
   * meant to follow it. The first draft of this feature did exactly that and this
   * stage is what caught it: it held the pill at `scale(0.92)` with a *paused*
   * animation, and the first `widget:resize` went out with
   * `pillTop: 22, pillHeight: 35` against a resting 20 and 38.
   *
   * So the measurement is recorded **at the instant it is taken**, by wrapping the
   * bridge before the pill has anything worth measuring — `widget:state` is held
   * 150ms by `LATENCY`, which is the same window `widget-attente` shoots in — and
   * not read back afterwards, because after the fact every rect is the resting one
   * and the stage would be reporting that it looked rather than what it saw.
   */
  'widget-entree': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      /*
       * Installed before the first measurement can happen, which is what makes this
       * a measurement rather than a hope: the pill paints immediately as the
       * placeholder and `widget:resize` is not sent until `widget:state` answers.
       */
      await page.evaluate(() => {
        window.__entree = []
        const real = window.app.invoke
        window.app.invoke = (channel, payload) => {
          if (channel === 'widget:resize') {
            const pill = document.querySelector('[data-pill]')
            const style = pill ? getComputedStyle(pill) : null
            const rect = pill?.getBoundingClientRect()
            window.__entree.push({
              payload,
              // What the pill was doing when the number above was read.
              animation: style?.animationName ?? '?',
              animationMs: style?.animationDuration ?? '?',
              transitionMs: style?.transitionDuration ?? '?',
              // The rect against the *layout* box, which no transform can touch.
              // Equal means nothing was scaling it.
              rectW: rect ? +rect.width.toFixed(2) : 0,
              layoutW: pill?.offsetWidth ?? 0,
              rectH: rect ? +rect.height.toFixed(2) : 0,
              layoutH: pill?.offsetHeight ?? 0,
            })
          }
          return real(channel, payload)
        }
      })

      await page.getByLabel('Durée d’enregistrement').waitFor()
      // The handshake answered and the arrival was released — see `placed` in
      // `Widget.tsx`. Waited for rather than assumed, the `widget-sortie` lesson.
      await page.waitForSelector('[data-pill].widget-arrived', { timeout: 5_000 })

      const first = await page.evaluate(() => window.__entree[0] ?? null)
      if (!first) throw new Error('aucun widget:resize observé : la mesure n’a pas eu lieu')
      /*
       * **Nothing was animating when the window was sized.** Both halves: the pill
       * carried no live duration at all (so no transition or animation could have
       * been in flight), and its painted box equalled its layout box (so no
       * transform of any kind was applied to it).
       */
      const live = (value) => Number.parseFloat(value) > 0
      if (first.animation !== 'none' || live(first.animationMs) || live(first.transitionMs)) {
        throw new Error(
          'la pilule portait déjà un mouvement au moment de la mesure : ' +
            `animation ${first.animation} ${first.animationMs}, transition ${first.transitionMs} — ` +
            'la fenêtre est dimensionnée sur une boîte transformée (DEC-50)',
        )
      }
      if (
        Math.abs(first.rectW - first.layoutW) > 0.5 ||
        Math.abs(first.rectH - first.layoutH) > 0.5
      ) {
        throw new Error(
          `la pilule était transformée au moment de la mesure : peinte ${first.rectW}×${first.rectH}, ` +
            `disposée ${first.layoutW}×${first.layoutH} (DEC-50)`,
        )
      }
      /*
       * The resting numbers, read off the **layout** box and not off a rect.
       *
       * The first version of this line read `getBoundingClientRect().top` right
       * after the class landed and got 21 against the 20 that had been sent — the
       * arrival was still playing, so the assertion was itself measuring a
       * transformed pill and failed on correct code. `offsetTop` is what a
       * transform cannot touch, and both elements share an `offsetParent`, so the
       * difference is exactly the distance the product computes from two rects at
       * rest.
       */
      const resting = await page.evaluate(() => {
        const pill = document.querySelector('[data-pill]')
        return { height: pill.offsetHeight, top: pill.offsetTop - pill.parentElement.offsetTop }
      })
      if (first.payload.pillHeight !== resting.height || first.payload.pillTop !== resting.top) {
        throw new Error(
          `le processus principal a reçu une pilule de ${first.payload.pillHeight}px à ${first.payload.pillTop} ` +
            `pour une pilule au repos de ${resting.height}px à ${resting.top} — ` +
            'c’est la première image rognée que la poignée de main existe pour supprimer',
        )
      }

      /*
       * **The overshoot, pinned by its shape at the surface.** `tokens.test.ts`
       * asserts it of the token; this asserts it of the curve that actually
       * reached the element, which is the `--ease-in` lesson applied one layer up
       * — that token was redefined to a near-identical respelling and passed every
       * check in the repo because nothing asked what the curve did.
       */
      const shape = await page.evaluate(() => {
        const pill = document.querySelector('[data-pill]')
        const style = getComputedStyle(pill)
        const match = /^cubic-bezier\(([^)]*)\)$/.exec(style.animationTimingFunction.trim())
        if (!match) return { curve: style.animationTimingFunction, peak: null, ms: style.animationDuration }
        const [, y1, , y2] = match[1].split(',').map((n) => Number.parseFloat(n))
        const Y = (t) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3
        let peak = 0
        for (let i = 0; i <= 1000; i += 1) peak = Math.max(peak, Y(i / 1000))
        return { curve: style.animationTimingFunction, peak, ms: style.animationDuration, name: style.animationName }
      })
      if (shape.name === 'none') throw new Error('la pilule posée ne joue aucune animation d’arrivée')
      if (!(shape.peak > 1.0001)) {
        throw new Error(
          `la courbe d’arrivée ne dépasse jamais son point d’arrivée (pic ${shape.peak}) : ` +
            `${shape.curve} — DEC-50 autorise un dépassement, et sans lui l’arrivée est une simple montée`,
        )
      }

      /*
       * **The origin follows `above`, which is the half of DEC-50 that is about
       * where the motion comes *from*.** The panel grows out of the edge the pill
       * is on; `Overlay.resize` answers which, and the harness answers `true` for
       * the same reason the real placement does at these viewports — the widget's
       * default position is the bottom of the display.
       */
      await page.evaluate(() => window.__harness.replayWidget())
      await page.getByRole('button', { name: /le panneau/ }).click()
      await page.getByPlaceholder('Noter ce moment…').waitFor()
      await page.waitForTimeout(220)
      const panel = await page.evaluate(() => {
        const card = document.querySelector('.widget-panel-arrive')
        if (!card) return null
        return {
          above: card.getAttribute('data-above'),
          origin: getComputedStyle(card).transformOrigin,
          height: Math.round(card.getBoundingClientRect().height),
        }
      })
      if (!panel) throw new Error('le panneau ouvert ne porte pas l’animation d’ouverture')
      // Stacked above the pill the origin is the panel's own bottom edge, stacked
      // below it is its top. A centre is what shipped, and it is what DEC-50 names.
      const wantY = panel.above === 'true' ? panel.height : 0
      const gotY = Number.parseFloat(panel.origin.split(' ')[1] ?? '')
      if (!Number.isFinite(gotY) || Math.abs(gotY - wantY) > 1.5) {
        throw new Error(
          `le panneau s’ouvre depuis ${panel.origin} alors qu’il est empilé ${
            panel.above === 'true' ? 'au-dessus' : 'en dessous'
          } de la pilule : il devrait naître du bord côté pilule (y ≈ ${wantY})`,
        )
      }
    },
  },

  /*
   * The same window, opened: the live transcript, the rep's own marks in place,
   * the note field and the two ways out. This is the state the widget spends
   * most of a call in once a rep has opened it, and it is the only surface in
   * the product that draws an *interim* transcription.
   */
  /*
   * **The pill before it knows which call it is — the face the product paints at
   * the start of every single recording, and no stage had ever seen it.**
   *
   * `widget:state` is a preload hop and two SQLite reads, and until it answers
   * `Pill` draws « Aucun enregistrement » with no meter, no clock and no mark
   * button: `Widget.tsx`'s entire `MEASURE_DEADLINE_MS` handshake exists because
   * the window used to be *revealed* carrying it, 41 px clipped and sliding 21.
   * Five widget stages shared one `widget:state` that resolved in the same
   * microtask as the call, so the placeholder could not exist in the harness, and
   * 106 stagings and eight checks had visited it exactly zero times — the third
   * instance of « the fixture was the reason no stage could reproduce it ».
   *
   * The answer is held 150 ms (`LATENCY` in `bridge-stub.mjs`) and this stage
   * shoots inside that window. It is the only stage whose assertion is a string
   * that must be there **and then not be there**: a stage that only waited for the
   * placeholder would pass on a widget whose state never arrives at all.
   */
  'widget-attente': {
    scenario: 'widget-sans-reunion',
    query: 'window=widget',
    async drive(page) {
      await page.getByText('Aucun enregistrement').waitFor()
      /*
        And the clock, the meter and the mark button are **absent**, which is the
        half a `waitFor` on one string cannot state: the placeholder is not the
        pill with a different label, it is the pill with three of its four things
        missing, and that is why revealing the window carrying it was 41 px of
        clipping and a 21 px slide.
      */
      if ((await page.getByLabel('Durée d’enregistrement').count()) > 0) {
        throw new Error('la pilule d’attente porte une horloge — ce n’est plus l’état sans réunion')
      }
    },
  },

  /**
   * **The panel with the capture in trouble — the state the widget exists for,
   * and the one no stage had ever staged.**
   *
   * `grep -c 'capture:health'` over `bridge-stub.mjs` returned **0** before this
   * stage. So the strip that reports a failing capture had never been
   * photographed on the surface whose entire purpose is reporting capture
   * health, and it shipped for a round carrying `border-subtle border-b` six
   * lines below a comment reading « Three zones, no internal rules » — a fourth
   * zone and an internal rule, with a fill change on one edge and a stroke on
   * the other, in the one state that falsified the claim. Nothing could have
   * caught it, which is the point: a claim about a conditional surface needs the
   * condition staged, or the claim is prose.
   *
   * It asserts the rule is gone rather than only photographing it, for the
   * reason `reglages-sortie` asserts for itself: the next person to reach for a
   * separator here will reach for a line, and a screenshot does not object.
   */
  'widget-ennui': {
    scenario: 'widget-ennui',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.replayWidget())
      await page.getByRole('button', { name: /le panneau/ }).click()
      await page.getByPlaceholder('Noter ce moment…').waitFor()
      const strip = page.getByText('La sortie audio de l’ordinateur a changé', { exact: false })
      await strip.waitFor()
      await settled(page)

      /*
       * **The property, not the line — which took a reviewer to get right.**
       *
       * The first version of this read `getComputedStyle` on the strip alone.
       * Driven against three mutations, it caught one: the literal
       * `border-subtle border-b` on the `<p>`. It passed with a `bg-inner` on
       * that same `<p>` — chrome straight back to 34.8% and a fourth zone — and
       * it passed with the *same stroke* moved onto a wrapper `<div>` one node
       * up, which drew a 1px rule across the card at the same y. A stage that
       * pins one line teaches the next person to write the line one level out.
       *
       * So the claim is asked of the card: between the top of the card and the
       * top of the action tray, **no descendant draws a border side, and no
       * descendant paints a ground of its own.** That is « one filled zone, no
       * internal rules » stated as the thing it is, and it fails on all three
       * mutations rather than one.
       */
      const zones = await page.evaluate(() => {
        /*
         * The **panel**, not the pill: this window draws several `data-card`
         * surfaces and only one of them has a tray. Picking the first matched
         * the pill, whose meter bars and recording dot are marks rather than
         * zones — the first run of this reported twenty-one of them.
         */
        const card = [...document.querySelectorAll('[data-card]')].find((el) =>
          el.querySelector('.rounded-b-lg'),
        )
        if (!card) return null
        const tray = card.querySelector('.rounded-b-lg')
        const cut = tray.getBoundingClientRect().top
        const ground = getComputedStyle(card).backgroundColor
        const painted = []
        const ruled = []
        for (const el of card.querySelectorAll('*')) {
          const box = el.getBoundingClientRect()
          // Only what sits above the tray, and only what actually occupies space.
          if (box.height === 0 || box.top >= cut - 0.5) continue
          const style = getComputedStyle(el)
          const bg = style.backgroundColor
          /*
           * A **zone** is a band, not a mark. A quotation gutter, a bookmark
           * glyph or a 2px dot may carry a colour; what may not is something
           * spanning the card, because that is a second ground and the whole
           * claim is that one zone has one.
           */
          const band = box.width >= card.getBoundingClientRect().width * 0.8
          if (band && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== ground) {
            painted.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)} ${bg}`)
          }
          /*
           * **Top and bottom only, and that is the claim rather than a
           * convenience.** An « internal rule » here is a horizontal separator —
           * a line drawn across the card to say « these bands are different »,
           * which is the job the fill took over. A *vertical* border is the
           * quotation gutter, which the card keeps on purpose and which its own
           * docblock names as one of the two lines left on the surface. A check
           * that flagged it would be asking for a card that cannot quote.
           */
          for (const [w, k] of [
            ['borderTopWidth', 'borderTopStyle'],
            ['borderBottomWidth', 'borderBottomStyle'],
          ]) {
            if (parseFloat(style[w]) > 0 && style[k] !== 'none') {
              ruled.push(`${el.tagName.toLowerCase()} ${w}=${style[w]}`)
            }
          }
        }
        return { painted, ruled, ground, weight: getComputedStyle(card).fontWeight }
      })
      if (!zones) throw new Error('la carte du widget est introuvable')
      if (zones.ruled.length > 0) {
        throw new Error(
          `la carte porte ${zones.ruled.length} trait(s) interne(s) au-dessus de la barre : ` +
            `${zones.ruled.slice(0, 3).join(' · ')} — elle groupe par fond`,
        )
      }
      if (zones.painted.length > 0) {
        throw new Error(
          `${zones.painted.length} zone(s) remplie(s) au-dessus de la barre : ` +
            `${zones.painted.slice(0, 3).join(' · ')} — une seule zone porte un fond`,
        )
      }
      const drawn = await strip.evaluate((el) => ({ weight: getComputedStyle(el).fontWeight }))
      /*
       * A health reason is a sentence, sometimes two lines of one. `⚠ faible` is
       * this product's mark — short, semibold *and* coloured — and a whole
       * paragraph in bold gold emphasises nothing inside itself. The colour is
       * the mark here; the weight must not be.
       */
      if (Number(drawn.weight) >= 600) {
        throw new Error(`l’avis de capture est en ${drawn.weight} — une phrase n’est pas une marque`)
      }
    },
  },

  /*
   * **Nothing in this harness had ever moved a pointer.**
   *
   * Seventy-three stages, ten measured checks, every ratio in `tokens.css`
   * recomputed by a unit test — and all of it describes a product at rest. A
   * `:hover` rule is a second palette nobody had ever asked a number of, and on
   * the one surface with its own ground the answer was that there wasn't one:
   * `.widget-surface` re-points every token a control *wears* — `--bg-*`,
   * `--text-*`, `--border-*`, `--brand-700`, `--danger`, `--warn`, the meters —
   * and none of the three it *moves to*. So every hover on the widget reached
   * back into the light ramp and painted a near-black onto a dark card:
   * « Marquer » and « Ouvrir Sillage » at **1.30:1**, « Terminer » at
   * **1.63:1**. Not dimmed under the pointer — gone.
   *
   * The check is the one `--contrast` already makes, asked of a state the page
   * only enters when someone is pointing at it. Two claims, and the second is
   * why the first cannot pass vacuously: **every control clears AA while
   * hovered**, and **every control answers the pointer at all**.
   *
   * The second claim was « at least one control changes » for one draft, and
   * that draft passed the mutation it exists to catch: stripping the `hover:`
   * rule off all four `Button` variants left twelve other controls on the
   * surface still moving, so the stage went green over four dead ones. The
   * claim is now asked of each control rather than of the page, which is both
   * stronger and the thing DEC-26 already says — a control that does not answer
   * the pointer looks like one that is not there.
   */
  'widget-survol': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.replayWidget())
      await page.getByRole('button', { name: /le panneau/ }).click()
      await page.getByPlaceholder('Noter ce moment…').waitFor()
      await settled(page)

      /*
       * **The resting footer first, and this is the whole correction.**
       *
       * The first version of this stage pressed *Terminer* before it counted
       * anything, to reach the `danger` confirmation. `Widget.tsx` renders that
       * confirmation *instead of* the footer — `{confirmEnd ? <span/> : (…)}` —
       * so the press removed « Terminer », « Ouvrir Sillage » and « Pause » from
       * the DOM before the sweep began. The stage whose reason for existing is
       * « Marquer » and « Ouvrir Sillage » measured « Marquer » and never
       * « Ouvrir Sillage ».
       *
       * And it was blind to exactly the one control that needed it. Every other
       * hover here is derivable from its `Button` variant, so a sibling covers
       * it; « Terminer » carried a per-instance `hover:text-danger` pinning its
       * hover to its rest colour, which no sibling could stand in for. The one
       * control whose hover was not covered was the one control the stage had
       * pressed out of its own reach — and it is the word that stops the
       * recording, on a surface where DEC-12 means the audio is gone.
       *
       * Two passes, one predicate.
       */
      await sweepHovers(page, 'au repos')

      /*
       * Then through the press, because the confirmation's « Terminer » is the
       * `danger` variant — the filled rectangle, the only irreversible act here
       * — and its label rides *on* the fill, so a hover that moves the fill
       * moves the ground under the word.
       */
      const end = page.getByRole('button', { name: /^Terminer/ }).first()
      if ((await end.count()) === 0) throw new Error('« Terminer » est introuvable au repos')
      await end.click()
      await settled(page)
      await sweepHovers(page, 'après « Terminer »')
    },
  },

  'widget-ouvert': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      /*
        The replay comes **first**, and the order is the assertion: the widget
        collects the call whether or not anybody is looking, so opening the
        panel has to show a conversation that arrived while it was shut. It was
        the other way round for one round — replay *after* the click — because
        the state lived in the panel and the stage photographed an empty box
        otherwise. A stage that has to be driven in an unnatural order is a
        stage describing a defect.
      */
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.replayWidget())

      /*
       * **The chevron must not move out from under the pointer.**
       *
       * The frame is a `flex-col` whose `align-items` defaulted to `stretch`,
       * so opening the panel stretched the pill to the panel's width with its
       * content still packed left — and the card's *centre* is what
       * `placeAroundPill` holds fixed, so every control on the pill moved 50 px
       * left on the press that opened it. The before and after rectangles were
       * disjoint, and the reflex second press landed on bare pill, which is
       * `drag-region` and delivers no click at all.
       */
      const chevron = page.getByRole('button', { name: /le panneau/ })
      /*
       * **Both boxes read at rest**, which stopped being free when DEC-50 put a
       * `scale` on the pill's arrival: measured on the first run after it, this
       * `before` came back 23.26×23.26 for a 24×24 chevron — the pill was still
       * 97% of the way through growing in — and the stage reported the chevron
       * moving 3px under the pointer when nothing had moved at all. A geometric
       * invariant across a gesture has to be measured at rest on both sides of it
       * or the invariant is not what is being measured. See `settled`.
       */
      await settled(page)
      const before = await chevron.boundingBox()
      await chevron.click()
      await page.getByPlaceholder('Noter ce moment…').waitFor()
      await page.waitForTimeout(120)
      await settled(page)
      const after = await chevron.boundingBox()
      const moved = Math.abs((after?.x ?? 0) - (before?.x ?? 0))
      if (moved > 2) {
        throw new Error(
          `le chevron se déplace de ${Math.round(moved)} px sous le pointeur en s’ouvrant : ` +
            `${JSON.stringify(before)} → ${JSON.stringify(after)}`,
        )
      }
    },
  },

  /*
   * **A refused mark, on the pill, with no panel open.**
   *
   * `meeting:mark` refuses whenever the meeting is not `recording` —
   * `EndOfMeetingWatch` can make that true with the pill still floating over the
   * call — and on any store failure. The refusal used to go into an `sr-only`
   * paragraph: measured 1×1 with `clip: rect(0,0,0,0)`, on a window with no
   * `role="alert"` anywhere in it, while the pill's counter correctly did not
   * move because nothing had been written. So the screen's answer to a refusal
   * and its answer to a success were the same screen, and the second is the one a
   * rep assumes.
   *
   * Measured rather than photographed, and the measurement is the box: a control
   * that is *not rendered* and one *crushed to nothing* are different, and this
   * check exists because the second one shipped.
   */
  /**
   * **The paused call** — the one state the pill draws a word in place of the
   * clock. Driven through the footer's own control and the stub's broadcast,
   * which is the order the product uses: nothing on this window changes on a
   * press, only on `recording:paused`.
   */
  'widget-pause': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.replayWidget())
      await page.getByRole('button', { name: /le panneau/ }).click()
      const field = page.getByPlaceholder('Noter ce moment…')
      await field.waitFor()

      /*
       * **Typed first, and that is the whole of what this stage was missing.**
       *
       * It pressed *Pause* on an **empty** field for as long as it has existed,
       * and an empty input has `scrollWidth === clientWidth` — so nothing
       * overflowed and the property below could not be exercised. Measured on
       * the shipped renderer before the fix: the field went 252.1 → 89.5 px and
       * a 51-character note rendered **13** characters, `text-overflow: clip`,
       * in a box whose caret could not move. `--scrollers` could not have caught
       * it either: Chromium gives `<input>` `overflow: clip`, which is not in
       * that check's predicate.
       */
      await field.fill('revenir sur le plafond achats avant de proposer quoi que ce soit')

      /*
       * **`.widget-panel-arrive`, not the first `[data-card]`.**
       *
       * Three elements carry `data-card` and the **pill** is first in DOM order
       * (`Widget.tsx`'s `data-pill data-card`). The pill's height is invariant
       * across this press — 38 px before, 38 px after — so the assertion below
       * measured a box that cannot move and reported 0 px while the panel it was
       * written about grew 42. Driven: the paused tray row taken from `h-[38px]`
       * to 80 px leaves this stage green at both sizes, with all twelve gates and
       * 152 stagings green, and a `widget:resize` of 42 px going out under the
       * rep's finger.
       *
       * The guard and the fix it guards shipped in the same commit, which is the
       * habit round 16 named and this is its fourth instance. `widget-arret`,
       * whose assertion this one says it copied, reads `.widget-panel-arrive` —
       * the box that actually resizes — and would have caught it.
       */
      const card = page.locator('.widget-panel-arrive').first()
      await settled(page)
      const before = await card.boundingBox()

      await page.getByRole('button', { name: 'Pause' }).click()
      await page.getByRole('button', { name: 'Reprendre' }).waitFor()
      await page.getByText('En pause', { exact: true }).waitFor()
      if ((await page.getByLabel('Durée d’enregistrement').count()) !== 0) {
        throw new Error('en pause, la pastille compte encore le temps')
      }
      await settled(page)
      const after = await card.boundingBox()

      /*
       * **The card may not resize under the finger** — the assertion
       * `widget-arret` makes for *Terminer* and that nobody had made for this
       * row, on the same tray. In the shipped window a change here is a
       * `widget:resize`: a frameless always-on-top surface re-placing itself
       * over the client's face, at the instant the rep reached for privacy.
       */
      const grew = Math.abs((after?.height ?? 0) - (before?.height ?? 0))
      if (grew > 1) {
        throw new Error(
          `la carte passe de ${Math.round(before?.height ?? 0)} à ${Math.round(after?.height ?? 0)} px ` +
            `en se mettant en pause — c’est un widget:resize sous le doigt du commercial`,
        )
      }

      /*
       * And the rep's own words are not left half-drawn in a box they cannot
       * scroll: paused, the row is a sentence, and it says the note is kept.
       */
      if ((await page.getByPlaceholder('Noter ce moment…').count()) !== 0) {
        throw new Error('le champ reste en pause — c’est lui qui se faisait écraser')
      }
      await page.getByText('Votre note est conservée', { exact: false }).waitFor()
    },
  },

  /*
   * **The privacy control, refused.**
   *
   * `Orchestrator.setPaused` answers `false` when it holds no recording for the
   * meeting — the `EndOfMeetingWatch` gap, the same one `meeting:mark` refuses
   * in — and `register.ts` answers with the state *unchanged*, so the widget sees
   * back the opposite of what it asked for.
   *
   * Before it was drawn, the whole receipt for that was one sentence inside a 1×1
   * `clip: rect(0,0,0,0)` `aria-live` paragraph, while the label still read
   * « Pause », the clock still counted and the pill still drew the `--accent`
   * dot. On the one surface whose job is to say across a desk whether a client is
   * being written down, the rep believed they were off the record and the machine
   * was still recording.
   *
   * `refusePause()` existed for a round with nothing calling it, which is how its
   * own half-staged world went unnoticed. This is the caller.
   */
  'widget-pause-refus': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.replayWidget())
      await page.getByRole('button', { name: /le panneau/ }).click()
      await page.getByRole('button', { name: 'Pause' }).waitFor()

      // The call ends under the pill, which is why the press will be refused.
      await page.evaluate(() => window.__harness.refusePause())
      await page.getByRole('button', { name: 'Pause' }).click()

      const notice = page.getByRole('alert')
      await notice.waitFor()
      const rect = await notice.boundingBox()
      if (!rect || rect.width <= 1 || rect.height <= 1) {
        throw new Error(
          `le refus de pause est dessiné dans une boîte de ${JSON.stringify(rect)} — ` +
            `invisible, exactement comme le paragraphe sr-only qu’il remplace`,
        )
      }
      const carded = await notice.evaluate((el) => el.closest('[data-card]') !== null)
      if (!carded) throw new Error('le refus est hors carte : le halo ne prend pas la souris')

      /*
       * The label must not have flipped. A receipt for a pause that did not
       * happen is the failure one layer on — and « Reprendre » over a running
       * recording is the sentence this whole stage exists to stop.
       */
      if ((await page.getByRole('button', { name: 'Reprendre' }).count()) !== 0) {
        throw new Error('le bouton dit « Reprendre » alors que la pause a été refusée')
      }

      /*
       * **And the pill stops claiming the recording.** Polled rather than
       * sampled, for `widget-refus`' reason: the repair is a `widget:state`
       * re-read carrying the shipped channel's own latency, so a single reading
       * taken when the alert appears measures the round trip instead of the rule.
       */
      await page
        .waitForFunction(
          () => {
            const graphic =
              document.querySelector('[data-graphic]')?.getAttribute('data-graphic') ?? ''
            const spoken = [...document.querySelectorAll('.sr-only')].map((el) => el.textContent ?? '')
            return ![graphic, ...spoken].some((text) => /enregistrement en cours/i.test(text))
          },
          undefined,
          { timeout: 2_000 },
        )
        .catch(() => {
          throw new Error(
            'la pastille revendique encore « enregistrement en cours » à côté du refus de pause : ' +
              'les deux moitiés de la fenêtre ne disent pas la même chose',
          )
        })
    },
  },

  'widget-refus': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.refuseMarks())

      const counter = page.getByRole('button', { name: /^Marquer ce moment/ })
      const before = await counter.getAttribute('aria-label')
      await counter.click()

      // The sentence, and the box it is drawn in.
      const notice = page.getByRole('alert')
      await notice.waitFor()
      const rect = await notice.boundingBox()
      if (!rect || rect.width <= 1 || rect.height <= 1) {
        throw new Error(
          `le refus est dessiné dans une boîte de ${JSON.stringify(rect)} — invisible pour un ` +
            `commercial qui voit, exactement comme le paragraphe sr-only qu’il remplace`,
        )
      }

      /*
       * And it is inside a card. Everything on this window that is not a card is
       * halo, and halo is handed back to Teams with
       * `setIgnoreMouseEvents(…, { forward: true })` — so a notice that forgot
       * `data-card` would draw a dismiss button the pointer goes straight
       * through.
       */
      const carded = await notice.evaluate((el) => el.closest('[data-card]') !== null)
      if (!carded) throw new Error('le refus est hors carte : le halo ne prend pas la souris')

      // The counter must not have moved: nothing was written, and a receipt for
      // a write that did not happen is the failure one layer further on.
      const after = await counter.getAttribute('aria-label')
      if (after !== before) {
        throw new Error(`le compteur a bougé sur un refus : « ${before} » → « ${after} »`)
      }

      /*
       * **And the pill must agree with the sentence beside it.**
       *
       * Both elements were already in this stage's viewport and it checked
       * neither. Measured six pixels apart at the same instant, before the fix:
       * the pill drew a filled `--accent` dot carrying
       * `data-graphic="enregistrement en cours"`, a clock still counting and an
       * `sr-only` « Enregistrement en cours » — beside this `role="alert"`
       * reading « Aucun enregistrement en cours ». A screen reader is read both.
       *
       * This is the whole job of the window. It floats over a client's video to
       * say, across a desk, whether the conversation is being written down; in
       * the one state where it is not, the loud half said it was. `meeting:mark`
       * refuses precisely because the meeting is not `recording`, so the
       * refusal is proof the pill's copy is stale — the renderer re-reads
       * `widget:state`, which answers `{ meeting: null }`, and the two halves
       * come back into agreement.
       *
       * Asserted on the accessible names and on `data-graphic` rather than on a
       * screenshot, because the contradiction was never visible in one: each
       * half is correct on its own and only the pair is wrong.
       */
      const agreed = () => {
        const alert = document.querySelector('[role="alert"]')?.textContent ?? ''
        const graphic = document.querySelector('[data-graphic]')?.getAttribute('data-graphic') ?? null
        const spoken = [...document.querySelectorAll('.sr-only')].map((el) => el.textContent ?? '')
        const denies = /aucun enregistrement/i.test(alert)
        const claims = [graphic ?? '', ...spoken].filter((text) => /enregistrement en cours/i.test(text))
        return { ok: !(denies && claims.length > 0), alert, claims }
      }
      /*
       * **Waited for, not sampled.** The repair is a re-read of `widget:state`,
       * which this fixture answers with the shipped channel's own 150 ms of
       * latency — so a single reading taken when the alert appears catches the
       * window mid-repair and fails on a working product. Polled to a deadline
       * instead: the contradiction must *clear*, and a stage that asserted the
       * first frame would be measuring the round trip rather than the rule.
       */
      await page
        .waitForFunction(
          () => {
            const alert = document.querySelector('[role="alert"]')?.textContent ?? ''
            const graphic = document.querySelector('[data-graphic]')?.getAttribute('data-graphic') ?? null
            const spoken = [...document.querySelectorAll('.sr-only')].map((el) => el.textContent ?? '')
            const denies = /aucun enregistrement/i.test(alert)
            return !(denies && [graphic ?? '', ...spoken].some((t) => /enregistrement en cours/i.test(t)))
          },
          undefined,
          { timeout: 4_000 },
        )
        .catch(async () => {
          const said = await page.evaluate(agreed)
          throw new Error(
            `la pastille et le refus se contredisent : « ${said.alert.trim()} » ` +
              `à côté de ${said.claims.map((text) => `« ${text.trim()} »`).join(', ')}`,
          )
        })

      /*
       * **The notice is as wide as the pill it hangs from.**
       *
       * It was `w-[260px]`, a constant matching one state of a content-sized
       * pill approximately and the other not at all — 35px of overhang a side
       * when idle. Replacing it with a measured `--pill-w` made the recording
       * state exact and the idle state *worse* (43px), because the notice is
       * sized by that variable and so pins the frame: the pill then shrank
       * inside a border box the `ResizeObserver` was watching, nothing fired,
       * and the published number kept the recording pill's width.
       *
       * A consumer that pins the thing being measured is a measurement that
       * stops arriving, and neither a screenshot nor any other check could see
       * it — both rectangles are drawn correctly, and only the pair is wrong.
       *
       * **At rest, and that stopped being free when the card got an arrival.**
       * `getBoundingClientRect` includes transforms and `widget-arrive` carries
       * `--ease-overshoot`, so a notice read while it is still settling is read
       * at up to 1.0064 of its own width. Driven six at a time on one machine,
       * the sizes the smoke run actually competes for: five reads of 200.18 to
       * 200.47 against a 199.56 pill, and one of **200.86** — a failure of a
       * working product, produced entirely by reading a box mid-animation. Same
       * correction, same reason, as the `before`/`after` pair in `widget-ouvert`.
       */
      await settled(page)
      const stack = await page.evaluate(() => {
        const pill = document.querySelector('[data-pill]')?.getBoundingClientRect()
        const notice = document.querySelector('[role="alert"]')?.closest('[data-card]')?.getBoundingClientRect()
        return pill && notice
          ? { pill: Math.round(pill.width * 100) / 100, notice: Math.round(notice.width * 100) / 100 }
          : null
      })
      if (!stack) throw new Error('pastille ou notice introuvable pour la mesure de largeur')
      if (Math.abs(stack.pill - stack.notice) > 1) {
        throw new Error(
          `la notice ne suit pas la pastille : pastille ${stack.pill}px, notice ${stack.notice}px ` +
            `(${Math.round(Math.abs(stack.pill - stack.notice) / 2)}px de débord par côté)`,
        )
      }
      console.log(`   pile: pastille ${stack.pill}px · notice ${stack.notice}px`)

      await page.evaluate(() => window.__harness.refuseMarks(null))
    },
  },

  /**
   * **The one card arriving and leaving — the loudest state change on this
   * surface, and it had neither half of a motion.**
   *
   * Measured with `--motion` on `widget-refus` and `widget-pause-refus`, at both
   * smoke sizes, before this stage existed: « 3 élément(s) animé(s) dont **0 qui
   * s'en vont**, 0 @keyframes de sortie ». A refused mark and a refused *Pause*
   * are the two sentences on this window a rep most needs to notice, and both
   * appeared between two frames and vanished between two frames over another
   * application's screen share. `useDeparture` — the hook written for a surface
   * the *world* removes — had no caller under `src/widget/` at all.
   *
   * **Three things are measured here and none of them is a photograph.**
   *
   *  · the **arrival** is a live `widget-arrive` on the card, on an arrival curve;
   *  · the **departure** is sampled frame by frame at the shipped duration, and
   *    what is asserted is the thing a census cannot see — that the last value
   *    painted before the element detaches is *zero* and not a quarter opaque.
   *    Round 18 found `useDismiss` snapping out from 0.44 and fixed it; running
   *    the same measurement on `useDeparture` gave 0.237 / 0.241 / 0.238, so the
   *    hook this card needed had the defect its sibling had just lost. A stage
   *    that only asked « is there an exit class » would have passed over it.
   *  · and it is done **for both cards**, because the slot holds two and they
   *    empty by different mechanisms — the rep presses `×` on one, and the world
   *    yields the other out from under them. A fixture that ran one direction of
   *    a two-direction rule is this file's own recurring defect.
   *
   * **Why the stage ends with a card still going.** `--motion`'s census counts
   * what is animating *now*, and a departure that has finished is not. So the
   * last card is dismissed under a `--motion` stretched to thirty seconds,
   * injected as a stylesheet carrying the token's own `prefers-reduced-motion`
   * rule so the check's second pass still measures a page that obeys the OS. The
   * stretch is itself an assertion: one custom property moves both the CSS
   * animation and the JavaScript hold, which is the « the duration is read, never
   * written » rule of `useDismiss.ts` made visible. At thirty seconds the card is
   * three hundredths of the way through a back-loaded curve when the checks run,
   * so every other check still measures a resting card.
   */
  'widget-carte-sortie': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()

      /** What the card is doing, read off the element the alert or status is in. */
      const reading = () =>
        page.evaluate(() => {
          const card = [...document.querySelectorAll('[data-card]')].find(
            (el) => el.querySelector('[role="alert"], [role="status"]'),
          )
          if (!card) return null
          const style = getComputedStyle(card)
          return {
            animation: style.animationName,
            ms: style.animationDuration,
            ease: style.animationTimingFunction,
            origin: style.transformOrigin,
            classes: card.className,
          }
        })

      /*
       * **The mention card first, and it is un-refused**, so the two halves of
       * the slot are exercised as the rep meets them: a sentence they are about
       * to read aloud, and a write that did not happen.
       */
      await page.getByRole('button', { name: /Prévenir le client/ }).click()
      await page.getByRole('status').waitFor()
      const mention = await reading()
      if (!mention) throw new Error('la carte de mention n’est pas à l’écran')
      if (mention.animation !== 'widget-arrive' || Number.parseFloat(mention.ms) <= 0) {
        throw new Error(
          `la carte de mention arrive sans mouvement : animation ${mention.animation}, ${mention.ms}`,
        )
      }
      await settled(page)
      judgeDeparture(
        'mention, écartée par le commercial',
        await departureOf(page, '[data-card].widget-card-arrive', 'button[aria-label="Masquer cette phrase"]'),
      )

      /*
       * Then the refusal, which is the same slot reached by a different press and
       * drawn by a different component.
       *
       * A **store failure during a live recording** and not the call ending:
       * `refuseMarks` with its own reason leaves `widget:state` answering a live
       * meeting, which is the other half of what `meeting:mark` rejects on and is
       * the half that leaves the controls on screen. `widget-refus` beside this
       * stage covers the other one, where the pill has to stop claiming the
       * recording.
       */
      await page.evaluate(() =>
        window.__harness.refuseMarks('Ce moment n’a pas pu être enregistré.'),
      )
      await page.getByRole('button', { name: /^Marquer ce moment/ }).click()
      await page.getByRole('alert').waitFor()
      const refus = await reading()
      if (!refus || refus.animation !== 'widget-arrive' || Number.parseFloat(refus.ms) <= 0) {
        throw new Error(
          `le refus arrive sans mouvement : ${refus ? `${refus.animation}, ${refus.ms}` : 'carte absente'}`,
        )
      }
      /*
       * The origin is the pill's edge and not the card's centre — DEC-50's
       * « origin-aware from the pill » — so the card grows out of the control
       * that was pressed. `50% 0` reads as « Npx 0px » once resolved.
       */
      if (!/ 0px$/.test(refus.origin) && !/ 0px 0px$/.test(refus.origin)) {
        throw new Error(
          `le refus ne grandit pas depuis le bord de la pastille : transform-origin ${refus.origin}`,
        )
      }
      await settled(page)
      judgeDeparture(
        'refus, écarté par le commercial',
        await departureOf(page, '[data-card].widget-card-arrive', 'button[aria-label="Masquer ce message"]'),
      )

      /*
       * **And once more, held.** The census `--motion` takes counts what is
       * animating when it runs, so the stage ends with a departure still in
       * flight. The token is stretched rather than replaced, through a sheet that
       * carries its own `prefers-reduced-motion` rule, so the check's second pass
       * still measures a page that collapses to `0ms` when the OS asks.
       */
      await page.getByRole('button', { name: /^Marquer ce moment/ }).click()
      await page.getByRole('alert').waitFor()
      await settled(page)
      await page.evaluate(() => {
        const sheet = document.createElement('style')
        sheet.textContent =
          ':root{--motion:30s}@media (prefers-reduced-motion: reduce){:root{--motion:0ms}}'
        document.head.append(sheet)
      })
      await page.evaluate(() => {
        document
          .querySelector('[data-card] button[aria-label="Masquer ce message"]')
          .click()
      })
      await page.waitForSelector('[data-card].widget-card-leaving', { timeout: 5_000 })
      await page.evaluate(() => window.__harness.refuseMarks(null))
    },
  },

  /**
   * **The panel closing — 340×205 over another application's video, removed
   * between two frames for as long as the surface has existed.**
   *
   * DEC-50 decided the *opening* and argued it at length; the exit was not in
   * scope and nothing since put one there. Measured with `--motion` on
   * `widget-ouvert`, at both smoke sizes: « 16 élément(s) animé(s) dont **0 qui
   * s'en vont** ». It is the largest object on this window and it is the one a
   * rep dismisses most often, by any of four routes — the chevron, the footer's
   * *Replier*, the meeting ending, the window going — which is why it is held by
   * `useDeparture` and not by `useDismiss`: three of the four are not a gesture
   * on the panel.
   *
   * Measured rather than photographed, for the same reason `widget-carte-sortie`
   * is: a class name says an exit was declared and a painted frame says one ran.
   * The stage ends with the panel *back open*, so `--geometry`, `--targets`,
   * `--prose`, `--a11y`, `--contrast` and `--scrollers` still have the surface
   * `widget-ouvert` shows them, and re-opening is itself the assertion that a
   * departure interrupted leaves nothing behind.
   */
  'widget-panneau-sortie': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.replayWidget())
      const chevron = page.getByRole('button', { name: /le panneau/ })
      await chevron.click()
      await page.getByPlaceholder('Noter ce moment…').waitFor()
      await settled(page)

      const arrival = await page.evaluate(() => {
        const panel = document.querySelector('.widget-panel-arrive')
        if (!panel) return null
        const style = getComputedStyle(panel)
        return { animation: style.animationName, ms: style.animationDuration, origin: style.transformOrigin }
      })
      if (!arrival) throw new Error('le panneau n’est pas à l’écran')
      if (arrival.animation !== 'widget-arrive' || Number.parseFloat(arrival.ms) <= 0) {
        throw new Error(`le panneau arrive sans mouvement : ${arrival.animation}, ${arrival.ms}`)
      }

      judgeDeparture(
        'panneau, replié par le commercial',
        await departureOf(page, '.widget-panel-arrive', 'button[aria-label="Replier le panneau"]'),
      )

      // Reopened, and it has to come back clean: a held exit that left a ghost
      // would give two panels here, and the frame is measured off this box.
      await chevron.click()
      await page.getByPlaceholder('Noter ce moment…').waitFor()
      await settled(page)
      const count = await page.evaluate(
        () => document.querySelectorAll('.widget-panel-arrive, .widget-panel-leaving').length,
      )
      if (count !== 1) throw new Error(`${count} panneau(x) après la réouverture, un seul est attendu`)
    },
  },

  /*
   * The second press. Ending a recording cannot be undone, so the widget asks
   * again — and the confirmation is a different rectangle from the label that
   * summoned it (DEC-4).
   */
  'widget-arret': {
    scenario: 'session',
    query: 'window=widget',
    async drive(page) {
      await page.getByLabel('Durée d’enregistrement').waitFor()
      await page.evaluate(() => window.__harness.replayWidget())
      await page.getByRole('button', { name: /^Ouvrir le panneau/ }).click()

      /*
       * **Not a photograph — the two rectangles, measured.**
       *
       * DEC-4's rule, stated in this control's own docblock and done backwards
       * for as long as it existed: both clusters are right-aligned in a
       * `justify-between` row, so the 160-px danger button grew *leftward* and
       * fully contained the 59×24 « Terminer » box. One double-click on a
       * control floating over a live call ended the recording, and `ended` has
       * no way back — the audio was never retained (DEC-12).
       *
       * Two properties, and the second is the stronger one: the danger button
       * must not intersect the trigger, and the **escape** must contain it, so
       * a second click at the same pixel cancels.
       */
      const box = async (name) => {
        // At rest, always: these three rectangles are compared with each other,
        // and a transform on the card they sit in moves all three by different
        // amounts. See `settled` — the same trap cost `widget-ouvert` a false
        // « the chevron moved 3px » on the first run after DEC-50.
        await settled(page)
        const rect = await page.getByRole('button', { name, exact: true }).boundingBox()
        if (!rect) throw new Error(`« ${name} » n’est pas à l’écran`)
        return rect
      }
      const cardHeight = async () => {
        await settled(page)
        return page.evaluate(
          () => document.querySelector('.widget-panel-arrive')?.getBoundingClientRect().height ?? null,
        )
      }
      const trigger = await box('Terminer')
      const before = await cardHeight()
      await page.getByRole('button', { name: 'Terminer', exact: true }).click()
      const danger = await box('Arrêter définitivement')
      const escape = await box('Annuler')
      const after = await cardHeight()

      /*
       * **The window must not move under the finger.**
       *
       * `danger` is the only filled variant on this surface and it is 32.59 px
       * against the footer's 24 px text controls, so this press grew the card
       * 356 → 365. In the shipped window that is a `widget:resize`: a frameless
       * always-on-top surface re-placing itself over the client's face at the
       * instant the rep is deciding whether to end a recording that cannot be
       * resumed. It is also what slid the row and broke the containment below.
       *
       * Both states measure 24 px now — `py-0` on the danger button, with
       * `Button`'s own `min-h-[24px]` keeping the target floor — so this is 0.
       * (An earlier draft of this comment claimed a `min-h-gutter` on the row.
       * There is none; the row carries `py-snug` and nothing else. Prose wrong
       * about the code, in a paragraph about a check that was wrong about the
       * code.)
       */
      if (before !== null && after !== null && Math.abs(after - before) > 0.5) {
        throw new Error(
          `la carte change de taille sous le doigt : ${before} → ${after} px — ` +
            'la fenêtre se replace au moment de la décision irréversible',
        )
      }

      const intersects = (a, b) =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      if (intersects(trigger, danger)) {
        throw new Error(
          `« Arrêter définitivement » recouvre « Terminer » — un double-clic arrête l’enregistrement : ` +
            `${JSON.stringify(trigger)} ∩ ${JSON.stringify(danger)}`,
        )
      }
      /*
       * **Containment, on both axes — this tested overlap.**
       *
       * The `y` half read « escape.y <= trigger.y + trigger.height && escape.y +
       * escape.height >= trigger.y », which is satisfied by a one-pixel touch.
       * The docblock above it says « wide enough to **cover** it, so a second
       * click at the same pixel cancels ». Measured on the shipped card, the
       * escape missed the top **4.3 px — 18 %** of the trigger's height, because
       * the filled danger button grew the row and `items-center` pushed
       * *Annuler* down. The check passed the whole time.
       *
       * A check that passes while the property it states is false, on the one
       * irreversible control in the product.
       */
      const covers =
        escape.x <= trigger.x &&
        escape.x + escape.width >= trigger.x + trigger.width &&
        escape.y <= trigger.y &&
        escape.y + escape.height >= trigger.y + trigger.height
      if (!covers) {
        throw new Error(
          `« Annuler » ne contient pas « Terminer » — le second clic peut tomber à côté : ` +
            `${JSON.stringify(escape)} vs ${JSON.stringify(trigger)}`,
        )
      }
    },
  },

  'reglages-sans-entra': {
    scenario: 'reglages',
    entra: false,
    expand: true,
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Réglages' }).click()
      await page.getByRole('heading', { name: 'Facultatifs' }).waitFor()
    },
  },

  /**
   * **The suggested action on the note, pressed** (`session/askActions.ts`).
   *
   * The chip that answers « et maintenant, je fais quoi de ça ? » — it names the
   * follow-up draft the gate composes and asks the recording what was committed
   * to. Its own stage rather than a line added to `session-demander`, for the
   * reason that stage states about itself: that one *types*, deliberately,
   * because the question chips are dropped below a 430px container and it has to
   * work at 960. This chip is outside that container query on purpose — measured
   * on the shipped panel, at 960×600 the compte-rendu pane offered **zero**
   * suggestions — so pressing it is the assertion, at both smoke sizes, that the
   * one offer the note carries is reachable on the window's own minimum.
   */
  'session-suivi': {
    scenario: 'compte-rendu',
    async drive(page) {
      await SCREENS['session-compte-rendu'].drive(page)
      await page.getByRole('button', { name: 'Rédiger la relance' }).click()
      /*
        The question the chip actually sent, above the answer — the chip's label
        is never the last word on what was asked — and then a citation, because
        an answer with no citation is no answer (DEC-21).
      */
      await page.getByText(/Quels engagements ont été pris/).waitFor()
      /*
        `:not(.ask-suggestions)` because the question chips are `li`s too — and
        at 960 they are `display: none`, so a locator that caught them would
        wait for a hidden element and hang on exactly the size this stage exists
        to cover.
      */
      await page.locator('.ask ul:not(.ask-suggestions) > li').first().waitFor()
    },
  },

  /**
   * **And the same note on the build the first demo ships in** (DEC-28).
   *
   * No Entra registration, so `draftIntents` marks `mail.draft` « Aucun compte
   * Microsoft connecté. » and no follow-up draft will ever be created. The chip
   * is *absent*, not disabled and not refusing — a control that is present and
   * does nothing is DEC-26's own example — and everything *Demander* already was
   * is untouched, which is the half an absence check has to assert or it is
   * satisfied by the panel having disappeared.
   */
  'session-suivi-sans-entra': {
    scenario: 'compte-rendu',
    entra: false,
    async drive(page) {
      await SCREENS['session-compte-rendu'].drive(page)
      await page.getByLabel('Poser une question sur cet appel').waitFor()
      const chip = page.getByRole('button', { name: 'Rédiger la relance' })
      if ((await chip.count()) !== 0) {
        throw new Error(
          'le mail de suivi est offert sans compte Microsoft — aucun brouillon ne peut être créé',
        )
      }
    },
  },
}

/**
 * **The gate's field rail groups by ground — measured on the painted pixels.**
 *
 * The rail drew eleven value boxes on three nested grounds and let the strokes
 * do the grouping: the `<aside>` `rgb(249,251,253)`, the container
 * `rgb(253,254,254)`, a value box `rgb(255,255,255)` — **1.010:1**, ΔL* 0.42 —
 * with **fifty-eight** border sides inside it. `4bo7bdc8` inverted that: the
 * container takes `--bg-subtle`, the editable field keeps white, an inert field
 * takes no fill at all.
 *
 * **Why ΔL*, and not the contrast ratio this repo measures everywhere else.**
 * WCAG's ratio is the right instrument for a mark against its ground and the
 * wrong one for two near-white grounds against each other: it is a ratio, so at
 * the dark end a hair of luminance buys a large number and at the light end a
 * visible step buys almost none. CIE L* is perceptually uniform, a
 * just-noticeable difference is about 1, and the floor is 2.5.
 *
 * **Read off the screenshot, because the first draft read `getComputedStyle`
 * and that draft scored the defect it guards a 95.58.** Its `parse()` was
 * `css.match(/[\d.]+/g).slice(0,3)`, so `rgba(0, 0, 0, 0)` came back `[0,0,0]`
 * — L* 0 — and one character in `Review.tsx`'s `'bg-inner' : 'bg-transparent'`
 * ternary turned eleven boxes invisible and made the check print the largest
 * number it can produce. Five of eight injected regressions passed it: a
 * transparent fill, a 4 % alpha fill, `opacity: .25` on the rail, a
 * `filter: contrast(.08)`, and left-and-right strokes returning. A declared
 * colour is not a painted one, and nothing composites alpha, a mask, an opacity
 * or a filter except the compositor.
 *
 * **And a census, which the README's own rule already required.** « A check that
 * visited zero elements must not be able to print the same sentence as a check
 * that measured everything » was written for `--fade` and not applied here. The
 * rail has eleven rows in both states; every one is classified and counted, and
 * a count that is not eleven is a failure rather than a smaller pass.
 */
/**
 * **Every visible control, hovered, measured — and every one asked to answer.**
 *
 * Nothing in this harness had ever moved a pointer: seventy-odd stages, ten
 * measured checks, every ratio in `tokens.css` recomputed by a unit test, all of
 * it describing a product at rest. A `:hover` rule is a second palette nobody
 * had asked a number of, and on the widget the answer was that `.widget-surface`
 * re-points every token a control *wears* and none of the three it *moves to*.
 *
 * Two claims, and the second is why the first cannot pass vacuously: **every
 * control clears AA while hovered**, and **every control answers the pointer at
 * all**. The second was « at least one control changes » for one draft, and that
 * draft passed the mutation it exists to catch — stripping `hover:` off all four
 * `Button` variants left twelve other controls on the surface still moving, so
 * the stage went green over four dead ones. It is asked of each control now,
 * which is both stronger and what DEC-26 already says: a control that does not
 * answer the pointer looks like one that is not there.
 */
async function sweepHovers(page, where) {
  const controls = page.locator('button:visible')
  const total = await controls.count()
  if (total < 3) {
    throw new Error(`${total} contrôle(s) visibles ${where} — la mise en scène n’a rien ouvert`)
  }

  const readPaint = (handle) =>
    handle.evaluate((el) => {
      const walk = (node) => {
        for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor
          if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
        }
        return getComputedStyle(document.documentElement).backgroundColor
      }
      const style = getComputedStyle(el)
      return {
        name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30),
        ink: style.color,
        ground: walk(el),
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
        paint: `${style.color}|${style.backgroundColor}|${style.borderTopColor}|${style.textDecorationLine}|${style.opacity}`,
      }
    })

  const srgb = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = (css) => {
    const [r, g, b] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => srgb(Number(v) / 255))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  const failures = []
  const inert = []
  let moved = 0
  for (let i = 0; i < total; i += 1) {
    const control = controls.nth(i)
    const rest = await readPaint(control)
    await control.hover({ force: true })
    // A hover is a transition like any other — `STAGING_TURN_MS` is what the
    // rest of this file waits for a class to land, and this waits the same.
    await page.waitForTimeout(STAGING_TURN_MS)
    const over = await readPaint(control)
    if (over.paint !== rest.paint) moved += 1
    else inert.push(over.name || '(sans nom)')

    /*
     * AA at the size the control actually draws: 3:1 is the large-text floor and
     * it wants 18.66px at 700 or 24px, which no control on this surface reaches.
     * The size is read rather than assumed so the floor cannot be the wrong one
     * after a type change.
     */
    const large = over.size >= 24 || (over.size >= 18.66 && over.weight >= 700)
    const floor = large ? 3 : 4.5
    const measured = ratio(over.ink, over.ground)
    if (measured < floor) {
      failures.push(
        `« ${over.name} » ${measured.toFixed(2)}:1 sous le pointeur ` +
          `(${over.ink} sur ${over.ground}, au repos ${ratio(rest.ink, rest.ground).toFixed(2)}:1), plancher ${floor}`,
      )
    }
  }

  if (inert.length > 0) {
    throw new Error(
      `${where} : ${inert.length} contrôle(s) sur ${total} ne changent pas sous le pointeur : ` +
        `${inert.join(' · ')} — ${moved} bouge(nt)`,
    )
  }
  if (failures.length > 0) {
    throw new Error(
      `${where} : ${failures.length} contrôle(s) sur ${total} passent sous AA au survol : ${failures.join(' · ')}`,
    )
  }
}

const RAIL_FLOOR = 2.5
const RAIL_ROWS = 11
/**
 * **Which rows are read-only, and in which state — named, not counted.**
 *
 * `account` is inert on every screen: an account is resolved by Outlook and
 * VerySwing and never typed (DEC-7), so a box a rep can type in over a value no
 * payload carries is the dead control DEC-26 refuses. The other nine are the
 * `INTERPRETIVE` rows, inert only while the opportunity is not shipping.
 *
 * This was `readOnly === 0` on the nominal screen and `readOnly > 0` on the inert
 * one — a floor of **one**, on a check whose own docblock says « a floor declared
 * for a grammar and applied to two rows of it is a floor nobody is holding ».
 * Eight flush rows and three boxed ones was a pass. Round 16 proved it: excluding
 * one row from `INTERPRETIVE` left `review-rail`, `review-rail-inerte`, all twelve
 * gates and 152 stagings green while `besoin` — the row the opportunity's whole
 * description opens on — was a live textarea over a payload that will never exist.
 */
const RAIL_ALWAYS_INERT = ['row-account']
const RAIL_TYPED_INERT = [
  'row-besoin',
  'row-profils',
  'row-modeCollaboration',
  'row-tjm',
  'row-dateDemarrage',
  'row-dureeMission',
  'row-contexteTechnique',
  'row-objections',
  'row-prochainesEtapes',
]

async function measureRail(page, { inert }) {
  const sharp = require('sharp')
  const srgb = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lstar = (rgb) => {
    const [r, g, b] = rgb.map((v) => srgb(v / 255))
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (y * 24389) / 27
  }
  const step = (a, b) => Math.abs(lstar(a) - lstar(b))

  const keys = await page.evaluate(() =>
    [...document.querySelectorAll('[id^="row-"]')].map((row) => row.id),
  )
  /*
   * The census, before any measurement: a stage that measured two rows and
   * passed is the defect this exists to stop.
   */
  if (keys.length !== RAIL_ROWS) {
    throw new Error(
      `${keys.length} ligne(s) dans le rail, ${RAIL_ROWS} attendues — ` +
        'la mesure ci-dessous ne porterait pas sur le rail',
    )
  }

  const flat = []
  const boxed = []
  const readOnlyKeys = []
  let band = null

  for (const key of keys) {
    const row = page.locator(`#${key}`)
    /*
     * Scrolled to, not unclipped. `--expand`'s own docblock calls unclipping « a
     * lie told to the camera »; a rail 840px tall inside a 402px scroller simply
     * has most of its rows outside any one shot, and the honest way to photograph
     * a row is to put it on screen the way a rep does.
     */
    await row.scrollIntoViewIfNeeded()
    await settled(page)

    const geometry = await page.evaluate((id) => {
      const el = document.getElementById(id)
      const field = el.querySelector('textarea, input')
      if (field === null) return null
      const container = el.parentElement
      const r = (n) => {
        const b = n.getBoundingClientRect()
        return { x: b.x, y: b.y, width: b.width, height: b.height }
      }
      return { field: r(field), container: r(container), readOnly: field.readOnly }
    }, key)
    if (geometry === null) throw new Error(`${key} : aucune boîte à mesurer sur la ligne`)
    if (geometry.readOnly) readOnlyKeys.push(key)

    /*
     * One clip per row, spanning the container's own left edge through the
     * field — so the fill and the ground beside it come out of the *same*
     * painted rectangle and no declared colour is involved.
     */
    const left = Math.floor(geometry.container.x - 10)
    const clip = {
      x: left,
      y: Math.round(geometry.field.y),
      width: Math.ceil(geometry.field.x + geometry.field.width - left),
      height: Math.max(2, Math.round(geometry.field.height)),
    }
    const { data, info } = await sharp(await page.screenshot({ clip }))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const scale = info.width / clip.width
    const at = (x, y) => {
      const px = Math.min(info.width - 1, Math.max(0, Math.round((x - clip.x) * scale)))
      const py = Math.min(info.height - 1, Math.max(0, Math.round((y - clip.y) * scale)))
      const i = (py * info.width + px) * info.channels
      return [data[i], data[i + 1], data[i + 2]]
    }

    /*
     * **The modal colour along a scanline, not the pixel at the centre.**
     *
     * A value box has text in it, so its middle pixel is as likely to be a
     * glyph as a fill: the first run of this reported ΔL* 17.80 on
     * `row-prochainesEtapes` — `--text-strong` on white — and called it a box
     * that a read-only row should not have had. Ink is a minority of any line
     * through a field; the mode is the fill.
     */
    const modeAlong = (x0, x1, y) => {
      const seen = new Map()
      for (let x = x0; x <= x1; x += 1) {
        const key = at(x, y).join(',')
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
      let best = null
      let count = -1
      for (const [key, n] of seen) {
        if (n > count) {
          best = key
          count = n
        }
      }
      return best.split(',').map(Number)
    }

    const mid = geometry.field.y + geometry.field.height / 2
    const fill = modeAlong(
      Math.round(geometry.field.x + 3),
      Math.round(geometry.field.x + geometry.field.width - 3),
      mid,
    )
    const beside = at(geometry.container.x + 4, mid)
    const aside = at(geometry.container.x - 6, mid)
    if (band === null) band = step(beside, aside)

    const measured = step(fill, beside)
    /*
     * Two grammars, both asserted, which is what makes the census mean
     * something: an editable field must be a real step from the ground it sits
     * on, and an inert one must be flush with it — that is the whole of what
     * read-only looks like here, and a floor applied to only one of them is a
     * floor that nine rows escape.
     */
    if (geometry.readOnly) {
      if (measured >= RAIL_FLOOR) {
        boxed.push(`${key} ΔL* ${measured.toFixed(2)} — un champ inerte porte encore une boîte`)
      }
    } else if (measured < RAIL_FLOOR) {
      flat.push(`${key} ΔL* ${measured.toFixed(2)} (rgb(${fill}) sur rgb(${beside}))`)
    }
  }

  /*
   * The exact set, both ways. A missing row means a control the rep can type into
   * over a payload that will not carry it; an extra one means a correction the
   * gate silently refuses. Neither is a count.
   */
  const owed = [...RAIL_ALWAYS_INERT, ...(inert ? RAIL_TYPED_INERT : [])].sort()
  const got = [...readOnlyKeys].sort()
  if (owed.join(',') !== got.join(',')) {
    const missing = owed.filter((k) => !got.includes(k))
    const extra = got.filter((k) => !owed.includes(k))
    throw new Error(
      `champs inertes inattendus sur l’écran ${inert ? 'sans opportunité' : 'nominal'} : ` +
        `${missing.length} manquant(s)${missing.length > 0 ? ` (${missing.join(' · ')})` : ''}, ` +
        `${extra.length} en trop${extra.length > 0 ? ` (${extra.join(' · ')})` : ''}`,
    )
  }
  if (band === null || band < RAIL_FLOOR) {
    throw new Error(
      `le rail ne se détache pas de la colonne : ΔL* ${band === null ? 'rien mesuré' : band.toFixed(2)}, ` +
        `plancher ${RAIL_FLOOR}`,
    )
  }
  if (flat.length > 0) {
    throw new Error(
      `${flat.length} champ(s) sur ${keys.length} ne se détachent pas de leur fond : ` +
        `${flat.slice(0, 3).join(' · ')} — plancher ${RAIL_FLOOR}`,
    )
  }
  if (boxed.length > 0) {
    throw new Error(`${boxed.length} champ(s) : ${boxed.slice(0, 3).join(' · ')}`)
  }

  const ruled = await page.evaluate(() => {
    const container = document.querySelector('[id^="row-"]').parentElement
    const out = []
    for (const el of [container, ...container.querySelectorAll('*')]) {
      const style = getComputedStyle(el)
      for (const side of ['Top', 'Bottom']) {
        if (
          parseFloat(style[`border${side}Width`]) > 0 &&
          style[`border${side}Style`] !== 'none'
        ) {
          out.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 30)} ${side}`)
        }
      }
    }
    return out
  })
  if (ruled.length > 0) {
    throw new Error(
      `${ruled.length} trait(s) horizontal(aux) dans le rail : ` +
        `${ruled.slice(0, 3).join(' · ')} — il groupe par fond`,
    )
  }
}

const openAgenda = (page) => page.getByRole('region', { name: 'Calendrier' }).waitFor()

/** One row of a list, by the text it carries. */
const rowNamed = (page, text) => page.locator('li').filter({ hasText: text }).first()

/**
 * Flags, so one file covers what five near-identical copies used to.
 *
 * `--viewport` is the whole reason those copies existed: a responsive pass
 * wants 1280, 1440 and 1920 of the same screen, and forking the file to change
 * one constant is how three of them drifted from the fourth.
 */
function parseArgs(argv) {
  const flags = {
    viewport: { width: 1440, height: 900 },
    /* `null` = follow the screen's own plan; `--expand`/`--no-expand` override it. */
    expand: null,
    scan: null,
    png: true,
    entra: null,
    geometry: false,
    targets: false,
    prose: false,
    echo: false,
    a11y: false,
    contrast: false,
    motion: false,
    fade: false,
    census: false,
    rhythm: false,
    cells: false,
    scrollers: false,
  }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--expand') flags.expand = true
    /*
     * The other way. Two screens ask for `expand` in their own plan because
     * what matters on them is below an inner fold — but the same unclipping
     * erases whatever is *pinned* to the bottom of a column, which is how a
     * sticky action bar looks correct in every screenshot and is missing in
     * the window. `--no-expand` shoots the viewport the rep really gets.
     */
    else if (arg === '--no-expand') flags.expand = false
    else if (arg === '--sans-entra') flags.entra = false
    else if (arg === '--no-png') flags.png = false
    else if (arg === '--geometry') flags.geometry = true
    else if (arg === '--targets') flags.targets = true
    else if (arg === '--prose') flags.prose = true
    else if (arg === '--echo') flags.echo = true
    else if (arg === '--a11y') flags.a11y = true
    else if (arg === '--contrast') flags.contrast = true
    else if (arg === '--scrollers') flags.scrollers = true
    else if (arg === '--motion') flags.motion = true
    else if (arg === '--fade') flags.fade = true
    else if (arg === '--census') flags.census = true
    else if (arg === '--rhythm') flags.rhythm = true
    else if (arg === '--cells') flags.cells = true
    else if (arg === '--scan') {
      const next = argv[i + 1]
      flags.scan = next && !next.startsWith('--') && next.endsWith('.json') ? argv[++i] : ''
    } else if (arg === '--viewport') {
      const match = /^(\d+)x(\d+)$/.exec(argv[++i] ?? '')
      if (!match) {
        console.error('--viewport attend WxH, par exemple --viewport 1280x800')
        process.exit(2)
      }
      flags.viewport = { width: Number(match[1]), height: Number(match[2]) }
    } else if (arg.startsWith('--')) {
      console.error(`option inconnue: ${arg}`)
      process.exit(2)
    } else positional.push(arg)
  }
  return { flags, positional }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))
  const [screen, outfile] = positional
  if (!screen || (!outfile && flags.png)) {
    console.error(
      'usage: node shot.mjs <screen> <outfile.png> [--viewport WxH] [--expand] [--scan [out.json]] [--no-png] [--geometry] [--targets] [--prose] [--echo] [--a11y] [--contrast] [--scrollers] [--motion] [--fade] [--census] [--rhythm] [--cells]',
    )
    console.error('screens: ' + Object.keys(SCREENS).join(' · '))
    process.exit(2)
  }
  const plan = SCREENS[screen]
  if (!plan) {
    console.error(`écran inconnu: ${screen}. Connus: ${Object.keys(SCREENS).join(', ')}`)
    process.exit(2)
  }

  const serving = await servingThisRepo(URL_BASE)
  if (!serving.ok) {
    console.error(`✗ ${URL_BASE} ne sert pas ce dépôt : ${serving.why}`)
    console.error(`  dépôt mesuré : ${REPO}`)
    console.error('  lancez « npm run dev -- --port <p> --strictPort » dans ce dépôt,')
    console.error('  puis SILLAGE_URL=http://localhost:<p> — sinon la mesure porte sur un autre arbre.')
    process.exit(3)
  }

  const now = pinnedNow()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: flags.viewport,
    deviceScaleFactor: 2,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    colorScheme: 'light',
  })
  const page = await context.newPage()

  const problems = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`[${message.type()}] ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`))

  await page.clock.setFixedTime(new Date(now))
  const entra = flags.entra ?? plan.entra ?? true
  await page.addInitScript(installAppBridge, { scenario: plan.scenario, now, entra })

  /*
   * The widget is a second *window*, not a second route: `?window=widget` is
   * what `src/main.tsx` reads to decide which of the two renderers it is.
   */
  await page.goto(plan.query ? `${URL_BASE}?${plan.query}` : URL_BASE, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForSelector('#root > *', { timeout: 15_000 })

  try {
    await plan.drive(page)
  } catch (error) {
    console.error(`\n✗ ${screen}: la mise en scène a échoué — ${error.message}`)
    console.error(await debugDump(page))
    problems.forEach((p) => console.error('   ' + p))
    await browser.close()
    process.exit(1)
  }

  /*
   * **A stage may borrow the viewport; it may not keep it.**
   *
   * `review-garde` drives the arming latch by resizing — 1600×1200, 1280×800,
   * 1280×3000, 1280×800 — which is legitimate and is the whole assertion. What
   * it did not do is give the size back, and nothing here noticed: the label
   * below was printed from the size that was *asked for*, so every render of
   * that stage at any size came out 1280×800 and was captioned with whatever
   * the caller requested. `smoke.mjs`'s « every stage × two sizes » therefore
   * measured that stage twice at one size, for an unknown number of rounds — on
   * the screen whose entire subject is what fits in a window, and behind the one
   * press that writes into a client's CRM.
   *
   * Restored rather than refused, because borrowing it is the right way to write
   * that stage. The picture and every check below then describe the size on the
   * label. The label itself is read back from the page further down, so it can
   * no longer state a viewport nothing rendered — `CLAUDE.md`'s fourth shape, in
   * the one tool this repo uses to avoid it.
   */
  const borrowed = page.viewportSize()
  if (borrowed && (borrowed.width !== flags.viewport.width || borrowed.height !== flags.viewport.height)) {
    await page.setViewportSize(flags.viewport)
    await settled(page)
  }

  // Nothing below measures a page that is still moving — see `settled`.
  await settled(page)

  if (process.env.SILLAGE_PROBE) {
    await page.evaluate(() => document.fonts.ready)
    const src = (await import('node:fs')).readFileSync(process.env.SILLAGE_PROBE, 'utf8')
    console.log('PROBE ' + JSON.stringify(await page.evaluate(src), null, 1))
  }

  /*
   * The scan runs *before* `--expand`, on the layout the window really draws.
   * Unclipping the scrollers is a lie told to the camera; told to the detector
   * it would erase every finding about content that sits below a fold, which is
   * the class of finding worth having.
   */
  let findings = null
  if (flags.scan !== null) {
    await page.evaluate(() => document.fonts.ready)
    findings = await scan(page, screen, flags)
  }

  /*
   * Same reason, same moment: before `--expand`, because unclipping the
   * scrollers is exactly what would hide a marker hanging out of its box.
   */
  let clipped = []
  let measured = 0
  let tightest = { by: Infinity, text: '' }
  let inset = []
  let groups = 0
  let small = []
  /*
   * Collected here, before `--expand`, for `--geometry`'s reason: unclipping the
   * scrollers changes the geometry of everything this counts.
   */
  let counted = null
  if (flags.census) {
    await page.evaluate(() => document.fonts.ready)
    counted = await census(page)
  }
  /*
   * Both of these read *painted* geometry, so they go where the census goes:
   * before `--expand`, on the layout the window really draws. Unclipping the
   * scrollers changes every width `--cells` compares and every seam `--rhythm`
   * measures — it would erase the finding rather than measure it.
   */
  let beat = null
  if (flags.rhythm) {
    await page.evaluate(() => document.fonts.ready)
    beat = await rhythm(page)
  }
  let starved = null
  if (flags.cells) {
    await page.evaluate(() => document.fonts.ready)
    starved = await cells(page)
  }
  if (flags.geometry) {
    await page.evaluate(() => document.fonts.ready)
    const seen = await geometry(page)
    clipped = seen.clipped
    measured = seen.measured
    tightest = seen.tightest
    inset = seen.inset
    groups = seen.groups
  }

  if (flags.targets) {
    await page.evaluate(() => document.fonts.ready)
    small = await targets(page)
  }

  let long = []
  if (flags.prose) {
    await page.evaluate(() => document.fonts.ready)
    long = await prose(page)
  }

  /*
   * **`--echo`'s own self-test, and it is twelve probes rather than a count.**
   *
   * A check whose self-test measures nothing while reporting green is the failure
   * this repo has already shipped five times, once inside an instrument
   * (`SILLAGE_MOTION_ATTACK` injected at `#root h1`, and the widget renderer has
   * no `h1`). So this one creates every element it attacks, asserts each probe
   * **by the string it draws** rather than by a total, and carries eight probes
   * that must stay silent — because a rule whose whole difficulty is its
   * exemptions can only be trusted if the exemptions are shown to hold, and
   * because a false positive here is worse than a hole: a repeated control label
   * is on every list in this product, so a check that reported one would be
   * worked around and gone.
   *
   *   SILLAGE_ECHO_ATTACK=1 node scripts/harness/shot.mjs agenda /dev/null \
   *     --no-png --echo
   *
   * must report the four echoes below, exempt the three columns and the control
   * naming its target, skip the value and the two invisible second copies, stay
   * silent on the declared blind spot, and exit 12.
   *
   * A harness-only development override, which is what `process.env` is for
   * here: DEC-34 is about the *app* requiring none, and nothing in `electron/` or
   * `src/` reads this.
   */
  if (process.env.SILLAGE_ECHO_ATTACK) {
    await page.evaluate(() => {
      const root = document.querySelector('#root')
      if (!root) throw new Error('SILLAGE_ECHO_ATTACK: pas de #root à attaquer')
      const bench = document.createElement('div')
      // Off to the side and out of the way, but genuinely laid out: a probe with
      // no box is a probe this check is documented to skip.
      bench.setAttribute('style', 'position:fixed;left:0;top:0;width:600px;opacity:.01;z-index:0')
      root.append(bench)
      const say = (html) => {
        const el = document.createElement('div')
        el.innerHTML = html
        bench.append(el)
      }

      /* 1. The shipped defect's own shape: one sentence, two different elements. */
      say('<h3 class="attaque-titre">Le compte-rendu part chez VerySwing</h3>')
      say('<p class="attaque-prose">Le compte-rendu part chez VerySwing</p>')

      /*
       * 2. Case and trailing punctuation, which is *exactly* how the home screen's
       * duplicate date hid: `text-transform: uppercase` leaves the DOM in lower
       * case, so a raw comparison reported the screen clean for every review round.
       */
      say('<p class="attaque-casse" style="text-transform:uppercase">Jeudi 9 avril</p>')
      say('<span class="attaque-casse-bis">jeudi 9 avril.</span>')

      /*
       * 3. A cell of a list row echoed by a heading outside it. Two components,
       * neither of them a control, so nothing exempts it.
       *
       * The client is invented rather than borrowed from the fixture, and that is
       * not decoration: every probe is asserted by its own string, so a probe
       * sharing copy with the staged screen would be satisfied — or defeated — by
       * the product rather than by the injection.
       */
      say(
        '<ul><li class="attaque-ligne"><span class="attaque-cellule">Sonaverre Industrie</span></li></ul>' +
          '<h4 class="attaque-ailleurs">Sonaverre Industrie</h4>',
      )

      /*
       * 4. A page title against a pager's value — two headings, two levels. This is
       * the pair US-22 created and `--echo` found on `agenda-hors-fenetre`: the
       * calendar's own `‹ Septembre 2026 ›` and the page's `h1` saying the same
       * month. It is the probe that proves exemption 1 is about the *tag* and not
       * about « anything that looks like a heading ».
       */
      say('<h1 class="attaque-titre-page">Brumaire 2031</h1>')
      say('<h2 class="attaque-pagineur">Brumaire 2031</h2>')

      /*
       * The first that must stay **silent**: the same control label on five rows,
       * which is every day list in this product — and deliberately on rows in two
       * *different* lists, because that is the shape on the home screen (the day
       * list and *En attente de validation* both offer *Ouvrir*) and the shape
       * that a positional-parallelism rule would report.
       */
      say(
        '<ul>' +
          [1, 2, 3]
            .map(() => '<li><button class="attaque-ouvrir">Rouvrir l’appel</button></li>')
            .join('') +
          '</ul>' +
          '<section><ul>' +
          [1, 2]
            .map(() => '<li><button class="attaque-ouvrir">Rouvrir l’appel</button></li>')
            .join('') +
          '</ul></section>',
      )

      /*
       * The second that must stay silent, and it is the one an allow-list of
       * button labels could never cover: a repeated *cell of prose* — the same
       * component, the same variant, one per row. « Rien n’a été envoyé » is on
       * every row of *En attente de validation* and is not the app repeating
       * itself; it is a column. Nor are these rows `<li>`s, because the rail's
       * eleven field rows and Réglages' provider rows are not either.
       */
      say(
        '<div>' +
          [1, 2, 3]
            .map(() => '<div><span class="attaque-colonne">Rien n’a été envoyé</span></div>')
            .join('') +
          '</div>',
      )

      /*
       * The third that must stay silent, and it is the false positive that decided
       * exemption 1's unit: two cells of one list whose classes differ because the
       * *row* differs. `TranscriptReader` draws a cited turn `text-strong` and an
       * ordinary one `text-body`, so comparing class lists reported one tiled
       * sentence **seventeen times** on `review-transcription` — the fixture's own
       * volume, reported as a defect of the product.
       */
      say(
        '<ul><li><span class="attaque-variante-a">Envoi interrompu</span></li>' +
          '<li><span class="attaque-variante-b">Envoi interrompu</span></li></ul>',
      )

      /*
       * The fourth: a control naming its target. A filter chip beside the rows it
       * filters, Réglages' section nav beside the pane it opens, « ‹ Calendrier »
       * beside the *Calendrier* connector row — one gesture, three screens.
       */
      say(
        '<button class="attaque-onglet">Cadrage support N2</button>' +
          '<p class="attaque-cible">Cadrage support N2</p>',
      )

      /*
       * The fifth: a value, drawn twice, **by two different tags** — which is what
       * makes this probe measure the letter floor rather than exemption 1. Written as
       * two `<p>`s it was silent either way, because the column exemption had already
       * taken it: measured, removing the floor changed nothing. A time is not a thing
       * said, and the month grid genuinely draws « 1 » twice.
       */
      say('<p class="attaque-heure">07:42</p><span class="attaque-heure-bis">07:42</span>')

      /*
       * The sixth, and it is the **declared blind spot rather than a property**: two
       * elements of the same tag saying the same thing in two unrelated places.
       * Exemption 1 cannot tell that from a column, which is written down in
       * `echo()`'s docblock with the measurement behind the choice — every
       * alternative cost a true positive, and the tightest of them reported *Ouvrir*
       * across two lists. If this probe ever starts firing, exemption 1 has been
       * tightened and the two probes above it are what to re-measure.
       */
      say('<p class="attaque-jumelle-a">Deux fois la même balise, hors liste</p>')
      say('<p class="attaque-jumelle-b">Deux fois la même balise, hors liste</p>')

      /*
       * The seventh and eighth: two strings drawn **once** where a rep can read them
       * and a second time where nobody can — an `sr-only` box, which is 1×1 and
       * clipped by construction, and a `display: none`. Each carries its own
       * string and neither may appear in the findings, which is how the assertion
       * reaches the skip directly instead of inferring it from a count.
       */
      say('<p class="attaque-visible-a">Le second exemplaire est pour les lecteurs d’écran</p>')
      const hidden = document.createElement('span')
      hidden.setAttribute(
        'style',
        'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)',
      )
      hidden.textContent = 'Le second exemplaire est pour les lecteurs d’écran'
      bench.append(hidden)

      say('<p class="attaque-visible-b">Le second exemplaire n’est pas dessiné</p>')
      const gone = document.createElement('p')
      gone.setAttribute('style', 'display:none')
      gone.textContent = 'Le second exemplaire n’est pas dessiné'
      bench.append(gone)
    })
    await page.waitForTimeout(60)
  }
  let repeats = { items: [], seen: 0, column: 0, named: 0 }
  if (flags.echo) {
    await page.evaluate(() => document.fonts.ready)
    repeats = await echo(page)
  }

  let dim = []
  let graphics = 0
  let undeclaredGraphics = 0
  let textRuns = 0
  let unmeasuredGrounds = []
  let unmeasuredRuns = 0
  let grainEaten = 0
  let grainWorst = null
  let grainAlpha = null
  let grainTile = null
  let grainPainted = 0
  if (flags.contrast) {
    await page.evaluate(() => document.fonts.ready)
    const measured = await contrast(page)
    dim = measured.dim
    graphics = measured.graphics
    undeclaredGraphics = measured.undeclared
    textRuns = measured.runs
    unmeasuredGrounds = measured.unmeasured
    unmeasuredRuns = measured.unmeasuredRuns
    grainEaten = measured.grainEaten
    grainWorst = measured.grainWorst
    grainAlpha = measured.grainAlpha
    grainTile = measured.grainTile
    grainPainted = measured.grainPainted
  }

  /*
   * Before `--expand`, and this is the whole reason it took thirteen rounds.
   * The expansion injects `textarea { field-sizing: content !important }` so a
   * `fullPage` shot shows a draft rather than scrolling past it — which means
   * every screenshot ever taken of this gate showed the fields at their full
   * height while the shipped product clipped them. The harness was hiding the
   * defect it exists to find.
   */
  let inner = []
  if (flags.scrollers) {
    await page.evaluate(() => document.fonts.ready)
    inner = await scrollers(page)
  }

  /*
   * **`--fade`'s own self-test, and it is the check that most needed one.**
   *
   * The twenty-fourth round executed `fades()` against the product's own CSS and
   * found it could not read **half of it**. The reader required the transparent
   * stop to carry a pixel offset, and `.fade-below[data-above="true"]` is
   * `linear-gradient(to bottom, transparent, black var(--fade-reading))`, whose
   * implicit `0` Chromium drops from the computed value — so on `review-valider`
   * both masked elements came back with no distance at all and were *silently*
   * skipped, under a line reading « aucun ne couvre une ligne entière ». A 40px
   * ramp forced over a 25px line box passed, exit 0. That is the shape recorded
   * three times over in CLAUDE.md: a check that measures nothing reports the same
   * green as a check that measured everything.
   *
   * So the attack stages **one element per gradient form the product can
   * actually produce**, at a ramp deliberately longer than the line box inside
   * it, and three controls that must stay quiet. The three `.fade-below` divs
   * carry no inline gradient: they wear the shipped class and the shipped
   * `--fade-reading` custom property, so what is being attacked is
   * `src/design/index.css` itself and not a copy of it in this file.
   *
   *   SILLAGE_FADE_ATTACK=1 node scripts/harness/shot.mjs review-valider /dev/null \
   *     --no-png --fade
   *
   * must print **seven** ramps over a line — `data-above`'s ramp, `data-below`'s,
   * *both* ramps of the state that has content at each end, the widget's
   * explicit-`0` form, the vertical layer riding behind a horizontal one, and a
   * `to top` ramp reported at the « bas » edge because that is the end of the box
   * its offset counts from — plus **one** unreadable mask, **one** ramp animated
   * by an unregistered property, and exit 11. The census must show two layers
   * exempted for running along the other axis and one ramp in percent.
   * A harness-only development override, which is what `process.env` is for
   * here: DEC-34 is about the *app* requiring none, and nothing in `electron/` or
   * `src/` reads this.
   *
   * **The three `.fade-below` probes no longer stage three different gradients**,
   * and that is the point of US-15: the class now writes **one** four-stop
   * gradient whose two lengths move, because the swap between a two-stop and a
   * four-stop declaration happened between two frames and put a 12px hard edge on
   * screen in one paint. What the three probes still assert is three different
   * *outcomes* through the shipped class — one ramp at the top, one at the bottom,
   * two — so a rule that stopped honouring `data-above` or `data-below` is still
   * caught. The dropped-implicit-`0` shape that defeated the first version of this
   * reader has left the product but not the attack: the `to top` probe and the
   * layered one both write it, and the 4px control does too.
   *
   * And the ramp being animatable is now itself attacked, because that half lives
   * in a different rule from the half that reads it: `@property` in
   * `src/design/index.css` registers the four lengths, and without a registration
   * a transition on a custom property is *discrete* — the mask draws correctly at
   * rest, the transition is still declared, and the snap comes back in silence.
   */
  if (process.env.SILLAGE_FADE_ATTACK) {
    await page.evaluate(() => {
      const root = document.querySelector('#root')
      const add = (style, className = '', attrs = {}) => {
        const el = document.createElement('div')
        if (className) el.className = className
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
        if (style) el.setAttribute('style', style)
        // An explicit line box, so the attack asserts the same numbers whatever
        // stage it is run on.
        el.innerHTML = '<p style="line-height:25px;font-size:16px">Attaque du fondu</p>'
        root.appendChild(el)
      }
      // The product's own three rules, at a ramp longer than the line box.
      add('--fade-reading: 40px', 'fade-below', { 'data-above': 'true' })
      add('--fade-reading: 40px', 'fade-below', { 'data-below': 'true' })
      add('--fade-reading: 40px', 'fade-below', { 'data-above': 'true', 'data-below': 'true' })
      // The widget's form: an explicit `0` and `currentColor` rather than `black`.
      add('mask-image: linear-gradient(to bottom, transparent 0, currentColor 40px)')
      // A vertical ramp riding behind a horizontal layer, which is how a fade
      // over a line disguises itself as a fade over the end of a row.
      add(
        'mask-image: linear-gradient(to right, transparent, black 28px),' +
          ' linear-gradient(to bottom, transparent, black 40px)',
      )
      // The other vertical direction, whose ramp is measured from the *bottom*
      // of the box even though its offset is the first one in the gradient.
      add('mask-image: linear-gradient(to top, transparent, black 40px)')
      // A mask this reader cannot measure, which must be said rather than skipped.
      add('mask-image: radial-gradient(circle, black 40%, transparent 70%)')
      /*
       * A ramp driven by a custom property nobody registered — the shape US-15's
       * fix depends on *not* being, and the one whose two halves sit in different
       * rules. The ramp itself is comfortably under the line box, so this probe can
       * only be reported for the reason it exists.
       */
      add(
        '--fondu-non-enregistre: 4px;' +
          ' mask-image: linear-gradient(to bottom, transparent, black var(--fondu-non-enregistre));' +
          ' transition: --fondu-non-enregistre 150ms',
      )
      // And the three that must stay silent: the horizontal exemption, a
      // vertical ramp comfortably under its line box, and a ramp expressed as a
      // share of the box, which is a different design and is counted rather than
      // guessed at.
      add('-webkit-mask-image: linear-gradient(to right, transparent, black 40px)')
      add('mask-image: linear-gradient(to bottom, transparent, black 4px)')
      add('mask-image: linear-gradient(to bottom, transparent, black 20%)')
    })
    /*
     * `settled` and not only a fixed wait. Every ramp in the product is now a
     * *transitioning* length, and a computed value read mid-transition is the same
     * false measurement `--contrast` and `settled` were both written about — this
     * would have read a growing ramp as a short one. The 120 ms is kept for the
     * line box, which needs a layout rather than an animation to be finished.
     */
    await page.waitForTimeout(120)
    await settled(page)
  }

  /*
   * After `document.fonts.ready` for the reason the check itself is about: the
   * thing it compares a fade against is a *line box*, and a line box is a
   * different number before the webfont lands.
   */
  let faded = { items: [], seen: 0, measured: 0, horizontal: 0, textless: 0, shares: 0, unreadable: [] }
  if (flags.fade) {
    await page.evaluate(() => document.fonts.ready)
    faded = await fades(page)
  }

  let unnamed = []
  let ladder = { body: null, top: null, step: null }
  if (flags.a11y) {
    await page.evaluate(() => document.fonts.ready)
    const tree = await a11y(page)
    unnamed = tree.problems
    ladder = tree.ladder
  }

  /*
   * Before `--expand` for the same reason `--scrollers` is: the expansion
   * injects rules of its own, and a check that runs after it is measuring the
   * harness rather than the product.
   */
  /*
   * **The check's own self-test, kept rather than thrown away.**
   *
   * `--motion` has now shipped with six blind spots across two rounds, and every
   * one of them was found by injecting something. Re-running the attack is how
   * anyone touching `motion()` finds out whether they have re-opened one, and a
   * check this repo cannot re-break on demand is a check it has to take on trust.
   *
   *   SILLAGE_MOTION_ATTACK=1 node scripts/harness/shot.mjs <stage> \
   *     /dev/null --no-png --motion
   *
   * must exit **10** on every stage, and it now also exits **11** — with the
   * probe named — if any one of its nine attacks provoked nothing. It exited 0 on
   * all five widget stages for a round, which is the finding below.
   */
  if (process.env.SILLAGE_MOTION_ATTACK) {
    /*
     * **It creates the elements it attacks**, which is the difference between a
     * self-test and a self-test that happens to work on one renderer.
     *
     * It used to target `#root h1` and `#root h2::after`. The widget renderer has
     * neither — measured, its entire tag set is `button div p path span svg` — so
     * on `widget-sortie`, `widget-ouvert`, `widget-refus`, `widget-arret` and
     * `widget-replay` the injected CSS matched nothing, the check reported a clean
     * page and the run exited 0. The stage where the exit animation this rule was
     * written for actually lives was the one stage the attack could not reach.
     *
     * Nine probes that must fire and one that must not, each aimed at a hole the
     * rule has had — and **every one of them asserted by the name of the element it
     * created**, because a count cannot say which shape stopped being seen:
     *
     *   1. a literal 777 ms duration                    → `offToken`
     *   2. a `steps(9)` curve in `animation-timing-function`, which a check
     *      reading `transition-timing-function` cannot see → `offCurve`
     *   3. a transition on a `::after`, out of reach of `querySelectorAll`
     *   4. five departures on an arrival curve: a **child** of the leaving
     *      element (the class name says nothing), a **`@keyframes`** exit (neither
     *      half of the old rule could see inside one), a **`to`-only `@keyframes`**
     *      (the census read declaration order and saw no exit at all), and an
     *      **`<svg>`** (whose `className.toString()` is the literal
     *      `"[object SVGAnimatedString]"`), and one whose endpoint and motion sit in
     *      **two rules** — which is how almost everyone writes a state-class exit, and
     *      which every one of the other probes hid by declaring the pair in one block
     *   5. a looping animation **on its own element and on a literal duration**,
     *      which `prefers-reduced-motion` cannot collapse. It had neither: it rode
     *      on probe 1's element, and `persisting.length > 0` was satisfied by that
     *      element's 777 ms *transition* — so deleting `infinite` from the attack
     *      left the self-test reporting « les cinq attaques signalées » with no
     *      infinite animation anywhere on the page. Measured. A token duration
     *      cannot serve here either: `var(--motion)` is `0ms` there, which is the
     *      correct behaviour and the opposite of what this probe must provoke.
     *   6. and one that must stay **silent**: an element wearing Tailwind's own
     *      `ease-out` utility (`tailwind.config.js:165`) while genuinely
     *      arriving. The first version of the direction rule read the class name
     *      and matched `out` as a word, so `className="transition ease-out"`
     *      would have been reported as a departure on the arrival curve — a false
     *      positive one keystroke from any component in the product. A check that
     *      can only fail loudly cannot prove it does not fire, so this probe is
     *      asserted the other way round.
     *
     * The curve on the five departures is `cubic-bezier(0.22, 1, 0.36, 0.99)` —
     * the near-identical respelling of `--ease-out` that defeated the token
     * comparison, measured at 0.768 / 0.278 / 0.018 opacity on the shipped
     * element, which is the same blink. So the attack proves the *shape* rule and
     * not the string one.
     *
     * A harness-only development override, which is what `process.env` is for
     * here — DEC-34 is about the *app* requiring none, and nothing in `electron/`
     * or `src/` reads this.
     */
    await page.addStyleTag({ content: `
      @keyframes sillage-attack-spin { from { opacity: 1 } to { opacity: .5 } }
      @keyframes sillage-attack-leave { from { opacity: 1 } to { opacity: 0 } }
      /* Probe 7: the whole fade in one \`to\`, which is what the census used to
         read as no fade at all. No \`opacity: 0\` in any style rule and no inline
         style, so the keyframes census is the only signal that can find it. */
      @keyframes sillage-attack-to-only { to { opacity: 0 } }
      #sillage-attack-litteral {
        animation: sillage-attack-spin var(--motion) steps(9) infinite !important;
        transition: opacity 777ms linear !important }
      #sillage-attack-litteral::after { content:"[X]"; display:inline-block;
        transition: opacity 777ms linear !important }
      /* Probe 5 on its own element and on a **literal** duration, which is the
         whole point of it: \`var(--motion)\` is \`0ms\` under reduced motion, so an
         infinite animation wearing the token contributes nothing to \`persisting\`
         and the probe was reading probe 1's 777 ms transition instead. */
      #sillage-attack-infini {
        animation: sillage-attack-spin 1200ms linear infinite !important }
      .sillage-attack-leaving > * {
        opacity: 0;
        transition: opacity var(--motion) cubic-bezier(0.22, 1, 0.36, 0.99) !important }
      #sillage-attack-keyframe {
        animation: sillage-attack-leave var(--motion) cubic-bezier(0.22, 1, 0.36, 0.99) forwards !important }
      #sillage-attack-to {
        animation: sillage-attack-to-only var(--motion) cubic-bezier(0.22, 1, 0.36, 0.99) forwards !important }
      #sillage-attack-svg {
        opacity: 0;
        transition: opacity var(--motion) cubic-bezier(0.22, 1, 0.36, 0.99) !important }
      /* Probe 8: the endpoint and the motion in **two** rules, which is the most
         ordinary way to write a state-class exit and the spelling that defeated the
         « same declaration block » discriminator. No keyframes, no inline style. */
      #sillage-attack-scinde {
        transition: opacity var(--motion) cubic-bezier(0.22, 1, 0.36, 0.99) !important }
      .sillage-attack-parti { opacity: 0 }
      /* Probe 9: the endpoint **inline** and the motion in a class — the split-rule
         spelling one level over, which the inline branch demanded in one place. */
      #sillage-attack-inline {
        transition: opacity var(--motion) cubic-bezier(0.22, 1, 0.36, 0.99) !important }
      /* Probe 10: a departure on an element that also has an ordinary hover *dim*. Any
         non-zero opacity under a state used to excuse a departure outright. */
      #sillage-attack-dim { opacity: 0;
        transition: opacity var(--motion) cubic-bezier(0.22, 1, 0.36, 0.99) !important }
      #sillage-attack-dim:hover { opacity: .85 }
      /* Probe 11, the second that must stay **silent**: a reveal gated on a class rather
         than on a pseudo-class, which is how anything driven by JavaScript is written.
         Reported as a departure for a round, on correct code. */
      #sillage-attack-revele { opacity: 0;
        transition: opacity var(--motion) var(--ease-out) !important }
      #sillage-attack-revele.sillage-attack-visible { opacity: 1 }
      /* Probe 6, the one that must stay silent: arriving, on the arrival curve,
         wearing the word that used to be read as « leaving ». */
      #sillage-attack-arrivee {
        transition: opacity var(--motion) var(--ease-out) !important }
      /* Probe 12, the third that must stay **silent**: DEC-50's arrival, in the
         shape the product now ships it — a \`from { opacity: 0 }\` keyframes on an
         overshoot curve. It is the first element in this product whose curve is
         neither \`--ease-out\` nor \`--ease-in\`, and it starts fully transparent, so
         it sits on both of the census's tripwires at once. A tightening that made
         it a « départ à contresens » would be a false positive on the one surface
         DEC-50 exists for, and a check people work around is gone. */
      @keyframes sillage-attack-entree { from { opacity: 0; scale: .92 } to { opacity: 1; scale: 1 } }
      #sillage-attack-entree {
        animation: sillage-attack-entree var(--motion) var(--ease-overshoot) both !important }
    ` })
    await page.evaluate(() => {
      const root = document.querySelector('#root')
      if (!root) throw new Error('SILLAGE_MOTION_ATTACK: pas de #root à attaquer')
      const add = (id, className) => {
        const el = document.createElement('div')
        if (id) el.id = id
        if (className) el.className = className
        el.textContent = '·'
        root.append(el)
        return el
      }
      add('sillage-attack-litteral')
      add('sillage-attack-infini')
      // The child carries the fade; the parent carries only the marker, which is
      // exactly the shape that made the class-name rule blind. Its own class says
      // `enfant` and never `leaving`, so naming it in the assertion below costs the
      // probe nothing — what it proves is that the *selector* found it.
      const parent = add(null, 'sillage-attack-leaving')
      const child = document.createElement('span')
      child.className = 'sillage-attack-enfant'
      parent.append(child)
      add('sillage-attack-keyframe')
      add('sillage-attack-to')
      add('sillage-attack-scinde', 'sillage-attack-parti')
      add('sillage-attack-dim')
      add('sillage-attack-revele')
      // The endpoint written where no stylesheet declares it.
      add('sillage-attack-inline').style.opacity = '0'
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.id = 'sillage-attack-svg'
      svg.setAttribute('width', '8')
      svg.setAttribute('height', '8')
      root.append(svg)
      // `ease-out` is the class, not the token: Tailwind ships it and it is what
      // a component arriving is written with.
      add('sillage-attack-arrivee', 'transition ease-out duration-150')
      add('sillage-attack-entree')
    })
    await page.waitForTimeout(120)
  }
  let motionOff = { undeclared: [], backwards: [], persisting: [], seen: 0 }
  if (flags.motion) {
    await page.evaluate(() => document.fonts.ready)
    motionOff = await motion(page)
  }

  /*
   * The app shell never scrolls the document: it is `h-full` with its own inner
   * `overflow-y-auto` columns, so a `fullPage` shot of it is exactly one
   * viewport and everything below an inner fold is lost. On the screens whose
   * point *is* what sits below that fold — the review gate's mail draft and its
   * three intents — the scrollers are unclipped first so the page itself grows
   * and `fullPage` means what it says. Width, type and layout are unchanged;
   * only the clipping is.
   */
  if (flags.expand ?? plan.expand) {
    await page.addStyleTag({
      content: `
        html, body, #root { height: auto !important; overflow: visible !important; }
        .h-full { height: auto !important; }
        /* The screen shells and the inner scrollers — never the rounded
           List, whose own overflow-hidden is what draws its corners. */
        .h-full.overflow-hidden, .overflow-y-auto, .overflow-auto { overflow: visible !important; }
        .max-h-72 { max-height: none !important; }
        /* Chromium 123+: a textarea that grows to its content, so the mail
           draft is read rather than scrolled past. */
        textarea { field-sizing: content !important; }
      `,
    })
    await page.waitForTimeout(150)
  }

  // Fonts and the last paint. `document.fonts.ready` is what stops a shot from
  // catching Fraunces mid-swap.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)

  let out = null
  if (flags.png) {
    out = path.resolve(outfile)
    await page.screenshot({ path: out, fullPage: true })
  }

  const unanswered = await page.evaluate(() => window.__harness?.unanswered ?? [])
  const rendered = page.viewportSize()
  await browser.close()

  /*
   * Read back from the page, never from the request. A caption is a measurement
   * like any other — see the viewport restoration above for what this cost.
   */
  const size = rendered
    ? `${rendered.width}×${rendered.height}`
    : `${flags.viewport.width}×${flags.viewport.height}`
  console.log(out ? `✓ ${screen} ${size} → ${out}` : `✓ ${screen} ${size}`)
  if (findings) report(findings, flags.scan, screen, flags.viewport)
  if (flags.scrollers) {
    if (inner.length === 0) console.log('  ascenseurs: rien de caché dans une boîte interne')
    else {
      console.log(`  ✗ ascenseurs: ${inner.length} boîte(s) cachent du contenu`)
      for (const item of inner.slice(0, 8)) {
        console.log(`     ${item.what} — ${item.hidden}px cachés en ${item.axis} (boîte ${item.box}px)`)
      }
      /*
       * **This was the one of the six that never set an exit code.**
       *
       * `smoke.mjs` fails on a non-zero exit and on nothing else, so every
       * finding this check has ever made was printed into a run that passed —
       * ninety-two stagings of « ✓ » over a box hiding 95% of a transcript. It
       * was written to end exactly that failure on the review gate's textareas,
       * and it could only ever have been read by a human looking at the right
       * two lines of output.
       */
      process.exitCode = 9
    }
  }
  if (flags.fade) {
    /*
     * **The census, and why a check prints one.**
     *
     * `--fade` used to print « fondus: aucun ne couvre une ligne entière » and
     * nothing else, so a run that visited **zero** masks — or one that visited
     * two and could parse neither — read exactly like a run that measured every
     * ramp in the product. That is the third instance of the shape CLAUDE.md
     * records for `--scrollers` (scoped to landmarks *Historique* does not have,
     * so it visited nothing and said « rien de caché ») and for `--contrast`
     * (reusing `drawn()`, so it measured nothing and reported green). `--motion`
     * had already learned it: it prints `${seen} élément(s) animé(s)`, and a
     * silent zero there cannot pass for evidence.
     *
     * So: how many masks were visited, how many vertical ramps were actually
     * measured, how many layers were exempted for running along the other axis,
     * and how many ramps were left unmeasured because they are a share of the
     * box rather than a distance. An unreadable mask is not in that list — it is
     * a finding below, because it is exactly where a defect would hide.
     */
    const census =
      `${faded.seen} masque(s) vus, ${faded.measured} rampe(s) verticale(s) mesurée(s), ` +
      `${faded.horizontal} couche(s) sur l'autre axe exemptée(s), ` +
      `${faded.registered} propriété(s) enregistrée(s)` +
      (faded.textless > 0 ? `, ${faded.textless} sans texte` : '') +
      (faded.shares > 0 ? `, ${faded.shares} en pourcentage de la boîte` : '')
    if (faded.items.length === 0 && faded.unreadable.length === 0 && faded.discrete.length === 0) {
      console.log(`  fondus: ${census} — aucune ne couvre une ligne entière, aucune ne saute`)
    } else {
      console.log(`  fondus: ${census}`)
      if (faded.items.length > 0) {
        console.log(`  ✗ fondus: ${faded.items.length} rampe(s) peuvent effacer une ligne entière`)
        for (const item of faded.items.slice(0, 8)) {
          console.log(
            `     ${item.what} (${item.edge}) — fondu ${item.fade}px sur une ligne de ${item.line}px` +
              ` (alpha ${item.alpha} au haut des capitales) — « ${item.text} »`,
          )
        }
      }
      if (faded.unreadable.length > 0) {
        console.log(
          `  ✗ fondus: ${faded.unreadable.length} masque(s) que la mesure ne sait pas lire` +
            ` — c'est là qu'un fondu trop long passerait`,
        )
        for (const item of faded.unreadable.slice(0, 8)) {
          console.log(`     ${item.what} — ${item.mask}`)
        }
      }
      if (faded.discrete.length > 0) {
        console.log(
          `  ✗ fondus: ${faded.discrete.length} masque(s) dont la rampe est animée par une ` +
            'propriété non enregistrée — la transition est déclarée et le fondu saute quand même',
        )
        for (const item of faded.discrete.slice(0, 8)) {
          console.log(`     ${item.what} — ${item.properties.join(', ')} sans @property`)
        }
      }
      process.exitCode = 11
    }
  }
  if (flags.contrast) {
    if (dim.length === 0) {
      /*
       * **The count is in the sentence, and this is not decoration.**
       *
       * « contraste: texte AA » was printed over *one* measured element on the
       * onboarding screen and over twelve on the same screen after the ground
       * walk learned the grain — the same eleven words either way. A check that
       * visited almost nothing must not be able to say what a check that
       * visited everything says.
       */
      console.log(
        `  contraste: ${textRuns} passage(s) de texte AA, ${graphics} graphique(s) à 3:1` +
          (graphics === 0 ? ' — aucun élément ne s’est déclaré `data-graphic`' : '') +
          (undeclaredGraphics > 0 ? `, ${undeclaredGraphics} marque(s) non déclarée(s)` : '') +
          (grainTile !== null ? ` · grain ${grainTile}, noir ${grainAlpha}/255` : ''),
      )
    }
    else {
      console.log(`  ✗ contraste: ${dim.length} élément(s) sous le seuil sur ${textRuns} mesuré(s)`)
      for (const item of dim.slice(0, 8)) {
        console.log(`   ✗ ${item.ratio}:1 (min ${item.need}) — « ${item.text} » ${item.fg} sur ${item.bg}`)
      }
      process.exitCode = 8
    }

    /**
     * **The grain binds now, and for several rounds it was computed, printed and
     * bound nothing.**
     *
     * The number was right and the sentence carrying it was green: « N
     * passage(s) dont la marge AA tient dans le grain ». 138 text runs across
     * the sweep clear AA against their design colour — `--text-muted` at 11–12px
     * on `--bg-canvas`, **4.83:1** — and do not clear it against the ground the
     * tile actually paints, **4.46:1** against a 4.5 floor. An instrument that
     * sees a WCAG failure every run and files it as information is the shape
     * this file has now produced four times.
     *
     * **The judgement call, settled by measuring the tile rather than by
     * arguing about textures.** The paragraph this replaces refused to fail on
     * the darkest pixel because « only a quarter of the tile is at the darkest
     * level and a 12px glyph covers dozens of tile pixels » — an argument about
     * *area*, where the question is *reachability*. The tile repeats at its
     * intrinsic size, so one tile pixel is one CSS pixel; decoded and swept for
     * the darkest window of each shape, on the torus the repeat makes:
     *
     *     1×1  9.000     1×6  8.500     2×8  7.313     6×6  6.333
     *     1×2  9.000     1×8  7.875     3×8  6.750     8×8  5.813
     *     1×4  9.000     2×6  7.500     4×4  7.313
     *
     * A **1×4 run of the darkest level exists** — one CSS pixel wide, four tall.
     * A 12px Inter stem is about 1.2px wide, so a quarter of a lowercase letter
     * can sit entirely on alpha 9. The darkest level is not a scatter of
     * isolated pixels a glyph averages away; it forms runs the size of the
     * feature a reader resolves. So the minimum is the statistic, not a
     * percentile, and it is reachable rather than theoretical.
     *
     * A percentile was the alternative and it is rejected with the same table: the
     * `1×8` mean (7.875) is what a *whole* stem sits on and would pass the shipped
     * palette at 4.52:1, which is an answer about a letter nobody reads one stem of.
     *
     * It fails on the **margin**, never on the run twice: a run already reported
     * under `dim` is below AA on its own colour and is a worse finding than this
     * one.
     */
    if (grainEaten > 0) {
      console.log(
        `  ✗ contraste: ${grainEaten} passage(s) sous AA une fois le grain peint — ` +
          `${grainWorst.clear}:1 sur la couleur déclarée, ${grainWorst.under}:1 sous le ` +
          `pixel le plus sombre du grain (seuil ${grainWorst.need}), « ${grainWorst.text} »`,
      )
      process.exitCode = 18
    }

    /*
     * **The grain has to be decodable.** `.grain` paints a texture over a
     * colour, so a tile this cannot read is a ground it is measuring as if the
     * texture were not there — the silent-widening failure the ground walk was
     * rewritten to end. Only said where the screen actually paints one.
     */
    if (grainAlpha === null && grainPainted > 0) {
      console.log(
        `  ✗ contraste: le grain est peint sur ${grainPainted} fond(s) et n’a pas pu être ` +
          'décodé — la mesure porte sur la couleur nue, pas sur ce qui est à l’écran',
      )
      process.exitCode = 18
    }

    /*
     * **An abstention is a finding.** The ground walk returning `null` used to
     * be a silent `continue`, and that is how a single `background-image` on the
     * app root took 92% of the onboarding's text out of the check while the line
     * above stayed green. Whatever cannot be computed has to be declared with
     * `data-ground`, naming the colour the ink was designed against.
     */
    if (unmeasuredGrounds.length > 0) {
      console.log(
        `  ✗ contraste: ${unmeasuredRuns} passage(s) de texte sur un fond non calculable, ` +
          `${unmeasuredGrounds.length} élément(s) en cause — déclarez-le avec \`data-ground\``,
      )
      for (const item of unmeasuredGrounds.slice(0, 6)) {
        console.log(`     ${item.what} — ${item.image} — près de « ${item.text} »`)
      }
      process.exitCode = 8
    }
  }
  if (flags.motion) {
    const { undeclared, backwards, persisting, seen, departures, unreadable, declared } = motionOff
    if (undeclared.length === 0 && backwards.length === 0 && persisting.length === 0) {
      console.log(
        `  mouvement: ${seen} élément(s) animé(s) dont ${departures} qui s’en vont, tous par ` +
          'les jetons, dans le bon sens, tous muets sous prefers-reduced-motion ' +
          `(${declared.selectors} sélecteur(s) « opacity: 0 », ${declared.reveals} règle(s) ` +
          `qui la rendent sous un état, ${declared.keyframes} @keyframes de sortie` +
          `${unreadable > 0 ? `, ${unreadable} feuille(s) illisible(s)` : ''})`,
      )
    } else {
      if (undeclared.length > 0) {
        console.log(`  ✗ mouvement: ${undeclared.length} élément(s) hors jetons`)
        for (const item of undeclared.slice(0, 8)) {
          console.log(`     ${item.what} — ${item.dur} / ${item.ease}`)
        }
      }
      if (backwards.length > 0) {
        console.log(
          `  ✗ mouvement à contresens: ${backwards.length} élément(s) qui s’en vont ` +
            'portent une courbe d’arrivée',
        )
        for (const item of backwards.slice(0, 8)) {
          console.log(
            `     ${item.what} — ${item.dur} / ${item.wrongWay} : part moyenne du changement ` +
              `déjà faite ${item.share} % (une courbe de sortie est sous 50 % — --ease-in mesure 17 %, ` +
              '--ease-out 83 %)',
          )
        }
      }
      if (persisting.length > 0) {
        console.log(
          `  ✗ mouvement réduit: ${persisting.length} élément(s) bougent encore malgré prefers-reduced-motion`,
        )
        for (const item of persisting.slice(0, 8)) {
          console.log(`     ${item.what} — ${item.dur}`)
        }
      }
      process.exitCode = 10
    }
    /*
     * **The self-test says whether it measured anything, which is the whole
     * reason it exists.**
     *
     * `SILLAGE_MOTION_ATTACK` injected rules targeting `#root h1` and
     * `#root h2::after`, and the widget renderer has **no `h1` and no `h2`** —
     * measured, its whole tag set is `button div p path span svg`. So the attack
     * matched nothing on all five widget stages, `--motion` correctly reported a
     * clean page, and the run exited **0**: « a check that measures nothing while
     * reporting green », applied to the self-test of the check written to end
     * exactly that. Fifth instance of the shape in this repo.
     *
     * The attacks below are aimed at elements the injection creates itself, so
     * they land on any renderer — but the fix is not the aim, it is this: the
     * attack now states what each of its five probes must provoke and fails the
     * run when one of them provokes nothing. An attack that stops working can no
     * longer pass.
     */
    if (process.env.SILLAGE_MOTION_ATTACK) {
      const missed = [
        [undeclared.length > 0, 'une durée littérale (777 ms) hors jetons'],
        [
          undeclared.some((m) => m.ease.includes('steps')),
          'une courbe dans animation-timing-function (steps(9)), invisible à transition-timing-function',
        ],
        [
          undeclared.some((m) => m.what.includes('::after')),
          'une transition sur un ::after, hors de portée de querySelectorAll',
        ],
        /*
         * **Each departure named, because a count could not say which shape stopped
         * being seen.** It was `backwards.length >= 3`, and the three shapes are the
         * three holes the direction rule has had: any one of them going quiet while
         * another over-reported held the threshold. The `to`-only keyframes is the
         * fourth and is the one the census used to miss entirely.
         */
        [
          backwards.some((m) => m.what.includes('sillage-attack-enfant')),
          'un départ déclaré sur l’enfant de l’élément qui part (le nom de classe ne dit rien)',
        ],
        [
          backwards.some((m) => m.what.includes('sillage-attack-keyframe')),
          'un départ écrit dans un @keyframes from/to',
        ],
        [
          backwards.some((m) => m.what.includes('sillage-attack-to')),
          'un départ écrit dans un @keyframes n’ayant qu’un « to » — le recensement lisait ' +
            'l’ordre de déclaration et n’y voyait aucune sortie',
        ],
        [
          backwards.some((m) => m.what.includes('sillage-attack-svg')),
          'un départ sur un <svg>, dont className.toString() est « [object SVGAnimatedString] »',
        ],
        [
          backwards.some((m) => m.what.includes('sillage-attack-scinde')),
          'un départ dont le point d’arrivée et le mouvement sont dans deux règles ' +
            'séparées — la façon la plus banale d’écrire une sortie par classe d’état',
        ],
        [
          backwards.some((m) => m.what.includes('sillage-attack-inline')),
          'un départ dont le point d’arrivée est en style inline et le mouvement dans ' +
            'une classe — la même scission, un niveau plus bas',
        ],
        [
          backwards.some((m) => m.what.includes('sillage-attack-dim')),
          'un départ sur un élément qui a par ailleurs un simple assombrissement au ' +
            'survol — n’importe quelle opacité non nulle sous un état l’exemptait',
        ],
        /*
         * **On its own element, named, and described by what `persisting` can
         * actually measure.**
         *
         * It was `persisting.length > 0` with the animation riding on probe 1's
         * element — and that element also carries a literal `777ms` *transition*,
         * which survives reduced motion for reasons that have nothing to do with this
         * probe. So deleting `infinite` from the attack outright left the self-test
         * reporting « les cinq attaques signalées » with no infinite animation
         * anywhere on the page. Measured.
         *
         * And the probe's own claim was loose: `persisting` is built from
         * `animation-duration` and `transition-duration`, so it measures a duration
         * the media query failed to collapse, never an element observed in motion —
         * removing `infinite` from *this* element still leaves `1200ms` declared and
         * still, correctly, a finding. `infinite` stays because it is the shape the
         * rule is about; what the probe asserts is the literal duration, which is the
         * thing `prefers-reduced-motion` cannot reach. A token duration cannot serve:
         * `var(--motion)` is `0ms` there, which is the whole point of the token.
         */
        [
          persisting.some((m) => m.what.includes('sillage-attack-infini')),
          'une animation en boucle sur une durée littérale (1200 ms), que ' +
            'prefers-reduced-motion ne peut pas réduire',
        ],
        /*
         * The silent one, asserted as an absence. `#sillage-attack-arrivee` wears
         * `transition ease-out duration-150` and is arriving: nothing about it is
         * a finding, and the moment it becomes one the rule has re-acquired the
         * false positive that shipped with its first version.
         */
        [
          !backwards.some((m) => m.what.includes('sillage-attack-arrivee')),
          'RIEN — la classe Tailwind « ease-out » sur un élément qui arrive a été signalée ' +
            'comme un départ (faux positif)',
        ],
        /*
         * The second silent one. `#sillage-attack-revele` rests at `opacity: 0` and is
         * revealed by a *class*, which is how a JavaScript-driven reveal is written — and
         * it was reported as a departure on an arrival curve for a round. A false positive
         * here is worse than the hole, because a check people work around is gone.
         */
        [
          !backwards.some((m) => m.what.includes('sillage-attack-revele')),
          'RIEN — une révélation conditionnée par une classe (et non par un pseudo-état) ' +
            'a été signalée comme un départ (faux positif)',
        ],
        /*
         * The third silent one, and the newest: DEC-50's arrival as the product
         * ships it. `from { opacity: 0 }` on `--ease-overshoot` — fully transparent
         * at one end and on the only curve in `:root` that is neither of the two
         * this rule was built around. Nothing about it is a finding, in either
         * direction: not a departure (the progression ends *less* transparent) and
         * not off-token (the curve is declared). The moment it becomes one, the
         * rule has acquired a false positive on the one surface the decision exists
         * for.
         */
        [
          !backwards.some((m) => m.what.includes('sillage-attack-entree')) &&
            !undeclared.some((m) => m.what.includes('sillage-attack-entree')),
          'RIEN — une arrivée écrite en @keyframes depuis opacity 0, sur la courbe à ' +
            'dépassement, a été signalée (faux positif sur la surface même de DEC-50)',
        ],
      ]
        .filter(([held]) => !held)
        .map(([, what]) => what)
      if (missed.length > 0) {
        console.log(
          `  ✗ auto-test du mouvement: ${missed.length} attaque(s) n’ont rien provoqué — ` +
            'la vérification ne mesure pas ce qu’elle prétend mesurer sur cette mise en scène',
        )
        for (const what of missed) console.log(`     jamais signalé : ${what}`)
        process.exitCode = 11
      } else {
        console.log(
          '  auto-test du mouvement: les douze attaques signalées, les trois dernières restées muettes',
        )
      }
    }
  }
  if (flags.a11y) {
    const rung =
      ladder.top === null
        ? ladder.body === null
          ? 'aucune prose à mesurer'
          : `pas de h1, prose à ${ladder.body}px`
        : `titre ${ladder.top}px sur prose ${ladder.body}px (${ladder.step}×)`
    if (unnamed.length === 0) console.log(`  arbre: chaque contrôle a un nom, ${rung}`)
    else {
      console.log(`  ✗ arbre: ${unnamed.length} problème(s)`)
      for (const item of unnamed.slice(0, 8)) console.log(`   ✗ ${item.why} — ${item.what}`)
      process.exitCode = 7
    }
  }
  if (flags.prose) {
    if (long.length === 0) console.log('  mesure: aucune ligne au-delà de 75 caractères')
    else {
      console.log(`  ✗ mesure: ${long.length} surface(s) au-delà de 75 caractères`)
      for (const item of long.slice(0, 8)) {
        console.log(
          `   ✗ ${item.chars} car./ligne — ${item.what} (${item.size}, ${item.box}px) ` +
            `« ${item.text}… »`,
        )
      }
      process.exitCode = 6
    }
  }
  if (flags.echo) {
    /*
     * **A stage this file does not know fails, and it fails on every run.**
     *
     * `check:ports`' `HOMES` named a preload that has never existed, so its own
     * exclusion excluded nothing and the sentence a failure printed pointed at a file
     * nobody could open. A declared stage is a fact about `SCREENS`, so it is checked
     * against `SCREENS` — here rather than inside the per-stage branch below, because
     * a typo must not wait for the one run that happens to stage it.
     */
    const unknown = ECHO_DECLARED.flatMap((entry) =>
      entry.stages.filter((name) => !(name in SCREENS)).map((name) => ({ name, text: entry.text })),
    )
    if (unknown.length > 0) {
      console.log(
        `  ✗ échos: ${unknown.length} écho(s) déclaré(s) nomment une mise en scène inconnue`,
      )
      for (const item of unknown.slice(0, 8)) {
        console.log(`     « ${item.text} » sur « ${item.name} », qui n’est pas dans SCREENS`)
      }
      process.exitCode = 14
    }

    const declared = ECHO_DECLARED.filter((entry) => entry.stages.includes(screen))
    const allowed = new Set(declared.map((entry) => entry.text))
    const undeclared = repeats.items.filter((item) => !allowed.has(item.text))
    /*
     * **The half that matters: an allowance that no longer has a finding fails.**
     *
     * Without it the list is a blanket exemption that grows and never shrinks, which
     * is the rot `check-platform.mjs` records as the reason its own staleness check
     * exists. Every entry here names a story; when that story lands, this is what
     * tells whoever landed it to delete the entry.
     */
    const stale = declared.filter((entry) => !repeats.items.some((item) => item.text === entry.text))

    /*
     * The census, for the reason `--fade` prints one: a run that visited zero
     * elements has to read differently from a run that compared every string on
     * the screen. « aucune chaîne dessinée deux fois » over an empty set is the
     * false green this repo has recorded five times. The declared count is part of
     * it — a screen that is quiet because everything on it is excused must not read
     * like a screen that is quiet.
     */
    const census =
      `${repeats.seen} chaîne(s) comparée(s), ${repeats.column} colonne(s), ` +
      `${repeats.named} contrôle(s) qui nomment leur cible` +
      (declared.length > 0 ? `, ${declared.length} écho(s) déclaré(s)` : '')
    if (undeclared.length === 0) {
      console.log(`  échos: ${census} — aucune chaîne dessinée deux fois hors déclaration`)
    } else {
      console.log(`  ✗ échos: ${undeclared.length} chaîne(s) dessinée(s) plus d’une fois (${census})`)
      for (const item of undeclared.slice(0, 8)) {
        console.log(`     « ${item.text.slice(0, 60)} » ×${item.times} — ${item.where.join(' · ')}`)
      }
      process.exitCode = 12
    }
    if (stale.length > 0) {
      console.log(
        `  ✗ échos: ${stale.length} écho(s) déclaré(s) ne se répètent plus — ` +
          'une dispense qui a survécu à son constat, à supprimer',
      )
      for (const entry of stale.slice(0, 8)) {
        console.log(`     « ${entry.text} » sur « ${screen} » — ${entry.story}`)
      }
      process.exitCode = 14
    }
    if (process.env.SILLAGE_ECHO_ATTACK) {
      const found = (needle) => repeats.items.some((item) => item.text.includes(needle))
      const missed = [
        [found('compte-rendu part chez veryswing'), 'une phrase dessinée dans deux éléments différents'],
        [
          found('jeudi 9 avril'),
          'un doublon que seul le repli de casse peut voir (text-transform: uppercase ' +
            'd’un côté, un point final de l’autre) — la forme exacte du défaut de l’écran d’accueil',
        ],
        [found('sonaverre industrie'), 'une cellule de liste répétée par un titre hors liste'],
        [
          found('brumaire 2031'),
          'un titre de page qui répète la valeur d’un pagineur (h1 contre h2) — ' +
            'la paire que US-22 a créée et que --echo a trouvée sur agenda-hors-fenetre',
        ],
        /*
         * The seven silent ones, asserted the other way round. A check that can only
         * fail loudly cannot prove it does not fire, and a false positive here is
         * worse than a hole: a repeated control label is on every list in the
         * product, so a check that reported one would be worked around and gone.
         */
        [
          !found('rouvrir l’appel'),
          'RIEN — le même libellé de contrôle sur cinq lignes, réparties sur deux listes, ' +
            'a été signalé (faux positif : c’est la forme de l’écran d’accueil)',
        ],
        [
          !found('rien n’a été envoyé'),
          'RIEN — une colonne de prose répétée ligne par ligne, hors <li>, a été signalée ' +
            '(faux positif) ; aucune liste de libellés autorisés ne l’aurait couverte',
        ],
        [
          !found('envoi interrompu'),
          'RIEN — deux cellules d’une liste dont les classes diffèrent parce que la ' +
            'ligne diffère ont été signalées (faux positif mesuré : dix-sept fois la ' +
            'même réplique sur review-transcription)',
        ],
        [
          !found('cadrage support n2'),
          'RIEN — un contrôle qui nomme sa cible a été signalé (faux positif : c’est ' +
            '« ‹ Calendrier », la nav de Réglages et une puce de filtre)',
        ],
        [!found('07:42'), 'RIEN — une heure dessinée deux fois a été signalée (faux positif)'],
        [
          !found('pour les lecteurs d’écran'),
          'RIEN — un second exemplaire dans une boîte sr-only de 1×1 a été compté ' +
            'comme dessiné (faux positif)',
        ],
        [
          !found('n’est pas dessiné'),
          'RIEN — un second exemplaire en display:none a été compté comme dessiné (faux positif)',
        ],
        /*
         * And the declared blind spot, asserted as the absence it is. This is not a
         * property being defended: it is exemption 1's cost, kept visible so that a
         * later tightening cannot be made without re-measuring « Rouvrir l’appel »
         * above — the two move together, and the reasoning is in `echo()`'s docblock.
         */
        [
          !found('deux fois la même balise'),
          'RIEN — angle mort déclaré : deux éléments de même balise qui disent la même ' +
            'chose à deux endroits sans rapport (resserrer ceci coûte les deux probes ci-dessus)',
        ],
      ]
        .filter(([held]) => !held)
        .map(([, what]) => what)
      if (missed.length > 0) {
        console.log(
          `  ✗ auto-test des échos: ${missed.length} attaque(s) n’ont rien provoqué — ` +
            'la vérification ne mesure pas ce qu’elle prétend mesurer sur cette mise en scène',
        )
        for (const what of missed) console.log(`     jamais signalé : ${what}`)
        process.exitCode = 13
      } else {
        console.log(
          '  auto-test des échos: les quatre attaques signalées, les huit dernières restées muettes',
        )
      }
    }
  }
  if (flags.targets) {
    if (small.length === 0) console.log('  cibles: toutes ≥ 24 px')
    else {
      console.log(`  ✗ cibles: ${small.length} contrôle(s) sous 24 px`)
      for (const item of small.slice(0, 8)) {
        console.log(`   ✗ ${item.w}×${item.h} — « ${item.text} » (${item.tag})`)
      }
      process.exitCode = 5
    }
  }
  if (flags.geometry) {
    if (clipped.length === 0)
      console.log(
        measured === 0
          ? `  géométrie: aucun marqueur suspendu, ${groups} groupe(s) sans cadre alignés`
          : `  géométrie: ${measured} mesurés, marge la plus courte ${tightest.by}px sur « ${tightest.text} », ${groups} groupe(s) sans cadre alignés`,
      )
    else {
      console.log(`  ✗ géométrie: ${clipped.length} élément(s) hors de leur cadre`)
      for (const item of clipped.slice(0, 8)) {
        console.log(`   ✗ ${item.what} « ${item.text} » — ${item.by}px à gauche du cadre`)
      }
      process.exitCode = 4
    }
    if (inset.length > 0) {
      console.log(
        `  ✗ géométrie: ${inset.length} groupe(s) sans cadre dont le filet dépasse le contenu`,
      )
      for (const item of inset.slice(0, 8)) {
        console.log(`   ✗ ${item.tag} « ${item.text} » — contenu rentré de ${item.by}px sous un filet pleine largeur`)
      }
      process.exitCode = 4
    }
  }
  if (flags.census) {
    /*
     * **The census is printed whether or not it fails**, for `--fade`'s reason:
     * a run that visited zero rounded boxes must not be able to print the same
     * sentence as a run that measured every corner on the screen. The counts are
     * the evidence, and a rung nobody wears is stated rather than inferred —
     * `--radius` (12px) is declared in `tokens.css`, mapped as Tailwind's
     * `rounded` DEFAULT, and worn by **zero** elements across all 82 stages at
     * both sizes, which is the same shape `tailwind.config.js` deleted
     * `shadow-card` for eleven lines above where it declares this one.
     */
    const rungs = counted.worn
      .sort((a, b) => a.value - b.value)
      .map((r) => `${r.name.replace('--radius', 'radius')} ${r.value}px ×${r.n}`)
    const total = (list) => list.reduce((sum, item) => sum + item.n, 0)
    const others = [
      counted.stadiums.length > 0 ? `${total(counted.stadiums)} pastille(s)/puce(s)` : null,
      counted.caps.length > 0
        ? `${total(counted.caps)} embout(s) de barre à ${counted.caps.map((c) => c.value + 'px').join('/')}`
        : null,
    ].filter((entry) => entry !== null)
    console.log(
      `  recensement: ${counted.rounded} boîte(s) arrondie(s) sur ${counted.ladder.length} ` +
        `échelon(s) déclarés — ${rungs.length === 0 ? 'aucun échelon de carte' : rungs.join(', ')}` +
        (others.length > 0 ? `, ${others.join(', ')}` : '') +
        (counted.unworn.length > 0 ? ` · non porté(s) ici : ${counted.unworn.join(', ')}` : '') +
        ` · ${counted.controls.length} hauteur(s) de contrôle décidée(s) par l'auteur` +
        (counted.controls.length > 0
          ? ` (${counted.controls.map((c) => `${c.h}×${c.n}`).join(' ')})`
          : '') +
        ` · ${icons(counted.strokes)}`,
    )

    /*
     * **The ladder has to exist — and « exist » is not « be three ».**
     *
     * This was `< 3`, which is the same defect as the list it guarded: it froze
     * the size of the palette into the instrument, so `--radius` could not be
     * removed from `tokens.css` without turning twelve gates red, and the token
     * `--census` itself reports as worn by nobody was the token `--census` made
     * unremovable — « measured, exit 15 on `review` », in `tokens.css`'s own
     * words, beside the line it could not delete.
     *
     * A ladder that has *shrunk* is a decision; a ladder that is *gone* is a
     * check measuring nothing, and only the second is this guard's business.
     * What catches a rung deleted while classes still wear it is the stray list
     * below, where those corners land the moment they match no rung — driven
     * both ways before this changed.
     */
    if (counted.ladder.length === 0) {
      console.log(
        '  ✗ recensement: aucun échelon --radius* lu dans :root — ' +
          'la mesure n’a pas d’échelle contre laquelle mesurer',
      )
      process.exitCode = 15
    }

    if (counted.stray.length > 0) {
      console.log(`  ✗ recensement: ${counted.stray.length} rayon(s) hors échelle`)
      for (const item of counted.stray.slice(0, 8)) {
        console.log(`     ${item.value} sur ${item.size} — « ${item.near} »`)
      }
      process.exitCode = 15
    }

    /*
     * Two, not one: a 10px control inside a 14px card is concentric radius and
     * is the pattern 102 of the 164 stagings wear. Three is a screen standing
     * on a ladder nobody is climbing.
     */
    if (counted.worn.length > 2) {
      console.log(
        `  ✗ recensement: ${counted.worn.length} échelons de rayon de carte sur un même écran — ` +
          rungs.join(', '),
      )
      for (const item of counted.worn) console.log(`     ${item.value}px — « ${item.near} »`)
      process.exitCode = 15
    }

    if (counted.strokes.length > 1) {
      console.log(`  ✗ recensement: ${counted.strokes.length} épaisseurs de trait d'icône sur un même écran`)
      for (const item of counted.strokes) {
        console.log(`     stroke-width ${item.width} — ${item.count} icône(s), près de « ${item.near} »`)
      }
      process.exitCode = 15
    }

    if (counted.split.length > 0) {
      console.log(
        `  ✗ recensement: ${counted.split.length} composant(s) dessiné(s) à deux hauteurs sur un même écran`,
      )
      for (const item of counted.split.slice(0, 8)) {
        console.log(`     « ${item.near} » — ${item.tall.join(' / ')}`)
      }
      process.exitCode = 15
    }
  }
  if (flags.rhythm) {
    /*
     * **Printed whether or not it fails**, for `--census`'s reason: a run that
     * visited no spacing at all must not be able to print the sentence a run that
     * measured every gap on the screen prints. The share on the ladder is the
     * evidence, and the rules that spared a value say so by name rather than
     * silently dropping it.
     */
    const total = beat.measured
    const onLadder = beat.values
      .filter((entry) => beat.ladder.some((s) => Math.abs(s.value - Math.abs(entry.v)) <= 0.5))
      .reduce((sum, entry) => sum + entry.n, 0)
    const byRule = new Map()
    for (const item of beat.spared) byRule.set(item.why, (byRule.get(item.why) ?? 0) + item.n)
    console.log(
      `  rythme: ${total} espacement(s) peint(s) sur ${beat.elements} élément(s), ` +
        `${total === 0 ? 0 : Math.round((1000 * onLadder) / total) / 10}% sur les ` +
        `${beat.ladder.length} pas déclarés` +
        (byRule.size > 0
          ? ` · épargnés : ${[...byRule].map(([why, n]) => `${n} ${why}`).join(', ')}`
          : '') +
        ` · ${beat.pairs} groupe(s) imbriqué(s), ${beat.read} titre(s) mesuré(s)`,
    )

    /*
     * **The ladder has to exist, and « exist » is not « be seven ».**
     *
     * The first draft of this guard was `< 7`, which is exactly the defect
     * `--census` was carrying: a palette whose size is frozen into the
     * instrument cannot be tuned without turning the gates red, and `--radius`
     * (12px, worn by 0 of 40 388 corners) spent rounds undeletable for that
     * reason. A scale that has shrunk is a decision; a scale that is gone is a
     * check with nothing to measure against. A value that was on a rung since
     * removed lands in the off-ladder list below on its own.
     */
    if (beat.ladder.length === 0) {
      console.log(
        '  ✗ rythme: aucun pas --space-* lu dans :root — ' +
          'la mesure n’a pas d’échelle contre laquelle mesurer',
      )
      process.exitCode = 16
    }

    /*
     * An allowance covers a value on an element on named sides, and it has to
     * cover **every** side the value was painted on: `-mx-px` is an argument
     * about two hairlines, not a licence for the same number anywhere else on
     * the same box.
     */
    const excused = (item) =>
      RHYTHM_ALLOWANCES.some(
        (a) =>
          a.value === item.value &&
          a.at.test(item.at) &&
          item.sides.every((side) => a.sides.includes(side)),
      )
    const stray = beat.off.filter((item) => !excused(item))
    if (stray.length > 0) {
      const occurrences = stray.reduce((sum, item) => sum + item.n, 0)
      console.log(
        `  ✗ rythme: ${stray.length} endroit(s) hors de l’échelle (${occurrences} occurrence(s)) — ` +
          `les pas déclarés sont ${beat.ladder.map((s) => s.value).join('/')}`,
      )
      for (const item of stray.slice(0, 10)) {
        console.log(
          `     ${item.value}px ${item.kind}${item.sides.length > 0 ? ' ' + item.sides.join('/') : ''} ×${item.n} — ` +
            `${item.at.slice(0, 64)} « ${item.near} »`,
        )
      }
      if (stray.length > 10) console.log(`     … et ${stray.length - 10} de plus`)
      process.exitCode = 16
    }

    if (beat.flat.length > 0) {
      console.log(
        `  ✗ rythme: ${beat.flat.length} groupe(s) aussi espacé(s) dedans qu’autour — ` +
          'un groupe qui n’est pas plus serré que ce qui l’entoure n’est pas un groupe',
      )
      for (const item of beat.flat.slice(0, 6)) {
        console.log(
          `     ${item.inner}px dedans contre ${item.outer}px autour — ` +
            `${item.at.slice(0, 56)} « ${item.near} »`,
        )
      }
      process.exitCode = 16
    }

    if (beat.headings.length > 0) {
      console.log(
        `  ✗ rythme: ${beat.headings.length} titre(s) plus serré(s) au-dessus qu’en dessous`,
      )
      for (const item of beat.headings.slice(0, 6)) {
        console.log(
          `     ${item.above}px au-dessus contre ${item.below}px en dessous — ` +
            `${item.tag} « ${item.text} »`,
        )
      }
      process.exitCode = 16
    }
  }
  if (flags.cells) {
    /*
     * Printed either way, for the reason above: « aucune cellule affamée » over
     * 5 069 growing cells and over none are two different statements and this
     * harness has shipped the second one as the first three times.
     */
    console.log(
      `  cellules: ${starved.flexible} cellule(s) extensible(s) dans ${starved.rows} rangée(s), ` +
        `${starved.starved.length} à l’étroit`,
    )
    if (starved.starved.length > 0) {
      console.log(
        `  ✗ cellules: ${starved.starved.length} cellule(s) qui s’étendent manquent de place ` +
          'pendant que leurs voisines fixes en gardent',
      )
      for (const item of starved.starved.slice(0, 6)) {
        console.log(
          `     ${item.got}px pour ${item.want}px de texte (${item.short}px, ~${item.characters} ` +
            `caractère(s)) alors que les fixes gardent ${item.slack}px` +
            (item.ellipsis ? ' — coupé avec une ellipse' : ' — coupé sans rien le dire') +
            (item.clamp ? `, clamp ${item.clamp}` : ''),
        )
        console.log(`       ${item.at.slice(0, 64)} « ${item.near} »`)
        console.log(`       rangée ${item.row.slice(0, 50)} : ${item.widths}`)
      }
      process.exitCode = 17
    }
  }
  if (unanswered.length) console.log(`  canaux sans réponse: ${[...new Set(unanswered)].join(', ')}`)
  const noise = problems.filter((p) => !IGNORED.some((rule) => rule.test(p)))
  if (noise.length) {
    console.log('  console:')
    noise.forEach((p) => console.log('   ' + p))
  }
}

/**
 * **Every text run against the ground it is painted on.**
 *
 * The bundled detector reports contrast by *sampling pixels*, which makes it
 * unreliable here in both directions: it read « Démarrer une réunion » as 4.0:1
 * on the calendar, and the same element resolves to about 14:1 — it had sampled
 * an antialiased edge, or a frame of the `transition` mid-flight. A check that
 * cries wolf is a check whose findings get waved through, which is worse than
 * none.
 *
 * This computes it instead, from the styles the browser resolved: the element's
 * own colour, the first ancestor that actually paints a background, and WCAG's
 * own relative-luminance formula. The threshold is AA — 4.5:1, or 3:1 for text
 * that is large (24px, or 18.66px bold), which is the exemption the criterion
 * itself grants and not one invented here.
 *
 * It cannot see a gradient or an image behind text, and it says so rather than
 * guessing: an ancestor painting neither a colour nor nothing is skipped.
 */
async function contrast(page) {
  /*
   * **Transitions off, first.**
   *
   * `getComputedStyle` returns the *current animated value*, so a reading taken
   * while a `transition: background-color` is in flight is a reading of a frame
   * — which is exactly how the bundled detector reported « Démarrer une
   * réunion » at 4.0:1 on an element that rests at fourteen. My own first
   * version reproduced the same false positive, at 1.16:1, on the same button:
   * grey ink over a blue that is not a colour anything in this product paints,
   * because it was halfway between two.
   *
   * A colour is a design decision and a transition is presentation, so the
   * measurement is of the resting state. Injected and then removed, so nothing
   * else in the run sees a page with its motion disabled.
   */
  const stylesheet = await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  await page.waitForTimeout(50)
  // `async`, because the grain tile is decoded here rather than assumed — see
  // `grainAlpha` below.
  const findings = await page.evaluate(async () => {
    const channel = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    const parse = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
    const opaque = (value) => value && !/rgba\([^)]*,\s*0\s*\)|transparent/.test(value)

    /*
     * **The grain is a declared texture, not an unknown ground — and treating
     * it as unknown was hiding 92% of the first screen a rep ever sees.**
     *
     * The walk abstains on a `background-image` because a gradient or a photo
     * is a ground nothing here can compute, and guessing white under one is how
     * a check invents a finding. That is right. What it did not account for is
     * that `.grain` (`design/index.css`) sets **only** `background-image`, over
     * whatever `bg-*` the same element already carries — so the app root is
     * `div.bg-canvas grain`, which paints a colour *and* an image, and the test
     * fired on the image before it ever looked at the colour.
     *
     * Every text run whose own ancestors paint nothing therefore walked up to
     * that root and was skipped. Measured over all 164 stagings: 22 944 text
     * runs, **290 skipped, every single one of them blocked by the declared
     * `--grain`** — 282 at the app root and 8 on an empty-state panel. Spread
     * thin overall, and not spread at all in fact: 85–94% of the text on every
     * one of the eleven onboarding stages and on `reglages-presentation`, where
     * the line « contraste: texte AA » was printed over **one** measured element
     * out of twelve. That is the failure `--fade` was rewritten to end and the
     * one `--census` exists for, in the check that guards legibility.
     *
     * The token is read out of `:root` rather than matched by class name, the
     * way `--census` reads the radius ladder and `--motion` reads its curve set:
     * rename `--grain` and this goes back to abstaining — loudly, see below —
     * instead of quietly widening to every image on the page.
     *
     * **The verdict is against the declared colour, and the grain is reported
     * beside it rather than failed on.** `tokens.css` states the tile as four
     * alpha levels of black — 0, 3, 6 and 9 of 255 — so the darkest pixel of a
     * grained ground is the colour composited with 9/255. Failing on that pixel
     * was written first and thrown away: it turns `--text-muted` at 12px on
     * `--bg-canvas` from **4.83:1** into **4.46:1** and would have reported five
     * failures on every onboarding stage, on text that is legible, because only
     * a quarter of the tile is at the darkest level and a 12px glyph covers
     * dozens of tile pixels. « A check that cries wolf is a check whose findings
     * get waved through » is the first paragraph of this function.
     *
     * What is *not* thrown away is the number. `index.css`'s own `.grain` rule
     * says where the texture must not go: « under dense body text, where it
     * costs real legibility at the 11–12px muted sizes the palette is only just
     * clearing AA at ». `Onboarding.tsx:208` is `div.bg-canvas grain` with the
     * whole onboarding inside it, and the measurement is the rule's own
     * sentence in numbers: five runs per stage clear AA on the colour and would
     * not clear it on the tile's darkest pixel. So they are counted and the
     * worst is named, on the green line, every run.
     */
    const GRAIN = getComputedStyle(document.documentElement).getPropertyValue('--grain').trim()
    /*
     * **The tile's darkest level is decoded, and it was the number `9 / 255`
     * typed here.**
     *
     * `index.css` names the consequence in its own words — « a quieter tile
     * needs `shot.mjs --contrast` to stop hard-coding `9 / 255` » — so the one
     * remedy the design lane can reach for was a remedy this instrument could
     * not see: repaint the grain at half the alpha and the reported margin would
     * not move by a thousandth. Same shape as `--census` reading its radius
     * ladder from a hand-written list while its docblock said it read `:root`.
     *
     * The PNG is a `data:` URL, so the canvas is same-origin and readable.
     * Measured on the shipped tile: **64×64, four levels — 0 (26.2 %), 3
     * (23.9 %), 6 (24.7 %), 9 (25.2 %), mean 4.47**. The prose in `tokens.css`
     * was right about the levels; nothing had ever read them.
     */
    let grainAlpha = null
    let grainTile = null
    const url = GRAIN.match(/url\("?([^"')]+)"?\)/)
    if (url !== null) {
      try {
        const tile = new Image()
        tile.src = url[1]
        await tile.decode()
        const board = document.createElement('canvas')
        board.width = tile.width
        board.height = tile.height
        const brush = board.getContext('2d')
        brush.drawImage(tile, 0, 0)
        const pixels = brush.getImageData(0, 0, board.width, board.height).data
        let peak = 0
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > peak) peak = pixels[i]
        grainAlpha = peak
        grainTile = `${board.width}×${board.height}`
      } catch {
        grainAlpha = null
      }
    }
    const grained = (value) => {
      const [r, g, b] = parse(value)
      const a = (grainAlpha ?? 0) / 255
      return `rgb(${Math.round(r * (1 - a))}, ${Math.round(g * (1 - a))}, ${Math.round(b * (1 - a))})`
    }
    /*
     * **An abstention is declared, never silent.** `data-ground` is the escape
     * for a real gradient or photo: the author states the colour they designed
     * the ink against and the check measures it. Nothing in `src/` carries one
     * today, which is the point — the attribute exists so that the next surface
     * that needs a gradient has to say what its ground is rather than switching
     * this check off by accident.
     */
    /*
     * `groundOf` answers either one colour or the pair a grained ground is —
     * the colour as declared, and the colour under the tile's darkest pixel.
     * The first is the verdict; the second is the margin, reported never
     * failed. See `groundOf`.
     */
    const ratioOf = (ink, ground) => {
      const a = luminance(parse(ink))
      const b = luminance(parse(ground))
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    const declaredGround = (ground) => (Array.isArray(ground) ? ground[0] : ground)
    /* Runs that clear AA on the colour and would not clear it under the tile. */
    let grainEaten = 0
    let grainWorst = null
    /* How many grounds actually paint the tile — see the decode check. */
    let grainPainted = 0

    const unmeasured = []
    const groundOf = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        const declared = node.getAttribute('data-ground')
        if (declared !== null && opaque(declared)) return declared
        const image = style.backgroundImage
        if (image !== 'none' && image !== GRAIN) {
          unmeasured.push({
            what: `${node.tagName.toLowerCase()}${node.classList.length > 0 ? '.' + [...node.classList].slice(0, 3).join('.') : ''}`,
            image: image.slice(0, 48),
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28),
          })
          return null
        }
        if (opaque(style.backgroundColor)) {
          if (image === GRAIN) {
            grainPainted += 1
            return [style.backgroundColor, grained(style.backgroundColor)]
          }
          return style.backgroundColor
        }
      }
      return 'rgb(255, 255, 255)'
    }

    const drawn = (el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      if (Number(style.opacity) < 0.99) return false
      if (el.closest('[aria-hidden="true"]')) return false
      return el.offsetParent !== null || style.position === 'fixed'
    }

    const out = []
    const seen = new Set()
    /*
     * **How many text runs this half actually measured.** Same rule as the
     * graphics count below and as `--fade`'s: a run that measured one element
     * must not be able to print the sentence a run that measured twelve prints.
     */
    let runs = 0
    for (const el of document.querySelectorAll('body *')) {
      // Only the element that *owns* the text, so a wrapper is not measured for
      // its children's ink.
      const own = [...el.childNodes].some(
        (node) => node.nodeType === 3 && (node.textContent ?? '').trim().length > 1,
      )
      if (!own || !drawn(el)) continue

      const style = getComputedStyle(el)
      const ground = groundOf(el)
      if (!ground) continue
      runs += 1

      const size = parseFloat(style.fontSize)
      const bold = Number(style.fontWeight) >= 700
      // WCAG's own exemption, not one invented here.
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5

      const worst = declaredGround(ground)
      const ratio = ratioOf(style.color, worst)
      if (Array.isArray(ground) && ratio >= need) {
        const under = ratioOf(style.color, ground[1])
        if (under < need) {
          grainEaten += 1
          if (grainWorst === null || under < grainWorst.under) {
            grainWorst = {
              under: Math.round(under * 100) / 100,
              clear: Math.round(ratio * 100) / 100,
              need,
              text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28),
            }
          }
        }
      }
      if (ratio >= need) continue

      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32)
      const key = `${style.color}|${worst}|${text}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text, fg: style.color, bg: worst, ratio: Math.round(ratio * 100) / 100, need })
    }

    /*
     * **And the graphics that carry information, at WCAG 1.4.11's 3:1.**
     *
     * Everything above measures *text*, so a mark that says something by colour
     * alone was outside the check entirely — and one shipped. The onboarding's
     * three progress dots drew the completed step at `brand-300` (**1.99:1**)
     * and the upcoming one at `bg-subtle` (**1.11:1**) on a `#fdfefe` footer, so
     * a rep saw **one** dot: the count the indicator exists to give was the
     * thing it lost. Right in the source, invisible on screen, and no screenshot
     * review in a dozen rounds noticed, because a missing dot looks like a
     * design with fewer dots.
     *
     * Opt-in via `data-graphic`, and that is the honest scope rather than
     * laziness: 1.4.11 covers a graphic *required to understand the content*,
     * and only the author knows which those are. A `StateDot` is not one — it
     * owns a text label beside it and refuses to render without it — and a
     * decorative rule is not one either.
     *
     * The ring is read as well as the fill. A hollow mark says what a filled one
     * says, and `ring-*` is a `box-shadow`, so an element with a transparent
     * background and a 1px inset ring would otherwise measure 1.01:1 against its
     * own ground and be reported as invisible when it is perfectly legible.
     */
    /*
     * `drawn` is not used here, and the reason is the shape of the thing.
     *
     * It excludes anything under `aria-hidden`, which is right for text — text
     * hidden from the reader is not read — and exactly backwards for a graphic.
     * A mark that carries information visually is *supposed* to be `aria-hidden`
     * when a labelled parent carries the same information as a sentence, which
     * is precisely how the onboarding's dots are built. Using `drawn` here meant
     * the check silently measured nothing at all, which is worse than not having
     * it: a green line asserting a floor nobody had checked.
     */
    /*
     * **How many graphics this half actually measured**, reported beside the
     * verdict rather than left implicit.
     *
     * `--fade` was rewritten to end exactly this: « a check that visited zero
     * elements must not be able to print the same sentence as a check that
     * measured everything ». This half is `data-graphic` opt-in, and across all
     * eight widget stages — the surface with the product's only 2.42:1 mark and
     * a twenty-cell meter on it — it printed « graphiques 3:1 » having visited
     * **nothing**, because one element in the whole renderer opts in. The
     * docblock above already names that failure (« a green line asserting a
     * floor nobody had checked ») about a different cause; this is the same
     * green line, and now it says how much it is worth.
     */
    let graphics = 0
    /*
     * **And how many marks it walked past**, because « 0 graphique(s) » on a
     * screen covered in them reads exactly like a pass.
     *
     * Opt-in is right — 1.4.11 covers a graphic *required to understand the
     * content*, and only the author knows which — but an opt-in census cannot
     * tell « nothing here needs checking » from « nobody has opted in », and two
     * separate reviewers read this line the second way on the same round. A
     * candidate is what a mark looks like: `aria-hidden`, painted, no words of
     * its own, small enough to be a dot or a bar, and carrying an opaque fill or
     * ring. That is a heuristic, so it is *reported* and never failed on — the
     * number's whole job is to stop the green line meaning nothing.
     */
    let undeclared = 0
    const painted = (el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      if (Number(style.opacity) < 0.99) return false
      return el.offsetParent !== null || style.position === 'fixed'
    }
    for (const el of document.querySelectorAll('[data-graphic]')) {
      if (!painted(el)) continue
      graphics += 1
      const style = getComputedStyle(el)
      const ground = groundOf(el.parentElement ?? el)
      if (!ground) continue
      /*
       * The ring counts as ink, not only the fill. A hollow mark says what a
       * filled one says, and `ring-*` compiles to a `box-shadow` — so an element
       * with a transparent background and a 1px inset ring would measure 1.01:1
       * against its own ground and be reported as invisible when it is perfectly
       * legible. Tailwind emits the offset shadow first and the ring second, so
       * the **last** opaque colour in the list is the ring.
       */
      const rings = [...style.boxShadow.matchAll(/rgba?\([^)]+\)/g)].map((m) => m[0])
      /*
       * The fill when there is one, the ring when there is not. A hollow mark
       * says what a filled one says, and `ring-*` is a `box-shadow`, so an
       * element with a transparent background and a 1px inset ring would
       * otherwise measure 1.01:1 against its own ground and be reported as
       * invisible when it is perfectly legible.
       *
       * **This took the stronger of the two for four commits, and the widening
       * is reverted here.** It was made so a `--warn` ring could bound an
       * `--accent` dot that measured 2.41:1 on the widget's old light card —
       * legitimate reasoning about 1.4.11, which asks that the *boundary* be
       * distinguishable — but the widget then got a ground of its own, the dot
       * became 7.08:1, and the ring was deleted. There is now no element in
       * `src/` carrying both an opaque fill and an opaque ring, so the loosened
       * rule protected nothing and only widened what could pass unnoticed. A
       * check relaxed for a reason that has expired is a check nobody has
       * audited.
       */
      /*
       * **And a `border`, which is the third way to draw the same boundary.**
       *
       * The paragraph above reasons about `ring-*` because `ring-*` compiles to
       * a `box-shadow` and would otherwise read as no ink at all. A hollow mark
       * drawn with `border` had the identical problem and was not handled: the
       * calendar grid's « réunion prête » is `border border-accent-mark` on a
       * transparent fill, and this reported it « rien sur rgb(235,248,255) » —
       * 0:1, a mark it could see perfectly well being called invisible.
       *
       * Same shape as `ring-card` resolving to no colour and `decoration-card`
       * resolving to a background token, and the same rule this repo already
       * writes down for those two: whatever `border-*` can say, the utilities
       * that draw the same line must be able to say too. Here it runs the other
       * way — the *check* knew two of the three.
       */
      /*
       * **Any side, not the top one.** A mark is not always bounded on all
       * four: the widget's paused glyph is two vertical bars — `border-x-2
       * border-y-0` — so reading `borderTopWidth` found 0 and reported « rien,
       * 0:1 » about a shape it could see perfectly well. Same correction as
       * teaching this check `border` in the first place, one axis further:
       * whichever side is actually drawn is the ink.
       */
      const edge =
        [
          ['borderTopWidth', 'borderTopColor'],
          ['borderRightWidth', 'borderRightColor'],
          ['borderBottomWidth', 'borderBottomColor'],
          ['borderLeftWidth', 'borderLeftColor'],
        ]
          .filter(([width, colour]) => parseFloat(style[width]) > 0 && opaque(style[colour]))
          .map(([, colour]) => style[colour])[0] ?? null
      const ink = opaque(style.backgroundColor)
        ? style.backgroundColor
        : (rings.filter(opaque).pop() ?? edge)
      if (!ink) {
        out.push({
          text: el.dataset.graphic || 'graphique',
          fg: 'rien',
          bg: declaredGround(ground),
          ratio: 0,
          need: 3,
        })
        continue
      }
      const worst = declaredGround(ground)
      const ratio = ratioOf(ink, worst)
      if (ratio >= 3) continue
      out.push({
        text: el.dataset.graphic || 'graphique',
        fg: ink,
        bg: worst,
        ratio: Math.round(ratio * 100) / 100,
        need: 3,
      })
    }
    for (const el of document.querySelectorAll('[aria-hidden="true"]')) {
      if (el.hasAttribute('data-graphic') || el.closest('[data-graphic]')) continue
      if (!painted(el)) continue
      if ((el.textContent ?? '').trim().length > 0) continue
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0 || box.width > 24 || box.height > 24) continue
      const style = getComputedStyle(el)
      const rings = [...style.boxShadow.matchAll(/rgba?\([^)]+\)/g)].map((m) => m[0])
      const bordered = opaque(style.borderTopColor) && parseFloat(style.borderTopWidth) > 0
      if (opaque(style.backgroundColor) || rings.some(opaque) || bordered) undeclared += 1
    }
    const key = (item) => `${item.what}|${item.image}`
    return {
      dim: out,
      graphics,
      undeclared,
      runs,
      grainEaten,
      grainWorst,
      grainAlpha,
      grainTile,
      grainPainted,
      unmeasured: [...new Map(unmeasured.map((item) => [key(item), item])).values()],
      unmeasuredRuns: unmeasured.length,
    }
  })
  await stylesheet.evaluate((node) => node.remove())
  return findings
}

/**
 * **The accessibility tree, which is half of what a design pass is looking at.**
 *
 * `CLAUDE.md` has said since the harness existed that « the defects that matter
 * here live in rendered geometry and in the accessibility tree », and only the
 * first half was ever measured. Three things are checked, and each is a defect
 * a screenshot cannot show:
 *
 *  · **a control with no accessible name** — a button whose only content is a
 *    glyph, an input with a placeholder and no label. It is on screen, it is
 *    hittable, and to a screen reader it is « bouton ». The month chevrons and
 *    the meter would each have been one without their `aria-label`;
 *  · **a form control with no label at all** — `placeholder` is not one: it
 *    disappears the moment a rep types, so the field a screen reader announces
 *    as unnamed is also the field a sighted rep can no longer identify;
 *  · **a skipped heading level** — the record's four panes jumped `h1 → h3`
 *    once already, and a heading list is how a screen is navigated without a
 *    mouse. `h1 → h2 → h4` is a rung missing from the ladder.
 *
 * The name is computed the way the platform computes it — `aria-label`,
 * `aria-labelledby`, a `<label for>`, wrapping label text, then content — rather
 * than trusted from one attribute.
 */
async function a11y(page) {
  return page.evaluate(() => {
    const out = []
    const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

    const nameOf = (el) => {
      const aria = el.getAttribute('aria-label')
      if (aria && aria.trim()) return aria.trim()
      const by = el.getAttribute('aria-labelledby')
      if (by) {
        const named = by
          .split(/\s+/)
          .map((id) => text(document.getElementById(id)))
          .filter(Boolean)
          .join(' ')
        if (named) return named
      }
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (text(label)) return text(label)
      }
      const wrapping = el.closest('label')
      if (wrapping && wrapping !== el && text(wrapping)) return text(wrapping)
      const title = el.getAttribute('title')
      if (title && title.trim()) return title.trim()
      return text(el)
    }

    const drawn = (el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      if (el.closest('[aria-hidden="true"]')) return false
      return el.offsetParent !== null || style.position === 'fixed'
    }

    const describe = (el) =>
      `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.className || '').toString().split(' ')[0]}`

    /*
     * **A glyph is not a name.**
     *
     * The first version fell back to `textContent`, so « ‹ » counted and the
     * month chevrons passed with their `aria-label` deleted — the check could
     * not catch the exact defect it was written for. A name with no letter and
     * no digit in it is a name a screen reader reads as punctuation: « ‹ »,
     * « › », « ▸ », « — ». The rule is the same one `StateDot` already enforces
     * for a colour, one modality over.
     */
    const speakable = (name) => /[\p{L}\p{N}]/u.test(name)

    for (const el of document.querySelectorAll('button, a[href], [role="button"], select')) {
      if (!drawn(el)) continue
      const name = nameOf(el)
      if (!speakable(name)) {
        out.push({
          why: name === '' ? 'contrôle sans nom accessible' : `nom illisible « ${name} »`,
          what: describe(el),
        })
      }
    }

    for (const el of document.querySelectorAll('input:not([type="hidden"]), textarea')) {
      if (!drawn(el)) continue
      const named =
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
        el.closest('label')
      // A placeholder is not a label: it is gone the moment a rep types.
      if (!named) out.push({ why: 'champ sans étiquette (le placeholder n’en est pas une)', what: describe(el) })
    }

    let previous = 0
    for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      if (!drawn(el)) continue
      const level = Number(el.tagName.slice(1))
      if (previous !== 0 && level > previous + 1) {
        out.push({ why: `niveau de titre sauté (h${previous} → h${level})`, what: text(el).slice(0, 40) })
      }
      previous = level
    }


    /*
     * **The top of the ladder has to be a rung.**
     *
     * The heading-level check above reads the *semantics* — h2 followed by h4.
     * Nothing read the size, and the gap that leaves is the one the product
     * actually had: measured on the shipped renderer, every screen carried a top
     * heading between 1.6x and 2.55x the prose under it, and the review gate
     * carried one at **0.93x** — an `h1` smaller than the body text it heads, on
     * twenty stages at both sizes, and on the transcription tab the largest text
     * in the whole window.
     *
     * The dominant prose size is weighted by characters of own text, not by
     * element count: a screen has hundreds of 11px captions and one column of
     * prose, and counting elements would elect the captions. Text inside a
     * heading is excluded, or a big enough heading would elect itself.
     *
     * Strictly greater, not 1.25. The published guideline the layout detector
     * quotes is « aim for at least a 1.25 ratio between steps » and the ratio is
     * printed on every run so the ladder can be read off the output — but a gate
     * set where the product sits (1.267 on the gate after this round) is a gate
     * one type change away from failing for a reason nobody chose, and a check
     * people work around is worse than none. What is refused is the case with no
     * step at all.
     *
     * A screen with no `h1` is reported as such rather than skipped: the widget
     * has none by design and says so on every run, which is a statement and not
     * a silence.
     */
    const ownChars = (el) =>
      [...el.childNodes]
        .filter((node) => node.nodeType === 3)
        .reduce((total, node) => total + (node.textContent ?? '').trim().length, 0)

    const shown = (el) => {
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }

    const byChars = new Map()
    for (const el of document.querySelectorAll('body *')) {
      const own = ownChars(el)
      if (own < 20 || !shown(el) || el.closest('h1, h2, h3, h4, h5, h6')) continue
      const px = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10
      byChars.set(px, (byChars.get(px) ?? 0) + own)
    }
    const body = [...byChars].sort((a, b) => b[1] - a[1])[0] ?? null
    const top = [...document.querySelectorAll('h1')].filter(shown)[0] ?? null
    let ladder = { body: body?.[0] ?? null, top: null, step: null }
    if (top !== null && body !== null) {
      const px = Math.round(parseFloat(getComputedStyle(top).fontSize) * 10) / 10
      ladder = { body: body[0], top: px, step: Math.round((px / body[0]) * 100) / 100 }
      if (px <= body[0]) {
        out.push({
          why: `titre de page à ${px}px sous une prose à ${body[0]}px (${ladder.step}x)`,
          what: text(top).slice(0, 44),
        })
      }
    }

    return { problems: out, ladder }
  })
}

/**
 * **How many characters a line of this prose really holds.**
 *
 * `.measure` is `58ch`, and the doctrine around it says a measure is « a count
 * of characters, not a width ». `ch` is the advance of the digit zero, which in
 * Inter is about 9.4px, while the average advance of French lowercase is about
 * 7.7 — so `66ch` renders **eighty-one characters**, not sixty-six. The rule
 * was written to end lines of ninety-eight and a hundred and thirty; it ended
 * those, and it has been quietly fifteen over its own number ever since,
 * because nothing counted.
 *
 * This counts. The width of a line is measured off the element's own resolved
 * font through a canvas, divided by the average advance of a sample weighted the
 * way French text actually is — `e`, `a`, `i`, `s`, `n`, `r`, `t` and the space
 * carry most of it. Seventy-five is the ceiling: the classic band is 45–75, the
 * detector's own threshold is 80, and a surface that lands between them is a
 * choice rather than an accident.
 */
async function prose(page) {
  return page.evaluate(() => {
    const SAMPLE = 'abcdefghijklmnopqrstuvwxyz eeeaisnrtoluu'
    const MAX = 75
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    const seen = new Set()
    const out = []
    /*
     * **Every element that owns a run of prose, not only the ones that opted in.**
     *
     * This measured `.measure` and the notepad, which are the surfaces that
     * remembered to ask — so the one failure it could never see is the one the
     * rule exists to prevent: a new pane holding prose that simply forgot the
     * class. The invariant is « one reading measure », and a check that only
     * inspects the elements wearing it is checking the label rather than the
     * text.
     *
     * **The element's own text, *summed* — and requiring one text node to carry it
     * all made the check blind to every quotation in the product.**
     *
     * It was « some child text node longer than ninety characters », and almost no
     * prose in this app is one text node. `« {match.excerpt} »` is three, so the
     * *Historique* search result — whose excerpt is deliberately « forty characters
     * either side of the hit », so it can never reach ninety in one node — was never
     * measured: **185 characters a line** at 1280×800, two and a half times the
     * ceiling and wider than the 130 at the gate this rule was written to end.
     * `À :{' '}{to.join(', ')}` is two, because JSX `{' '}` is its own node, so the
     * line naming who the Outlook draft goes to — read immediately before the one
     * irreversible press — measured **90 inside a `.measure` wrapper**, which is
     * verbatim the wrapper-versus-element failure this rule already records at eighty.
     * A `<mark>` around the hit splits it again. Four live surfaces, green on 108
     * stagings.
     *
     * Sixty rather than ninety, and the number is argued rather than chosen: the
     * ceiling is seventy-five characters a line, so an element holding fewer than
     * about sixty characters of its own cannot demonstrate a line that is too long —
     * below that the check would be reporting a *capacity* nothing fills. A heading, a
     * button, a cell and a timestamp are all well under it, so it still separates prose
     * from chrome with no list of tag names. Children's text is still excluded, so a
     * wrapper is not reported for the paragraphs inside it.
     */
    const surfaces = [...document.querySelectorAll('body *')].filter(
      (el) =>
        [...el.childNodes]
          .filter((node) => node.nodeType === 3)
          .reduce((total, node) => total + (node.textContent ?? '').trim().length, 0) > 60,
    )
    for (const el of surfaces) {
      const style = getComputedStyle(el)
      const box =
        el.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
      if (box < 40) continue
      // Nothing to read: an empty wrapper is not a measure that is too long.
      if ((el.textContent ?? '').trim().length < 40) continue

      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const advance = ctx.measureText(SAMPLE).width / SAMPLE.length
      const chars = Math.round(box / advance)
      if (chars <= MAX) continue

      if (el.offsetParent === null && style.position !== 'fixed') continue
      // Named with whether it is inside a reading surface at all: « 82ch hors
      // .measure » is a different defect from « 82ch dans .measure », and they
      // have different fixes — one is a missing class, the other a wrong number.
      const held = el.closest('.measure, .notepad') !== null
      const what = `${el.tagName.toLowerCase()}.${(el.className || '').split(' ')[0]}${held ? '' : ' [hors .measure]'}`
      const key = `${what}:${chars}`
      if (seen.has(key)) continue
      seen.add(key)
      /*
       * **And the first words of it**, because « span.text-body [hors .measure] » names
       * a class that fifteen elements in this product share. Round 28 spent three runs
       * narrowing one 97-character finding down to a file by elimination; the check had
       * the string in its hand the whole time. Short enough not to put a client's
       * sentence in a terminal scrollback beyond recognising which element it is.
       */
      out.push({
        what,
        chars,
        box: Math.round(box),
        size: style.fontSize,
        text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 48),
      })
    }
    return out
  })
}

/**
 * **Is the app saying the same thing twice on one screen?**
 *
 * The home screen led with « Calendrier » in 42px serif — the name of the
 * furniture — and printed the day **twice**: « DIMANCHE 13 SEPTEMBRE » in the
 * header at y=40 and « Dimanche 13 septembre » as an `h2` at y=148, measured
 * 108px apart at 1280×800 and 106 at 960×600. Every string was correct, every
 * contrast passed, every box was the right size, and none of the nine checks
 * before this one could see it, because none of them compares one part of a
 * screen with another part. A screenshot review cannot see it either: a reader
 * who has just read a date reads it again as confirmation.
 *
 * ## Own text, not `innerText`
 *
 * The same reason `--prose` gives, for the same reason: an element's text split
 * by one inline child is almost all of the prose in this product. `« {excerpt} »`
 * is three text nodes and `À :{' '}{to.join(', ')}` is two, so reading
 * `innerText` would report every wrapper as a duplicate of the element inside it
 * — a screen's worth of false positives — while reading only the first text node
 * would miss any string a `<mark>` or a `{' '}` splits. The element's own text
 * nodes are **summed**, and a wrapper therefore owns nothing its children own.
 *
 * ## Normalised, and the casefold is load-bearing
 *
 * Whitespace collapsed, casefolded, and leading/trailing punctuation and
 * quotation marks dropped. Casefolding is not tidiness here: the header's date
 * was `text-transform: uppercase` in CSS, so the DOM held « dimanche 13
 * septembre » and the `h2` held « Dimanche 13 septembre ». A comparison of raw
 * strings would have reported the home screen clean — which is exactly what
 * every review round did.
 *
 * A string with **no letter in it** is skipped. A time, a day number, a count or
 * a « — » is a *value* the screen prints, not a thing it says: two rows at 14:30
 * is a fact about the day, and the month grid genuinely draws « 1 » twice
 * (September's first and October's). Requiring a letter is what keeps this check
 * about sentences.
 *
 * A box smaller than 2×2 is skipped, measured rather than named — that is what
 * `sr-only` is by construction (a 1×1 clipped box), and a visually-hidden label
 * repeating a visible one is not something a rep's eye can see twice.
 *
 * ## The exemption, which is the whole difficulty
 *
 * « Ouvrir » on five rows is one control offered five times; « Dimanche 13
 * septembre » in two places is the app repeating itself. Both are « the same
 * string drawn more than once », so the rule has to separate them — and it is
 * stated as a rule rather than as a list of allowed strings, because an allow-list
 * of copy is an omission dressed as a declaration and goes stale the first time
 * somebody renames a button.
 *
 * What separates them is **how many things on the screen are speaking**, not how
 * many times the words appear. Two exemptions, each measured across all 122
 * stagings before being written down:
 *
 *  1. **One kind of element drawn more than once is one voice** — a *column*.
 *     « Ouvrir » on five day rows and again on the *En attente de validation* row,
 *     « source ▸ » on eleven field rows, « Client » on 215 turns of the gate's
 *     reader, « sur la machine » on two provider rows in Réglages. Two things it
 *     deliberately does **not** require. Not that the occurrences sit in a `<li>`:
 *     half the repeated rows in this product are divs — the rail's eleven field
 *     rows, Réglages' provider rows — and a version that demanded list membership
 *     reported every one of them. And not that the **class lists** match: a row's
 *     class changes with its state, so `TranscriptReader` draws a cited turn in
 *     `text-strong` and an ordinary one in `text-body`, and comparing classes
 *     reported the same sentence **seventeen times** on `review-transcription` —
 *     a fixture tiling its turns for volume, reported as a product defect. The
 *     tag is the honest unit here, and that is a measurement rather than a
 *     preference: across 122 stagings **every** true finding is two *different*
 *     tags, because an echo is one thing said in two different roles — a heading
 *     and a caption (`h2` against `span`), a document line and a field label
 *     (`strong` against `span`, `span` against `label`), a legend and a state
 *     (`li` against `span`), a page title and a pager (`h1` against `h2`).
 *  2. **A control naming its target is not an echo.** At least one occurrence sits
 *     inside a `button`, an `a[href]`, a `[role="button"]`, a `[role="tab"]`, a
 *     `[role="option"]` or a `summary`. CLAUDE.md already draws this line for the
 *     back link — « ‹ Calendrier » names a *destination*, which is a different job
 *     — and the same holds for Réglages' section nav beside the pane it opens, the
 *     *Transcription* tab beside the reader's own heading, and a client filter chip
 *     beside the rows it filters. A control is an offer to reach something; the
 *     thing it reaches is allowed to be on the screen that points at it.
 *
 * **What exemption 1 cannot see, stated rather than implied**, because every
 * alternative was measured and each cost a true positive: two elements of the *same
 * tag* saying the same thing in two unrelated places. Before US-22 there was a live
 * instance on this very screen — in *Mois*, the calendar's pager and the range
 * label above the list were both `h2.text-strong text-copy`, so « Septembre 2026 »
 * twice was invisible here. Moving the title into the header made it an `h1` and
 * the check found it at once, on `agenda-hors-fenetre` at both sizes, which is why
 * that title now names the count. Tightening exemption 1 with positional
 * parallelism (« the same slot of sibling containers ») catches that class of pair
 * and costs « Ouvrir » across the day list and the pending list — a `div` and a
 * `section` under `main` — which is a false positive on an entirely correct
 * control, and a check people work around is gone.
 *
 * On the shipped `agenda` at 1280×800 and at 960×600: 38 strings repeat, 2 are
 * columns, and before US-22 the one finding was the date. After it, none.
 */
/**
 * **The echoes this product has declared, each with the reason it is not a defect
 * *yet* and what removing it would cost.**
 *
 * `--echo` found 44 stagings on its first run. Two of them were this lane's and are
 * fixed; the rest are in three other files, and a check that exits 1 on every run
 * is a check nobody can gate on — so they are declared, in the shape
 * `check-platform.mjs` and `check:ports`' `UNWIRED` already use in this repo.
 *
 * Three rules, and the third is the one that matters:
 *
 *  · an entry names **one stage and one string**, never a bare string everywhere —
 *    « transcription » is legitimate on *Historique* and would be a defect on the
 *    session screen, and a list of words rather than pairs is a blanket exemption
 *    with extra steps;
 *  · it says what the pair **is** (both elements, both files), why it stands, and
 *    which story removes it — « declared debt » with no owner is a comment;
 *  · **a stale entry fails the run.** If the string stops repeating on that stage,
 *    the allowance has outlived its finding and the check exits 14 naming it. That
 *    is the half `check-platform.mjs` records as mattering most: without it the
 *    list rots into a permanent exemption, which this repo has now written down
 *    twice. A stage this file does not know also fails, which is `check:ports`'
 *    `HOMES`-not-on-disk lesson.
 *
 * So an entry costs whoever lands its story exactly one deletion, and forgetting
 * that deletion is loud rather than silent.
 */
const ECHO_DECLARED = [
  /*
   * ── *Historique*: a search result's surface label against a pane heading ──
   *
   * `Results.tsx` draws `span.w-28` on each result row saying **which of the four
   * searchable surfaces matched** — « Intitulé », « Transcription », « Mes notes »,
   * « Compte-rendu » — and `Historique.tsx` captions its panes with the same words.
   * The label is per row and answers « why is this row here »; the heading names a
   * box. Neither file is in this lane.
   */
  /*
   * The one of the three that needs a **decision** rather than a story: US-23 keeps
   * « Mes notes » deliberately (it and « Extraction » are two blocks of plain French
   * prose side by side with no shape of their own), so this pair survives that story
   * and something has to give — the heading or the surface label.
   */
  {
    stages: ['historique', 'historique-demander'],
    text: 'mes notes',
    pair: 'span.w-28 ×3 (search/Results.tsx) · h2.pane-label (Historique.tsx)',
    why: 'US-23 garde ce titre exprès — de la prose à côté de la prose, aucune ne se nomme',
    story: 'aucune : l’étiquette de surface ou le titre doit bouger (suite de la ronde 34)',
  },
  /*
   * ── The gate: the client's name, drawn by the screen and by the document ──
   *
   * Round 34's own finding, in its own words: « the client's name appears five times
   * above the fold ». The header line names the call; the compte-rendu's first line
   * is `# <objet>`, which is the string VerySwing receives and cannot be rewritten
   * here (DEC-44). The fixture's objet is what the entry matches, so a fixture change
   * fails this entry loudly, which is correct.
   */
  {
    stages: ['reglages-sans-entra'],
    text: 'aucune application microsoft n’est configurée — le calendrier et les brouillons outlook restent indisponibles',
    pair: 'CalendarConnect (la carte sous la grille, derrière le voile) · MicrosoftAccount (la ligne du compte dans Réglages)',
    why: 'la même condition sur deux surfaces — le calendrier reste monté sous la feuille Réglages (V2), et la carte est ce qui envoie le commercial vers la ligne',
    story: 'ronde « Agenda Outlook » — la carte a pris la phrase de l’état vide',
  },
  {
    stages: [
      'review',
      'review-rail',
      'review-rail-inerte',
      'review-valider',
      'review-garde',
      'review-garde-citation',
      'review-garde-frappe',
      'review-garde-mort',
      'review-garde-sources',
      'review-garde-tapis',
      'review-citation-prose',
      'review-sans-entra',
      'review-sans-opportunite',
      'review-sans-opportunite-valider',
      'review-refus',
      'review-modele',
      'review-modele-differe',
      'review-decocher',
      'review-source-sortie',
    ],
    text: 'néovia santé — cadrage renfort data',
    pair: 'p.text-muted (l’en-tête de Review.tsx) · span (session/CompteRenduDocument.tsx, la ligne « # <objet> »)',
    why: 'le document ouvre sur son propre titre (DEC-44) et l’en-tête nomme l’appel',
    story: 'lane US-23 / US-25 (Review.tsx, CompteRenduPane.tsx)',
  },
  /*
   * ── A **decision**, not debt: the recap shares a name with the chapter ──
   *
   * Checked rather than assumed. The composer really does write `## Prochaines
   * étapes` (the model's narrative chapter, declared in `COMPTE_RENDU_SECTIONS`)
   * and `### Prochaines étapes` (the appended field recap under « Éléments
   * retenus »), and the gate draws the field's label beside them — three
   * occurrences, two levels. That is not the collision CLAUDE.md records as fixed:
   * `modules/extract/__tests__/compteRendu.test.ts` asserts on the *level* and its
   * comment says so outright — « sharing a name between a chapter and a field of
   * the recap is fine and is what the recap is for ».
   *
   * What is left is a real question and it is a **recipe** question, not a renderer
   * one: the document states its two most operative sections twice, once as prose
   * and once as bullets, and VerySwing receives both. Nothing in `src/` can decide
   * that.
   */
  {
    stages: [
      'review',
      'review-rail',
      'review-rail-inerte',
      'review-valider',
      'review-garde',
      'review-garde-citation',
      'review-garde-frappe',
      'review-garde-mort',
      'review-garde-sources',
      'review-garde-tapis',
      'review-citation-prose',
      'review-sans-entra',
      'review-sans-opportunite',
      'review-sans-opportunite-valider',
      'review-refus',
      'review-modele',
      'review-modele-differe',
      'review-decocher',
      'review-source-sortie',
    ],
    text: 'prochaines étapes',
    pair: 'chapitre « ## » · sous-section « ### » du récapitulatif (CompteRenduDocument) · label.text-muted (le champ)',
    why: 'deux niveaux par construction (compteRendu.test.ts affirme le niveau, pas l’orthographe) ; le récapitulatif est fait pour partager le nom du chapitre',
    story: 'décision de recette pour la ronde 34 — si le document doit dire les deux',
  },
  /*
   * ── A **decision**, and DEC-47 is the reason ──
   *
   * « Client » is the rail's account field *and* the speaker label on every
   * far-channel turn — 215 of them on the gate's reader. DEC-47: a turn is
   * attributed to a **side** and never to a person, so « Client » is precisely what
   * the record is entitled to say when there is more than one interlocutor, and
   * `speakerLabel` produces it once per turn by design. Renaming either half would
   * cost more than the collision: the field is the VSA account and the label is the
   * only honest thing the two channels establish.
   */
  {
    stages: ['review-transcription', 'review-transcription-introuvable', 'review-garde-transcription'],
    text: 'client',
    pair: 'label.text-muted (le champ Compte du rail) · span.text-muted ×215 (speakerLabel, DEC-47)',
    why: 'DEC-47 — un tour nomme un côté, jamais une personne ; 215 tours, c’est le compte-rendu qui fait son travail',
    story: 'aucune. C’est la décision',
  },
  /*
   * ── The reader naming the row it was opened from ──
   *
   * `TranscriptReader` heads the column with « Citation du champ « Besoin » », which
   * is the thread back to the `source ▸` the rep just pressed, and the rail beside
   * it still draws that field's own label. It is exemption 2 one frame later — a
   * control naming its target, except the naming outlives the press — and the two
   * files are another lane's.
   */
  {
    stages: ['review-transcription'],
    text: 'besoin',
    pair: 'span.text-body (review/TranscriptReader.tsx, « Citation du champ … ») · label.text-muted (le champ d’où il a été ouvert)',
    why: 'le lecteur dit de quelle ligne il vient ; le rail montre encore cette ligne',
    story: 'lane US-23 / US-25 (Review.tsx, TranscriptReader.tsx)',
  },
  /*
   * ── The session screen: the slate and the document name the same field ──
   *
   * The compte-rendu's fact line « Démarrage : … » against the rail's slate label.
   * This may well be correct and the argument is already written down: DEC-14 and
   * DEC-38 put the two side by side precisely so « Durée — » empty and the prose
   * silent about it can be seen *in one glance*, which needs the field named in
   * both. `SignalRail.tsx` is US-25's file, so the call is theirs.
   */
  {
    stages: [
      'session-compte-rendu',
      'session-suivi',
      'session-suivi-sans-entra',
      'session-demander',
      'session-remonter',
    ],
    text: 'démarrage',
    pair: 'strong.text-strong (la ligne de fait du compte-rendu) · span.slate-label (session/SignalRail.tsx)',
    why: 'DEC-14 / DEC-38 mettent l’ardoise à côté du document pour qu’on juge l’un par l’autre, ce qui demande le champ nommé des deux côtés',
    story: 'lane US-25 (SignalRail.tsx) — probablement une décision à garder, déclarée pour que le compte soit honnête',
  },
]

async function echo(page) {
  return page.evaluate(() => {
    const CONTROL =
      'button, a[href], [role="button"], [role="tab"], [role="option"], [role="link"], summary'

    /* Whitespace collapsed, casefolded, edges of punctuation dropped. */
    const normalise = (raw) =>
      raw
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('fr')
        .replace(/^[\s"'«»‹›(\[.,;:!?…·—–-]+/u, '')
        .replace(/[\s"'«»‹›)\].,;:!?…·—–-]+$/u, '')

    const describe = (el) =>
      `${el.tagName.toLowerCase()}.${((el.className ?? '').toString().trim() || '—').split(' ')[0]}`

    /*
     * **The role the element plays, which in this codebase is its tag.**
     *
     * Not the class list — measured, and the reason is in the docblock: a row's
     * class changes with its state, so the gate reader's cited turn is a different
     * class from an ordinary one and comparing class lists reported the same turn
     * seventeen times on `review-transcription`.
     */
    const shape = (el) => el.tagName

    const groups = new Map()
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes]
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? '')
        .join(' ')
      const text = normalise(own)
      // A value is not a thing said: a time, a day number, a count, a dash.
      if (text.length < 2 || !/\p{L}/u.test(text)) continue

      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      if (el.offsetParent === null && style.position !== 'fixed') continue
      const box = el.getBoundingClientRect()
      // `sr-only` is a 1×1 clipped box by construction — measured, not named.
      if (box.width < 2 || box.height < 2) continue

      if (!groups.has(text)) groups.set(text, [])
      groups.get(text).push({
        shape: shape(el),
        control: el.closest(CONTROL) !== null,
        what: describe(el),
        y: Math.round(box.y),
      })
    }

    const out = []
    let column = 0
    let named = 0
    for (const [text, hits] of groups) {
      if (hits.length < 2) continue
      // One component, drawn more than once: a column, and one voice.
      if (new Set(hits.map((hit) => hit.shape)).size === 1) {
        column += 1
        continue
      }
      // A control naming its target: the target may be on the screen it reaches.
      if (hits.some((hit) => hit.control)) {
        named += 1
        continue
      }
      out.push({
        /*
         * The **whole** normalised string, not a display slice. It is what a
         * declared exemption is matched against (`ECHO_DECLARED`), and matching a
         * truncation would let one entry cover every string sharing its first sixty
         * characters — a bare string standing in for a pair, which is the shape the
         * declaration is written to avoid. The slicing happens at print time.
         */
        text,
        times: hits.length,
        where: hits.slice(0, 4).map((hit) => `${hit.what} y=${hit.y}`),
      })
    }
    return { items: out, seen: groups.size, column, named }
  })
}

/**
 * **Is anything hidden inside a scroller the arming guard cannot see?**
 *
 * The gate's guard measures two columns and withholds *Valider* until both have
 * been shown end to end, under a caption that says so out loud: « Tout ce qui
 * part doit avoir été affiché avant d'être validé ». It measures those two boxes
 * and nothing else — so **a scroller nested inside one of them is a hole in the
 * claim**, and one that no screenshot shows, because a clipped textarea looks
 * exactly like a short one.
 *
 * There were eleven. `FieldRow`'s textarea sized itself from `value.split('\n')`
 * — a count of *newlines*, where a rep reads *wrapped* lines — under a
 * `Math.min(6, …)` ceiling. A nine-line « Prochaines étapes » drew six rows and
 * hid three lines at 1280×800, armed; at 960×600, which is the `minWidth` /
 * `minHeight` `app/main.ts` enforces, three fields hid text at once. The same
 * defect had already been found and fixed on the follow-up draft's body, in the
 * same file, with the fix written in a comment beside it.
 *
 * So it is measured instead of remembered. Every element under a scroll
 * container is checked for content taller or wider than its own box; the
 * containers themselves are exempt (they are the thing the guard measures) and
 * so is anything that opts out by declaring the overflow deliberately.
 */
async function scrollers(page) {
  return page.evaluate(() => {
    const SLACK = 2
    const columns = [...document.querySelectorAll('.fade-below, [data-scroller]')]
    const out = []
    /*
     * **`#root *`, not `main *, aside *, dialog *`.**
     *
     * The scope was a landmark list, and a screen with no landmark was
     * therefore not checked at all — which is exactly what *Historique* is. The
     * check reported « rien de caché dans une boîte interne » over four panes it
     * never visited, one of which hides 95% of a fifty-minute transcript behind
     * a bare 288-pixel box. Zero elements visited, green.
     *
     * The same shape as the `drawn()` false-green this file already records for
     * `--contrast`: a check that measures nothing is worse than no check, because
     * it is read as evidence.
     */
    const LANDMARK = 'main, aside, dialog, [role="main"]'
    for (const el of document.querySelectorAll('#root *')) {
      if (columns.includes(el)) continue
      // A landmark *is* the page's own scroll region, not a box inside one.
      if (el.matches(LANDMARK)) continue
      const hiddenY = el.scrollHeight - el.clientHeight
      const hiddenX = el.scrollWidth - el.clientWidth
      if (hiddenY <= SLACK && hiddenX <= SLACK) continue
      if (el.clientHeight === 0) continue
      /*
       * **Visually hidden is not hidden content.** The `sr-only` pattern is a
       * 1×1 clipped box carrying a full sentence for a screen reader, so it
       * overflows by construction and always will — and nothing is being kept
       * from anybody, which is the whole subject of this check. It only became
       * visible when the scope widened from the landmark list to the tree.
       */
      if (el.clientHeight <= 1 || el.clientWidth <= 1) continue
      const style = getComputedStyle(el)
      // `visible` cannot scroll: the content overflows the box and is drawn
      // anyway, which is a layout question and not a hidden one.
      const scrolls = (axis) => axis === 'auto' || axis === 'scroll' || axis === 'hidden'
      if (!scrolls(style.overflowY) && !scrolls(style.overflowX)) continue
      // Declared on purpose — a wide table or a code block is allowed to scroll
      // sideways inside its own box, and says so.
      if (el.dataset.scrolls !== undefined) continue
      /*
       * And truncation that **advertises itself** is not hiding. The check is
       * for content cut off with nothing on screen saying so — a clipped
       * textarea that looks exactly like a short one. A `line-clamp` or a
       * `text-overflow: ellipsis` draws the ellipsis that says « there is more »,
       * which is the cue whose absence this whole check is about.
       */
      if (style.webkitLineClamp && style.webkitLineClamp !== 'none') continue
      if (style.textOverflow === 'ellipsis') continue
      const label =
        el.id ||
        el.getAttribute('aria-label') ||
        `${el.tagName.toLowerCase()}.${(el.className || '').split(' ')[0]}`
      out.push({
        what: label,
        hidden: Math.max(hiddenY, hiddenX),
        axis: hiddenY > SLACK ? 'y' : 'x',
        box: Math.round(el.clientHeight),
      })
    }
    return out.sort((a, b) => b.hidden - a.hidden)
  })
}

/**
 * **A fade that can erase a whole line of a client's words.**
 *
 * The sixth blind spot of the same shape, and the shape is always the same: the
 * property is real, the comment states it, and no instrument in the repo can ask
 * the question. The widget's live transcript recedes at the edge it is hiding
 * content behind — the cue every chat surface uses, and the right one — with the
 * ramp set to `FADE_PX = 20` under a comment reading « little enough that no
 * whole line of a client's words is ever dimmed ». The line box in that log is
 * **19.5px** (`--type-ui` 12px × `leading-relaxed` 1.625), so the ramp was
 * *longer* than a line and the sentence was false of the surface it was written
 * on. `--contrast` reads resolved colours and a mask is not one; `--scrollers` is
 * opted out of by `data-scrolls`, correctly, because a log is supposed to hold
 * more than its box. Nothing measured it, for as long as it existed.
 *
 * So: for every element carrying a `mask-image` (or its `-webkit-` twin), every
 * **vertical** ramp between a fully transparent stop and a stop that paints,
 * measured in pixels, against the tallest line box of the text inside it. A ramp
 * at least as long as a line box can put a whole line inside itself at some
 * scroll position — and « some scroll position » is not hypothetical on a log
 * that auto-scrolls to wherever the content happens to end.
 *
 * **The reader is a reader, and the first version was a regex.** It required the
 * transparent stop to carry a pixel offset:
 * `/rgba\([^)]*,\s*0\)\s+[\d.]+px,\s*[a-z]+\([^)]*\)\s+([\d.]+)px/`. Half of the
 * product's own fade system cannot match that, because CSS lets the first stop
 * drop its `0` and Chromium drops it from the computed value too — the
 * `.fade-below` top fade was then `linear-gradient(rgba(0, 0, 0, 0), rgb(0, 0, 0)
 * 12px)`, on **every** scrolled column `ReadingColumn.tsx` and `Review.tsx` draw.
 * On `review-valider` both masked elements came back with no distance and were
 * skipped in silence; a forced 40px ramp over a 25px line box — the exact defect
 * this check exists for — printed « aucun ne couvre une ligne entière » and
 * exited 0. The same regex also saw only one of the two ramps of a four-stop
 * gradient, and was defeated by a multi-layer mask, below.
 *
 * What replaced it parses the value: layers split at top-level commas, then a
 * direction, then stops of a colour and up to two positions, with the implicit
 * `0` and implicit `100%` filled in the way the spec fills them. Every form the
 * product can produce is covered and `SILLAGE_FADE_ATTACK` stages one element of
 * each: `transparent` and `rgba(0, 0, 0, 0)`, `black` and `currentColor`, the
 * dropped default direction and a named `to bottom`, `0` and `0px` and no offset
 * at all, `Npx` and `calc(100% - Npx)`, `mask-image` and its `-webkit-` twin, and
 * the four-stop form whose **two** ramps are both measured rather than maxed.
 *
 * Five things are deliberate.
 *
 * **A ramp that cannot animate is a finding, not a matter of taste** (US-15). The
 * product's two fading scrollers used to carry three gradients each and *switch*
 * between them as the rep scrolled, so crossing the first twelve pixels of a
 * reading column put a 12px hard edge on screen in one paint — on the pane where
 * the rep meets the compte-rendu. `mask-image` is not interpolable between two
 * gradients, so the fix is one gradient whose lengths are **registered** custom
 * properties; an unregistered one transitions *discretely*, which draws the
 * correct ramp at rest and snaps exactly as before while the `transition`
 * declaration sits there looking right. That registration is four `@property`
 * rules in a different part of the file from the rule that reads them, which is
 * the « declaration with no caller » shape with its halves separated — so it is
 * asked for here, of every masked element, rather than assumed.
 *
 * **The ink band, not the line box**, is what the reported alpha describes: a
 * 12px font inside a 19.5px line box paints roughly the middle 12px, so the
 * honest number is the alpha at the top of the capitals rather than at the top of
 * the box, which is always zero and says nothing.
 *
 * **Percentages are counted, not failed and not hidden.** A ramp expressed as a
 * share of the box is a different design — it scales with the box rather than
 * with the text — and reporting a pixel number for it would be guessing. It is
 * printed in the census instead, so « this check did not measure that one » is a
 * number a reader can see rather than an absence.
 *
 * **A mask the reader cannot parse is a finding, not a skip.** That is the whole
 * lesson of the round that found this: an unparsed mask and a clean mask printed
 * the same sentence, and the unparsed one is precisely where a defect hides. A
 * `url()` stencil, a `radial-gradient`, a colour space this reader does not know
 * — all of them say so and fail, and the same census says how many masks were
 * visited at all, the way `--motion` prints `${seen} élément(s) animé(s)`.
 *
 * And **only a vertical ramp is measured**, which this check got wrong on its
 * first run. `.filter-scroller` fades `to right` over a row of chips, and against
 * a line box that reads as « 28 pixels over a 17.1-pixel line, alpha 0.05 » —
 * which is nonsense: a horizontal fade hides the *ends* of a row, not a line, and
 * that is the question `--scrollers` asks and exempts `text-overflow: ellipsis`
 * from. The exemption is now decided **per layer**, which is what makes it
 * honest: reading the direction with one `exec` over the whole declaration meant
 * `linear-gradient(to right, …), linear-gradient(to bottom, …)` — a real mask
 * shape, two layers multiplied together — exempted its vertical half on the
 * strength of its horizontal one. Chromium drops `to bottom` and `180deg` from
 * the computed value and keeps everything else, so an absent direction is the
 * default and is vertical; `to top` and an angle that resolves to 0 or 180
 * degrees are vertical too, and are measured from whichever end of the box the
 * gradient axis starts at.
 */
async function fades(page) {
  return page.evaluate(() => {
    /*
     * Splitting a CSS value cannot be done with `String.split`: every separator
     * this reader cares about also occurs *inside* `rgba(…)` and `calc(…)`. So:
     * split on a separator at paren depth zero, and nowhere else.
     */
    const splitTop = (value, onComma) => {
      const parts = []
      let depth = 0
      let current = ''
      for (const ch of value) {
        if (ch === '(') depth += 1
        else if (ch === ')') depth -= 1
        if (depth === 0 && (onComma ? ch === ',' : /\s/.test(ch))) {
          if (current.trim() !== '') parts.push(current.trim())
          current = ''
          continue
        }
        current += ch
      }
      if (current.trim() !== '') parts.push(current.trim())
      return parts
    }

    const PER_DEGREE = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }

    /* 'down' · 'up' · 'other' (another axis, exempt) · null (unreadable). */
    const axisOf = (token) => {
      // Absent: Chromium prints no direction for the default, which is `to bottom`.
      if (token === null) return 'down'
      const named = /^to\s+(.+)$/.exec(token)
      if (named) {
        const sides = named[1].split(/\s+/).sort().join(' ')
        if (sides === 'bottom') return 'down'
        if (sides === 'top') return 'up'
        return 'other'
      }
      const angle = /^(-?[\d.]+)(deg|grad|rad|turn)$/.exec(token)
      if (angle) {
        const deg = ((Number(angle[1]) * PER_DEGREE[angle[2]]) % 360 + 360) % 360
        if (deg === 180) return 'down'
        if (deg === 0) return 'up'
        return 'other'
      }
      return null
    }

    /*
     * The alpha of a resolved colour. A mask is an alpha stencil — `mask-mode`
     * defaults to `alpha` — so this is the only thing about a stop's colour that
     * matters here, and `0` versus « anything else » is the only distinction the
     * ramp measurement needs. `null` means « a colour this reader does not know »,
     * which is a finding rather than an assumption.
     */
    const alphaOf = (color) => {
      if (color === 'transparent') return 0
      const hex = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)
      if (hex) {
        const body = color.slice(1)
        if (body.length === 4) return Number.parseInt(body[3] + body[3], 16) / 255
        if (body.length === 8) return Number.parseInt(body.slice(6), 16) / 255
        return 1
      }
      const fn = /^[a-z-]+\((.*)\)$/is.exec(color)
      if (!fn) return /^[a-z]+$/i.test(color) ? 1 : null
      // Both spellings of an alpha channel: `rgba(r, g, b, a)` and `rgb(r g b / a)`.
      const slashed = /\/\s*([\d.]+%?)\s*$/.exec(fn[1])
      if (slashed) {
        const pct = /^([\d.]+)%$/.exec(slashed[1])
        const value = pct ? Number(pct[1]) / 100 : Number(slashed[1])
        return Number.isFinite(value) ? value : null
      }
      // A slash that is not an alpha this reader knows how to read (`/ none`).
      if (fn[1].includes('/')) return null
      const args = splitTop(fn[1], true)
      if (args.length === 4) {
        const value = Number(args[3])
        return Number.isFinite(value) ? value : null
      }
      return 1
    }

    /*
     * Where a stop sits, in the one frame of reference it can be resolved in
     * without knowing the box: `start` counts pixels from the beginning of the
     * gradient axis, `end` counts them back from its end — which is what
     * `calc(100% - 12px)` says, and what makes a bottom fade measurable at all.
     * `{ share: true }` is a percentage. `null` is a form this reader does not
     * know; `undefined` is « the stop carried no position », filled in below.
     */
    const positionOf = (token) => {
      let m = /^(-?[\d.]+)px$/.exec(token)
      if (m) return { frame: 'start', px: Number(m[1]) }
      m = /^(-?[\d.]+)$/.exec(token)
      if (m) return Number(m[1]) === 0 ? { frame: 'start', px: 0 } : null
      m = /^(-?[\d.]+)%$/.exec(token)
      if (m) {
        const pct = Number(m[1])
        if (pct === 0) return { frame: 'start', px: 0 }
        if (pct === 100) return { frame: 'end', px: 0 }
        return { share: true }
      }
      m = /^calc\(\s*100%\s*([+-])\s*([\d.]+)px\s*\)$/i.exec(token)
      if (m) return { frame: 'end', px: m[1] === '-' ? Number(m[2]) : -Number(m[2]) }
      return null
    }

    /*
     * One layer of a `mask-image`, read into the ramps it draws.
     *   { kind: 'unreadable' }              — say so; do not skip
     *   { kind: 'other-axis' }              — horizontal or angled, exempt
     *   { kind: 'ramps', ramps, shares }
     */
    const layerRamps = (layer) => {
      const gradient = /^(?:repeating-)?linear-gradient\((.*)\)$/is.exec(layer.trim())
      if (!gradient) return { kind: 'unreadable' }
      const args = splitTop(gradient[1], true)
      if (args.length < 2) return { kind: 'unreadable' }
      const directional = /^to\s/i.test(args[0]) || /^-?[\d.]+(deg|grad|rad|turn)$/i.test(args[0])
      const axis = axisOf(directional ? args.shift().toLowerCase() : null)
      if (axis === null) return { kind: 'unreadable' }
      if (axis === 'other') return { kind: 'other-axis' }

      const stops = []
      for (const arg of args) {
        const tokens = splitTop(arg, false)
        /*
         * A bare length between two stops is an interpolation *hint*: it moves
         * the midpoint of the ramp and never its extent, so it is dropped rather
         * than read as a stop with no colour.
         */
        if (tokens.length === 1 && (/^[-.\d]/.test(tokens[0]) || /^calc\(/i.test(tokens[0]))) continue
        const alpha = alphaOf(tokens[0].toLowerCase())
        if (alpha === null) return { kind: 'unreadable' }
        if (tokens.length === 1) stops.push({ alpha, at: undefined })
        // Two positions on one stop is the shorthand for two stops of one colour.
        else
          for (const token of tokens.slice(1)) {
            const at = positionOf(token)
            if (at === null) return { kind: 'unreadable' }
            stops.push({ alpha, at })
          }
      }
      if (stops.length < 2) return { kind: 'unreadable' }
      // The two the spec fills in, and the two this reader was blind to.
      if (stops[0].at === undefined) stops[0].at = { frame: 'start', px: 0 }
      if (stops[stops.length - 1].at === undefined) stops[stops.length - 1].at = { frame: 'end', px: 0 }

      const ramps = []
      let shares = 0
      for (let i = 0; i + 1 < stops.length; i += 1) {
        const a = stops[i]
        const b = stops[i + 1]
        // A ramp is transparent on exactly one side. Opaque-to-opaque paints
        // nothing away; transparent-to-transparent hides a band outright, which
        // is `--scrollers`' question rather than this one.
        if ((a.alpha === 0) === (b.alpha === 0)) continue
        const resolved =
          a.at && b.at && a.at.share !== true && b.at.share !== true && a.at.frame === b.at.frame
        if (!resolved) {
          shares += 1
          continue
        }
        /*
         * Which edge of the *box* the ramp sits at, which is not the same
         * question as which end of the *gradient* it sits at: `to top` runs the
         * axis upwards, so its `start` frame is the bottom of the box.
         */
        const atTop = (axis === 'down') === (a.at.frame === 'start')
        ramps.push({ px: Math.abs(a.at.px - b.at.px), edge: atTop ? 'haut' : 'bas' })
      }
      return { kind: 'ramps', ramps, shares }
    }

    /*
     * **Every custom property the page has *registered*, because a ramp that
     * animates is a ramp whose length is a registered property — and an
     * unregistered one transitions discretely, in silence.**
     *
     * `mask-image` is not animatable between two gradients, so the only way a
     * fade can grow or shrink instead of snapping is a `<length>` inside it that
     * *is*. `.fade-below` and `.filter-scroller` are built that way now, and the
     * declaration that makes it work is four `@property` rules in
     * `src/design/index.css` — nowhere near the rule that reads them. Delete them
     * and the mask still draws the right ramp at rest, the transition is still
     * declared, and every check in this repo stays green while the snap comes
     * back: a 12px hard edge arriving in one paint on the pane where the rep meets
     * the compte-rendu. That is the « a declaration with no caller » shape with the
     * two halves in different files, which is the version nothing catches.
     *
     * Read off the CSSOM rather than probed, because there is no API that answers
     * « is this property registered »: `CSSPropertyRule` is what `@property`
     * becomes. A stylesheet whose rules cannot be read is skipped — the harness
     * serves everything same-origin, and a cross-origin sheet cannot be carrying
     * this product's own tokens.
     */
    const registered = new Set()
    for (const sheet of document.styleSheets) {
      let rules = null
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of rules ?? []) {
        if (rule?.constructor?.name === 'CSSPropertyRule' && typeof rule.name === 'string') {
          registered.add(rule.name)
        }
      }
    }

    const out = []
    const unreadable = []
    const discrete = []
    let seen = 0
    let measured = 0
    let horizontal = 0
    let textless = 0
    let shares = 0

    for (const el of document.querySelectorAll('#root *')) {
      const style = getComputedStyle(el)
      /*
       * `-webkit-mask-image` is an alias of `mask-image` in Blink, so the two
       * agree whenever either is set — but reading only the unprefixed one would
       * make this check depend on that staying true, and the product writes both
       * everywhere it writes either.
       */
      const mask = [style.maskImage, style.webkitMaskImage].find((v) => v && v !== 'none')
      if (!mask) continue
      seen += 1
      const what =
        el.id ||
        el.getAttribute('aria-label') ||
        `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? '').split(' ')[0]}`

      /*
       * A custom property this element says it transitions, which nothing
       * registered. `transition-property: all` is not asked about: it cannot name
       * a custom property, and Blink does not interpolate one under it either.
       */
      const unregistered = splitTop(style.transitionProperty ?? '', true).filter(
        (name) => name.startsWith('--') && !registered.has(name),
      )
      if (unregistered.length > 0) discrete.push({ what, properties: unregistered })

      const ramps = []
      let unreadableHere = false
      for (const layer of splitTop(mask, true)) {
        const parsed = layerRamps(layer)
        if (parsed.kind === 'unreadable') unreadableHere = true
        else if (parsed.kind === 'other-axis') horizontal += 1
        else {
          shares += parsed.shares
          ramps.push(...parsed.ramps)
        }
      }
      if (unreadableHere) {
        unreadable.push({ what, mask: mask.length > 140 ? `${mask.slice(0, 137)}…` : mask })
        continue
      }
      measured += ramps.length
      if (ramps.length === 0) continue

      // The tallest line box of the text this mask is painted over. A mask on a
      // box with no text in it hides nothing a reader was going to read.
      let line = 0
      let text = ''
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        if ((node.textContent ?? '').trim() === '') continue
        const parent = node.parentElement
        if (!parent) continue
        const lh = Number.parseFloat(getComputedStyle(parent).lineHeight)
        if (!Number.isFinite(lh) || lh <= line) continue
        line = lh
        text = node.textContent.trim().slice(0, 34)
      }
      if (line === 0) {
        textless += 1
        continue
      }

      const size = Number.parseFloat(style.fontSize) || 12
      for (const ramp of ramps) {
        if (ramp.px < line) continue
        out.push({
          what,
          edge: ramp.edge,
          fade: Math.round(ramp.px * 10) / 10,
          line: Math.round(line * 10) / 10,
          // A line box sitting at the very top of the visible area: the alpha the
          // ramp gives the top of its capitals.
          alpha: Math.round(Math.min(1, (line - size) / 2 / ramp.px) * 100) / 100,
          text,
        })
      }
    }
    return {
      items: out.sort((a, b) => b.fade - b.line - (a.fade - a.line)),
      seen,
      measured,
      horizontal,
      textless,
      shares,
      unreadable,
      discrete,
      registered: registered.size,
    }
  })
}

/**
 * **Does the motion come from the design system, and does it stop when the rep
 * asks their OS to stop it?**
 *
 * `tokens.css` declares `--motion`, `--motion-fast` and `--ease-out`, collapses
 * the two durations to `0ms` under `prefers-reduced-motion`, and says of itself
 * « Respect the OS setting rather than asserting our motion is tasteful enough
 * to be exempt ». `design/tokens.test.ts` asserts the tokens *exist*. Neither
 * asks the only question that matters: **does anything read them.**
 *
 * That is this repo's oldest defect shape — `models:progress` proved the row
 * could render a number and never that one arrived; `--scrollers` visited zero
 * elements and printed green. A duration written as a literal in a component
 * survives both the token file and its test, and the media query then zeroes a
 * variable nobody consults: a rep who turned animation off system-wide keeps
 * every transition in the product, and nothing anywhere can tell.
 *
 * Two passes over the same page, which is what makes it cheap enough to run on
 * every stage. The first asks whether each animated element's duration and
 * easing are values `:root` actually declares — built from the tokens at
 * runtime, so changing a token moves the check with it and it cannot rot into a
 * hardcoded list. The second flips `prefers-reduced-motion` with
 * `emulateMedia` and re-reads the computed styles: no re-navigation, no
 * re-drive, and it proves the accessibility half **directly** rather than by
 * arguing that reading a token implies it.
 *
 * The second pass is the load-bearing one. An element could read `--motion` and
 * still move — a `@keyframes` with a literal duration, an inline style, a
 * library animating in JS — and only measuring it after the flip can see that.
 */
async function motion(page) {
  const scan = () =>
    page.evaluate(() => {
      /*
       * Built from `:root`, never from a list here. Every custom property whose
       * name begins `--motion` is an allowed duration and every `--ease` an
       * allowed curve, so a new token is honoured the moment it is declared and
       * a renamed one fails loudly instead of silently widening the check.
       */
      const root = getComputedStyle(document.documentElement)
      const durations = new Set(['0s', '0ms'])
      const easings = new Set()
      for (const name of root) {
        if (name.startsWith('--motion')) durations.add(root.getPropertyValue(name).trim())
        else if (name.startsWith('--ease')) easings.add(root.getPropertyValue(name).trim())
      }
      // `150ms` and `0.15s` are the same duration and `getComputedStyle`
      // answers in seconds, so both spellings have to resolve to one number.
      const ms = (value) => {
        const n = Number.parseFloat(value)
        if (Number.isNaN(n)) return null
        return Math.round(value.trim().endsWith('ms') ? n : n * 1000)
      }
      const allowedMs = new Set([...durations].map(ms).filter((n) => n !== null))
      const allowedEase = new Set([...easings].map((e) => e.replace(/\s+/g, '')))

      const out = []
      const split = (value) => value.split(/,(?![^(]*\))/).map((part) => part.trim())

      /*
       * **How much of its change a curve spends early — the number that replaced
       * « is this the `--ease-out` token ».**
       *
       * The mean of the easing's progress function over the duration, sampled at
       * 1% and solved for `t` by bisection because a `cubic-bezier` is
       * parameterised by `t` and CSS applies it against `x`. Above 0.5 the change
       * is front-loaded: the element is most of the way there in the first
       * fraction of the time and then settles, which is what makes an *arrival*
       * feel instant. Run on something *leaving* it is a blink followed by a
       * window still holding its place with nothing in it.
       *
       * Measured, for the record and because these are the numbers `FRONT_LOADED`
       * is set against: `--ease-out` 0.827 · `cubic-bezier(0.22,1,0.36,0.99)`
       * (the attack that defeated the old rule) 0.824 · `cubic-bezier(0.3,0.95,0.4,1)`
       * 0.787 · `ease` 0.667 · `ease-out` 0.625 · `linear` and `ease-in-out`
       * exactly 0.500 · `ease-in` 0.375 · `--ease-in` 0.173.
       *
       * `null` for anything that is not a curve with a direction — `steps()`,
       * `jump-*`, a keyword this browser invented — because a check that guesses
       * at a value it could not parse invents findings, and `--motion` already
       * refuses a curve `:root` does not declare.
       */
      const FRONT_LOADED = 0.55
      const KEYWORD_CURVES = {
        linear: [0, 0, 1, 1],
        ease: [0.25, 0.1, 0.25, 1],
        'ease-in': [0.42, 0, 1, 1],
        'ease-out': [0, 0, 0.58, 1],
        'ease-in-out': [0.42, 0, 0.58, 1],
      }
      const frontLoaded = (curve) => {
        const text = (curve || '').trim()
        let points = KEYWORD_CURVES[text] ?? null
        if (!points) {
          const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(text)
          if (!bezier) return null
          const numbers = bezier[1].split(',').map((n) => Number.parseFloat(n))
          if (numbers.length !== 4 || numbers.some((n) => Number.isNaN(n))) return null
          points = numbers
        }
        const [x1, y1, x2, y2] = points
        const cubic = (a, b) => (t) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3
        const X = cubic(x1, x2)
        const Y = cubic(y1, y2)
        let total = 0
        for (let i = 0; i <= 100; i += 1) {
          const x = i / 100
          let lo = 0
          let hi = 1
          for (let step = 0; step < 40; step += 1) {
            const mid = (lo + hi) / 2
            if (X(mid) < x) lo = mid
            else hi = mid
          }
          total += Y((lo + hi) / 2)
        }
        return total / 101
      }

      /*
       * **Which elements are going away, read off the cascade rather than off a
       * class name.**
       *
       * Collected once per pass: every selector whose rule declares `opacity: 0`
       * **and, in the same declaration block, how it gets there** — a transition
       * or an animation — plus every `@keyframes` whose progression ends more
       * transparent than it starts. A departure declared as `.widget-leaving`, as
       * `.widget-leaving > *`, on an `<svg>`, through a keyframe or in an inline
       * style is the same fact to all of this, and none of it can be defeated by
       * a rename.
       *
       * **Both halves of « in the same block » are load-bearing, and the second
       * one is what a naive version got wrong.** Asking only « is its computed
       * opacity zero and is something animating it » reported **seven** findings
       * on `widget-ouvert`, and every one of them was the transcript row's mark
       * button: `opacity-0 transition group-hover:opacity-100`, an affordance that
       * is in the layout at all times and fades *in* on hover, deliberately, so a
       * line does not reflow while a rep is reading it during a call. It rests at
       * zero and it is arriving. That is precisely the objection the first version
       * of this rule wrote down — « guessing from the target opacity would fire on
       * anything fading for any reason » — and it is right; what it concluded from
       * it (read the class name instead) was not.
       *
       * The discriminator is that **a departure state declares the endpoint and
       * the motion together**, because it is a state the element *enters*:
       * `.widget-leaving` sets `opacity`, `transform` and the `transition` naming
       * both, in one block. A reveal-on-hover takes its resting endpoint from one
       * utility (`opacity-0`) and its motion from another (`transition`), and no
       * single rule in the cascade declares the pair. So the two are separable
       * without reading a name, without reading a pseudo-class, and without the
       * check having an opinion about hover.
       *
       * A cross-origin sheet throws on `cssRules` and is **counted**, not
       * swallowed: a check that quietly read no stylesheet would report « aucune
       * sortie » over a page full of them, which is the false green this repo has
       * now shipped five times. `index.html` serves its CSS from the dev server's
       * own origin, so the expected count is zero.
       */
      const leavingSelectors = []
      const revealSelectors = []
      const leavingKeyframes = new Set()
      let unreadableSheets = 0
      /**
       * The state variants a reveal is escaped by — `:hover` and its family.
       *
       * Tailwind's `group-hover:opacity-100` compiles to
       * `.group:hover .group-hover\:opacity-100`, so the *word* is in the selector and
       * this needs no opinion about Tailwind.
       */
      const STATE = /:(?:hover|focus|focus-visible|focus-within|active|checked|target|open)\b/
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.type === CSSRule.STYLE_RULE) {
            const opacity = rule.style.getPropertyValue('opacity').trim()
            if (opacity !== '') {
              const value = Number.parseFloat(opacity)
              if (value === 0) leavingSelectors.push(rule.selectorText)
              /*
               * **An escape from invisible is a restore to visible, and a hover that
               * merely dims is not one.**
               *
               * This took any non-zero opacity under a state, so an ordinary
               * `.pill:hover { opacity: .85 }` permanently exempted that element's
               * departure — measured: a probe with both went completely silent. A reveal
               * restores the element (`group-hover:opacity-100` is `opacity: 1`); a dim
               * is a hover affordance on something already visible and says nothing
               * about whether the element is going away.
               */
              else if (value >= 0.99) revealSelectors.push(rule.selectorText)
            }
          } else if (rule.type === CSSRule.KEYFRAMES_RULE) {
            /*
             * **Sorted by offset, and an endpoint the keyframes does not declare is
             * the element's own opacity.**
             *
             * This read `cssRules[0]` and `cssRules[length - 1]` — *declaration*
             * order — and asked `last < (first ?? 1)`. Four spellings of one fade-out
             * were therefore invisible, and rewriting the product's own exit as any of
             * them took the widget out of the direction rule with every check still
             * green, because a keyframes the census does not recognise makes
             * `leavingHere` answer false and `wrongWay` is then never asked:
             *
             *   · `{ to { opacity: 0 } }` — one frame is both ends, so `0 < 0` is false
             *   · `{ to { opacity: 0 } from { opacity: 1 } }` — legal CSS, read backwards
             *   · `{ 100% { opacity: 0 } 0% { opacity: 1 } }` — the same, in percentages
             *   · `{ 0%, 100% { … } }` — one `keyText` carrying two offsets, so neither
             *     `frames[0]` nor `frames[last]` is the end it looks like
             *
             * `keyText` is parsed rather than positioned (`from` → 0, `to` → 100, the
             * list split), the frames that declare an opacity are sorted by offset, and
             * an end nothing declares is the element's own — 1, which is what makes a
             * `to`-only fade-out read as the departure it is. A `0%, 100% { opacity: 1 }`
             * pulse still reads as no departure, because both its ends are declared.
             */
            const declared = []
            for (const frame of rule.cssRules) {
              const value = frame?.style?.getPropertyValue('opacity')?.trim()
              if (value === '' || value == null) continue
              const opacity = Number.parseFloat(value)
              if (Number.isNaN(opacity)) continue
              for (const key of (frame.keyText ?? '').split(',')) {
                const text = key.trim()
                const offset = text === 'from' ? 0 : text === 'to' ? 100 : Number.parseFloat(text)
                if (Number.isNaN(offset)) continue
                declared.push({ offset, opacity })
              }
            }
            if (declared.length > 0) {
              declared.sort((a, b) => a.offset - b.offset)
              const OWN_OPACITY = 1
              const head = declared[0]
              const tail = declared[declared.length - 1]
              const start = head.offset === 0 ? head.opacity : OWN_OPACITY
              const end = tail.offset === 100 ? tail.opacity : OWN_OPACITY
              if (end < start) leavingKeyframes.add(rule.name)
            }
          }
          if (rule.cssRules && rule.type !== CSSRule.KEYFRAMES_RULE) walk(rule.cssRules)
        }
      }
      for (const sheet of document.styleSheets) {
        try {
          walk(sheet.cssRules)
        } catch {
          unreadableSheets += 1
        }
      }
      /**
       * **Is this element's transparency something a state gets it out of?**
       *
       * The discriminator that replaced « the endpoint and the motion are declared in
       * the same block ». That one was measured and it was right about the seven mark
       * buttons on `widget-ouvert` — `opacity-0 transition group-hover:opacity-100`,
       * an affordance in the layout at all times that fades *in* on hover — and it was
       * wrong about the property, because the most ordinary way to write a state-class
       * exit splits the pair too:
       *
       *   .widget-shell   { transition: opacity var(--motion) … }
       *   .widget-leaving { opacity: 0 }
       *
       * Measured on the product's own exit rewritten that way, with `var(--ease-out)`
       * — the 83 %-front-loaded curve, the exact blink the rule exists to end: « 0
       * sélecteur(s) « opacity: 0 », 0 qui s'en vont, dans le bon sens », exit 0 at
       * both sizes, all twelve gates green, and the self-test's eight probes all
       * declaring the pair in one block so none of them could see it either.
       *
       * What actually separates the two is **whether the transparency has an exit**. A
       * reveal-on-hover is escaped by a state — that is what it is for, and the rule
       * granting the opacity back carries `:hover`, `:focus` or one of their family in
       * its own selector. A departure has no such rule: the element is going away, and
       * nothing the rep can do to it brings it back. So the question is asked of the
       * element, with the state stripped off the selector, which is the same question
       * « does this element have a hover that lights it up » — and it needs no opinion
       * about Tailwind, about class names, or about which end of a declaration block
       * something was written in.
       */
      /**
       * **And a state is not only a pseudo-class.**
       *
       * Round 28 stripped `:hover` and its family, which is right for
       * `group-hover:opacity-100` and blind to every reveal gated on a *class* or an
       * *attribute* — `.is-shown`, `[data-open]`, `[aria-expanded="true"]`, which is how
       * anything driven by JavaScript rather than by the pointer is written. Measured: a
       * probe resting at `opacity: 0` with `.is-shown { opacity: 1 }` beside it was
       * reported as a departure on an arrival curve, on correct code — and this repo's
       * own verdict on that direction is that a false positive here is worse than the
       * hole, because a check people work around is gone.
       *
       * So the pseudo-classes are stripped globally, as before, and then the trailing
       * simple selectors of the last compound are peeled one at a time: an element that
       * matches what is left is an element the reveal is *for*, waiting on a state it is
       * not in. Four peels, which is more than any selector in this product needs, and a
       * peel that would leave a bare combinator stops — `.group .x` must not degrade to
       * « anything inside `.group` ».
       */
      const PEELABLE = /(?:\.(?:\\.|[\w-])+|\[[^\]]*\])$/
      const revealed = (el) => {
        for (const selector of revealSelectors) {
          let probe = selector.replace(new RegExp(STATE.source, 'g'), '').trim()
          for (let peel = 0; peel < 4; peel += 1) {
            try {
              if (probe !== '' && el.matches(probe)) return true
            } catch {
              // A selector this browser cannot parse says nothing either way.
              break
            }
            const shorter = probe.replace(PEELABLE, '')
            if (shorter === probe || shorter === '' || /[\s>+~]$/.test(shorter)) break
            probe = shorter
          }
        }
        return false
      }
      const leavingHere = (el, pseudo, style) => {
        // A pseudo-element is judged by the rule that generated it, so the
        // selector test is run against the element it hangs off.
        for (const selector of leavingSelectors) {
          try {
            if (el.matches(selector)) return !revealed(el)
          } catch {
            // A selector this browser cannot parse says nothing either way.
          }
        }
        for (const name of split(style.animationName)) {
          if (leavingKeyframes.has(name)) return true
        }
        /*
         * **An inline `opacity: 0` is a departure whatever moves it**, and requiring the
         * motion inline too was the same mistake one spelling over.
         *
         * This asked for the pair in one place — `style={{ opacity: 0, transition: '…' }}`
         * — which is the « same declaration block » rule that the split-rule spelling
         * defeated in the stylesheet, reproduced for the inline case. Measured: an
         * element with `el.style.opacity = '0'` and its transition in a class went
         * completely silent, so `style={{ opacity: leaving ? 0 : 1 }}` takes the widget's
         * exit out of the direction rule exactly as `.widget-shell` + `.widget-leaving`
         * did. The element only reaches this point with a live duration on it —
         * `reading()` returns null otherwise — so the motion is already established, and
         * the escape test is what separates a departure from a reveal.
         */
        const inline = el.style
        return (
          inline != null &&
          inline.opacity !== '' &&
          Number.parseFloat(inline.opacity) === 0 &&
          !revealed(el)
        )
      }
      /*
       * **A transition's curve is `transition-timing-function`; an animation's
       * is `animation-timing-function`, and reading the first for the second
       * reads a property the element is not using.**
       *
       * The first version asked `transitionTimingFunction` whatever the motion
       * was. An element whose only motion is a `@keyframes` has the *initial*
       * `ease` sitting in that property untouched, and `ease` is not a token —
       * except it was never flagged, because the same blindness cut both ways:
       * an `animation: … steps(9)` reported `ease` and passed, while
       * `animate-rise-in`, which is entirely ours, would have been reported as
       * « hors jetons » for a curve it does not have. One property missing,
       * a false negative and a false positive at once.
       */
      const reading = (el, pseudo) => {
        const style = getComputedStyle(el, pseudo)
        // A pseudo-element that is not generated has no box and no motion; its
        // `content` is `none`, and measuring it would invent findings.
        if (pseudo && (style.content === 'none' || style.content === '')) return null
        const durations = [...split(style.transitionDuration), ...split(style.animationDuration)]
          .map((d) => ms(d))
          .filter((n) => n !== null && n > 0)
        if (durations.length === 0) return null
        const curves = []
        if (split(style.transitionDuration).some((d) => (ms(d) ?? 0) > 0)) {
          curves.push(...split(style.transitionTimingFunction))
        }
        if (split(style.animationDuration).some((d) => (ms(d) ?? 0) > 0)) {
          curves.push(...split(style.animationTimingFunction))
        }
        const normalised = curves.map((e) => e.replace(/\s+/g, ''))
        const label =
          (el.id ||
            el.getAttribute('aria-label') ||
            `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`) +
          (pseudo ?? '')
        /*
         * **Which end of the motion the slow part belongs to** — the half this
         * check could not see, and the reason it reported green over a blink.
         *
         * Every curve in `:root` is an allowed curve, by design, so a new token is
         * honoured the moment it is declared. What that can never ask is whether
         * this element is arriving or leaving. There was one curve for a year, and
         * VISION.md §6 said « ease-out » flat, so the single exit in this product —
         * the widget, the one surface drawn over another application — wore the
         * *entering* curve: `--ease-out` is an expo-out that spends 73% of its
         * change in the first 35ms, which is what makes an arrival feel instant and
         * then settle, and on a departure is a blink followed by 88ms of a fully
         * transparent always-on-top window still over the rep's call. Measured on
         * the shipped element in Chromium: opacity 0.768 at 9ms, 0.278 at 35ms,
         * 0.018 at 93ms — under 0.05 for the last 74 of 150ms. With `--ease-in`,
         * the same element measures 0.999 / 0.998 / 0.909 and lands at 151ms.
         *
         * **Both halves of this rule were named rather than measured, and an
         * adversarial round walked through six holes in one sitting.** The first
         * version asked « does the class name say `leaving`, and is the curve the
         * `--ease-out` token »:
         *
         *   · redefining `--ease-in` to `cubic-bezier(0.22, 1, 0.36, 0.99)` — the
         *     same blink to three decimal places, measured 0.768/0.278/0.018 —
         *     passed, because it is not the `--ease-out` *string*;
         *   · renaming `--ease-out` turned the rule off entirely and silently:
         *     `enterCurve` became `''` and `allowedEase.has('')` is false, so
         *     `entering` was false for every element on every stage;
         *   · moving the fade to `.widget-leaving > *` was invisible — the child
         *     carries no `leaving` in its own class list — and the census did not
         *     move either (3 → 3), so the count could not betray it;
         *   · a curve inside `@keyframes` was invisible to both halves;
         *   · an SVG can never say it is leaving at all: `className` on an
         *     `SVGElement` is an `SVGAnimatedString`, and `.toString()` on it is
         *     the literal `"[object SVGAnimatedString]"`;
         *   · and a false positive sat one keystroke away: `tailwind.config.js`
         *     ships the utility class `ease-out`, and `-out` matched as a word, so
         *     `className="transition ease-out"` on anything arriving would have
         *     been reported as a departure on the arrival curve.
         *
         * So neither half is named now. **The curve is judged by its shape**, which
         * is `frontLoaded` below: the mean of the progress function over the
         * duration, which is 0.827 for `--ease-out`, 0.824 for that near-identical
         * attack, 0.667 for the CSS keyword `ease`, 0.625 for `ease-out`, exactly
         * 0.5 for `linear` and `ease-in-out`, 0.375 for `ease-in` and 0.173 for
         * `--ease-in`. A curve that spends more than `FRONT_LOADED` of its change
         * early is an arrival curve whatever it is called, and the rule survives
         * every rename and every near-miss respelling because no token identity
         * enters into it.
         *
         * **And a departure is read off the stylesheet, not off a word.**
         * `leavingHere` unions three signals, every one of them a measurement:
         * a rule in the cascade that sets `opacity: 0` (so `.widget-leaving`, and
         * `.widget-leaving > *`, and anything else, matched by the selector rather
         * than by a name); a `@keyframes` whose progression ends more transparent
         * than it starts, matched on `animation-name`; and an **inline**
         * `opacity: 0` beside an inline `transition` or `animation`, which no
         * stylesheet declares. The third is deliberately inline and not *computed*:
         * a computed zero under a live duration is exactly the reveal-on-hover
         * button two paragraphs above, resting at zero and arriving, and reading it
         * would hand back the seven false findings this rule was built to lose.
         * None of the three can read an SVG wrongly,
         * because none of them reads a class name, and none of them fires on
         * Tailwind's `ease-out` utility, because that utility sets a timing
         * function and nothing else.
         */
        const leaving = leavingHere(el, pseudo, style)
        const wrong = normalised.filter((e) => frontLoaded(e) !== null && frontLoaded(e) > FRONT_LOADED)
        return {
          what: label,
          dur: [...new Set(durations)].map((n) => `${n}ms`).join(' '),
          ease: [...new Set(normalised)].join(' '),
          offToken: durations.some((n) => !allowedMs.has(n)),
          offCurve: normalised.some((e) => e !== 'linear' && !allowedEase.has(e)),
          leaving,
          wrongWay: leaving && wrong.length > 0 ? wrong[0] : null,
          // The measurement behind the verdict, so the finding is evidence rather
          // than an assertion — and so a tuned `FRONT_LOADED` can be argued about
          // against a number the check printed.
          share: leaving && wrong.length > 0 ? Math.round(frontLoaded(wrong[0]) * 100) : null,
        }
      }
      for (const el of document.querySelectorAll('#root *')) {
        /*
         * **`::before` and `::after` are motion too, and `querySelectorAll`
         * cannot reach them.** `index.css` already draws a `.pane-label::before`;
         * the day one of those takes a transition, nothing was measuring it.
         */
        for (const pseudo of [null, '::before', '::after']) {
          const found = reading(el, pseudo)
          if (found) out.push(found)
        }
      }
      // The census travels with the findings: a run that read no stylesheet and
      // therefore recognised no departure has to be able to say so.
      return {
        items: out,
        unreadableSheets,
        selectors: leavingSelectors.length,
        reveals: revealSelectors.length,
        keyframes: leavingKeyframes.size,
      }
    })

  const live = await scan()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await scan()
  // Put it back: this page is photographed after the checks run, and a stage
  // shot under an emulated media query is not the stage.
  await page.emulateMedia({ reducedMotion: null })

  return {
    undeclared: live.items.filter((m) => m.offToken || m.offCurve),
    backwards: live.items.filter((m) => m.wrongWay),
    persisting: reduced.items,
    /*
     * **How much the departure half of this check had to work with**, printed on
     * a pass.
     *
     * `seen` alone could not betray the `.widget-leaving > *` attack: the count
     * stayed at three while the rule stopped applying. What moved — and what
     * nothing was printing — is how many *departures* were recognised, so a
     * stage whose exit animation stopped being identified as one says
     * « 0 sortie » instead of « dans le bon sens ». `unreadable` is the same
     * property one level down: if every stylesheet were cross-origin, the two
     * declarative signals would find nothing and only the computed-opacity one
     * would remain.
     */
    departures: live.items.filter((m) => m.leaving).length,
    unreadable: live.unreadableSheets,
    declared: { selectors: live.selectors, reveals: live.reveals, keyframes: live.keyframes },
    /*
     * **How many elements were actually looked at**, printed even when the
     * check passes.
     *
     * This is the `--scrollers` lesson in its other half. That check scoped
     * itself to a landmark list, visited **zero** elements on a screen with no
     * landmark, and printed « rien de caché » over four unmeasured panes — and
     * nothing in its output distinguished « I looked and found nothing » from
     * « I looked at nothing ». A silent zero reads as evidence.
     *
     * Zero is not a failure here: a stage can legitimately hold no animated
     * element, and a splash with three static rows does. It is a *number a human
     * can see*, so « tout passe par les jetons » on a stage that measured
     * nothing cannot be mistaken for a stage that measured forty.
     */
    seen: live.items.length,
  }
}

/**
 * **Is every control big enough to hit?**
 *
 * WCAG 2.2's *Target Size (Minimum)* asks for 24×24 CSS pixels, and the
 * exception it grants is the one that matters here: a control that is **inline
 * in a sentence** is exempt, because making it 24px tall would break the line it
 * sits in. Everything else — a chip, a segmented option, a « source ▸ », a
 * checkbox, a close — is measured.
 *
 * The reps this ships to are on Windows laptops with trackpads (HR-2), not on
 * phones, so this is not about thumbs. It is about a 16px control in a dense
 * rail beside eleven others: the miss costs a click, the click lands on the row
 * below, and on the review gate the row below is a field a rep did not mean to
 * touch.
 *
 * Measured, not read: a `py-0.5` looks fine in the source and is 18px on screen
 * once the line-height under it resolves.
 */
async function targets(page) {
  return page.evaluate(() => {
    const MIN = 24
    const out = []
    const controls = document.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="checkbox"], [role="tab"]',
    )
    /*
     * **A control that is not rendered is exempt; one that has been crushed to
     * nothing is the worst target there is.**
     *
     * The first version skipped every zero-sized box, which is right for a
     * `display: none` panel behind a tab and catastrophically wrong for a text
     * field that lost a flex fight: at 960 the session header's client input
     * compressed to *fourteen* pixels and then to zero, and this check called it
     * fine. Not rendered is `display: none`, `visibility: hidden` or no layout
     * box at all; anything else with a zero dimension is on screen and
     * unhittable, and is reported as such.
     */
    const drawn = (el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      // `position: fixed` has no `offsetParent`, so it is asked about last.
      return el.offsetParent !== null || style.position === 'fixed'
    }

    for (const el of controls) {
      if (!drawn(el)) continue
      const box = el.getBoundingClientRect()
      // Half a pixel of slack: a 24px box lands on 23.99 under a fractional
      // line-height, and a check that reports that is a check nobody can clear.
      const big = (v) => v >= MIN - 0.5
      if (big(box.width) && big(box.height)) continue

      /*
       * The inline exception, and it is the whole reason this check is usable.
       * A control whose parent is a paragraph of prose is *in* a sentence — the
       * citation inside an answer, the « Réglages » inside a reason — and WCAG
       * exempts it because enlarging it would break the line. Detected by the
       * parent being text-bearing rather than by a class, so it cannot be
       * claimed by adding one.
       */
      /*
       * A checkbox inside its own `<label>` has the *label* as its target — the
       * whole row is clickable, which is what a rep aims at and what WCAG
       * measures. Reporting the 13×13 box the OS draws would be reporting the
       * paint rather than the affordance, and the fix it implied — a giant
       * checkbox — is not one anybody wants.
       */
      const label =
        el.closest('label') !== el ? el.closest('label') : null
      // `for=` counts as much as wrapping: both make the whole label the thing
      // a rep aims at, which is what the criterion measures.
      const linked = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null
      for (const target of [label, linked]) {
        if (!target) continue
        const around = target.getBoundingClientRect()
        if (big(around.width) && big(around.height)) { box.__ok = true; break }
      }
      if (box.__ok) continue

      const parent = el.parentElement
      const inline =
        parent !== null &&
        getComputedStyle(el).display.startsWith('inline') &&
        (parent.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 8
      if (inline) continue

      out.push({
        tag: el.tagName.toLowerCase(),
        text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        w: Math.round(box.width),
        h: Math.round(box.height),
      })
    }
    return out
  })
}

/**
 * **Does what hangs in a gutter still fit on screen?**
 *
 * The compte-rendu's `#`, `##`, `###` and `- ` hang left of the prose in an
 * `absolute right-full` span — which is a promise about *painted geometry*, and
 * the only kind of promise a DOM test cannot check. Ten of the twenty-three
 * markers on a real document were clipped for three review rounds: every one of
 * them was in the accessibility tree, every one of them read correctly in
 * `page.innerText`, and a third of the `###` was simply not on screen. The
 * screenshots showed it and nobody's eye caught a nine-pixel truncation of a
 * character that is *supposed* to be faint.
 *
 * So it is measured. Anything marked `data-hangs` is compared against the
 * padding edge of the nearest ancestor that clips — its scroll container, or
 * failing that the element it is positioned in. An overhang of a pixel or two is
 * sub-pixel rounding; anything more is a marker the rep cannot read.
 */
async function geometry(page) {
  return page.evaluate(() => {
    const clips = (el) => {
      const style = getComputedStyle(el)
      return style.overflowX !== 'visible' || style.overflowY !== 'visible'
    }
    const frameOf = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (clips(node)) return node
      }
      return el.offsetParent ?? document.documentElement
    }
    const out = []
    let tightest = { by: Infinity, text: '' }
    const all = document.querySelectorAll('[data-hangs]')
    for (const el of all) {
      const box = el.getBoundingClientRect()
      if (box.width === 0) continue
      const frame = frameOf(el)
      const around = frame.getBoundingClientRect()
      const pad = parseFloat(getComputedStyle(frame).paddingLeft) || 0
      const by = Math.round(around.left + pad - box.left)
      // One pixel is sub-pixel rounding. Two is a character losing a stroke.
      if (by > 1) out.push({ what: el.dataset.hangs, text: (el.textContent ?? '').trim(), by })
      // The tightest clearance, so the gutter can be tuned against the widest
      // marker rather than against the one that happened to break first.
      if (-by < tightest.by) tightest = { by: -by, text: (el.textContent ?? '').trim() }
    }

    /*
     * **A rule drawn edge to edge under text that is indented from it is a box
     * with the box rubbed out.**
     *
     * `List bare` takes the stroke and the radius off a list and keeps the
     * hairlines between its rows. What it could not take off was `Row`'s
     * horizontal padding, which exists to hold the text away from an edge
     * stroke — so every boxless list in the product drew a full-bleed hairline
     * with its rows inset 16 to 20 px inside it, and the section caption above
     * sat on the outer edge while the first row sat on the inner one. Six lists
     * in Réglages, two on the agenda, and on the agenda they had shipped that
     * way since the round that removed the boxes. It is the « 132 px spread of
     * title left edges » `src/ui/List.tsx` already records, one indent smaller
     * and on every screen at once.
     *
     * Stated as geometry rather than as a class, so it holds for any grouping
     * built this way and not only for `List`: a container that paints no left
     * edge of its own, whose children are separated by a horizontal rule that
     * spans the container, must start those children's content on the
     * container's own content edge.
     *
     * « Paints no left edge » is measured, not read: a container with a left
     * border, or with a background of its own that differs from what is behind
     * it, is a box, and a box is allowed to inset its contents — that is what
     * padding is for.
     */
    const painted = (el) => {
      const style = getComputedStyle(el)
      if (parseFloat(style.borderLeftWidth) > 0 || parseFloat(style.borderRightWidth) > 0) return true
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') return true
      return style.backgroundImage !== 'none' || style.boxShadow !== 'none'
    }
    const inset = []
    let groups = 0
    for (const group of document.querySelectorAll('ul, ol, div, section')) {
      const rows = [...group.children].filter((row) => row.getBoundingClientRect().height > 0)
      if (rows.length < 2) continue
      // A rule between the rows, spanning the group: that is the divider that
      // makes this a group at all.
      const ruled = rows
        .slice(1)
        .every((row) => parseFloat(getComputedStyle(row).borderTopWidth) > 0)
      if (!ruled) continue
      const box = group.getBoundingClientRect()
      const style = getComputedStyle(group)
      const edge = box.left + (parseFloat(style.paddingLeft) || 0)
      if (painted(group)) continue
      const spans = rows.every((row) => Math.abs(row.getBoundingClientRect().width - box.width) <= 1)
      if (!spans) continue
      groups += 1
      for (const row of rows) {
        const rowStyle = getComputedStyle(row)
        const start = row.getBoundingClientRect().left + (parseFloat(rowStyle.paddingLeft) || 0)
        const by = Math.round(start - edge)
        if (by > 1) {
          inset.push({ by, text: (row.textContent ?? '').trim().slice(0, 44), tag: row.tagName.toLowerCase() })
          break
        }
      }
    }


    return { clipped: out, measured: all.length, tightest, inset, groups }
  })
}

/**
 * **The census: how many rungs of one ladder is a screen standing on at once?**
 *
 * Every measured check in this harness asks about **one** element. `--targets`
 * asks one box against 24×24. `--contrast` asks one ink against one ground.
 * `check:tokens` asks whether one value is on the declared ladder. None of them
 * can ask the question a craft review actually asks, which is a question about a
 * *distribution*: this card is standing on four radius families and five control
 * heights at the same time, and every individual value is impeccable.
 *
 * That gap was falsified in both directions before this function was written.
 * `rounded-[7px]` — an arbitrary value — turns `check:tokens` red, so the
 * arbitrary-value hole is shut. `rounded` — 12px, a **declared** rung — put on
 * the widget's panel left **twelve gates green, 164 stagings green over all nine
 * existing checks, and 52 widget renderer tests green**, with the largest object
 * on that surface wearing a third radius family nothing in the repo could see;
 * `--census` alone went red and named the element. A rung is not a defect;
 * standing on all of them at once is.
 *
 * ## Three ladders, one shape
 *
 * **Corner radius.** The rungs are read out of `:root` at runtime — **every**
 * custom property whose name begins `--radius`, the way `--motion` builds its
 * allowed curve set by prefix. This paragraph said exactly that for two rounds
 * while the line under it iterated a hand-written
 * `['--radius-sm', '--radius', '--radius-lg']`, and the difference had a price:
 * `--radius` (12px) is worn by 0 of 40 388 corners over 170 stagings and could
 * not be deleted, because the guard was `< 3` and every stage then failed « 2
 * échelon(s) lus dans :root au lieu de 3 ». The instrument that proved a token
 * dead was the reason it could not be removed. A rung added is honoured on
 * declaration; a rung removed shrinks the ladder, and any corner still wearing
 * it is reported as stray. The two rungs that are *not* in `:root` —
 * `rounded-bar` (1px, declared in `tailwind.config.js` for the input meter's
 * caps) and `rounded-full` — are not named here either: they are recognised by
 * **shape**, because naming them would be a second copy of the ladder that can
 * go stale.
 *
 *   - a radius equal to a card rung is a card corner, whatever it is on;
 *   - otherwise a radius at or past half the element's shorter side is a
 *     stadium or a circle — `rounded-full` on a dot, a pill, a chip — which is a
 *     different shape and not a rung on the corner ladder;
 *   - otherwise an element whose shorter side is under the smallest card rung
 *     cannot wear a card rung at all: it is a cap on a bar. `LevelMeter`'s bars
 *     measure about 6×4–9 and `tailwind.config.js` argues at length that the
 *     10–14 band would round each of them into a dot. Round 20 read the 80
 *     corners those 20 spans produce as « 80 spans that should be
 *     `rounded-full` », which is wrong twice over, and this exemption is
 *     measured rather than claimed so the next round does not repeat it;
 *   - anything else is **off the ladder** and is a finding.
 *
 * The rule that fails is: at most **two** card rungs on one screen. Two, not
 * one, because a 10px control inside a 14px card is concentric radius and is
 * deliberate — swept over the whole list, **102 of the 164 stagings** wear
 * exactly that pair and the remaining 62 wear `--radius-sm` alone. Three is a
 * ladder nobody is climbing. The middle rung, `--radius` at 12px, is worn by
 * **zero** elements in all 164 — which is why the sentence names what a run did
 * *not* find as well as what it did, the same shape `tailwind.config.js`
 * deleted `shadow-card` for eleven lines above where it declares this one.
 *
 * **Control height.** A raw height census is noise: a control that wraps is
 * sized by the client's sentence, not by its author. So only *authored* heights
 * are counted — a field, or a control holding at most one line box — and the
 * rule is the sharpest one the data supports: **one component may not be drawn
 * at two heights on one screen.** A component is its tag plus its class list,
 * which is what a React component produces and what `--echo` already uses to
 * recognise a repetition along a list.
 *
 * Swept over all 82 stages at both sizes before any fix, that rule fires on
 * **35 stagings across 27 screens**, and on two controls:
 *
 *   - the widget, 16 stagings (8 stages × both sizes) — « Retirer ce moment
 *     marqué » at **24px and 39px** on one 340px card. Its neighbour was worse
 *     and invisible to the rule, because all five of them agreed: « Marquer
 *     cette prise de parole » drawn **24×58.5** five times over. Both buttons
 *     carry `min-h-[24px]` inside `<li class="group flex">`, whose
 *     `align-items` defaults to `stretch`, so the glyph the rep aims at was
 *     centred on the whole turn: measured on `widget-ouvert`, the seven rows of
 *     that panel put their control's glyph at **12, 19.5 and 29.3px** from the
 *     row top while every speaker label and first line sat at one offset. The
 *     control column tracked how long the client spoke. `self-start` on both:
 *     all seven now at 12px, and the widget's authored height families drop
 *     from four to two;
 *   - the compte-rendu, 19 stagings — **all of them at 960×600 only**, which is
 *     the half of the matrix a comfortable pass never reads. « Voir la source
 *     dans la transcription » at **24.38px and 48.75px**: the button is
 *     `inline-block`, its text fits one line at 438 of 453 available pixels,
 *     and the `opacity-0` magnifier that follows it does not — so the
 *     followable line is drawn two line boxes tall with nothing on the second,
 *     and `hover:bg-inner` fills all of it. Not fixed here: it is
 *     `src/screens/session/CompteRenduDocument.tsx`, another lane's file.
 *
 * Note what the rule cannot see, since a blind spot stated is a blind spot the
 * next round does not have to rediscover: a component drawn at **one** wrong
 * height everywhere — the five 24×58.5 bookmarks — is a single-valued
 * distribution and passes. The printed line is the evidence for that case; the
 * failure is only for the split.
 *
 * The looser rules were measured and rejected rather than guessed, over the
 * same 164 stagings: « two controls in one flex row at different heights »
 * fires on **90 stagings / 45 screens** (a ghost beside a primary is a
 * hierarchy, not a defect), and « one accessible name, two heights » on
 * **66 / 33** (the day grid's *Aujourd'hui* and the nav's *Aujourd'hui* are two
 * different controls that share a word).
 *
 * **Icon stroke.** Moved here from `--geometry`, unchanged, because it is the
 * same question and there should be one place that asks it.
 */
async function census(page) {
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100

    /*
     * **The ladder is discovered, and for two rounds this said so over a list.**
     *
     * It read `['--radius-sm', '--radius', '--radius-lg']` — three names typed
     * here — under a docblock claiming the rungs came « out of `:root` at
     * runtime the way `--motion` builds its allowed curve set ». The cost was
     * not theoretical: `--radius` (12px) is worn by 0 of 40 388 corners across
     * 170 stagings, `tokens.css` says so at length, and the token could not be
     * deleted because the guard below was `< 3` and every stage then failed « 2
     * échelon(s) lus dans :root au lieu de 3 », exit 15. The instrument that
     * proved a token dead was the reason it could not be removed.
     *
     * Every custom property whose name begins `--radius` now, the way `motion()`
     * takes `--motion` and `--ease`.
     */
    const root = getComputedStyle(document.documentElement)
    const rungs = []
    for (const name of root) {
      if (!name.startsWith('--radius')) continue
      const raw = root.getPropertyValue(name).trim()
      const value = Number.parseFloat(raw)
      if (raw !== '' && Number.isFinite(value)) rungs.push({ name, value: round(value) })
    }
    rungs.sort((a, b) => a.value - b.value)
    const ladder = rungs.map((r) => r.value)
    const smallest = ladder.length > 0 ? Math.min(...ladder) : 0

    const CORNERS = [
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
      'borderBottomLeftRadius',
    ]
    const worn = new Map()
    const stadiums = new Map()
    const caps = new Map()
    const stray = []
    let rounded = 0

    /*
     * **Authored, not wrapped.** A control holding two line boxes is as tall as
     * the client's sentence made it; only a control holding one — or a field,
     * which has no child text node at all — has a height its author chose.
     */
    const lineBoxes = (el) => {
      let n = 0
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 3 && (child.textContent ?? '').trim() !== '') {
            const range = document.createRange()
            range.selectNodeContents(child)
            for (const rect of range.getClientRects()) if (rect.height > 0) n += 1
          } else if (child.nodeType === 1) walk(child)
        }
      }
      walk(el)
      return n
    }

    const shapes = new Map()
    const heights = new Map()
    const CONTROLS =
      'button, a[href], input:not([type="hidden"]), select, [role="button"], [role="tab"], [role="switch"], [role="checkbox"]'

    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const box = el.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) continue
      const shorter = Math.min(box.width, box.height)
      const near = ((el.getAttribute('aria-label') || el.textContent || '').trim() || el.tagName)
        .replace(/\s+/g, ' ')
        .slice(0, 30)

      const values = [...new Set(CORNERS.map((corner) => style[corner]).filter((v) => v !== '0px' && v !== '0%'))]
      if (values.length > 0) rounded += 1
      for (const value of values) {
        /*
         * A percentage radius is off the ladder by construction: it is a share
         * of the box, so it is a different value on every element that wears it.
         */
        if (value.includes('%')) {
          stray.push({ value, near, size: `${Math.round(box.width)}×${Math.round(box.height)}` })
          continue
        }
        const radius = round(Number.parseFloat(value))
        const rung = rungs.find((r) => Math.abs(r.value - radius) < 0.51)
        if (rung) {
          const seen = worn.get(rung.name) ?? { value: rung.value, n: 0, near }
          seen.n += 1
          worn.set(rung.name, seen)
        } else if (shorter < smallest && radius < smallest) {
          /*
           * Asked **before** the stadium test, and the order is load-bearing: a
           * meter bar is 6px wide and its height rides the rep's voice, so at
           * 2px tall a 1px cap is also « at least half the shorter side » and
           * the same twenty spans were counted as caps on one frame and as
           * pills on the next. A cap is the more specific case, so it goes first.
           */
          const seen = caps.get(String(radius)) ?? { n: 0, near }
          seen.n += 1
          caps.set(String(radius), seen)
        } else if (radius >= shorter / 2 - 0.01) {
          const seen = stadiums.get(String(radius)) ?? { n: 0, near }
          seen.n += 1
          stadiums.set(String(radius), seen)
        } else {
          stray.push({ value, near, size: `${Math.round(box.width)}×${Math.round(box.height)}` })
        }
      }

      if (el.matches(CONTROLS)) {
        const field = el.tagName === 'INPUT' || el.tagName === 'SELECT'
        if (field || lineBoxes(el) <= 1) {
          const height = round(box.height)
          const key = `${el.tagName.toLowerCase()}.${[...el.classList].sort().join('.')}`
          const shape = shapes.get(key) ?? { near, tall: new Map() }
          shape.tall.set(height, (shape.tall.get(height) ?? 0) + 1)
          shapes.set(key, shape)
          const tally = heights.get(String(height)) ?? { n: 0, near }
          tally.n += 1
          heights.set(String(height), tally)
        }
      }
    }

    /*
     * Sub-pixel is not a second height: a 24px box lands on 23.99 under a
     * fractional line-height, exactly as `--targets` allows. A whole pixel apart
     * is a decision somebody made.
     */
    const split = []
    for (const [key, shape] of shapes) {
      const tall = [...shape.tall.keys()]
      if (tall.length < 2) continue
      if (Math.max(...tall) - Math.min(...tall) <= 1) continue
      split.push({
        near: shape.near,
        shape: key.slice(0, 80),
        tall: [...shape.tall].sort((a, b) => a[0] - b[0]).map(([h, n]) => `${h}px ×${n}`),
      })
    }

    /*
     * **One icon weight, and there were three.** Moved here from `--geometry`
     * unchanged: it is the same question this function exists to ask, and it was
     * the only distribution rule in the repo before it.
     *
     * Measured over every stage at both sizes when it was written: 500 icons at
     * `stroke-width: 2` (lucide's default), 250 at 1.75 (two hand-rolled
     * `<svg>`s with no recorded reason for the number), and 4 at 1 on the widget.
     * Re-swept the round this moved: **792 icons, every one of them at 2, and no
     * staging drawing two weights** — so it is a regression guard and nothing
     * else today, which is a thing a check has to be able to say about itself.
     * Falsified rather than assumed: putting `strokeWidth="1.75"` back on the app
     * rail's hand-rolled glyph (`ui/Rail.tsx`) — the exact regression — turns
     * **50 stagings across 25 screens** red, every one of them a screen that
     * draws the rail beside a lucide icon.
     *
     * The weight is read off the `<svg>` first and off its first stroked child
     * second, because lucide puts it on the root and a hand-rolled glyph may put
     * it on the path. Icons only — anything wider than 24px is a mark or a
     * wordmark (`ui/Logo.tsx` is 32 and 64) and has its own weight by right. A
     * **filled** glyph has no stroke weight and reading one off it invented a
     * third value: the widget's pause and stop marks are `fill="currentColor"`
     * with no stroke, and `getComputedStyle().strokeWidth` answers the CSS
     * initial `1px` for them.
     */
    const weights = new Map()
    for (const svg of document.querySelectorAll('svg')) {
      const box = svg.getBoundingClientRect()
      if (box.width === 0 || box.width > 24) continue
      const carrier = svg.hasAttribute('stroke-width') ? svg : svg.querySelector('[stroke-width]')
      if (carrier === null) continue
      const painted = getComputedStyle(carrier).stroke
      if (painted === 'none' || painted === '') continue
      const key = String(Number.parseFloat(carrier.getAttribute('stroke-width')))
      const seen = weights.get(key) ?? { count: 0, near: '' }
      seen.count += 1
      if (!seen.near)
        seen.near = (svg.closest('button, a, label, li, div')?.textContent ?? '').trim().slice(0, 30)
      weights.set(key, seen)
    }

    return {
      ladder: rungs,
      rounded,
      worn: [...worn].map(([name, seen]) => ({ name, value: seen.value, n: seen.n, near: seen.near })),
      unworn: rungs.filter((r) => !worn.has(r.name)).map((r) => `${r.name} (${r.value}px)`),
      stadiums: [...stadiums].map(([value, seen]) => ({ value, n: seen.n, near: seen.near })),
      caps: [...caps].map(([value, seen]) => ({ value, n: seen.n, near: seen.near })),
      stray,
      controls: [...heights].sort((a, b) => b[1].n - a[1].n).map(([h, t]) => ({ h, n: t.n, near: t.near })),
      split,
      strokes: [...weights]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([width, seen]) => ({ width, count: seen.count, near: seen.near })),
    }
  })
}

/**
 * **The declared deviations from the spacing ladder, and why each is not a step.**
 *
 * Keyed by the painted value, the element signature and the side, the way
 * `check-platform.mjs` keys its allowances. `scripts/__tests__/rhythmAllowances.test.mjs`
 * holds every entry to a live site in `src/`, so an allowance cannot outlive the
 * code it excuses — that direction is a source grep and belongs in a test, not in
 * a pass that only ever sees one screen.
 *
 * There are two, and both were argued in the tree before this pass existed.
 * Everything else the sweep found is a finding, not an allowance: an allowance
 * is a reason, and « nobody has changed it yet » is not one.
 */
const RHYTHM_ALLOWANCES = [
  {
    value: 1,
    at: /^span\.text-muted\.flex\.w-12/,
    sides: ['Top'],
    why:
      'One pixel, and it is not a gap between two things: the widget’s mark rows ' +
      'nudge their timestamp column onto the first line of the prose beside it, ' +
      'which is set at a different size. An optical alignment inside one row — ' +
      'the reason is `src/widget/__tests__/spacing.test.tsx`’s own, shipped with ' +
      'the `pt-px` it covers.',
  },
  {
    value: -1,
    at: /^li\.scroll-mt-snug/,
    sides: ['Left', 'Right'],
    why:
      'The open record’s stroke, pulled over the list’s hairlines rather than ' +
      'beside them (`-mx-px`, `src/screens/Historique.tsx`). It is the width of a ' +
      'border and it exists so the row does not step sideways as it opens — ' +
      'border geometry, not a rung of a ladder whose smallest step is four.',
  },
]

/**
 * **Spacing rhythm, computed — rubric axis 3, which nothing measured.**
 *
 * The axis makes three claims: « One scale, visible at a glance. Tight groups,
 * generous separation, more space above a heading than below. » Ten passes ran
 * over every stage and **none of them read a gap**. `--census` counts radii,
 * pips, bar caps, authored control heights and icon strokes, and prints
 * byte-identical output on either side of a change that regroups a whole
 * surface — which is how lane e found this: the widget's pill had six children
 * at five identical intervals, and the pass whose job is « one screen, one
 * ladder » had nothing to say about it.
 *
 * A renderer unit test can read what a component *declares*
 * (`src/widget/__tests__/spacing.test.tsx` does, over `src/widget/**`), and that
 * is the right tool for a declaration. It cannot read a **seam that nothing
 * declares** — two bands each padding themselves produce a separation that is
 * the sum of two paddings and is on no element in the tree — and jsdom answers
 * zero for every box, so nothing in `npm test` can measure a painted interval at
 * all. This runs in the browser, on all 85 stages at both sizes.
 *
 * ## What it reads, and what it refuses to read
 *
 * Every painted `gap`, `padding` and `margin`, through the **Typed OM**
 * (`computedStyleMap`) rather than `getComputedStyle`: margins resolve to their
 * *used* value, so the rail's `mt-auto` reads back as `511.03px` — a number no
 * author wrote, about a box nobody spaced. Typed OM answers `auto`, and a
 * keyword is not a length this can compare.
 *
 * Four rules decide what is not rhythm, and each is a rule rather than a list
 * because a list of sites is a list that goes stale:
 *
 *   1. **A drawing is not a layout.** A container none of whose children holds
 *      text, carries an accessible name, or can be operated is a drawn object
 *      with its own geometry — `LevelMeter`'s bars, the onboarding's pips.
 *      Measured over the sweep: **820 gaps** of 1px and 2px, every one of them a
 *      meter. `tailwind.config.js` already argues the same exemption for
 *      `rounded-bar`, and `--census` honours it by shape.
 *   2. **The bare tag's own spacing is not authored.** A probe element of the
 *      same tag, with no class, is built in the page and measured; anything
 *      equal to it is the baseline. Preflight resets almost everything, so this
 *      finds exactly one thing — `th`/`td` at 1px — and it finds it by
 *      measuring rather than by being told.
 *   3. **A length that is not a whole pixel came from the type, not the
 *      ladder.** The seven steps are integers; an `em`-relative margin at a
 *      12–28px size is not. It exempts **three sites, 60 occurrences**, all of
 *      them `CompteRenduDocument`'s heading margins (26.4, 9.6, 20.9) — a
 *      typeset document has its own measure, and claim 3 below still reads it.
 *   4. **A one-sided indent past the top of the ladder is a gutter.** Padding on
 *      one horizontal side with nothing on the other, greater than the widest
 *      step: `pl-10` on the compte-rendu's marker gutter and `pl-16` under a
 *      search result. « A gutter is owned by what hangs in it, and geometry is
 *      measured, not read » — `--geometry` is the pass that owns them.
 *      **Two sites, 80 occurrences.** Symmetric padding of 40 or 48 is *not*
 *      exempt: a card padded past the ladder is exactly what claim 1 is about.
 *
 * ## The three rules that fail
 *
 * **Claim 1 — one scale.** The seven steps are read out of `:root` at runtime,
 * never restated here, for `--census`'s reason: a renamed token has to turn this
 * red rather than quietly shrink what it checks. Tolerance is ±0.5px, because a
 * `rem` step lands on 8.25 and 7.6 at the sizes this product draws and sub-pixel
 * is not a second rung.
 *
 * **Claim 2 — tight groups, generous separation.** A flex or grid container with
 * its own gap, holding a child that is itself a container with its own gap: the
 * inner one must be *smaller*. Swept before this existed, **254 such pairs over
 * 16 sites**, and the ratio histogram is
 * `0.33×5 0.67×12 0.75×10 1.00×76 1.33×2 1.5×40 2.00×96 4×8 6×5` — so a third of
 * them are flat or inverted, which is lane e's pill defect generalised. The floor
 * is « strictly smaller » rather than lane e's 2.0, and the floor comes from the
 * ladder: its adjacent steps are 4→6, 6→8, 8→12, 12→16, 16→20, 20→32, so the
 * smallest real step-down is 1.25 and anything at or under 1.00 is not a group
 * at all. Requiring 2.0 would refuse 8 inside 12, which is two rungs and legible.
 *
 * **Claim 3 — more space above a heading than below.** Measured **geometrically,
 * not through the DOM**, and the first draft measured it through the DOM and was
 * wrong: it compared a heading against its previous *sibling*, so every heading
 * that is the first child of its box reported `0 above` and the check reported
 * 121 violations over 7 sites, almost all of them that artefact. The space a
 * reader sees is the distance to the nearest painted box above that overlaps the
 * heading horizontally, whatever the nesting — 484 headings measured that way
 * across the sweep against 171 the sibling way. The tolerance is the ladder's
 * smallest step: `below` must exceed `above` by a whole rung before it is a
 * difference anybody can see. At 4px the sweep reports **42 occurrences over 16
 * sites on 32 stagings**; at 0.5px it reports 88 over 30, and the extra ones are
 * pairs like 20/21.59.
 *
 * ## What it cannot see, stated so the next round does not rediscover it
 *
 * Claim 2 compares a group against what surrounds it, so **a row with no groups
 * in it at all is invisible to it**. Lane e's pill before the fix was six flat
 * children at one interval: nothing nested, nothing to compare, and this would
 * have printed « 0 groupe(s) imbriqué(s) » and passed. Falsified rather than
 * assumed — `src/widget/Widget.tsx` put back to its pre-`bee480d` form, `widget`
 * at both sizes: claim 2 stays silent and claim 1 turns red on
 * `10px pad Left — div.drag-region…`, which is lane e's own
 * « px-snug → pl-2.5 pr-tight » finding arrived at from the painted pixels
 * instead of from the class list. So the declaration-reading test and this pass
 * are complementary and neither replaces the other.
 *
 * The scale is read by **prefix** — every `--space-*` in `:root` — and the first
 * draft read a list of seven names instead, in the same file where `--census`
 * was reading a list of three radius rungs under a docblock claiming it
 * discovered them. Falsified on `agenda` at 1280×800 by renaming `--space-block`
 * in `tokens.css`: the line goes from « 340 espacements … sur les 7 pas déclarés
 * » to « 337 … sur les 6 », and the printed ladder from `4/6/8/12/16/20/32` to
 * `4/6/8/12/16/32`. So the scale is the one it read and not one it remembers.
 *
 * Note *which* way that failed, because it is the same thing `--census` taught
 * this round: the three 20px paddings did **not** become off-ladder findings,
 * they disappeared — `pt-block` resolves `var(--space-block)`, and a `var()` with
 * no token is an invalid declaration the browser drops, so the spacing is simply
 * not painted. A painted-geometry pass cannot see a rung deleted out from under
 * the classes that wear it; `src/design/tokens.test.ts` is the instrument that
 * can, and it does. The guard here only refuses an *empty* ladder: freezing the
 * count at seven would have made the palette untunable, which is the cost
 * `--radius` paid for rounds.
 *
 * ## What it found on `main`, and it is the axis's own answer
 *
 * Swept over all 85 stages at both sizes: **59 553 painted spacings over 54 886
 * elements, 79.6 % of them on the ladder**; 820 gaps spared as graphics, 80 as
 * indents, 60 as typography; 254 nested group pairs and 484 headings measured.
 * **156 of the 170 stagings are red**, over **63 distinct sites** — 39 off the
 * ladder, 8 groups no tighter than their surroundings, 16 headings with more room
 * below than above.
 *
 * The off-ladder mass is one number: **2px, painted 9 716 times** — `p-0.5`,
 * `py-0.5`, `mt-0.5` — which outnumbers `--space-row` (16px, 3 483) by three to
 * one. Then 14px ×846, 10px ×472, 24px ×124, 28px ×49. `tokens.css` says the
 * scale was « derived from what the screens already repeat » and records having
 * been extended twice for exactly that reason; whether 2px is a rung this product
 * owes a name, or 39 sites that owe a rung, is a decision for the token lane, and
 * this pass's job is that nobody can take it without the count.
 *
 * **The fourteen green stagings are every `widget-*` stage that does not open the
 * panel** — the surface lane e regrouped this round, and the only one in the
 * product that stands on one ladder. The rule is reachable; it is one surface
 * away from being reached everywhere.
 */
async function rhythm(page) {
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100
    const root = getComputedStyle(document.documentElement)

    /*
     * **By prefix, not by a list of seven names** — `--census`'s rule, and the
     * first draft of this was the list `--census` had just been caught holding.
     * Every `--space-*` in `:root`, so a rung added is honoured on declaration.
     */
    const steps = []
    for (const name of root) {
      if (!name.startsWith('--space-')) continue
      const raw = root.getPropertyValue(name).trim()
      const value = Number.parseFloat(raw)
      if (raw !== '' && Number.isFinite(value)) {
        steps.push({ name: name.replace('--space-', ''), value: round(value) })
      }
    }
    steps.sort((a, b) => a.value - b.value)
    const ladder = steps.map((s) => s.value)
    const onScale = (v) => ladder.some((s) => Math.abs(s - Math.abs(v)) <= 0.5)
    const widest = ladder.length > 0 ? Math.max(...ladder) : 0
    const finest = ladder.length > 0 ? Math.min(...ladder) : 0

    /*
     * A probe of the same tag with no class, built in this document so the app's
     * own baseline sheet applies to it. `th` inside a `<tr>` inside a `<table>`
     * or the UA gives it nothing — the ancestry is structural, not a table of
     * values.
     */
    const HOST = {
      th: 'table>thead>tr', td: 'table>tbody>tr', tr: 'table>tbody',
      li: 'ul', option: 'select', figcaption: 'figure', dd: 'dl', dt: 'dl',
    }
    const host = document.createElement('div')
    host.setAttribute('style', 'position:absolute;left:-9999px;top:0;visibility:hidden')
    document.body.appendChild(host)
    const known = new Map()
    const baseline = (tag) => {
      if (known.has(tag)) return known.get(tag)
      host.innerHTML = ''
      let holder = host
      for (const part of (HOST[tag] || '').split('>').filter(Boolean)) {
        const node = document.createElement(part)
        holder.appendChild(node)
        holder = node
      }
      const out = {}
      try {
        const probe = document.createElement(tag)
        holder.appendChild(probe)
        const style = getComputedStyle(probe)
        for (const prop of [
          'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
          'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
          'columnGap', 'rowGap',
        ]) out[prop] = Number.parseFloat(style[prop]) || 0
      } catch {
        // Not a tag this document can make; it has no baseline either.
      }
      known.set(tag, out)
      return out
    }

    const near = (el) =>
      ((el.getAttribute('aria-label') || el.textContent || '').trim() || el.tagName)
        .replace(/\s+/g, ' ')
        .slice(0, 30)
    const where = (el) => {
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : []
      return el.tagName.toLowerCase() + (cls.length > 0 ? '.' + cls.slice(0, 4).join('.') : '')
    }
    const shown = (el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      // A visually-hidden announcement is 1×1 with `margin: -1px`, and neither
      // the box nor the margin is a thing a rep sees.
      if (style.clipPath === 'inset(50%)' || (style.clip && style.clip !== 'auto')) return false
      const box = el.getBoundingClientRect()
      if (box.width <= 1 && box.height <= 1) return false
      return box.width > 0 && box.height > 0
    }
    /** The computed value. `auto` and a percentage are not lengths to compare. */
    const typed = (el, prop, fallback) => {
      try {
        const value = el.computedStyleMap().get(prop)
        if (value === null || value === undefined) return null
        if (typeof value.value !== 'number' || value.unit !== 'px') return null
        return round(value.value)
      } catch {
        return Number.isFinite(fallback) ? round(fallback) : null
      }
    }
    const drawing = (el) => {
      const kids = [...el.children]
      if (kids.length < 2) return false
      for (const kid of kids) {
        if (kid.matches('button, a[href], input, select, textarea, [role="button"], [tabindex]')) return false
        if (kid.getAttribute('aria-label')) return false
        if ((kid.textContent ?? '').trim() !== '') return false
      }
      return true
    }
    const laid = (style) => style.display.includes('flex') || style.display.includes('grid')

    const OPPOSITE = { Top: 'Bottom', Bottom: 'Top', Left: 'Right', Right: 'Left' }
    const off = new Map()
    const spared = new Map()
    const values = new Map()
    let measured = 0
    let drawings = 0

    const painted = [...document.querySelectorAll('body *')].filter(shown)
    for (const el of painted) {
      const style = getComputedStyle(el)
      const base = baseline(el.tagName.toLowerCase())
      const kids = [...el.children].filter(shown)
      const drawn = drawing(el)
      if (drawn) drawings += 1

      /*
       * **One finding per value per element, not one per side.** `p-0.5` on a
       * day cell is one decision an author made once; reporting it four times
       * turned thirteen sites into fifty-two lines and buried the rest.
       */
      const file = (bucket, value, kind, side, why) => {
        const key = `${value}|${kind}|${where(el)}`
        const seen = bucket.get(key) ?? { value, kind, sides: [], at: where(el), near: near(el), why, n: 0 }
        seen.n += 1
        if (side !== '' && !seen.sides.includes(side)) seen.sides.push(side)
        bucket.set(key, seen)
      }
      const take = (kind, prop, value, side) => {
        if (value === null || value === 0) return
        if (Math.abs(value - (base[prop] || 0)) < 0.01) return
        measured += 1
        values.set(value, (values.get(value) ?? 0) + 1)
        if (onScale(value)) return
        if (drawn && kind === 'gap') return file(spared, value, kind, side, 'graphique')
        if (Math.abs(value % 1) > 0.01) return file(spared, value, kind, side, 'typographie')
        if (kind === 'pad' && (side === 'Left' || side === 'Right') && Math.abs(value) > widest) {
          const other = typed(el, 'padding-' + OPPOSITE[side].toLowerCase(), 0) ?? 0
          if (other === 0) return file(spared, value, kind, side, 'retrait')
        }
        file(off, value, kind, side, null)
      }

      if (laid(style) && kids.length > 1) {
        take('gap', 'columnGap', typed(el, 'column-gap', Number.parseFloat(style.columnGap)), '')
        take('gap', 'rowGap', typed(el, 'row-gap', Number.parseFloat(style.rowGap)), '')
      }
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        const low = side.toLowerCase()
        take('pad', 'padding' + side, typed(el, 'padding-' + low, Number.parseFloat(style['padding' + side])), side)
        take('mar', 'margin' + side, typed(el, 'margin-' + low, Number.parseFloat(style['margin' + side])), side)
      }
    }
    host.remove()

    // ── claim 2 ────────────────────────────────────────────────────────────
    const flat = []
    let pairs = 0
    for (const el of painted) {
      const style = getComputedStyle(el)
      if (!laid(style) || drawing(el)) continue
      const kids = [...el.children].filter(shown)
      if (kids.length < 2) continue
      const outer = Math.max(typed(el, 'column-gap', 0) ?? 0, typed(el, 'row-gap', 0) ?? 0)
      if (outer <= 0) continue
      for (const kid of kids) {
        const inside = getComputedStyle(kid)
        if (!laid(inside) || drawing(kid)) continue
        if ([...kid.children].filter(shown).length < 2) continue
        const inner = Math.max(typed(kid, 'column-gap', 0) ?? 0, typed(kid, 'row-gap', 0) ?? 0)
        if (inner <= 0) continue
        pairs += 1
        if (inner >= outer - 0.01) {
          flat.push({ inner, outer, at: where(kid), near: near(kid), in: where(el) })
        }
      }
    }

    // ── claim 3 ────────────────────────────────────────────────────────────
    const boxes = painted.map((el) => ({ el, box: el.getBoundingClientRect() }))
    const headings = []
    let read = 0
    for (const head of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
      if (!shown(head)) continue
      const box = head.getBoundingClientRect()
      let above = null
      let below = null
      for (const { el, box: other } of boxes) {
        if (el === head || head.contains(el) || el.contains(head)) continue
        /*
         * Horizontally over the heading, by at least half the narrower of the
         * two: a box in the next column is not the space above this title.
         */
        const overlap = Math.min(other.right, box.right) - Math.max(other.left, box.left)
        if (overlap < Math.min(other.width, box.width) * 0.5) continue
        if (other.bottom <= box.top + 0.5) {
          const gap = box.top - other.bottom
          if (above === null || gap < above) above = gap
        }
        if (other.top >= box.bottom - 0.5) {
          const gap = other.top - box.bottom
          if (below === null || gap < below) below = gap
        }
      }
      if (above === null || below === null) continue
      read += 1
      if (below - above > finest) {
        headings.push({
          tag: head.tagName.toLowerCase(), above: round(above), below: round(below),
          text: near(head), at: where(head),
        })
      }
    }

    return {
      ladder: steps,
      measured,
      elements: painted.length,
      drawings,
      values: [...values].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n })),
      off: [...off.values()].sort((a, b) => b.n - a.n),
      spared: [...spared.values()].sort((a, b) => b.n - a.n),
      pairs,
      flat,
      read,
      headings,
    }
  })
}

/**
 * **A growing cell starved by its fixed siblings — a whole class of defect that
 * all ten passes are blind to by construction.**
 *
 * Found by lane f on a search result at 960×600: the cell holding the client's
 * name had to break its own text while four fixed-width siblings kept room they
 * did not use, and `line-clamp-2` then cut the word itself, so three results read
 * « Sodex / comi… », « Group Maréc / quali… », « Banqu Delcou / prem… ». A rep at
 * the window's declared minimum could not tell three accounts apart.
 *
 * Every pass was green over it, and `--scrollers`' blindness is **structural**: a
 * `-webkit-box` clamp overflows in the *block* direction, so `scrollWidth ===
 * clientWidth` and the metric it is built on reports nothing. `--prose` counts
 * characters a line, not cells. So this measures the one thing neither can: the
 * width the cell's own contents **want**, through a `Range` over its contents
 * rather than through `scrollWidth`. Verified rather than assumed — driven on the
 * defect with `src/screens/search/Results.tsx` reverted to its pre-`87511ac`
 * form, the Range reports the unclamped 187.1px inside an 88.3px box.
 *
 * ## The rule, and why it is not the one that was proposed
 *
 * Proposed: « report when the one growing cell is the smallest cell in the row ».
 * Measured on the defect itself, that rule **does not fire**: the row is
 * `64 / 88.3↔ / 80 / 112 / 61.7`, and the growing cell at 88.3 is not the
 * smallest — the 61.7px button is. A rule written from a recollection of the
 * screen would have shipped green over the screen it was written for.
 *
 * What the row actually says, and what a rep loses, is an **arithmetic**: the
 * growing cell is 98.8px short of its own text while its fixed siblings hold
 * 164.7px they are not using (`Validée` keeps 80 and wants 41.6; the date keeps
 * 64 and wants 35.5). So the rule is
 *
 *     a cell that grows is short of its text, *and* the cells that do not grow
 *     are holding slack
 *
 * — which is « starved by its fixed siblings » stated as a measurement. Both
 * halves are required: a growing cell short of its text in a row with no slack
 * anywhere is a window too narrow, which is a different finding and not this one.
 *
 * **The floor is one character of the cell's own resolved font**, measured
 * through a canvas the way `--prose` measures its advance, rather than a pixel
 * count chosen after the fact. Swept over all 85 stages at both sizes, the rule
 * with no floor reports exactly one site on `main` — a Réglages row 1.5px short,
 * a quarter of one character, which is nothing a reader can name — against
 * lane f's 98.8px, sixteen characters. The floor separates those two and nothing
 * else in the sweep sits between them.
 *
 * **A cell that can scroll is exempt**, because that is `--scrollers`' subject
 * and it can see it.
 *
 * **An ellipsis is reported, not required.** It is the difference between a cut
 * that says so and a cut mid-word, and it is the half that hurt the rep — but on
 * the very row this exists for the starved cell itself resolves to
 * `text-overflow: clip`, with the ellipsis on one child and the clamp on another,
 * so a rule gated on it would have been asking the wrong box. The state is in the
 * finding so a reader can tell the two apart.
 */
async function cells(page) {
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 10) / 10
    const shown = (el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      if (style.clipPath === 'inset(50%)' || (style.clip && style.clip !== 'auto')) return false
      const box = el.getBoundingClientRect()
      return box.width > 1 && box.height > 0
    }
    /**
     * The widest line box this element's contents produce — a `Range`, never
     * `scrollWidth`, which a block-direction clamp defeats by construction.
     */
    const wants = (el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5)
      return rects.length === 0 ? 0 : round(Math.max(...rects.map((r) => r.width)))
    }
    const near = (el) =>
      ((el.getAttribute('aria-label') || el.textContent || '').trim() || el.tagName)
        .replace(/\s+/g, ' ')
        .slice(0, 34)
    const where = (el) => {
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : []
      return el.tagName.toLowerCase() + (cls.length > 0 ? '.' + cls.slice(0, 5).join('.') : '')
    }
    const scrolls = (el) => {
      const style = getComputedStyle(el)
      return /(auto|scroll)/.test(style.overflowX) || /(auto|scroll)/.test(style.overflowY)
    }
    /*
     * One character of this element's own font, the way `--prose` measures an
     * advance: a sample weighted the way French text is, through a canvas.
     */
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const SAMPLE = 'abcdefghijklmnopqrstuvwxyz eeeaisnrtoluu'
    const advance = (el) => {
      const style = getComputedStyle(el)
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      return ctx.measureText(SAMPLE).width / SAMPLE.length
    }

    const starved = []
    let rows = 0
    let flexible = 0
    for (const row of document.querySelectorAll('body *')) {
      const style = getComputedStyle(row)
      if (!style.display.includes('flex') || style.flexDirection.startsWith('column')) continue
      const kids = [...row.children].filter(shown)
      if (kids.length < 2) continue
      rows += 1
      const cells = kids.map((el) => ({
        el,
        grow: Number.parseFloat(getComputedStyle(el).flexGrow) || 0,
        got: round(el.getBoundingClientRect().width),
        want: wants(el),
      }))
      // What the cells that cannot grow are holding and not using. A fixed cell
      // that itself overflows contributes nothing — it is not hoarding.
      const slack = round(
        cells.filter((c) => c.grow === 0).reduce((total, c) => total + Math.max(0, c.got - c.want), 0),
      )
      for (const cell of cells.filter((c) => c.grow > 0)) {
        if ((cell.el.textContent ?? '').trim() === '') continue
        flexible += 1
        if (scrolls(cell.el)) continue
        const short = round(cell.want - cell.got)
        if (short <= advance(cell.el)) continue
        if (slack <= 0) continue
        const own = getComputedStyle(cell.el)
        starved.push({
          at: where(cell.el), near: near(cell.el),
          got: cell.got, want: cell.want, short, slack,
          characters: Math.round(short / advance(cell.el)),
          ellipsis: own.textOverflow === 'ellipsis',
          clamp: own.webkitLineClamp !== 'none' ? Number(own.webkitLineClamp) : null,
          row: where(row),
          widths: cells.map((c) => `${c.got}${c.grow > 0 ? '↔' : ''}/${c.want}`).join(' '),
        })
      }
    }
    return { rows, flexible, starved }
  })
}

/**
 * Run impeccable's detector in the page, the way the skill's own URL mode does:
 * config first (`autoScan: false`, so nothing decorates the DOM under the
 * camera), then the script, then one call.
 *
 * `impeccableDetectAsync` with `visualContrast` is preferred over the sync
 * entry point because it is the half that measures painted pixels rather than
 * computed styles — the tinted-selection and low-contrast findings this app
 * keeps producing are invisible to the static half.
 */
async function scan(page, screen, flags) {
  let source
  try {
    source = fs.readFileSync(DETECTOR, 'utf8')
  } catch {
    console.error(`✗ détecteur impeccable introuvable: ${DETECTOR}`)
    console.error('  installez la compétence, ou pointez IMPECCABLE_DETECTOR sur detect-antipatterns-browser.js')
    process.exit(3)
  }
  await page.evaluate(() => {
    window.__IMPECCABLE_CONFIG__ = {
      ...(window.__IMPECCABLE_CONFIG__ || {}),
      autoScan: false,
      visualContrast: true,
    }
  })
  await page.evaluate(source)
  const groups = await page.evaluate(async () => {
    const run = window.impeccableDetectAsync ?? window.impeccableDetect
    if (!run) return null
    return run({ decorate: false, serialize: true, visualContrast: true })
  })
  if (groups === null) {
    console.error('✗ le détecteur ne s’est pas installé (window.impeccableDetect absent)')
    process.exit(3)
  }
  return { screen, viewport: flags.viewport, groups }
}

/**
 * One line per finding type with a count, then the file. A flat dump of every
 * occurrence is how a scan of a dense screen becomes unreadable — the detector
 * reports per element, and one wrong token can be forty elements.
 */
function report(findings, target, screen, viewport) {
  const items = findings.groups.flatMap((group) =>
    group.findings.map((f) => ({ ...f, selector: group.selector })),
  )
  if (items.length === 0) {
    console.log('  impeccable: aucun signalement')
  } else {
    const byType = new Map()
    for (const item of items) {
      const bucket = byType.get(item.type) ?? { count: 0, item }
      bucket.count++
      byType.set(item.type, bucket)
    }
    console.log(`  impeccable: ${items.length} signalements, ${byType.size} types`)
    for (const [type, { count, item }] of [...byType].sort((a, b) => b[1].count - a[1].count)) {
      const flag = item.advisory ? '·' : item.severity === 'error' ? '✗' : '⚠'
      console.log(`   ${flag} ${type} ×${count} — ${(item.detail ?? '').slice(0, 110)}`)
    }
  }
  const file = target || path.resolve(REPO, 'scratch', `scan-${screen}-${viewport.width}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(findings, null, 2))
  console.log(`  → ${file}`)
}

/** « 62 icône(s) à stroke-width 2 », or « aucune icône ». */
const icons = (strokes) =>
  strokes.length === 0
    ? 'aucune icône'
    : `${strokes[0].count} icône(s) à stroke-width ${strokes[0].width}`

/** Vite's dev-server chatter, which says nothing about the app. */
const IGNORED = [/\[vite\]/i, /Download the React DevTools/i, /source-?map/i]

const debugDump = async (page) => {
  const text = await page.evaluate(() => document.body.innerText.slice(0, 1200))
  return '   écran affiché:\n' + text.split('\n').map((l) => '   | ' + l).join('\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
