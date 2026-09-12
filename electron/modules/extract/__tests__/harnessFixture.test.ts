/**
 * **The screenshot fixture has to be a document the product could actually
 * write.**
 *
 * `scripts/harness/bridge-stub.mjs` is what every design review looks at. It has
 * now been caught lying three times, each time about something that made the app
 * look better than it is:
 *
 *  · it was four invented headings, roughly half the real length, for five
 *    review rounds — and making it faithful surfaced two shipped bugs in one
 *    afternoon (duplicated `##` sections, literal `**` in the typesetter);
 *  · it claimed a health row the app cannot emit — a `degraded` Outlook for a
 *    token failure that is always `down`, and a Whisper download in `--warn`
 *    when the weights ship inside the installer;
 *  · and this: its compte-rendu attributed quotes to **named attendees** —
 *    « Élodie Vasseur annonce… », « Marc Pontier signale… ». `deterministicLeaks`
 *    refuses exactly that (DEC-7): the model is never shown the attendee list,
 *    so a name in the prose is a name read off a speech-to-text transcript, and
 *    the whole reply is thrown away rather than published. The fixture was
 *    showing a document the composer would have refused, on the flagship screen,
 *    and it made the app look like it knew who was speaking — which it does not.
 *    The transcript has two channels, `rep` and `far`, and DEC-21 verifies the
 *    *quote*, never the *speaker*.
 *
 * A comment saying « keep the fixture faithful » has been written twice and
 * ignored twice. This is the check.
 *
 * It holds a second property now, for the same reason and found the same way.
 * `REGISTRE` licenses guillemets for words the client *actually said*, so a
 * quotation in the compte-rendu is the one part of that prose which claims to be
 * verbatim — and the fixture's document quoted two phrases the call did not
 * contain. Nothing could show it until the prose's quotations became followable
 * (DEC-21); the first one pressed opened the reader on « Cet extrait est
 * introuvable dans la transcription ».
 *
 * It asserts the one property that can be asserted without a model: the prose
 * sections of the fixture's compte-rendu pass the same leak check the real reply
 * must pass. The deterministic header is exempt for the reason the real one is —
 * `renderCompteRendu` writes those four lines itself, from Graph.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findDeterministicLeaks } from '../deterministicLeaks.ts'
import { SettingsSnapshotSchema } from '../../../core/contracts/settings.ts'
/*
 * The harness stub is plain JS with no declaration — it runs in a browser page,
 * not under `tsc`. Imported dynamically and typed at the call site, so this test
 * can drive the real fixture without dragging the whole harness into the
 * electron type-check.
 */
const loadStub = async (): Promise<(o: { scenario: string; now: number; entra: boolean }) => void> => {
  const url = new URL('../../../../scripts/harness/bridge-stub.mjs', import.meta.url).href
  const mod = (await import(url)) as {
    installAppBridge: (o: { scenario: string; now: number; entra: boolean }) => void
  }
  return mod.installAppBridge
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUB = path.resolve(HERE, '../../../../scripts/harness/bridge-stub.mjs')

/**
 * Everyone the fixture's own meeting has on it — read from the stub rather than
 * restated, so a fixture that gains an attendee gains the check with it.
 */
const attendeesIn = (source: string): string[] => {
  const names = new Set<string>()
  // « Prénom Nom » before an address, which is how the stub writes an
  // interlocutor everywhere it writes one.
  for (const match of source.matchAll(
    /([A-ZÉÈÀÂÎÔÙ][\p{L}'’-]+ [A-ZÉÈÀÂÎÔÙ][\p{L}'’-]+)\s*\(?[\p{L}\p{N}._%+-]+@/gu,
  )) {
    const name = match[1]
    if (name) names.add(name)
  }
  return [...names]
}

test('the fixture’s compte-rendu is a document the composer could have produced', () => {
  const source = readFileSync(STUB, 'utf8')

  // The prose, without the deterministic header — which legitimately names
  // people, because `renderCompteRendu` writes it from Graph and not from the
  // model.
  const prose = /'## Résumé',([\s\S]*?)'## Éléments retenus'/.exec(source)?.[1]
  assert.ok(prose, 'le compte-rendu du harnais a changé de forme — mets ce test à jour')

  const names = attendeesIn(source)
  // A guard on the guard: if the extraction stops finding anyone, this test
  // would pass by looking at nothing.
  assert.ok(names.length >= 2, `attendus au moins deux participants, trouvés : ${names.join(', ')}`)

  const leaks = findDeterministicLeaks({ compteRendu: prose }, { names, emails: [] })

  assert.deepEqual(
    leaks,
    [],
    'la prose du compte-rendu de démonstration nomme un participant, une adresse ou une date ' +
      'calendaire — le vrai composeur refuserait cette extraction (DEC-7), donc les captures ' +
      'montrent un document que le produit n’écrit pas. Attribue au côté (« le client », ' +
      '« la DSI ») : le canal est mesuré, la personne ne l’est pas.',
  )
})


test('every quotation in the fixture’s compte-rendu is in the fixture’s call', () => {
  const source = readFileSync(STUB, 'utf8')

  const prose = /'## Résumé',([\s\S]*?)'## Éléments retenus'/.exec(source)?.[1]
  const lines = /const LINES = \[([\s\S]*?)\n  \]/.exec(source)?.[1]
  assert.ok(prose && lines, 'le harnais a changé de forme — mets ce test à jour')

  /*
   * The same fold `locateQuote` applies: accents dropped, case folded,
   * punctuation collapsed. The model's transcription of what it read and the
   * transcriber's own disagree on a comma often enough that an exact match would
   * fail a citation that is perfectly real.
   */
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()

  const call = fold(lines)
  const quotes = [...prose.matchAll(/«[\s\u00a0\u202f]?(\S(?:[^«»]*\S)?)[\s\u00a0\u202f]?»/gu)].map(
    (match) => match[1] ?? '',
  )
  assert.ok(quotes.length >= 3, `attendues au moins trois citations, trouvées ${quotes.length}`)

  const invented = quotes.filter((quote) => !call.includes(fold(quote)))
  assert.deepEqual(
    invented,
    [],
    'le compte-rendu de démonstration cite des mots que l’appel ne contient pas — ' +
      'le vrai composeur ne peut pas : le modèle ne voit que la transcription, et ' +
      'REGISTRE n’autorise les guillemets que pour ce que le client a dit.',
  )
})

/**
 * A bare `window`, so `installAppBridge` can be *run* rather than parsed.
 *
 * It assigns `window.app` and answers synchronously, so the fixture's own
 * responders are reachable from a Node test — which is the only way to hold it to
 * the shapes the renderer receives. The regexes this file used to lift literals
 * out with were a second implementation of the fixture, and they broke the first
 * time the fixture expressed the same fact differently: the sources check below
 * looked for `quote: '…'` and found **zero** the day those spans started being
 * located in the transcript instead of written beside it.
 */
const withStub = async <T,>(
  scenario: string,
  entra: boolean,
  read: (invoke: (channel: string, payload?: unknown) => Promise<unknown>) => Promise<T>,
): Promise<T> => {
  const globals = globalThis as { window?: unknown }
  const before = globals.window
  globals.window = { addEventListener: () => {} }
  try {
    const installAppBridge = await loadStub()
    installAppBridge({ scenario, now: PINNED_NOW, entra })
    const bridge = (globals.window as {
      app: { invoke: (c: string, p: unknown) => Promise<unknown> }
    }).app
    return await read((channel, payload) => bridge.invoke(channel, payload ?? {}))
  } finally {
    globals.window = before
  }
}

/**
 * **The instant the whole fixture is pinned to, minted the way `shot.mjs` mints
 * it** — today at 14:35 Europe/Paris.
 *
 * Every timing property below is relative to it, and it is the same number the
 * harness passes in, so this file asks the fixture the questions a stage asks it.
 * `Date.now()` would have made the future-dated-turn assertion pass or fail
 * depending on what time of day the suite ran.
 */
const PINNED_NOW = (() => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const read = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const guess = Date.UTC(Number(read.year), Number(read.month) - 1, Number(read.day), 14, 35)
  const shown = new Date(guess).toLocaleString('en-US', { timeZone: 'Europe/Paris', hour12: false })
  return guess - (new Date(shown).getHours() - 14) * 3_600_000
})()

/** The same fold `locateSegments` applies. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

type Span = { quote: string; channel: string; startMs: number | null; endMs: number | null }
type Segment = { id: string; channel: string; text: string; startMs: number; endMs: number; receivedAt: number }

test('every source the fixture offers leads to a turn the fixture’s call contains', async () => {
  /*
   * The document's provenance (DEC-21), held to the same standard as its
   * quotations — and for the same reason, which is that the failure is silent.
   *
   * Twelve bullets became followable. A `span.quote` the transcript does not
   * contain opens the reader on « Cet extrait est introuvable dans la
   * transcription », so a fixture with one invented quote would photograph the
   * feature's *failure* state on the flagship screen and pass every other check
   * in the repo.
   *
   * **Read off the running fixture, not off its source.** This test regexed
   * `quote: '…'` out of the file and asserted it found ten; the day the fixture
   * started *locating* those spans in its own transcript rather than writing them
   * beside it, the regex matched nothing and the assertion it was guarding
   * silently stopped being made — caught only by the anti-vacuity floor, which is
   * the one thing standing between « I looked and found nothing » and « I looked
   * at nothing ».
   */
  const panel = await withStub('review', true, async (invoke) => {
    const answer = (await invoke('review:get', { meetingId: 'm-neovia-cadrage' })) as {
      open: boolean
      panel: { sources: { text: string; span: Span }[]; edits: { compteRendu: string } }
    }
    assert.ok(answer.open, 'le fixture n’ouvre plus la porte de revue — mets ce test à jour')
    return answer.panel
  })
  const record = await withStub('review', true, async (invoke) =>
    (await invoke('review:transcript', { meetingId: 'm-neovia-cadrage' })) as { segments: Segment[] },
  )

  const call = fold(record.segments.map((segment) => segment.text).join(' '))
  const quotes = panel.sources.map((source) => source.span.quote)
  assert.ok(quotes.length >= 10, `attendues au moins dix sources, trouvées ${quotes.length}`)
  assert.ok(record.segments.length >= 10, `attendus au moins dix tours, trouvés ${record.segments.length}`)

  const missing = quotes.filter((quote) => !call.includes(fold(quote)))
  assert.deepEqual(
    missing,
    [],
    'une source du compte-rendu de démonstration pointe vers des mots que l’appel ' +
      'ne contient pas — la capture montrerait « introuvable » sur la fonctionnalité ' +
      'qu’elle est censée prouver.',
  )

  /*
   * **And the offset the gate prints is the offset the reader prints.**
   *
   * `Review.tsx:1828` draws « vérifié · mm:ss » from `span.startMs` on each of the
   * eleven field rows, and `source ▸` then opens `TranscriptReader`, which draws
   * the *turn's* own offset. Those were two unrelated numbers: the spans were
   * hand-written literals up to 840 000 ms — fourteen minutes — over a transcript
   * that spanned under three, and not one of them landed on the turn holding its
   * quote even under the old spacing. So the flagship screen said « vérifié · 14:00 »
   * about evidence the reader placed at 00:02:34, on the surface whose whole
   * argument is that a claim is checkable.
   */
  const drift: string[] = []
  for (const source of panel.sources) {
    if (source.span.startMs === null) continue
    const needle = fold(source.span.quote)
    const turn = record.segments.find((segment) => fold(segment.text).includes(needle))
    if (!turn) continue
    if (source.span.startMs < turn.startMs || source.span.startMs > turn.endMs) {
      drift.push(
        `« ${source.span.quote} » : span à ${source.span.startMs} ms, tour ${turn.id} de ` +
          `${turn.startMs} à ${turn.endMs} ms`,
      )
    }
  }
  assert.deepEqual(
    drift,
    [],
    'l’horodatage qu’une ligne affiche (« vérifié · mm:ss », Review.tsx) tombe hors du tour ' +
      'que « source ▸ » ouvre : deux nombres pour une même preuve, sur l’écran dont tout ' +
      'l’argument est qu’une affirmation est vérifiable.',
  )

  /*
   * And the other half: a source whose `text` is not a line of the fixture's own
   * compte-rendu matches nothing, so the bullet is drawn plain and the entry is
   * dead weight that no screenshot would reveal.
   */
  const written = new Set(
    panel.edits.compteRendu
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).replace(/[\s\u00a0]*⚠[\s\u00a0]*faible[\s\u00a0]*$/u, '').trim()),
  )
  const orphans = panel.sources.map((source) => source.text).filter((text) => !written.has(text))
  assert.deepEqual(
    orphans,
    [],
    'une source ne correspond à aucune ligne du compte-rendu de démonstration — ' +
      'le rendu compare par égalité, donc cette puce resterait sans provenance.',
  )
})

test('the fixture’s settings snapshot is one the product could actually send', async () => {
  /*
   * **The fifth time this stub has flattered the app, and the first that made a
   * screen impossible to look at.**
   *
   * Its eight provider rows were missing `fields`, which `ProviderRowSchema`
   * requires and `ProviderLine` reads as `row.fields.length`. So *Transcription*
   * and *Modèle de langage* both threw, the whole app went blank, and every
   * later pane click timed out — and no stage in `shot.mjs` opened either pane,
   * so « 74 mises en scène jouées » and its six measured checks had never
   * touched the surfaces where HR-4, DEC-30, DEC-34 and DEC-35 live. The shipped
   * app was fine; what was lost was the measurement.
   *
   * It also carried « Mistral AI (UE) » where the shipped registry says plain
   * « Mistral AI » — a jurisdiction claim CLAUDE.md explicitly forbids
   * reintroducing (DEC-37), living in the file the product is *looked at*
   * through.
   *
   * `harnessFixture.test.ts` checked the compte-rendu and nothing checked this.
   * Parsed with the product's own schema, which is the only standard that
   * matters: the renderer is typed against it on the other side of the bridge.
   */
  const source = readFileSync(STUB, 'utf8')

  /*
   * The stub is **run**, not parsed. `SETTINGS` closes over other locals, and a
   * regex that lifted the literal out would be a second implementation of the
   * fixture — which is the drift this whole file exists to prevent. A bare
   * `window` is all `installAppBridge` needs: it assigns `window.app` and
   * answers synchronously.
   */
  const globals = globalThis as { window?: unknown }
  const before = globals.window
  globals.window = { addEventListener: () => {} }
  let value: unknown
  try {
    const installAppBridge = await loadStub()
    installAppBridge({ scenario: 'reglages', now: Date.now(), entra: true })
    const bridge = (globals.window as { app: { invoke: (c: string, p: unknown) => unknown } }).app
    value = await bridge.invoke('settings:snapshot', {})
  } finally {
    globals.window = before
  }

  const parsed = SettingsSnapshotSchema.safeParse(value)
  assert.ok(
    parsed.success,
    `le SETTINGS du harnais ne passe pas son propre schéma : ${
      parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))
    }`,
  )

  // And no jurisdiction claim, on any row, in any label (DEC-37).
  assert.doesNotMatch(
    source,
    /\((UE|EU)\)/,
    'une revendication de juridiction est revenue dans le fixture — voir DEC-37',
  )
})

/**
 * **The stub's health sentences are the ones `main.ts` emits — the fourth time
 * this fixture has been caught saying something the product does not.**
 *
 * `main.ts` gained a second clause on the no-Entra `calendar` row: a rep on that
 * build loses the calendar *and* every arming offer, because `Agenda` and
 * `MeetingApps` are both constructed inside the branch that needs a Graph
 * registration — and DEC-26 says a degradation is stated, never silent. The
 * fixture kept the old one-clause sentence, so every `--sans-entra` stage
 * photographed a string the product no longer emits.
 *
 * It flattered the app in the direction the previous three did: shorter and
 * calmer than the truth, and — because it is half the length — unable to show a
 * reviewer whether the real sentence still fits the card it is drawn in at 960
 * pixels, which is the width `main.ts` declares as the minimum.
 *
 * Source as evidence, the `preloadUnwrap.test.ts` shape. A string comparison
 * rather than an import, because `bridge-stub.mjs` is deliberately one
 * self-contained function with no imports — Playwright serialises it to source
 * and evaluates it in the page — so the two cannot share a constant and a test
 * is the only thing that can hold them equal.
 *
 * It guards itself against finding nobody: both sides must be non-empty, or a
 * rename turns this into a test that passes by comparing two absences.
 */
test('the harness stub states the no-Entra degradation the product states', () => {
  const stub = readFileSync(STUB, 'utf8')
  const main = readFileSync(path.resolve(HERE, '../../../app/main.ts'), 'utf8')

  /*
   * Both files write the sentence as **adjacent literals** — it is too long for
   * one line under the formatter — so the comparison is over the *joined* text
   * rather than over source lines.
   *
   * Any number of them, which is not how this was first written: the regex
   * matched exactly two, and the first sentence to need a third was silently
   * compared truncated. The count is a consequence of where the formatter breaks
   * a line, so it is not a property either file should be held to — and a test
   * that reads only part of the string it is checking fails in the direction that
   * lets a drift through.
   */
  const joined = (source: string): string[] => {
    const out: string[] = []
    const re = /'(aucune application Microsoft configurée[^']*)'((?:\s*\+\s*'[^']*')*)/g
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      const rest = [...(match[2] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1]).join('')
      out.push(match[1]! + rest)
    }
    return out.sort()
  }

  const fromMain = joined(main)
  const fromStub = joined(stub)

  assert.ok(fromMain.length >= 2, `main.ts should state two no-Entra rows, found ${fromMain.length}`)
  assert.ok(fromStub.length >= 2, `the stub should state two no-Entra rows, found ${fromStub.length}`)
  assert.deepEqual(
    fromStub,
    fromMain,
    'the harness fixture states a different degradation from the one the product emits',
  )
})

/**
 * **No scenario stages an `armed` meeting beside a `recording` one — because the
 * product cannot produce that day, and the fixture was photographing it.**
 *
 * The fourth lie, and the first one about the *calendar* rather than about the
 * compte-rendu. `agenda-appel-imprevu` exists to photograph meeting detection
 * (`core/domain/adHoc.ts`), and `m-neovia-cadrage` had no branch for it, so it
 * fell through to `recording` and sat on the same day: the screen's one filled
 * *Enregistrer* directly above a row reading « En cours ». That is verbatim the
 * configuration `Agenda.#arm` and `AdHocInput.meetingLive` exist to prevent —
 * « three statements about one meeting, two of them false, on one screen » —
 * staged on the screen a reviewer looks at to judge the feature. A real build
 * reads `liveStates()`, counts exactly these two states, and answers « une
 * réunion est déjà en cours ou proposée »: there would have been no offer to
 * photograph at all.
 *
 * The row's own docblock said « photographing it would make the fixture argue
 * for a defect » and was simply wrong about being the only row on the day. That
 * is the third comment in this file written to keep the fixture honest and
 * ignored; a comment is not a check.
 *
 * The two states are `armed` and `recording` and deliberately not the six —
 * `Agenda` explains why at length, and widening the set here would make this
 * test disagree with the rule it is about.
 *
 * Scenarios are read out of the stub, never restated, so a fixture that gains
 * one gains the check with it; `__inconnu__` stands for every stage whose name
 * the stub does not branch on and which therefore gets the default day. And it
 * guards itself twice, because this property is the kind that passes by finding
 * nothing: the enumeration must find scenarios, and at least one of them must
 * actually stage an `armed` meeting — otherwise every day trivially satisfies a
 * rule about two states, one of which never occurs.
 */
test('no harness scenario stages an armed meeting beside a recording one', async () => {
  const source = readFileSync(STUB, 'utf8')

  const scenarios = [
    ...new Set([...source.matchAll(/scenario [!=]== '([^']+)'/g)].map((m) => m[1] as string)),
    // Every stage the stub has no branch for lands on the same default day.
    '__inconnu__',
  ].sort()
  assert.ok(
    scenarios.length >= 8,
    `l’énumération des scénarios n’en a trouvé que ${scenarios.length} — le stub a changé de ` +
      'forme et ce test ne regarde plus rien',
  )

  const installAppBridge = await loadStub()
  const globals = globalThis as { window?: unknown }
  const before = globals.window

  /** Every meeting the stub stages for one scenario, by state. */
  const dayOf = async (scenario: string, entra: boolean): Promise<{ id: string; state: string }[]> => {
    globals.window = { addEventListener: () => {} }
    try {
      installAppBridge({ scenario, now: Date.now(), entra })
      const bridge = (globals.window as { app: { invoke: (c: string, p: unknown) => unknown } }).app
      return (await bridge.invoke('meeting:list', {})) as { id: string; state: string }[]
    } finally {
      globals.window = before
    }
  }

  const offences: string[] = []
  let everArmed = 0

  for (const scenario of scenarios) {
    // Both halves of the axis: `entra: false` is the build DEC-28 ships first,
    // and it is the one this defect was found on.
    for (const entra of [true, false]) {
      const meetings = await dayOf(scenario, entra)
      const armed = meetings.filter((m) => m.state === 'armed')
      const recording = meetings.filter((m) => m.state === 'recording')
      if (armed.length > 0) everArmed += 1
      if (armed.length > 0 && recording.length > 0) {
        offences.push(
          `${scenario} (entra: ${entra}) : ${armed.map((m) => m.id).join(', ')} ` +
            `armé(s) pendant que ${recording.map((m) => m.id).join(', ')} enregistre`,
        )
      }
      // And one armed meeting at most: `core/domain/arming.ts` picks the
      // earliest, and `DayPane` gives the armed row the day's single filled
      // primary. Two would be two of them.
      if (armed.length > 1) {
        offences.push(
          `${scenario} (entra: ${entra}) : ${armed.length} réunions armées à la fois ` +
            `(${armed.map((m) => m.id).join(', ')})`,
        )
      }
    }
  }

  assert.ok(
    everArmed > 0,
    'aucun scénario ne met en scène de réunion armée — ce test passerait sur une propriété ' +
      'que rien ne peut violer',
  )

  assert.deepEqual(
    offences,
    [],
    'le fixture met en scène une réunion armée à côté d’une réunion en cours : le produit ' +
      'refuse cette journée (Agenda.#arm, AdHocInput.meetingLive — « une réunion est déjà en ' +
      'cours ou proposée »), donc la capture montre deux boutons primaires pour une seule ' +
      'conversation et fait plaider le fixture pour un défaut.',
  )
})

/**
 * **Four numbers in three files that must stay in one order, and nothing checked it.**
 *
 * The widget's first frame is decided by a handshake across a process boundary. The
 * renderer waits for the type to settle *and* for `widget:state` to answer before it
 * reports a size (`MEASURE_DEADLINE_MS`); the main process waits for that report before
 * it shows the window (`FIRST_FRAME_MS`), with a ceiling on the whole appearance
 * (`APPEARANCE_MS`). And the harness fixture now answers `widget:state` after a delay,
 * because 43 of its 44 responders resolving in the same microtask is what hid this class
 * of defect for thirteen rounds.
 *
 * Put those numbers out of order and **the handshake is decided by the wrong side**. If
 * the fixture's latency exceeds the renderer's deadline, the deadline fires every time
 * and the wait it guards never happens — which is exactly how the first attempt at this
 * fix measured as working while doing nothing: at 120 ms against a 150 ms answer, the
 * gate was decided before the content arrived, every run. If the renderer's deadline
 * exceeds the main process's, the *main process* wins and what it reveals is
 * `INITIAL_SIZE` — 232×52, forty-nine pixels narrower than the pill, carrying « Aucun
 * enregistrement » over a live call. That is the defect this whole round closed,
 * reintroduced by editing a constant, with every test still green.
 *
 * Read from source rather than imported, the `preloadUnwrap.test.ts` shape: `Widget.tsx`
 * is `.tsx` and would need a JSX loader here, `Overlay.ts` pulls in Electron types, and
 * the stub is deliberately one browser-shaped file. What is being asserted is an
 * *ordering between files*, so reading the files is the honest instrument.
 */
test('the widget’s first-frame deadlines are ordered across the three files that hold them', () => {
  const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')
  const number = (source: string, pattern: RegExp, what: string): number => {
    const found = pattern.exec(source)
    assert.ok(found, `${what} n’a pas été trouvé — la constante a été renommée ou déplacée`)
    const value = Number(found[1]?.replace(/_/g, ''))
    assert.ok(Number.isFinite(value) && value > 0, `${what} n’est pas un nombre: ${found[1]}`)
    return value
  }

  const latency = number(
    read('../../../../scripts/harness/bridge-stub.mjs'),
    /'widget:state':\s*(\d[\d_]*)\s*,/,
    "la latence de `widget:state` dans bridge-stub.mjs",
  )
  const measure = number(
    read('../../../../src/widget/Widget.tsx'),
    /const MEASURE_DEADLINE_MS\s*=\s*(\d[\d_]*)/,
    'MEASURE_DEADLINE_MS',
  )
  const firstFrame = number(
    read('../../../../electron/app/windows/Overlay.ts'),
    /export const FIRST_FRAME_MS\s*=\s*(\d[\d_]*)/,
    'FIRST_FRAME_MS',
  )
  const appearance = number(
    read('../../../../electron/app/windows/Overlay.ts'),
    /export const APPEARANCE_MS\s*=\s*(\d[\d_]*)/,
    'APPEARANCE_MS',
  )

  assert.ok(
    latency < measure,
    `le harnais répond à widget:state en ${latency} ms et le rendu abandonne à ${measure} ms — ` +
      'le délai décide avant que le contenu arrive, donc l’attente qu’il protège n’a jamais lieu',
  )
  assert.ok(
    measure < firstFrame,
    `le rendu parle au plus tard à ${measure} ms et le processus principal montre la fenêtre à ` +
      `${firstFrame} ms — dans cet ordre-là c’est le principal qui décide, et ce qu’il montre ` +
      'est la taille devinée (232×52), quarante-neuf pixels plus étroite que la pilule',
  )
  assert.ok(
    firstFrame < appearance,
    `le plafond d’apparition (${appearance} ms) doit rester au-delà de ${firstFrame} ms, ` +
      'sinon il court-circuite la mesure qu’il n’existe que pour secourir',
  )
})
