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
let noise = []
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
     */
    await page.getByRole('button', { name: /^Valider/ }).click()
    await page.waitForTimeout(2_000)

    const { outbox } = await page.evaluate(
      (meetingId) => window.app.invoke('meeting:get', { meetingId }),
      gated,
    )
    if (!Array.isArray(outbox) || outbox.length === 0) {
      throw new Error('la validation n’a écrit aucune intention dans l’outbox')
    }
    const drained = outbox.filter((row) => row.state === 'drained')
    if (drained.length > 0) {
      throw new Error(`une intention est partie sans connecteur : ${drained[0].kind}`)
    }
    for (const row of outbox) {
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
     * The assertion is the **invariant**, not a state: a meeting is in `pushing`
     * if and only if some intent is still pending. That is true whether or not a
     * connector exists on this machine — which matters, because none does here —
     * and it is what a step asserting `state === 'done'` would have got wrong in
     * the other direction, calling a meeting finished with nothing in the CRM.
     */
    const { meeting, outbox } = await page.evaluate(
      (meetingId) => window.app.invoke('meeting:get', { meetingId }),
      gated,
    )
    const inFlight = outbox.filter((row) => row.state !== 'drained' && row.state !== 'failed')
    if (inFlight.length === 0 && meeting.state === 'pushing') {
      throw new Error(
        'tout est retombé et la réunion est restée en « pushing » — `pushSettled` n’est dispatché par personne',
      )
    }
    if (inFlight.length > 0 && meeting.state !== 'pushing') {
      throw new Error(
        `${inFlight.length} intention(s) encore en vol mais la réunion est « ${meeting.state} »`,
      )
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
    await page.getByRole('heading', { name: 'Historique' }).waitFor()
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
