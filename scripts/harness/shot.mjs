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
  splash: {
    scenario: 'splash',
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
  'agenda-empty': {
    scenario: 'agenda',
    async drive(page) {
      await openAgenda(page)
      await page.getByRole('button', { name: /aucune réunion$/ }).first().click()
      // Whichever of the three the range calls for — a past day does not say
      // « à venir » about itself, which is the whole point of the copy.
      await page
        .getByText(/Aucune réunion ce jour-là|Aucune réunion sur cette période|Plus aucune réunion/)
        .waitFor()
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

        `/^(Lire|Voir) la suite/` is the page turn and `/^Valider/` is the
        primary in both of its states. A copy change that breaks *these* has
        changed what the controls are, not how they are worded, and should fail
        here.

        The loop is bounded well above the number of turns a column needs: the
        document is about three screenfuls at 800px and grows with the recipe.
      */
      for (let i = 0; i < 12; i++) {
        const turn = page.getByRole('button', { name: /^(Lire|Voir) la suite/ })
        if ((await turn.count()) === 0) break
        await turn.first().click()
        await page.waitForTimeout(500)
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
   * The keyboard, printed (`app/shortcuts.ts`). Its own stage because it is its
   * own pane, and because a table that drifts from the matcher is exactly the
   * kind of thing nobody looks at again.
   */
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
      'usage: node shot.mjs <screen> <outfile.png> [--viewport WxH] [--expand] [--scan [out.json]] [--no-png] [--geometry] [--targets] [--prose]',
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

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' })
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
    const surfaces = document.querySelectorAll('.measure, .notepad .ProseMirror')
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

      const what = `${el.tagName.toLowerCase()}.${(el.className || '').split(' ')[0]}`
      const key = `${what}:${chars}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ what, chars, box: Math.round(box), size: style.fontSize })
    }
    return out
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
