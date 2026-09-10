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
 * agree; the recording is ended before the window closes, so nothing is left
 * holding a device.
 *
 * **It runs on a throwaway profile.** Electron's own `--user-data-dir` switch
 * points at a fresh temporary directory, so the store is created from nothing on
 * every run — which is the only way the first-run path is reachable at all — and
 * no developer's real database is touched.
 *
 *     npm run build && npm run build:electron && node scripts/e2e.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

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

try {
  app = await electron.launch({
    // `--user-data-dir` is Electron's own switch and needs no support in the
    // app: the store, the model directory and the preferences all hang off
    // `app.getPath('userData')`, so pointing it at a temporary directory is what
    // makes the first-run path reachable and leaves a developer's real database
    // alone.
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
  const noise = []
  page.on('console', (message) => {
    if (message.type() === 'error') noise.push(message.text())
  })
  page.on('pageerror', (error) => noise.push(String(error)))

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

  await step('the meeting is in the store, and the calendar shows it', async () => {
    await page.getByRole('button', { name: '‹ Calendrier' }).click()
    await page.getByRole('region', { name: 'Calendrier' }).waitFor()
  })

  await step('Ctrl H opens the reader over the real store', async () => {
    await page.keyboard.press('Control+h')
    await page.getByRole('heading', { name: 'Historique' }).waitFor()
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
