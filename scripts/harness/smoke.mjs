/**
 * Every stage, driven, with no PNG written.
 *
 * ## Why this exists
 *
 * A stage is a scripted path through the real renderer, and it is held together
 * by French strings that are also the product's copy. So a copy change breaks
 * stages — silently, because nothing runs them but a person deciding to look at
 * a screen.
 *
 * It has now happened twice. Renaming the reveal control at the review gate
 * broke `review-valider`, the one stage that photographs the armed gate — the
 * product's headline claim — and it went unnoticed until a reviewer tried to
 * shoot it. The fix was applied to that stage and to none of the other
 * twenty-four; three commits later, renaming a day-row's button from *Ouvrir* to
 * *Enregistrer* broke six more at once, including both of the features that were
 * under review at that moment.
 *
 * The lesson was written down both times, and both times it was written down in
 * a comment. A comment is not a check.
 *
 * ## What it is not
 *
 * Not a screenshot test: there is no golden image and nothing to update. It
 * drives every stage and asserts only that the stage reached its own end. The
 * question it answers is « can the design pass still photograph this product »,
 * which is the question that had been silently answering *no*.
 *
 * `--contrast` also measures the graphics that carry information, at WCAG
 * 1.4.11's 3:1 — opt-in via `data-graphic`, because only the author knows which
 * marks a reader must see to understand the screen. The onboarding's three
 * progress dots drew at 1.99:1 and 1.11:1, so the indicator rendered as one dot
 * and lost the count it exists to give.
 *
 * It carries `--contrast`, computed from the styles the browser resolved rather
 * than from sampled pixels — with transitions switched off, because
 * `getComputedStyle` returns the *current animated value* and a reading taken
 * mid-flight is a reading of a frame. That is how the bundled detector reports
 * « Démarrer une réunion » at 4.0:1 on an element that rests at fourteen, and
 * the first version of this check reproduced the same false positive at 1.16:1
 * on the same button. A check that cries wolf is a check whose findings get
 * waved through.
 *
 * It carries `--a11y`, which is the half of a design pass a screenshot cannot
 * show and which nothing had ever measured — `CLAUDE.md` has claimed since this
 * harness existed that the defects that matter live « in rendered geometry and
 * in the accessibility tree », and only the first half was checked. A control
 * with no accessible name, a field whose only label is a placeholder that
 * vanishes the moment a rep types, a rung missing from the heading ladder. A
 * glyph is not a name: « ‹ » passes a textContent test and reads as punctuation.
 *
 * It carries `--prose`, which counts the characters a line of each reading
 * surface really holds. `.measure` was `66ch` on the reasoning that a measure is
 * a count of characters — and `ch` is the advance of the digit zero, so it
 * rendered eighty-one. Nothing counted, so nothing noticed, for four rounds.
 *
 * It carries `--echo`, which asks the one question no other pass can:
 * does this screen draw the same visible string twice? The home screen printed
 * the day in the header and again as an `h2` 108 pixels lower, under
 * « Calendrier » in 42px serif — every string correct, every contrast passing,
 * every box the right size, and invisible to a screenshot review because a
 * reader who has just read a date reads it again as confirmation. The casefold
 * is load-bearing: the header's copy was `text-transform: uppercase`, so the two
 * differed as strings. A repetition *along a list* is exempt by rule — same tag,
 * same class list, every occurrence in a row — because « Ouvrir » on five rows is
 * one control offered five times, and an allow-list of copy would go stale the
 * first time somebody renamed a button. `SILLAGE_ECHO_ATTACK=1` holds the reader
 * to that, five probes that must fire and five that must stay silent.
 *
 * It carries `--targets` too. Every control is measured against WCAG 2.2's
 * 24×24, with the criterion's own exceptions honoured — a control inline in a
 * sentence, and a checkbox whose label is the thing a rep actually aims at.
 * Forty-odd controls were under it across the product, all of them 17 to 23
 * pixels tall: the reps this ships to are on laptops with trackpads (HR-2), and
 * a miss on the review gate lands on the field below.
 *
 * It carries `--scrollers`, which finds what this harness was itself hiding. It
 * reports any box whose content is taller or wider than the box, and it exists
 * because the review gate's guard measures **two** columns and withholds
 * *Valider* until both have been shown — so a scroller nested inside one of them
 * is a hole in that promise, and one no picture shows, because a clipped textarea
 * looks exactly like a short one. There were eleven: `FieldRow` sized its box
 * from a count of *newlines* where a rep reads *wrapped* lines, under a
 * `min(6, …)` ceiling, so three fields hid text at 960×600 with the button
 * armed. Thirteen rounds of screenshots missed it for a reason written into this
 * harness: `--expand` injects `field-sizing: content` into every textarea, so
 * every shot of that gate showed the fields unclipped. The check runs before the
 * expansion. Truncation that draws its own ellipsis is exempt — the check is for
 * content cut off with nothing saying so.
 *
 * It carries `--motion`, which asks the question the token file could not ask
 * of itself: `tokens.css` declares the durations and collapses them under
 * `prefers-reduced-motion`, and `design/tokens.test.ts` proves the tokens
 * *exist* — neither proves anything *reads* them. A literal duration in a
 * component passes both and then ignores the OS setting in silence. The check
 * builds its allowed set from `:root` at runtime so it cannot rot, and flips
 * `prefers-reduced-motion` with `emulateMedia` to measure the accessibility
 * half directly rather than inferring it.
 *
 * It carries `--fade`, which is the same lesson at a sixth boundary. The
 * widget's live transcript recedes at the edge it hides content behind — the
 * right cue, and the ramp was set to twenty pixels under a comment reading
 * « little enough that no whole line of a client's words is ever dimmed ». The
 * line box in that log is 19.5px, so the ramp was longer than a line and the
 * sentence was false of the surface it was written on: swept over every scroll
 * position, a whole line sat inside the ramp with its ink at alpha 0.19. Neither
 * of the two checks that could plausibly have seen it can: `--contrast` reads
 * resolved colours and a mask is not one, and `--scrollers` is opted out of by
 * `data-scrolls`, correctly, because a log is supposed to hold more than its
 * box. This one compares every fading mask against the line box it fades over.
 * It **parses** that mask rather than pattern-matching it, because the first
 * version could not read the implicit `0` CSS lets a first stop drop — which is
 * the form `.fade-below[data-above="true"]` takes on every scrolled reading
 * column, skipped in silence on the two stages that carry it — and it prints a
 * census of what it visited, so a zero here reads as a zero. Every stage in the
 * list below is one run of that, and `SILLAGE_FADE_ATTACK=1` is how the reader
 * itself is held to it.
 *
 * It carries `--geometry` as well, which is the other half of the same problem.
 * Ten of the compte-rendu's twenty-three gutter markers were clipped for three
 * review rounds: present in the DOM, correct in `innerText`, and a third of the
 * `###` simply not painted. A screenshot showed it and no eye caught a nine-pixel
 * truncation of a character that is *meant* to be faint. Every stage is measured
 * now, so a padding that stops fitting what hangs in it fails here.
 *
 * It shells out to `shot.mjs --no-png` rather than importing it, because the CLI
 * *is* the thing under test — `scripts/harness/README.md` tells a reviewer to run
 * exactly this, and a smoke run over a refactored internal would not have caught
 * either regression.
 *
 * Run it against a dev server, as the shots are:
 *
 *     npm run dev -- --port 5180 --strictPort
 *     node scripts/harness/smoke.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOT = path.join(HERE, 'shot.mjs')

/** Four at a time. One browser each; the whole list in series is three minutes. */
const LANES = 4

const screens = () =>
  new Promise((resolve, reject) => {
    // `shot.mjs` with no arguments prints its own list, which keeps this script
    // from holding a second copy of it that can go stale.
    const child = spawn(process.execPath, [SHOT], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('close', () => {
      const line = err.split('\n').find((l) => l.startsWith('screens: '))
      if (!line) return reject(new Error('shot.mjs n’a pas listé ses écrans'))
      resolve(line.slice('screens: '.length).trim().split(' · '))
    })
  })

/**
 * Two sizes, and the smaller one is the window's own declared minimum.
 *
 * Every check here passed at 1280×800 while 960×600 held a text field crushed
 * to fourteen pixels, a recording pill eating 404 of 960, and a client name
 * painted over the label beside it. A design pass that only shoots the
 * comfortable size has looked at half the product — `main.ts` says 960 is
 * supported, so 960 is a size the checks have to clear.
 */
const SIZES = ['1280x800', '960x600']

/**
 * **The passes, declared once and counted rather than remembered.**
 *
 * This used to be an inline argument vector and `CLAUDE.md` a sentence beside
 * it; the sentence has been wrong three times, in the same direction, each time
 * omitting the passes added most recently — which are the ones a reviewer is
 * likeliest to assume unrun and re-run by hand. The run prints
 * `PASSES.length` at the end, so the number is read off the thing that was
 * actually passed.
 *
 * `--marks` is the newest, and `--rhythm` and `--cells` the two before it; they
 * are here rather than only in `shot.mjs` for the repo's eighth shape: a check
 * nobody runs is a control that is present and does nothing. `--rhythm` and
 * `--cells` both read *painted* geometry over every stage, which is the half a
 * hand-run reviewer never reaches — `--cells` exists because ten passes were
 * green over a client name rendered in 40.3 px, and `--scrollers` could not see
 * it by construction. `--marks` is the first **relational** one: every other
 * pass asks something about one element, and the twelve of them were green over
 * a calendar whose « réunion enregistrée » and « enregistrement en cours »
 * measured 1.0077:1 against each other on 6 px dots.
 */
const PASSES = [
  '--geometry',
  '--targets',
  '--prose',
  '--echo',
  '--a11y',
  '--contrast',
  '--marks',
  '--scrollers',
  '--motion',
  '--fade',
  '--census',
  '--rhythm',
  '--cells',
]

const drive = (screen, viewport) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      /*
       * `--census` is here and not merely in `shot.mjs` for the reason the
       * repo's eighth shape names: a check nobody runs is a control that is
       * present and does nothing. It is also the only pass that reads a
       * *distribution* rather than one value against one rule, so it is the
       * only one that can fail over a screen on which every individual value is
       * impeccable — which means it is exactly the pass a hand-run reviewer
       * would never think to add.
       */
      [SHOT, screen, 'unused.png', '--no-png', ...PASSES, '--viewport', viewport],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (out += chunk))
    child.on('close', (code) => {
      process.stdout.write(code === 0 ? '.' : 'x')
      resolve(
        code === 0
          ? null
          : // The first line only: a Playwright timeout carries its whole call
            // log, and a wall of those is something nobody reads.
            { screen, reason: (out.split('\n').find((l) => l.includes('✗')) ?? out).trim() },
      )
    })
  })

const screenList = await screens()
const all = SIZES.flatMap((viewport) => screenList.map((screen) => ({ screen, viewport })))
const failures = []
/*
 * **A wrong dev server is not 156 findings, it is one.**
 *
 * `shot.mjs` refuses a server that is not serving this checkout, and the refusal
 * is per stage — so pointing this at the live checkout's :5180 from a worktree
 * used to print a hundred and fifty-six of the same sentence and bury it. It is
 * never stage-specific, so the first one ends the run.
 */
const WRONG_TREE = 'ne sert pas ce dépôt'
for (let at = 0; at < all.length; at += LANES) {
  const lane = await Promise.all(all.slice(at, at + LANES).map((j) => drive(j.screen, j.viewport)))
  failures.push(...lane.filter((entry) => entry !== null))
  const misaimed = failures.find((entry) => entry.reason.includes(WRONG_TREE))
  if (misaimed) {
    process.stdout.write('\n')
    console.error(misaimed.reason)
    console.error(
      '\nAucune mise en scène n’a été mesurée. Le serveur visé sert un autre arbre que' +
        '\ncelui d’où part cette commande.',
    )
    process.exit(2)
  }
}
process.stdout.write('\n')

if (failures.length > 0) {
  console.error(
    `\n${failures.length} mise(s) en scène sur ${all.length} ne se jouent plus ` +
      `(${PASSES.length} passes : ${PASSES.join(' ')}) :\n`,
  )
  for (const { screen, reason } of failures) console.error(`  ✗ ${screen}\n    ${reason}`)
  console.error(
    '\nUne mise en scène tient par les chaînes du produit. Si une copie a changé, c’est le' +
      '\nsélecteur qu’il faut rendre moins littéral — pas la copie qu’il faut remettre.',
  )
  process.exit(1)
}

console.log(
  `${all.length} mises en scène jouées (${screenList.length} écrans × ${SIZES.length} tailles, ` +
    `${PASSES.length} passes).`,
)
