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
 *   --a11y           names on controls, labels on fields, and the heading ladder
 *   --contrast       every text run against the ground it is painted on (WCAG AA)
 *   --sans-entra     stage any screen with **no Entra app registration** — the
 *                    case the first demo ships in (DEC-28). Signed out with
 *                    nothing to sign into, empty agenda, calendar and Outlook
 *                    `down` and not retryable.
 *
 * Screens: splash · agenda · agenda-empty · agenda-semaine · agenda-liste ·
 * agenda-client · agenda-search · session · review · review-valider ·
 * review-transcription ·
 * review-transcription-introuvable · historique · reglages ·
 * agenda-sans-entra · session-sans-entra · review-sans-entra ·
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(path.join(REPO, 'package.json'))
const { chromium } = require('playwright')

const URL_BASE = process.env.SILLAGE_URL ?? 'http://localhost:5180'

/**
 * The verb on a day-list row, which is **not** one word.
 *
 * The armed meeting — the call starting now — carries a filled *Enregistrer*;
 * every other row carries an outline *Ouvrir*, because opening a meeting that
 * exists and starting a capture are two different acts. A stage that hard-codes
 * either one photographs half the calendar and hangs on the other half: renaming
 * this button broke six stages at once, including both of the features that were
 * under review at the time.
 *
 * Matched as a set rather than as a string, so a stage says « the way into this
 * row » and stops caring which of the two it is.
 */
const OPEN_ROW = /^(Ouvrir|Enregistrer)$/

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
 * The clock, pinned.
 *
 * Today's date at 14:35 Paris. Fixed so the calendar always opens on a plausible
 * mid-afternoon — the armed meeting has just started, two calls are behind and
 * two ahead — and so two runs of the same screen produce the same pixels.
 * `page.clock.setFixedTime` freezes `Date.now()` but leaves timers running,
 * which the 200 ms search debounce needs.
 */
const pinnedNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const read = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  // 14:35 Paris = 12:35Z in summer, 13:35Z in winter. Resolve it by measuring.
  const guess = Date.UTC(Number(read.year), Number(read.month) - 1, Number(read.day), 14, 35)
  const shown = new Date(guess).toLocaleString('en-US', { timeZone: 'Europe/Paris', hour12: false })
  const offsetHours = new Date(shown).getHours() - 14
  return guess - offsetHours * 3_600_000
}

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
        await page.getByRole('button', { name: 'Aujourd’hui' }).click()
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
    },
  },

  /*
   * The empty day's second way out — the first-run sequence, replayed. A rep who
   * installs on Tuesday with no calls until Thursday opens the app on nothing,
   * and what this product has to show them is already true: three beats and
   * twenty seconds of real capture (DEC-45), rather than a fabricated demo
   * meeting that would sit in *Historique* afterwards.
   */
  'agenda-empty-presentation': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: /aucune réunion$/ }).first().click()
      await page.getByRole('button', { name: /Revoir la présentation/ }).click()
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
    },
  },

  'agenda-semaine': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Semaine' }).click()
      await page.getByText('Néovia Santé — cadrage renfort data').first().waitFor()
    },
  },

  'agenda-liste': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: 'Liste' }).click()
      await page.getByText('Néovia Santé — cadrage renfort data').first().waitFor()
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
      await page.getByPlaceholder(/Rechercher/).first().fill('Néovia')
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
      await page.getByText('Rien ne migre dans vos notes.').waitFor()
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

  'onboarding-essai': {
    scenario: 'onboarding',
    async drive(page) {
      await page.getByRole('heading', { name: /Sillage écoute l’appel/ }).waitFor()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByRole('button', { name: 'Continuer' }).click()
      await page.getByRole('heading', { name: 'Votre premier appel' }).waitFor()
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
      // And it names what is still unread, in the column's own words.
      await page.getByRole('button', { name: /la suite de la transcription/ }).first().waitFor()
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
        await page.waitForTimeout(380)
      }
      await page.getByRole('button', { name: /^Valider/ }).waitFor()
      await page.waitForTimeout(400)
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
      await page.getByText('Compte-rendu').first().waitFor()
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
        await page.waitForTimeout(380)
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
        await page.waitForTimeout(380)
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
      await page.getByText('Compte-rendu').first().waitFor()
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
   * The same window, opened: the live transcript, the rep's own marks in place,
   * the note field and the two ways out. This is the state the widget spends
   * most of a call in once a rep has opened it, and it is the only surface in
   * the product that draws an *interim* transcription.
   */
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
      await page.getByRole('button', { name: /^Ouvrir le panneau/ }).click()
      await page.getByPlaceholder('Noter ce moment…').waitFor()
      await page.waitForTimeout(120)
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
      await page.getByRole('button', { name: 'Terminer' }).click()
      await page.getByRole('button', { name: 'Arrêter l’enregistrement' }).waitFor()
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
    a11y: false,
    contrast: false,
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
    else if (arg === '--a11y') flags.a11y = true
    else if (arg === '--contrast') flags.contrast = true
    else if (arg === '--scrollers') flags.scrollers = true
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
      'usage: node shot.mjs <screen> <outfile.png> [--viewport WxH] [--expand] [--scan [out.json]] [--no-png] [--geometry] [--targets] [--prose] [--a11y] [--contrast]',
    )
    console.error('screens: ' + Object.keys(SCREENS).join(' · '))
    process.exit(2)
  }
  const plan = SCREENS[screen]
  if (!plan) {
    console.error(`écran inconnu: ${screen}. Connus: ${Object.keys(SCREENS).join(', ')}`)
    process.exit(2)
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
  let small = []
  if (flags.geometry) {
    await page.evaluate(() => document.fonts.ready)
    const seen = await geometry(page)
    clipped = seen.clipped
    measured = seen.measured
    tightest = seen.tightest
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

  let dim = []
  if (flags.contrast) {
    await page.evaluate(() => document.fonts.ready)
    dim = await contrast(page)
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

  let unnamed = []
  if (flags.a11y) {
    await page.evaluate(() => document.fonts.ready)
    unnamed = await a11y(page)
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
  await browser.close()

  const size = `${flags.viewport.width}×${flags.viewport.height}`
  console.log(out ? `✓ ${screen} ${size} → ${out}` : `✓ ${screen} ${size}`)
  if (findings) report(findings, flags.scan, screen, flags.viewport)
  if (flags.scrollers) {
    if (inner.length === 0) console.log('  ascenseurs: rien de caché dans une boîte interne')
    else {
      console.log(`  ✗ ascenseurs: ${inner.length} boîte(s) cachent du contenu`)
      for (const item of inner.slice(0, 8)) {
        console.log(`     ${item.what} — ${item.hidden}px cachés en ${item.axis} (boîte ${item.box}px)`)
      }
    }
  }
  if (flags.contrast) {
    if (dim.length === 0) console.log('  contraste: texte AA, graphiques 3:1')
    else {
      console.log(`  ✗ contraste: ${dim.length} élément(s) sous le seuil`)
      for (const item of dim.slice(0, 8)) {
        console.log(`   ✗ ${item.ratio}:1 (min ${item.need}) — « ${item.text} » ${item.fg} sur ${item.bg}`)
      }
      process.exitCode = 8
    }
  }
  if (flags.a11y) {
    if (unnamed.length === 0) console.log('  arbre: chaque contrôle a un nom')
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
        console.log(`   ✗ ${item.chars} car./ligne — ${item.what} (${item.size}, ${item.box}px)`)
      }
      process.exitCode = 6
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
          ? '  géométrie: rien à mesurer sur cet écran'
          : `  géométrie: ${measured} mesurés, marge la plus courte ${tightest.by}px sur « ${tightest.text} »`,
      )
    else {
      console.log(`  ✗ géométrie: ${clipped.length} élément(s) hors de leur cadre`)
      for (const item of clipped.slice(0, 8)) {
        console.log(`   ✗ ${item.what} « ${item.text} » — ${item.by}px à gauche du cadre`)
      }
      process.exitCode = 4
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
  const findings = await page.evaluate(() => {
    const channel = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    const parse = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
    const opaque = (value) => value && !/rgba\([^)]*,\s*0\s*\)|transparent/.test(value)

    const groundOf = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        // A gradient or an image is a ground this cannot compute against, and
        // guessing white under it is how a check invents a finding.
        if (style.backgroundImage !== 'none') return null
        if (opaque(style.backgroundColor)) return style.backgroundColor
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

      const size = parseFloat(style.fontSize)
      const bold = Number(style.fontWeight) >= 700
      // WCAG's own exemption, not one invented here.
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5

      const a = luminance(parse(style.color))
      const b = luminance(parse(ground))
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      if (ratio >= need) continue

      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32)
      const key = `${style.color}|${ground}|${text}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text, fg: style.color, bg: ground, ratio: Math.round(ratio * 100) / 100, need })
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
    const painted = (el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      if (Number(style.opacity) < 0.99) return false
      return el.offsetParent !== null || style.position === 'fixed'
    }
    for (const el of document.querySelectorAll('[data-graphic]')) {
      if (!painted(el)) continue
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
      const ink = opaque(style.backgroundColor)
        ? style.backgroundColor
        : (rings.filter(opaque).pop() ?? null)
      if (!ink) {
        out.push({
          text: el.dataset.graphic || 'graphique',
          fg: 'rien',
          bg: ground,
          ratio: 0,
          need: 3,
        })
        continue
      }
      const a = luminance(parse(ink))
      const b = luminance(parse(ground))
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      if (ratio >= 3) continue
      out.push({
        text: el.dataset.graphic || 'graphique',
        fg: ink,
        bg: ground,
        ratio: Math.round(ratio * 100) / 100,
        need: 3,
      })
    }
    return out
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

    return out
  })
}

/**
 * **How many characters a line of this prose really holds.**
 *
 * `.measure` is `66ch`, and the doctrine around it says a measure is « a count
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
     * Ninety characters of *own* text is the test for « this is prose ». A
     * heading, a button, a cell and a timestamp are all shorter than that by a
     * wide margin, so the threshold separates them without a list of tag names
     * that would need maintaining — and an element is measured only for the text
     * it owns, never for its children's, so a wrapper is not reported for the
     * paragraphs inside it.
     */
    const surfaces = [...document.querySelectorAll('body *')].filter((el) =>
      [...el.childNodes].some(
        (node) => node.nodeType === 3 && (node.textContent ?? '').trim().length > 90,
      ),
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
      out.push({ what, chars, box: Math.round(box), size: style.fontSize })
    }
    return out
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
    for (const el of document.querySelectorAll('main *, aside *, dialog *')) {
      if (columns.includes(el)) continue
      const hiddenY = el.scrollHeight - el.clientHeight
      const hiddenX = el.scrollWidth - el.clientWidth
      if (hiddenY <= SLACK && hiddenX <= SLACK) continue
      if (el.clientHeight === 0) continue
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
    return { clipped: out, measured: all.length, tightest }
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
