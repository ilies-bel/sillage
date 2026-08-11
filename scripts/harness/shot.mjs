#!/usr/bin/env node
/**
 * Render one screen of the Sillage renderer in a plain Chromium: write a PNG,
 * and — with `--scan` — run impeccable's detector inside that same rendered page.
 *
 *   node scripts/harness/shot.mjs <screen> [out.png] [options]
 *
 *   --viewport WxH   default 1440x900
 *   --expand         unclip the inner scrollers so `fullPage` means the screen
 *   --scan [out.json]  run the impeccable browser detector on the staged screen
 *   --no-png         scan only
 *   --sans-entra     stage any screen with **no Entra app registration** — the
 *                    case the first demo ships in (DEC-28). Signed out with
 *                    nothing to sign into, empty agenda, calendar and Outlook
 *                    `down` and not retryable.
 *
 * Screens: splash · agenda · agenda-empty · agenda-semaine · agenda-liste ·
 * agenda-client · agenda-search · session · review · historique · reglages ·
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

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const require = createRequire(path.join(REPO, 'package.json'))
const { chromium } = require('playwright')

const URL_BASE = process.env.SILLAGE_URL ?? 'http://localhost:5180'

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
      await page.getByText('Aucune réunion à venir.').waitFor()
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
      await page.getByRole('button', { name: 'Néovia Santé', exact: true }).click()
      await page.waitForTimeout(400)
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
        .getByRole('button', { name: 'Ouvrir' })
        .click()
      await page.getByRole('button', { name: 'Terminer' }).waitFor()
      await page.getByText('Se remplit à mesure', { exact: false }).waitFor()
      // A speech-shaped level history over a broadcast — the same channel the
      // main process would use, and the whole width of the meter, so the still
      // shows the widget as a rep sees it rather than flat.
      await page.evaluate(() => window.__harness.replaySession('m-neovia-cadrage'))
      await page.getByTitle('votre micro', { exact: false }).waitFor()
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
        .getByRole('button', { name: 'Ouvrir' })
        .click()
      await page.getByRole('button', { name: 'Terminer' }).waitFor()
      await page.getByText('le plan du compte-rendu sera décidé à la fin', { exact: false }).waitFor()
      await page.evaluate(() => window.__harness.replaySession('m-neovia-cadrage'))
      await page.getByTitle('votre micro', { exact: false }).waitFor()
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
        .getByRole('button', { name: 'Ouvrir' })
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
        .getByRole('button', { name: 'Ouvrir' })
        .click()
      await page.getByRole('button', { name: 'Relire et valider' }).waitFor()
      await page.getByText('Le budget de la plateforme data', { exact: false }).waitFor()
    },
  },

  review: {
    scenario: 'review',
    // The panel is taller than 900px — see the note beside `addStyleTag` below.
    expand: true,
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: 'Ouvrir' })
        .click()
      await page.getByRole('button', { name: 'Relire et valider' }).click()
      await page.getByText('Prêt à envoyer').waitFor()
      await page.getByRole('button', { name: 'Valider' }).waitFor()
      await page.getByText('⚠ faible').first().waitFor()
    },
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
        .getByRole('button', { name: /Groupe Lefort — découverte du besoin plateforme/ })
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
      await page.getByRole('button', { name: 'Nouvelle réunion' }).waitFor()
    },
  },

  'session-sans-entra': {
    scenario: 'session',
    entra: false,
    async drive(page) {
      await openAgenda(page)
      await rowNamed(page, 'Néovia Santé — cadrage renfort data')
        .getByRole('button', { name: 'Ouvrir' })
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
        .getByRole('button', { name: 'Ouvrir' })
        .click()
      await page.getByRole('button', { name: 'Relire et valider' }).click()
      await page.getByRole('button', { name: 'Valider' }).waitFor()
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
    expand: false,
    scan: null,
    png: true,
    entra: null,
  }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--expand') flags.expand = true
    else if (arg === '--sans-entra') flags.entra = false
    else if (arg === '--no-png') flags.png = false
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
    console.error('usage: node shot.mjs <screen> <outfile.png> [--viewport WxH] [--expand] [--scan [out.json]] [--no-png]')
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
   * The app shell never scrolls the document: it is `h-full` with its own inner
   * `overflow-y-auto` columns, so a `fullPage` shot of it is exactly one
   * viewport and everything below an inner fold is lost. On the screens whose
   * point *is* what sits below that fold — the review gate's mail draft and its
   * three intents — the scrollers are unclipped first so the page itself grows
   * and `fullPage` means what it says. Width, type and layout are unchanged;
   * only the clipping is.
   */
  if (plan.expand || flags.expand) {
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
  if (unanswered.length) console.log(`  canaux sans réponse: ${[...new Set(unanswered)].join(', ')}`)
  const noise = problems.filter((p) => !IGNORED.some((rule) => rule.test(p)))
  if (noise.length) {
    console.log('  console:')
    noise.forEach((p) => console.log('   ' + p))
  }
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
