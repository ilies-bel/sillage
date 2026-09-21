/**
 * **Every `reason` the two live connectors can carry, against what the widget's
 * health slot actually draws.**
 *
 * The defect this binds: `aggregateStatus` returns `ConnectorHealth.reason`
 * verbatim — correctly; that is its contract and *Réglages* wants exactly that —
 * and `Widget.tsx` drew it. `reason` is a free `string` composed at **sixteen** sites
 * in the shipped tree, and they are not one grade of sentence. Measured on the shipped
 * renderer at 1280×800 and 960×600 before `healthSentence.ts` existed, the slot
 * read « aucun fournisseur de transcription disponible » — `Orchestrator.ts`'s
 * note to itself — with no `role` and no `aria-live`, on a card drawn over
 * everything the rep is sharing.
 *
 * ## What this file measures that the rendering tests do not
 *
 * `Widget.test.tsx` drives the shipped component and answers « does the slot
 * hold a fragment, and is it a live region ». It does that for **two** of the
 * sixteen, because a rendering test is one fixture at a time.
 *
 * This one is the width: it runs the whole corpus through `healthLine` and
 * asserts both directions — a fragment is **never** what the rep reads, and a
 * written sentence **always** is. Those are inequalities and equalities against
 * literal strings, not re-applications of `isWrittenSentence`; a check that
 * re-applied the predicate would stay green over a fix that had been reverted
 * and a predicate loosened to match, which is the shape this repo keeps
 * shipping.
 *
 * ## And why the corpus cannot quietly go stale
 *
 * The classification below is a human judgement — « would a rep know what to do
 * with this » — so it is written down once. What is *not* left to a human is
 * whether it is still complete: `le corpus couvre encore l’arbre` scans the
 * shipped producer files for every `ConnectorHealth` literal that can reach
 * these two connectors and fails when one of them is not accounted for here.
 * That is the `harnessFixture.test.ts` idiom, and it exists because the harness
 * fixture's copy of a `main.ts` sentence drifted four times.
 *
 * **What the scan does not reach, declared rather than left implicit.** Two
 * producers set health through a *variable* connector, so no regex over the call
 * site can tell which connector they land on:
 *
 *   · `Orchestrator.ts` `retry()` — « nouvelle tentative échouée — … »
 *   · `Recording.ts` `#start()` — the caught error's own `message`, forwarded raw
 *
 * Both are in the corpus by hand, and `les producteurs hors portée du scan sont
 * toujours là` asserts their literals are still in their files — so a rewording
 * fails, but a *third* variable-connector producer added tomorrow would not.
 * Closing that needs a connector argument the scan can read, which is a change
 * in `app/session/` and not in this lane.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  WIDGET_SENTENCES,
  healthLine,
  isWrittenSentence,
  type LiveConnector,
  type TroubledState,
} from '../healthSentence.ts'

/*
 * `import.meta.url` is not a `file:` URL under vitest's jsdom environment, so
 * the root is the runner's cwd — and it is *checked*, because a test that reads
 * the tree from the wrong place would report « nothing uncovered » from an empty
 * scan and go green having looked at nothing.
 */
const ROOT = `${process.cwd()}/`
const source = (rel: string) => readFileSync(ROOT + rel, 'utf8')

test('le test lit bien cet arbre-ci', () => {
  expect(JSON.parse(source('package.json')).name).toBe('sillage')
})

interface Producer {
  /** Where it is composed, so a failure names the file to open. */
  file: string
  /** Which connector it lands on. */
  connector: LiveConnector
  /**
   * A literal substring of the **source expression**, used twice: to prove the
   * producer is still there, and to tie a scanned literal to this row.
   */
  anchor: string
  /**
   * Is what the rep ends up reading a sentence the product wrote *for them* —
   * capitalised, terminated, naming a side and a remedy?
   */
  written: boolean
  /**
   * What the expression can evaluate to, with its interpolations filled in the
   * way the product fills them. More than one where the expression branches,
   * because the branches are different sentences.
   */
  samples: readonly string[]
}

/**
 * Sixteen sites. **Six** write a sentence for a rep; **ten** write a fragment for
 * the machine, and those ten are why this file exists.
 */
const PRODUCERS: readonly Producer[] = [
  // ── written for a rep ──────────────────────────────────────────────────────
  {
    file: 'electron/modules/capture/index.ts',
    connector: 'capture',
    anchor: 'Votre micro est en mode',
    written: true,
    samples: [
      'Votre micro est en mode « communication » (16 kHz) — la transcription sera ' +
        'moins précise. Un casque Bluetooth fait cela ; un micro filaire ou les ' +
        'haut-parleurs l’évitent.',
    ],
  },
  {
    file: 'electron/modules/capture/index.ts',
    connector: 'capture',
    anchor: 'La sortie audio de l’ordinateur a changé',
    written: true,
    samples: [
      'La sortie audio de l’ordinateur a changé pendant l’appel — le son du client ' +
        'peut ne plus être capté. Terminez et redémarrez l’enregistrement pour le reprendre.',
    ],
  },
  {
    file: 'electron/modules/capture/index.ts',
    connector: 'capture',
    anchor: 'Rien n’arrive depuis',
    written: true,
    samples: [
      'Rien n’arrive depuis le micro — ce côté de l’appel ne sera pas transcrit.',
      'Rien n’arrive depuis le son du client — ce côté de l’appel ne sera pas transcrit.' +
        ' Votre application d’appel utilise un autre périphérique de sortie que Windows : ' +
        'alignez les deux dans les paramètres de son.',
      'Le micro est coupé : le signal est à zéro depuis le début de l’appel. ' +
        'Vérifiez le bouton « muet ».',
      'Le son du client s’est interrompu pendant l’appel — plus rien n’arrive. ' +
        'Vérifiez le périphérique audio.',
    ],
  },
  {
    file: 'electron/core/domain/capturePermission.ts',
    connector: 'capture',
    anchor: 'ne sont autorisés — une réunion ne serait pas enregistrée',
    written: true,
    samples: [
      'Ni le micro ni l’enregistrement de l’écran ne sont autorisés — une réunion ne ' +
        'serait pas enregistrée. Autorisez-le pour que Sillage puisse l’enregistrer.',
    ],
  },
  {
    file: 'electron/core/domain/capturePermission.ts',
    connector: 'capture',
    anchor: 'n’est pas autorisé — le client ne sera pas enregistré',
    written: true,
    samples: [
      'L’enregistrement de l’écran n’est pas autorisé — le client ne sera pas ' +
        'enregistré, vous seul le serez. Autorisez-le pour que Sillage puisse l’enregistrer.',
      'Le micro n’est pas autorisé — vous ne serez pas enregistré, seul le client le ' +
        'sera. Cet ordinateur est géré et l’autorisation est bloquée par votre service ' +
        'informatique.',
    ],
  },
  {
    file: 'electron/core/contracts/essai.ts',
    connector: 'capture',
    anchor: 'Relancez l’essai de 20 secondes après correction.',
    written: true,
    samples: [
      'Votre voix a été entendue, celle du client non. Relancez l’essai de 20 secondes ' +
        'après correction.',
    ],
  },

  // ── written for the machine, and read by a rep until this round ────────────
  {
    file: 'electron/modules/capture/index.ts',
    connector: 'capture',
    anchor: 'micro indisponible — ',
    written: false,
    samples: [
      'micro indisponible — Device in use by another application',
      'audio système indisponible — ScreenCaptureKit stream stopped',
    ],
  },
  {
    /*
     * Found by `le corpus couvre encore l’arbre` on its first run, not by the
     * hand audit above it — which is the whole reason that test is written the
     * way it is. `SystemAudioCapture.probe()`, read at boot and on every
     * *Réessayer* on the capture row.
     */
    file: 'electron/modules/capture/index.ts',
    connector: 'capture',
    anchor: 'module audio natif indisponible — ',
    written: false,
    samples: ['module audio natif indisponible — electron indisponible: Module did not self-register'],
  },
  {
    file: 'electron/modules/transcribe/index.ts',
    connector: 'transcribe',
    anchor: 'plus aucun moteur de transcription disponible',
    written: false,
    samples: ['plus aucun moteur de transcription disponible'],
  },
  {
    file: 'electron/modules/transcribe/index.ts',
    connector: 'transcribe',
    anchor: 'transcription du micro dégradée — ',
    written: false,
    samples: [
      'transcription du micro dégradée — 429 Too Many Requests',
      'transcription de l’audio système dégradée — 429 Too Many Requests',
    ],
  },
  {
    file: 'electron/modules/transcribe/registry.ts',
    connector: 'transcribe',
    anchor: 'aucun fournisseur de transcription ne gère',
    written: false,
    samples: [
      'aucun fournisseur de transcription ne gère fr',
      'mode hors ligne: aucun moteur local ne gère fr',
    ],
  },
  {
    file: 'electron/app/session/Orchestrator.ts',
    connector: 'transcribe',
    anchor: 'aucun fournisseur de transcription disponible',
    written: false,
    samples: ['aucun fournisseur de transcription disponible'],
  },
  {
    file: 'electron/app/session/Orchestrator.ts',
    connector: 'capture',
    anchor: 'capture indisponible',
    written: false,
    samples: [
      'capture indisponible — EPERM: operation not permitted',
      'capture indisponible',
    ],
  },
  {
    file: 'electron/app/main.ts',
    connector: 'transcribe',
    anchor: 'aucun moteur de transcription disponible',
    written: false,
    samples: ['aucun moteur de transcription disponible'],
  },
  // The two the scan cannot reach — see the header.
  {
    file: 'electron/app/session/Orchestrator.ts',
    connector: 'capture',
    anchor: 'nouvelle tentative échouée — ',
    written: false,
    samples: ['nouvelle tentative échouée — ENOENT: no such file or directory', 'échec inconnu'],
  },
  {
    file: 'electron/app/session/Recording.ts',
    connector: 'transcribe',
    anchor: "'transcription indisponible'",
    written: false,
    samples: [
      'transcription indisponible',
      // Forwarded **raw**, with no prefix of ours: `reason = error.message`.
      // Capitalised and non-ASCII-free, which is the case the predicate's third
      // condition exists for.
      "Cannot read properties of undefined (reading 'start')",
      'Échec du chargement du modèle',
    ],
  },
]

const STATES: readonly TroubledState[] = ['degraded', 'down']
const CONNECTORS: readonly LiveConnector[] = ['capture', 'transcribe']

const line = (connector: LiveConnector, state: TroubledState, reason: string) =>
  healthLine({ [connector]: { state, reason, since: 0, retryable: true } })

describe('ce que la fenêtre dit quand le produit est en panne', () => {
  /**
   * **The half that binds the defect**: no reason composed for a state machine
   * reaches the rep, in either state, on either connector.
   *
   * Asserted as `not.toBe(sample)` — an inequality against the producer's own
   * literal. It cannot pass vacuously and it cannot be satisfied by loosening
   * the predicate, because the only way to satisfy it is for the string to have
   * changed.
   */
  test('aucun fragment interne n’atteint la fente de santé', () => {
    const escaped: string[] = []
    for (const producer of PRODUCERS.filter((p) => !p.written)) {
      for (const sample of producer.samples) {
        for (const state of STATES) {
          const shown = line(producer.connector, state, sample)
          if (shown === null || shown.text === sample) {
            escaped.push(`${producer.file} [${producer.connector}/${state}] « ${sample} »`)
            continue
          }
          expect(shown.written).toBe('widget')
          expect(shown.text).toBe(WIDGET_SENTENCES[producer.connector][state])
        }
      }
    }
    expect(escaped, `fragment(s) rendus tels quels :\n  ${escaped.join('\n  ')}`).toEqual([])
  })

  /**
   * **And the half that stops the fix from being « replace everything ».**
   *
   * Seven producers write a sentence that names the *channel* — « depuis le
   * micro », « le son du client » — and nothing derivable from `AppStatus` can.
   * Replacing those would lose DEC-32's « the sentence names which side » on the
   * one surface that carries it during a call.
   */
  test('une phrase écrite pour un commercial est rendue telle quelle', () => {
    const lost: string[] = []
    for (const producer of PRODUCERS.filter((p) => p.written)) {
      for (const sample of producer.samples) {
        for (const state of STATES) {
          const shown = line(producer.connector, state, sample)
          if (shown === null || shown.text !== sample) {
            lost.push(`${producer.file} « ${sample.slice(0, 60)}… » → ${shown?.text ?? 'null'}`)
            continue
          }
          expect(shown.written).toBe('connector')
        }
      }
    }
    expect(lost, `phrase(s) du produit remplacées :\n  ${lost.join('\n  ')}`).toEqual([])
  })

  /**
   * The table is total over `(connector, state)` at compile time — it is a
   * `Record` — but « a cell exists » is not « a cell is a sentence ». This is
   * the runtime half, and it is what a rep actually reads.
   */
  test('les quatre phrases de la fenêtre en sont', () => {
    const seen = new Set<string>()
    for (const connector of CONNECTORS) {
      for (const state of STATES) {
        const text = WIDGET_SENTENCES[connector][state]
        expect(text, `${connector}/${state}`).toBeTruthy()
        // Opens on a capital, ends on a full stop, and is French — the same bar
        // the seven written producers meet.
        expect(/^\p{Lu}/u.test(text), `${connector}/${state} ne commence pas par une capitale`)
          .toBe(true)
        expect(/[.!?…]$/u.test(text), `${connector}/${state} ne se termine pas`).toBe(true)
        // French: at least one character ASCII does not have. The predicate's
        // third condition, asked of this file's own sentences — a table whose
        // cells would not pass `isWrittenSentence` is a table that fails the bar
        // it exists to enforce.
        expect(isWrittenSentence(text), `${connector}/${state} n’est pas une phrase écrite`)
          .toBe(true)
        // Names a remedy the rep can reach from this card: *Ouvrir Sillage* is
        // 40 px below the slot.
        expect(text.includes('Ouvrez Sillage'), `${connector}/${state} n’offre pas de suite`)
          .toBe(true)
        // No straight apostrophe anywhere — CLAUDE.md, and `check:french`
        // does not read `src/`'s string concatenations.
        expect(text.includes("'"), `${connector}/${state} porte une apostrophe droite`).toBe(false)
        seen.add(text)
      }
    }
    // Four distinct sentences: a slot that says the same thing about capture and
    // transcription tells a rep nothing about which one broke.
    expect(seen.size).toBe(4)
  })

  test('rien à signaler ne dit rien', () => {
    expect(healthLine({})).toBeNull()
    expect(healthLine({ capture: { state: 'ok' }, transcribe: { state: 'ok' } })).toBeNull()
  })

  /*
   * **A test that was written here and deleted, because its fixture could not
   * exist.** « A degraded connector with no sentence at all » looked like a case
   * worth covering — until `tsc` refused the fixture: `ConnectorHealthSchema`
   * makes `reason` *required* on `degraded` and `down`, so only an `ok`
   * connector can have none. `healthLine` still guards `reason === null`,
   * because `AppStatus.reason` is `string | null` and the guard is what narrows
   * it — but no product path reaches that branch, and a test pretending
   * otherwise would be a fixture the product cannot produce.
   */

  /**
   * `down` outranks `degraded` and the *sentence* follows the winner — the point
   * round 23 made about which connector speaks, restated about which words.
   */
  test('la phrase suit le canal le plus atteint', () => {
    const shown = healthLine({
      capture: { state: 'degraded', reason: 'micro indisponible — x', since: 0, retryable: true },
      transcribe: {
        state: 'down',
        reason: 'aucun fournisseur de transcription disponible',
        since: 0,
        retryable: true,
      },
    })
    expect(shown).toEqual({ text: WIDGET_SENTENCES.transcribe.down, written: 'widget' })
  })
})

describe('le corpus est tenu à l’arbre', () => {
  /**
   * Every producer above is still in the file it names, spelled the way it is
   * spelled here. A rewording that made a fragment worse — or a sentence a
   * fragment — fails here rather than on a rep's screen.
   */
  test('chaque producteur du corpus est encore dans sa source', () => {
    const gone = PRODUCERS.filter((p) => !source(p.file).includes(p.anchor)).map(
      (p) => `${p.file}: « ${p.anchor} »`,
    )
    expect(gone, `producteur(s) disparus ou reformulés :\n  ${gone.join('\n  ')}`).toEqual([])
  })

  /**
   * **And the other direction, which is the one that rots.**
   *
   * Scans the shipped tree for every `ConnectorHealth` literal that can reach
   * `capture` or `transcribe`, and fails when one is not covered by a row above.
   * A fifteenth producer added next round arrives here, not on the card.
   *
   * The anchors are the same regexes `scripts/check-reasons.mjs` uses to find a
   * health literal, narrowed to the two connectors by the call that publishes
   * it — `setHealth('capture'…)`, `onHealth?.('transcribe'…)`, and `emit('health'…)`
   * inside the two modules that only ever publish one connector each.
   */
  test('le corpus couvre encore l’arbre', () => {
    const FILES = [
      'electron/modules/capture/index.ts',
      'electron/modules/transcribe/index.ts',
      'electron/modules/transcribe/registry.ts',
      'electron/core/domain/capturePermission.ts',
      'electron/core/contracts/essai.ts',
      'electron/app/session/Orchestrator.ts',
      'electron/app/main.ts',
    ]
    const strip = (text: string) =>
      text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')

    const scanned: Array<{ where: string; expression: string }> = []
    for (const file of FILES) {
      const scoped = /modules\/(capture|transcribe)\/|capturePermission|essai\.ts/.test(file)
      const lines = strip(source(file)).split('\n')
      lines.forEach((text, index) => {
        const publishes =
          /\bsetHealth\(\s*'(capture|transcribe)'/.test(text) ||
          /\bonHealth\?\.\(\s*'(capture|transcribe)'/.test(text) ||
          (scoped && (/\bemit\(\s*'health'/.test(text) || /\bstate:\s*'(down|degraded)'/.test(text)))
        if (!publishes) return
        const window = lines.slice(index, index + 12).join('\n')
        const found = /\breason:\s*([\s\S]*?)(?:,\s*\n\s*(?:since|state|retryable)|\n\s*\})/.exec(
          window,
        )
        if (!found) return
        scanned.push({
          where: `${file}:${index + 1}`,
          expression: found[1].replace(/\s+/g, ' ').trim(),
        })
      })
    }

    /*
     * A floor on the scan itself. A regex that stopped matching would otherwise
     * report « nothing uncovered » and mean « nothing looked at » — the shape
     * CLAUDE.md calls a check that measures nothing while reporting green. This
     * was 13 when it was written; it may only grow with the corpus.
     */
    expect(scanned.length).toBeGreaterThanOrEqual(13)

    const uncovered = scanned.filter(
      (hit) => !PRODUCERS.some((p) => hit.expression.includes(p.anchor)),
    )
    expect(
      uncovered.map((u) => `${u.where}: ${u.expression.slice(0, 90)}`),
      'état(s) de santé capture/transcribe que le corpus ne classe pas',
    ).toEqual([])
  })

  /**
   * The two the scan cannot reach, held by name — see the header for why a regex
   * cannot find them and what that leaves open.
   */
  test('les producteurs hors portée du scan sont toujours là', () => {
    expect(source('electron/app/session/Orchestrator.ts')).toContain('nouvelle tentative échouée')
    const recording = source('electron/app/session/Recording.ts')
    expect(recording).toContain("'transcription indisponible'")
    // The raw forward: `reason` is the caught error's own message, and it is the
    // only producer in the tree with no words of ours in front of it.
    expect(recording).toContain('error instanceof Error ? error.message')
  })
})

describe('ce que le prédicat sait et ne sait pas distinguer', () => {
  test('les trois conditions sont toutes nécessaires', () => {
    // All three met.
    expect(isWrittenSentence('Le son du client a disparu — vérifiez la sortie audio.')).toBe(true)
    // Opens lowercase.
    expect(isWrittenSentence('le son du client a disparu — vérifiez la sortie audio.')).toBe(false)
    // Does not end.
    expect(isWrittenSentence('Le son du client a disparu — vérifiez la sortie audio')).toBe(false)
    // Pure ASCII: not a string this product wrote.
    expect(isWrittenSentence('Something went wrong.')).toBe(false)
    expect(isWrittenSentence(null)).toBe(false)
    expect(isWrittenSentence('')).toBe(false)
    expect(isWrittenSentence('   ')).toBe(false)
  })

  /**
   * **The limit, asserted rather than described.**
   *
   * A foreign message that is capitalised, terminated *and* non-ASCII passes as
   * ours. Today nothing can produce one on these two connectors — Graph feeds
   * `calendar` and `mail`, which this window does not collect — but the hole is
   * real and this is what it looks like. Closing it needs a field on
   * `ConnectorHealth` saying who wrote the string, which is coordinator-owned.
   *
   * It is a test and not a comment because a comment claiming a limit is a
   * comment that goes on claiming it after the limit has moved.
   */
  test('une phrase étrangère bien ponctuée passerait encore', () => {
    expect(isWrittenSentence('Le jeton d’accès a expiré.')).toBe(true)
  })
})
