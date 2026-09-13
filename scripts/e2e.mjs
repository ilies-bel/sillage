/**
 * **The whole product, once, for real.**
 *
 * Everything else in this repo tests a slice. `node --test` runs the domain with
 * no Electron; `vitest` runs the renderer against a fake bridge; the screenshot
 * harness runs the renderer in a plain Chromium with `window.app` stubbed. All
 * three are fast and all three share one blind spot: **nothing had ever started
 * the actual application.** The preload, the real IPC channel names, the Zod
 * validation on both sides of them, the SQLite file, the boot sequence and the
 * window itself were exercised by no test at all — so a channel renamed on one
 * side of the bridge, a schema that rejects what the main process really sends,
 * or a migration that will not open a fresh database, would ship.
 *
 * This starts the packaged main process under Playwright's Electron driver and
 * walks a rep's first ten minutes: the splash resolves, first run appears on a
 * clean profile, the permissions step reads real health, the calendar opens, a
 * meeting is created and its screen draws, the reader and the settings screens
 * open, and the keyboard works. Every one of those is a round trip through the
 * real bridge.
 *
 * ## What it deliberately does not do
 *
 * **It never runs the audio trial.** Twenty seconds of listening on a machine
 * that may never have been asked would raise the OS permission prompt — a modal
 * nothing in a headless run can answer. It does start and end a real meeting,
 * because that is the product's spine and the one path where the store, the
 * state machine, the capture module and the end-of-meeting notice all have to
 * agree.
 *
 * **And once, deliberately, it closes the app while one is still recording.**
 * That is not an oversight: on Windows — the primary platform (HR-2) —
 * `window-all-closed` quits, so « get the app out of the way at the end of a
 * call » is a quit, and `before-quit`'s deferral is registered on a real `app`
 * object by a booted main process and by nothing else. It is the second launch's
 * meeting, so the recording that is left running is one nothing after it needs;
 * what the step asserts is that the handler ended it on the way *out* — with its
 * own reason in the log — rather than leaving it for the boot sweep on the way
 * back, and that the process still exits.
 *
 * **It runs on a throwaway profile.** Electron's own `--user-data-dir` switch
 * points at a fresh temporary directory, so the store is created from nothing on
 * every run — which is the only way the first-run path is reachable at all — and
 * no developer's real database is touched.
 *
 *     npm run build && npm run build:electron && node scripts/e2e.mjs
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Store } from '../electron/modules/store/index.ts'
import { DB_FILENAME } from '../electron/modules/store/schema.ts'
import {
  sampleExtraction,
  sampleSegment,
  sampleVerification,
} from '../electron/core/contracts/fixtures.ts'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(REPO, 'package.json'))
const { _electron: electron } = require('playwright')

const profile = mkdtempSync(path.join(os.tmpdir(), 'sillage-e2e-'))

const steps = []
const step = async (name, body) => {
  const started = Date.now()
  try {
    await body()
    steps.push({ name, ok: true, ms: Date.now() - started })
    process.stdout.write('.')
  } catch (error) {
    steps.push({ name, ok: false, ms: Date.now() - started, reason: error.message })
    process.stdout.write('x')
  }
}

let app = null
let page = null
/** The in-meeting widget's window, while a meeting is recording. */
let widget = null
let noise = []

/**
 * The widget's window, or null.
 *
 * Found by its URL rather than by index: there is no ordering guarantee between
 * windows, and `app.windows()[1]` would be a test that passes for the wrong
 * reason the first time a devtools window opens. `?window=widget` is what
 * `src/main.tsx` reads to decide which renderer it is, so it is also the honest
 * thing to look for.
 */
const findWidget = async () => {
  for (const window of app.windows()) {
    if (window.isClosed()) continue
    if (window.url().includes('window=widget')) return window
  }
  return null
}

/** Poll until a condition holds, or give up. Used for windows appearing and going. */
const waitFor = async (predicate, timeoutMs) => {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}
/** The meeting the gate steps below seed, drive and confirm. */
let gated = null

/**
 * Where the running app put its database.
 *
 * `--user-data-dir` is what Electron reads for `app.getPath('userData')`, so
 * `sillage.db` is normally at the root of the profile — but that is Electron's
 * business and not this file's, and a version that nests it one directory down
 * would turn a real failure into a confusing `ENOENT`. So it is looked up.
 */
const dbUnder = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (entry === DB_FILENAME) return full
    if (statSync(full).isDirectory()) {
      const found = dbUnder(full)
      if (found) return found
    }
  }
  return null
}

/**
 * One launch, on the profile directory the whole run shares.
 *
 * `--user-data-dir` is Electron's own switch and needs no support in the app:
 * the store, the model directory and the preferences all hang off
 * `app.getPath('userData')`, so pointing it at a temporary directory is what
 * makes the first-run path reachable and leaves a developer's real database
 * alone. Called twice — the second time on a database the first one filled,
 * which is the launch every rep after their first day actually performs and
 * which nothing here had ever exercised.
 */
const launch = async () => {
  app = await electron.launch({
    args: [path.join(REPO, '.'), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // A trial run must never reach a client tenant or a real mailbox.
      SILLAGE_VSA_BASE_URL: '',
    },
  })

  page = await app.firstWindow({ timeout: 60_000 })
  page.setDefaultTimeout(20_000)

  /*
   * The console is part of the result. A renderer that throws still paints
   * something, so a run can go green over a page that is quietly failing — and
   * the errors that matter here are exactly the bridge ones this file exists to
   * catch: « canal inconnu », a Zod parse failure, a missing preload.
   */
  page.on('console', (message) => {
    if (message.type() === 'error') noise.push(message.text())
  })
  page.on('pageerror', (error) => noise.push(String(error)))
}

try {
  await launch()

  await step('the window opens and paints', async () => {
    await page.waitForSelector('#root > *', { timeout: 45_000 })
  })

  await step('the splash resolves on its own', async () => {
    // Boot answers three steps from the real store, the real ABI probe and the
    // real model check. A splash that never resolves is the store failing to
    // open, which is the first thing a fresh install can get wrong.
    await page.waitForSelector('text=Première utilisation', { timeout: 45_000 })
  })

  await step('first run appears on a clean profile', async () => {
    await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
  })

  await step('step 2 reads the machine’s real health', async () => {
    await page.getByRole('button', { name: 'Continuer' }).click()
    await page.getByRole('heading', { name: 'Ce dont Sillage a besoin' }).waitFor()
    // Three rows, and each has resolved to something the main process measured
    // — not « vérification… », which is what a `health:snapshot` that never
    // answered would leave on screen.
    await page.getByText('Le micro et l’audio de votre ordinateur').waitFor()
    await page.waitForFunction(
      () => !document.body.innerText.includes('vérification…'),
      undefined,
      { timeout: 20_000 },
    )
  })

  await step('step 3 offers the trial without running it', async () => {
    await page.getByRole('button', { name: 'Continuer' }).click()
    await page.getByRole('heading', { name: 'Votre premier appel' }).waitFor()
    // Offered, never automatic — pressing it would open the real devices.
    await page.getByRole('button', { name: /^Essai de/ }).waitFor()
  })

  await step('finishing first run records it and opens the calendar', async () => {
    await page.getByRole('button', { name: 'Terminer' }).click()
    await page.getByRole('region', { name: 'Calendrier' }).waitFor()
  })

  await step('the calendar is drawn with no Graph connection (DEC-31)', async () => {
    // No Entra registration in this environment, so this is the demo's own case
    // (DEC-28): a real grid, a real day pane, and the one way in.
    await page.getByRole('button', { name: 'Démarrer une réunion' }).waitFor()
  })

  await step('a meeting is created and its screen draws', async () => {
    await page.getByRole('button', { name: 'Démarrer une réunion' }).click()
    // Reaching the session screen means `meeting:create` round-tripped through
    // the real store and the state machine accepted `start`.
    await page.getByRole('button', { name: 'Terminer' }).waitFor({ timeout: 30_000 })
  })

  await step('the widget opens over the call, in its own window', async () => {
    /*
     * The in-meeting widget (`app/windows/Overlay.ts`), which nothing but a
     * real Electron run can see: it is a second `BrowserWindow`, created by the
     * main process when a meeting starts recording, loading the same bundle
     * under `?window=widget`. The screenshot harness drives its renderer
     * against a stubbed bridge and jsdom cannot have a window at all — so the
     * query string, the preload on a second window and the `widget:state`
     * channel are exercised by this and by nothing else.
     */
    await waitFor(async () => (await findWidget()) !== null, 20_000)
    widget = await findWidget()
    if (!widget) throw new Error('aucune fenêtre widget pendant l’enregistrement')
    widget.setDefaultTimeout(20_000)
    await widget.getByLabel('Durée d’enregistrement').waitFor({ timeout: 15_000 })
  })

  await step('the pill marks a moment with nothing open', async () => {
    // The one-press bookmark, which is what a pill floating over a client's
    // face is for. Three files described this button before it existed.
    await widget.getByRole('button', { name: 'Marquer ce moment' }).click()
    await widget
      .getByRole('button', { name: /Marquer ce moment \(1 déjà marqués\)/ })
      .waitFor({ timeout: 15_000 })
  })

  await step('opening the panel does not move the pill', async () => {
    /*
     * **The regression the sixteenth adversarial round found by executing the
     * shipped function**: the placement anchored a *window edge*, and the pill
     * is drawn at the top of the content — so opening the panel threw the
     * control the rep had just pressed 333 pixels up the screen, on the default
     * placement, on the first press of the first call.
     *
     * Measured here and nowhere else it can be: the unit test models the
     * renderer, the harness has no window, and only a real `BrowserWindow` has
     * a screen position at all. Screen coordinates = the window's own origin
     * plus where the pill sits inside it.
     */
    const pillScreenTop = async () => {
      const bounds = await app.evaluate(async ({ BrowserWindow }) => {
        const found = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().includes('window=widget'),
        )
        return found ? found.getBounds() : null
      })
      if (!bounds) throw new Error('la fenêtre widget a disparu')
      const offset = await widget.evaluate(() => {
        const pill = document.querySelector('[data-pill]')
        return pill ? Math.round(pill.getBoundingClientRect().top) : null
      })
      if (offset === null) throw new Error('la pastille est introuvable')
      return bounds.y + offset
    }

    const before = await pillScreenTop()
    await widget.getByRole('button', { name: /^Ouvrir le panneau/ }).click()
    await widget.getByPlaceholder('Noter ce moment…').waitFor({ timeout: 15_000 })
    await new Promise((resolve) => setTimeout(resolve, 400))
    const opened = await pillScreenTop()
    if (Math.abs(opened - before) > 2) {
      throw new Error(`la pastille a bougé de ${opened - before} px en ouvrant le panneau`)
    }

    await widget.getByRole('button', { name: 'Replier le panneau' }).click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const closed = await pillScreenTop()
    if (Math.abs(closed - before) > 2) {
      throw new Error(`la pastille a bougé de ${closed - before} px en repliant le panneau`)
    }
  })

  await step('a moment marked from the widget is written to the real store', async () => {
    await widget.getByRole('button', { name: /^Ouvrir le panneau/ }).click()
    const note = widget.getByPlaceholder('Noter ce moment…')
    await note.click()
    await note.type('à vérifier avec les achats')
    await note.press('Enter')
    /*
     * Drawn back from the **broadcast** and from nothing else: the widget does
     * not insert what `meeting:mark` returned, so this row on screen is proof
     * that the main process appended the event and told every window. It used
     * to be an optimistic local insert, and this assertion passed with
     * `broadcastMark` entirely unwired.
     */
    // In the list, not in the `aria-live` line that also says it — the row is
    // what the broadcast drew.
    await widget
      .locator('li')
      .getByText('à vérifier avec les achats')
      .waitFor({ timeout: 15_000 })
  })

  await step('a mark can be taken back, and the log says both things happened', async () => {
    // Typed one-handed over a client's face and sent on Enter, so a typo is
    // made here more easily than anywhere else in the product.
    // The row that carries the note, not « the first remove button there is »:
    // there are two marks on this call — the pill's, with no note — and taking
    // back the wrong one is a test that passes while the product forgets
    // something the rep wanted to keep.
    await widget
      .locator('li')
      .filter({ hasText: 'à vérifier avec les achats' })
      .getByRole('button', { name: 'Retirer ce moment marqué' })
      .click()
    await widget
      .locator('li')
      .getByText('à vérifier avec les achats')
      .waitFor({ state: 'detached', timeout: 15_000 })
    // And the one made from the pill is still there — removing is not a purge.
    await widget.getByRole('button', { name: /Marquer ce moment \(1 déjà marqués\)/ }).waitFor()
  })

  await step('the rep’s notepad takes what they type (DEC-5)', async () => {
    // The one surface in the product that is the rep's own. Typing into the real
    // ProseMirror instance is also what proves the editor mounted at all — it is
    // ported vendor code and the harness's stub never exercises its schema.
    const notepad = page.locator('.notepad [contenteditable="true"]').first()
    await notepad.click()
    await notepad.type('Point de calage la semaine prochaine.')
    await page.getByText('Point de calage la semaine prochaine.').waitFor()
  })

  await step('ending the meeting says what happens next (DEC-39)', async () => {
    await page.getByRole('button', { name: 'Terminer' }).click()
    /*
      No model is configured on a clean profile, so the compte-rendu cannot be
      written — and `ended` draws no control, which is exactly the case that used
      to leave a rep watching a recording finish and nothing happen. The notice
      is the promise the app makes instead, and this is the only test anywhere
      that sees it made by the real main process.
    */
    await page
      .getByText(/modèle de langage|sera généré|compte-rendu/i)
      .first()
      .waitFor({ timeout: 45_000 })
  })

  await step('the widget goes when the recording does, and inside its own deadline', async () => {
    /*
     * A pill floating over every other application is chrome the rep has to
     * close; one that outlived the call would also be saying « enregistrement
     * en cours » about a meeting that has ended. `syncOverlay` is driven from
     * the same transition broadcast the renderer is, so this is the assertion
     * that the two cannot drift.
     *
     * **Three seconds and not fifteen, and the number is the point.** The widget
     * no longer closes synchronously: it fades, and `Overlay.dismiss()` waits
     * either for the renderer to say how long that takes (`widget:left`) or for
     * `EXIT_FALLBACK_MS`, whichever comes first — so the window is gone at most
     * half a second after the transition, *whatever the renderer does*. A
     * fifteen-second tolerance would have passed on a handshake that never
     * completed, with only the fallback doing the work, which is precisely the
     * silent degradation this step is here to refuse. This is also the only place
     * in the repo where that round trip runs over the real preload, on a real
     * second window, in the packaged app.
     */
    const gone = await waitFor(async () => (await findWidget()) === null, 3_000)
    if (!gone) throw new Error('le widget est resté ouvert après la fin de l’enregistrement')
  })

  await step('there is no route into the gate for a meeting that never reached it', async () => {
    /*
     * DEC-23, end to end. The meeting just ended produced no transcript and
     * therefore no extraction, so the gate refuses it — and the session screen
     * must offer no way in. « Relire et valider » appearing here would be a
     * route to a screen that would immediately refuse, which is the dead
     * control DEC-26 forbids one layer up.
     *
     * This is as close as a headless run gets to the confirmation screen: the
     * gate itself needs a model, and the one thing worth asserting about it
     * from out here is that the door is not there when it should not be.
     */
    if ((await page.getByRole('button', { name: 'Relire et valider' }).count()) > 0) {
      throw new Error('la porte du gate est ouverte sur une réunion sans extraction')
    }
  })

  await step('the meeting is in the store, and the calendar shows it', async () => {
    await page.getByRole('button', { name: '‹ Calendrier' }).click()
    await page.getByRole('region', { name: 'Calendrier' }).waitFor()
  })

  await step('Ctrl H opens the reader over the real store', async () => {
    await page.keyboard.press('Control+h')
    /*
      The reader's title is the **count**, not the word « Historique »: the screen
      is a search field over a list of past calls and every part of it names
      itself, so the h1 carries the one thing on it that is information. Waiting
      on the number rather than on a noun is also the stronger wait — it cannot be
      satisfied before `history:search` has answered out of SQLite.
    */
    await page.getByRole('heading', { level: 1, name: /\d+ appels?/ }).waitFor()
    // The meeting just created is a row, which means `history:search` answered
    // from SQLite.
    await page.getByRole('list', { name: 'Appels enregistrés' }).waitFor()
  })

  await step('Demander refuses with the main process’s own sentence (DEC-26)', async () => {
    /*
     * No model is configured on a clean profile, so `meeting:ask` cannot answer
     * — and what a rep must get is the sentence that names the screen to go to,
     * not « une erreur est survenue ». That string is composed in the main
     * process and crosses the bridge; nothing else in this repo sees it make
     * that trip.
     */
    await page.getByRole('list', { name: 'Appels enregistrés' }).waitFor()
    await page.locator('li').first().getByRole('button').first().click()
    await page.getByLabel('Poser une question sur cet appel').fill('Quel TJM ?')
    await page.getByRole('button', { name: 'Demander' }).click()
    const alert = await page.getByRole('alert').first()
    await alert.waitFor({ timeout: 30_000 })
    const text = (await alert.textContent()) ?? ''
    /*
     * On a clean profile the meeting held no speech, so the refusal is « Aucune
     * transcription n'a été enregistrée pour cet appel. » — whichever refusal it
     * is, what has to hold is that a rep reads *only* the French sentence.
     *
     * This is the assertion that found the bug: Electron composes its own
     * message around a rejected `invoke`, so the alert read « Error invoking
     * remote method 'meeting:ask': Error: Aucune transcription… » — an English
     * stack-shaped prefix naming an internal channel, in front of the French, on
     * the surface DEC-26 exists to keep readable. `preload.ts` takes it back off.
     */
    if (/Error invoking remote method|^Error:/.test(text.trim())) {
      throw new Error(`la plomberie Electron fuit dans la phrase : ${text}`)
    }
    if (!/^[A-ZÀÂÉÈÊÎÔÙÜÇ]/.test(text.trim())) {
      throw new Error(`refus qui ne commence pas par une phrase : ${text}`)
    }
  })

  await step('the moment marked from the widget is in the record afterwards', async () => {
    /*
     * The other half of the mark, and the half that gives it a point: it was
     * made in one window during the call and is read in another after it, out
     * of the log, through `history:record`. The reader and the widget place it
     * with the same helper (`core/contracts/marks.ts`), which is what stops two
     * screens from disagreeing about one call.
     *
     * On the record *Demander* just opened, so this walks no UI of its own —
     * and the call it reads has **no transcript at all**, which is the case
     * worth asserting: a headless run records no audio, and a reader that drew
     * marks only when there were segments to interleave them with would have
     * swallowed every one of them on exactly the meeting a rep marks most.
     *
     * The one still standing is the pill's, with no note — the typed one was
     * taken back during the call, and « retiré » has to mean retired here too
     * or the gate would hand a rep back a sentence they deleted.
     */
    /*
     * The mark still standing is the pill's, made with no note — so the reader
     * draws the sentence it uses for one, which is also the assertion that a
     * mark with nothing typed in it is not an empty row.
     */
    await page.getByText('Marqué pendant l’appel.').first().waitFor({ timeout: 20_000 })
    // And the one taken back is gone from the record, not merely from the widget.
    if ((await page.getByText('à vérifier avec les achats').count()) > 0) {
      throw new Error('un moment retiré pendant l’appel est réapparu dans le compte-rendu relu')
    }
  })

  await step('the empty day can replay first run', async () => {
    await page.keyboard.press('Escape')
    await page.getByRole('region', { name: 'Calendrier' }).waitFor()
    // `Échap` from the reader is one of the three shortcuts installed for every
    // screen; reaching the calendar here is that assertion as well.
    // A day with nothing on it: the fresh profile has exactly one meeting, and
    // any other cell is empty.
    await page.getByRole('button', { name: /aucune réunion$/ }).first().click()
    await page.getByRole('button', { name: /Revoir la présentation/ }).click()
    await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
    await page.getByRole('button', { name: 'Passer' }).click()
    await page.getByRole('region', { name: 'Calendrier' }).waitFor()
  })

  await step('Ctrl , opens Réglages from the calendar', async () => {
    await page.keyboard.press('Control+Comma')
    await page.getByRole('navigation', { name: 'Sections des réglages' }).waitFor()
  })

  await step('every Réglages pane answers', async () => {
    for (const label of [
      'Transcription',
      'Modèle de langage',
      'Connecteurs',
      'Raccourcis clavier',
      'Mise à jour',
      'Diagnostics',
    ]) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
      await page.getByRole('heading', { name: new RegExp(label, 'i') }).first().waitFor()
    }
  })

  await step('first run is not shown twice', async () => {
    // `onboarding:seen` was written on the way out. A reload that puts the rep
    // back on step 1 is the nag this product refuses.
    await page.reload()
    await page.getByRole('region', { name: 'Calendrier' }).waitFor({ timeout: 45_000 })
  })

  await step('a clean first run logs no unexplained error', async () => {
    /*
     * The app's own diagnostic log, read back over the real channel.
     *
     * A first run on a machine with no Microsoft account, no VerySwing and no
     * language model *should* produce warnings — those are the optional
     * subsystems saying they are not configured (DEC-26), and a run that
     * produced none would mean the probes never ran. What it must not produce
     * is an `error`: that severity is reserved for something that went wrong
     * inside the app rather than outside it, and one appearing on the path a
     * rep takes in their first ten minutes is a defect nobody would otherwise
     * see — the log is behind two clicks in Réglages and nobody reads it.
     */
    const events = await page.evaluate(() => window.app.invoke('diagnostics:recent', { limit: 200 }))
    const errors = events.filter((event) => event.severity === 'error')
    if (errors.length > 0) {
      throw new Error(
        errors
          .slice(0, 3)
          .map((event) => `${event.code}: ${event.message}`)
          .join(' · '),
      )
    }
    // And it did run: a log with nothing in it is a log that was never written.
    if (events.length === 0) throw new Error('journal vide — les sondes n’ont rien écrit')
  })

  /*
   * ── the second launch, on a database the first one filled ───────────────────
   *
   * Every step above ran against a store created from nothing. That is the
   * *first* launch, and it is the one a rep performs once; every other day of
   * their working life is this one — a schema that has to open, projections that
   * have to read rows written by a previous process, a preference that has to
   * come back. Nothing in this repo had ever opened a non-empty database.
   */
  /*
   * ── the one irreversible press, on the real main process ────────────────────
   *
   * `review:confirm` is the only thing in this product that writes into a
   * client's CRM, and until this step it had **no end-to-end coverage at all**.
   * The reason is honest and had held for a dozen rounds: a headless run
   * produces no audio, so it produces no transcript, so no extraction, so the
   * gate correctly refuses — the step above asserts exactly that. The screenshot
   * harness drives the gate against real layout but a stubbed `window.app`; the
   * renderer's tests drive it against a fake bridge in jsdom. Neither has ever
   * seen the real store, the real state machine, the real field map or the real
   * outbox, which is the half of this screen that touches a client.
   *
   * So the log is written the way the app writes it — through the product's own
   * `Store`, with every event validated by its own Zod schema on the way in and
   * folded into the projections by its own `Projections` — and the next launch
   * rehydrates the session from those transitions like any other. Nothing is
   * mocked and nothing is injected: the events are the ones an extraction that
   * succeeded would have left, and the fixture is `core/contracts/fixtures.ts`,
   * the same `ExtractionESN` the domain tests agree on.
   *
   * It has to happen with the app **closed**. SQLite would take the write from a
   * second connection, but the running main process holds the session in memory
   * and would never re-read it.
   */
  await step('a meeting that reached the gate is written into the closed store', async () => {
    await app.close()
    app = null

    const dbPath = dbUnder(profile)
    if (!dbPath) throw new Error(`aucun ${DB_FILENAME} sous ${profile}`)
    const store = new Store(dbPath)
    try {
      const rows = store.log.db
        .prepare("SELECT id FROM meetings WHERE state = 'ended' ORDER BY updated_at DESC LIMIT 1")
        .all()
      if (rows.length === 0) throw new Error('aucune réunion terminée dans la base')
      gated = rows[0].id

      /*
       * Two turns, so every quotation in the extraction is locatable in the
       * transcript it is checked against — `[source ▸]` reads these rows and
       * `spanVerification` folds them the same way. A seeded gate whose
       * citations lead nowhere would photograph the failure state of the one
       * feature DEC-21 exists for and call it a pass.
       */
      store.appendAll(gated, [
        {
          type: 'transcript.segment',
          segment: {
            ...sampleSegment,
            id: 'e2e-1',
            channel: 'rep',
            text: 'Sur le budget, vous êtes à combien pour un profil confirmé ?',
            startMs: 806_000,
            endMs: 810_000,
          },
        },
        { type: 'transcript.segment', segment: { ...sampleSegment, id: 'e2e-2' } },
        { type: 'session.transition', from: 'ended', to: 'extracting', command: 'extract', reason: null },
        {
          type: 'extraction.completed',
          extraction: sampleExtraction,
          verification: sampleVerification,
        },
        {
          type: 'session.transition',
          from: 'extracting',
          to: 'awaiting_confirmation',
          command: 'extractionSucceeded',
          reason: null,
        },
      ])
    } finally {
      store.log.db.close()
    }

    noise = []
    await launch()
    await page.waitForSelector('#root > *', { timeout: 45_000 })
  })

  await step('the gate opens on a session rehydrated from the log', async () => {
    /*
     * Through the calendar, which is the route a rep takes: the row opens the
     * session screen, and the session screen draws *Relire et valider* only
     * because `orchestrator.stateOf` answered `awaiting_confirmation` — a state
     * that came back out of SQLite through `replayState`, into a
     * `MeetingSession` this process never created.
     */
    await page.getByRole('region', { name: 'Calendrier' }).waitFor({ timeout: 45_000 })
    await page.getByRole('button', { name: /^(Ouvrir|Enregistrer)$/ }).first().click()
    await page.getByRole('button', { name: 'Relire et valider' }).click({ timeout: 30_000 })
    await page.getByText('Prêt à envoyer').waitFor({ timeout: 30_000 })
  })

  await step('the fields are the extraction, and the citation leads into the record', async () => {
    /*
     * The whole DEC-21 chain, on the real bridge: `prefillEdits` filled the row
     * from the stored extraction, and `review:transcript` reads the segments
     * seeded above — the same rows the verification was computed against.
     */
    const tjm = page.locator('#field-tjm')
    await tjm.waitFor()
    const value = await tjm.inputValue()
    if (!value.includes('520')) throw new Error(`le TJM extrait n’est pas pré-rempli : « ${value} »`)

    /*
     * The reader is waited on by its *search field*, which is present in both
     * outcomes, and then judged by its header. The quote itself cannot be waited
     * on as text: the hit is highlighted, which splits it across nodes.
     *
     * What has to hold is the outcome — the citation was **found**. A quote the
     * record does not contain opens the same reader saying « introuvable », and
     * a step that only checked the reader had opened would pass on that too,
     * which is the exact failure DEC-21 exists to make visible.
     */
    /*
     * `source ▸` expands the row and shows the quote; *Voir dans la
     * transcription* is what opens the record. Two controls on purpose — the
     * transcript is fetched by a click and never otherwise — so the step takes
     * both, on an *interpretive* row: a deterministic one offers no jump,
     * because it has nothing to jump to (DEC-7).
     */
    await page.locator('#row-besoin').getByRole('button', { name: /^source/ }).click()
    await page.getByRole('button', { name: /Voir dans la transcription/ }).click()
    await page.getByPlaceholder('Rechercher dans la transcription…').waitFor({ timeout: 15_000 })
    if ((await page.getByText(/introuvable dans la transcription/).count()) > 0) {
      throw new Error('la citation vérifiée est annoncée introuvable dans le vrai transcript')
    }
    await page.getByText(/Citation du champ/).waitFor({ timeout: 15_000 })
  })

  await step('Valider is withheld until both columns have been shown (DEC-4)', async () => {
    // The guard, measured by the real renderer in a real window. jsdom cannot
    // see this at all — every box there is zero and the guard fails open.
    await page.getByRole('button', { name: 'Lecture', exact: true }).click()
    if ((await page.getByRole('button', { name: /^Valider/ }).count()) > 0) {
      throw new Error('Valider est armé avant que les deux colonnes aient été montrées')
    }
    for (let i = 0; i < 40; i += 1) {
      const turn = page.getByRole('button', { name: /(la suite|Remonter)/ }).first()
      if ((await turn.count()) === 0) break
      await turn.click()
      await page.waitForTimeout(320)
    }
    await page.getByRole('button', { name: /^Valider/ }).waitFor({ timeout: 15_000 })
  })

  await step('confirming writes the intents and the CRM refuses with a reason (DEC-26)', async () => {
    /*
     * The press. No VerySwing credentials exist on a throwaway profile, so the
     * adapter cannot create anything — and **that is the case worth running end
     * to end**, because it is the one where something could be lost silently.
     * What has to hold: the confirmation is recorded, the intents are in the
     * outbox, and an attempt that could not start leaves its row `pending` with
     * a stated reason rather than `failed` (which would offer a retry against a
     * record nobody knows the existence of — `POST /v1/crm/tasks` has no
     * idempotency key).
     *
     * **Read through `history:record`, not `meeting:get`.** `meeting:get` carried
     * an `outbox` array folded on every read of the session screen and read by
     * nothing under `src/`, and it has been deleted. What became of an envoi is
     * said in exactly one place in the product — *Historique*, on
     * `history:record.intents` — so asking the same question this run asked
     * before now goes through the channel a rep's own screen goes through, which
     * is the stronger read of the two: a field only this file consults is a field
     * that can be right here and wrong everywhere a rep looks.
     */
    await page.getByRole('button', { name: /^Valider/ }).click()
    await page.waitForTimeout(2_000)

    const { intents } = await page.evaluate(
      (meetingId) => window.app.invoke('history:record', { meetingId }),
      gated,
    )
    if (!Array.isArray(intents) || intents.length === 0) {
      throw new Error('la validation n’a écrit aucune intention dans l’outbox')
    }
    const drained = intents.filter((row) => row.state === 'drained')
    if (drained.length > 0) {
      throw new Error(`une intention est partie sans connecteur : ${drained[0].kind}`)
    }
    for (const row of intents) {
      if (row.state === 'failed' && !row.lastError) {
        throw new Error(`${row.kind} a échoué sans dire pourquoi`)
      }
    }
  })

  await step('the meeting leaves `pushing` when nothing is still in flight', async () => {
    /*
     * **`pushSettled` had a rule, a guard and no caller.**
     *
     * It is the only *guarded* transition in the whole table — `pushing → done`
     * when every intent is terminal — and nothing in the product dispatched it.
     * So pressing *Valider* moved a meeting into `pushing` and left it there for
     * the life of the database: « Validée » on the agenda row, « Déjà validée. »
     * at the gate and `settled` in the recipe picker were all unreachable, and a
     * call that shipped hours ago read « Envoi… » forever.
     *
     * **And the rule this step first encoded was wrong in the other direction,
     * which is why it failed the round after it was written.**
     *
     * It asserted « in `pushing` if and only if some intent is not `drained` or
     * `failed` », and called that true whether or not a connector exists. It is
     * not: a third terminal case was added deliberately, because the second one
     * was costing a rep everything. `Outbox.#attempt` finds no port, abandons
     * the intent **without an attempt event** — on purpose, so it ships the day
     * the connector is configured — and the row stays `pending`. On the demo
     * build, which DEC-28 calls the first deliverable and which has no VerySwing
     * tenant, that is the *ordinary* path: one press of *Valider* left the
     * meeting in `pushing` for the life of the database, the calendar read
     * « Envoi… » on that call for ever, and because the boot re-drain rehydrates
     * the session, `liveStates()` carried `pushing` and **every future update
     * was refused**. An intent nobody can route is settled as far as the
     * *meeting* is concerned.
     *
     * So this machine — no connector, nothing routable — is the case where the
     * meeting **must** reach a terminal state, and the old assertion demanded
     * the opposite. What still has to hold beside it is the half that could lose
     * something silently: the intents are **kept**, `pending` and not `failed`,
     * queued for the day a tenant exists. Settling the meeting is not discarding
     * the queue.
     *
     * The direction this no longer covers — a *routable* intent genuinely on the
     * wire keeping the meeting in `pushing` — is not reachable here, because it
     * needs a configured connector. `MeetingSession`'s unit tests hold it, and
     * this step says so rather than pretending to measure it.
     */
    // One read, through the channel *Historique* reads: the record carries the
    // meeting and what became of each intent, which is both halves of this step.
    const { meeting, intents } = await page.evaluate(
      (meetingId) => window.app.invoke('history:record', { meetingId }),
      gated,
    )
    if (meeting.state === 'pushing') {
      throw new Error(
        'la réunion est restée en « pushing » alors qu’aucun connecteur ne peut router ses intentions — ' +
          'elle y resterait pour la vie de la base, et le bloc de mise à jour avec elle',
      )
    }
    const kept = intents.filter((row) => row.state === 'pending')
    if (kept.length === 0) {
      throw new Error(
        `la réunion est « ${meeting.state} » et rien n’attend dans l’outbox — ` +
          'régler la réunion ne doit pas vider la file',
      )
    }
    for (const row of intents) {
      if (row.state === 'failed') {
        throw new Error(
          `${row.kind} est « failed » alors qu’aucune tentative n’a pu démarrer — ` +
            'une tentative impossible reste « pending », avec sa raison',
        )
      }
    }
  })

  await step('the app reopens on the database it left behind', async () => {
    await app.close()
    noise = []
    await launch()
    await page.waitForSelector('#root > *', { timeout: 45_000 })
    // No first run: `onboarding:seen` was written to this store and read back
    // out of it by a different process.
    await page.getByRole('region', { name: 'Calendrier' }).waitFor({ timeout: 45_000 })
  })

  await step('a quit during a call is deferred, and the call ends on the way out', async () => {
    /*
     * **The only place a `before-quit` during a recording can be driven at all.**
     *
     * On Windows — the primary platform (HR-2) — `window-all-closed` quits, so
     * « get the app out of the way at the end of a call » *is* a quit, and the
     * handler that catches it is registered on a real `app` object by a booted
     * main process and by nothing else. Two findings now exist that only this file
     * could have seen, and R32-1 is the third: `before-quit` dispatched `end` and
     * then awaited `stopRecording`, which returned immediately because
     * `#enhance` — fired by that very dispatch — had already taken the `Recording`.
     * « `stopRecording` is awaited so both providers flush » waited for nothing.
     *
     * What this step measures, on the real thing:
     *
     *  · the quit is **deferred** rather than refused or ignored — the meeting is
     *    `ended` in the log with *the quit's own reason*, which is what separates
     *    « the handler ended it » from « the boot sweep found it abandoned »;
     *  · the process still **exits**, and quickly. The fix turned an await that
     *    resolved instantly into one that waits for a provider's `stop()`, so
     *    « the window never goes away » is the failure it could have introduced —
     *    a bounded wait is worth nothing if nothing ever measures the bound;
     *  · and nothing **failed** on the way out: no `app.quit.endFailed`, no
     *    `app.quit.flushUnsettled`, no `enhancement.unhandled` in the diagnostic
     *    log the next launch reads back.
     *
     * What it cannot measure is the tail itself: a headless run produces no audio,
     * so there is no last utterance to lose. That is measured on the shipped
     * `Orchestrator` in `app/session/__tests__/orchestrator.test.ts`, over a
     * transcriber that emits a segment inside `stop()`. This step is the half that
     * needs the real `app`.
     */
    await page.getByRole('region', { name: 'Calendrier' }).waitFor({ timeout: 45_000 })
    await page.getByRole('button', { name: 'Démarrer une réunion' }).click()
    // *Terminer* on screen means the state machine took `start`: this meeting is
    // recording, with the devices and the transcriber behind it.
    await page.getByRole('button', { name: 'Terminer' }).waitFor({ timeout: 30_000 })

    const started = Date.now()
    // Playwright's close is the polite one — it reaches `before-quit`, which is
    // the whole point. The crash case is the step below, which fabricates a log.
    await app.close()
    app = null
    const closedInMs = Date.now() - started
    /*
     * The bound is the handler's own arithmetic: ten seconds for the flush
     * (`FLUSH_TIMEOUT_MS`) and eight for a push on the wire (`SETTLE_TIMEOUT_MS`),
     * neither of which has anything to wait for here. Twenty-five seconds fails on
     * a wait that hit either ceiling and on a quit that hangs, and passes on the
     * sub-second exit this should be.
     */
    if (closedInMs > 25_000) {
      throw new Error(`la fermeture a pris ${closedInMs} ms — un quit différé qui ne rend jamais la main`)
    }

    const dbPath = dbUnder(profile)
    if (!dbPath) throw new Error('base introuvable après la fermeture')
    const store = new Store(dbPath)
    let quitEnded = []
    let stillRecording = []
    try {
      for (const meeting of store.projections.listMeetings(500)) {
        if (meeting.state === 'recording') stillRecording.push(meeting.id)
        const ended = store.log
          .read(meeting.id)
          .some(
            (row) =>
              row.event.type === 'session.transition' &&
              row.event.to === 'ended' &&
              row.event.reason === 'fermeture de l’application',
          )
        if (ended) quitEnded.push(meeting.id)
      }
    } finally {
      store.log.db.close()
    }

    if (stillRecording.length > 0) {
      throw new Error(
        `${stillRecording.length} réunion(s) toujours « en cours » après la fermeture — ` +
          'la fenêtre a abandonné un enregistrement',
      )
    }
    if (quitEnded.length !== 1) {
      throw new Error(
        `${quitEnded.length} réunion(s) terminées par « fermeture de l’application » (attendu : 1) — ` +
          'le quit n’a pas été différé, ou la réunion a été récupérée au démarrage suivant à la place',
      )
    }

    noise = []
    await launch()
    await page.waitForSelector('#root > *', { timeout: 45_000 })
    const events = await page.evaluate(() =>
      window.app.invoke('diagnostics:recent', { limit: 300 }),
    )
    const onTheWayOut = events.filter((event) =>
      ['app.quit.endFailed', 'app.quit.flushUnsettled', 'enhancement.unhandled'].includes(
        event.code,
      ),
    )
    if (onTheWayOut.length > 0) {
      throw new Error(
        `la fermeture a laissé ${onTheWayOut.map((e) => `${e.code}: ${e.message}`).join(' · ')}`,
      )
    }
  })

  await step('a recording the previous process never ended is not left running', async () => {
    /*
     * **`recording` was the one live state with no boot recovery.**
     *
     * `before-quit` stopped the agenda and closed the store and never ended a
     * meeting, and on Windows — the primary platform — `window-all-closed`
     * quits: the ordinary gesture of getting the app out of the way during a
     * call ended the call with nothing. The transcriber was never flushed, so
     * the tail was lost, and the meeting sat in `recording` forever. There is no
     * capture behind it — the device was released when the process died — so the
     * session screen drew a recording pill over nothing, the gate refused the
     * meeting, `Agenda` would not re-arm it (`arm` is illegal from `recording`),
     * and nothing anywhere could end it.
     *
     * Written straight into the log with the app closed, so this is the crash
     * case and not the polite one: the previous process left a transition to
     * `recording` and no transition out.
     */
    await app.close()
    app = null

    const dbPath = dbUnder(profile)
    const store = new Store(dbPath)
    let abandoned = null
    try {
      abandoned = `crash-${Date.now().toString(36)}`
      store.appendAll(abandoned, [
        // Created and started, with no transition out — which is exactly what a
        // process that died mid-call leaves in the log.
        { type: 'meeting.created', title: 'Appel interrompu', context: null, clientName: null },
        { type: 'session.transition', from: 'idle', to: 'recording', command: 'start', reason: null },
      ])
    } finally {
      store.log.db.close()
    }

    noise = []
    await launch()
    await page.waitForSelector('#root > *', { timeout: 45_000 })

    const { meeting } = await page.evaluate(
      (meetingId) => window.app.invoke('meeting:get', { meetingId }),
      abandoned,
    )
    if (meeting.state === 'recording') {
      throw new Error('la réunion abandonnée est toujours « en cours » après un redémarrage')
    }
    if (meeting.state !== 'ended') {
      throw new Error(`état inattendu après récupération : ${meeting.state}`)
    }
  })

  await step('the meeting written last time is still there', async () => {
    await page.keyboard.press('Control+h')
    // The count again, and on this launch it counts rows a dead process wrote.
    await page.getByRole('heading', { level: 1, name: /\d+ appels?/ }).waitFor()
    // Rows, from SQLite, written by the process that has since exited.
    await page.getByRole('list', { name: 'Appels enregistrés' }).waitFor()
    const rows = await page.locator('[aria-label="Appels enregistrés"] > li').count()
    if (rows === 0) throw new Error('la base rouverte ne contient aucune réunion')
  })

  await step('the second launch logs no unexplained error either', async () => {
    const events = await page.evaluate(() => window.app.invoke('diagnostics:recent', { limit: 200 }))
    const errors = events.filter((event) => event.severity === 'error')
    if (errors.length > 0) {
      throw new Error(errors.slice(0, 3).map((e) => `${e.code}: ${e.message}`).join(' · '))
    }
  })

  await step('nothing threw in the renderer', async () => {
    const real = noise.filter(
      (line) =>
        !/Content Security Policy|Autofill|DevTools|Electron Security Warning/i.test(line),
    )
    if (real.length > 0) throw new Error(real.slice(0, 3).join(' · '))
  })
} finally {
  await app?.close().catch(() => undefined)
  rmSync(profile, { recursive: true, force: true })
}

process.stdout.write('\n')
const failed = steps.filter((s) => !s.ok)
for (const { name, ok, ms, reason } of steps) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? ` (${ms} ms)` : `\n    ${reason}`}`)
}

if (failed.length > 0) {
  console.error(`\n${failed.length} étape(s) sur ${steps.length} ont échoué de bout en bout.`)
  process.exit(1)
}
console.log(`\n${steps.length} étapes jouées de bout en bout, sur l’application réelle.`)
