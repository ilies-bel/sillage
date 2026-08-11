/**
 * The rail's producer, with a stub `LlmPort` and no network.
 *
 * Everything the module promises is testable without a model, which is the
 * point of splitting the chunking decision, the dedup key and the reply mapping
 * out as pure functions: the only thing the stub supplies is what a model would
 * have said, and every rule about what happens next is exercised here.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiagInput, DiagRecorder } from '../../../core/contracts/diagnostics.ts'
import type { LlmPort, LlmRequest, LlmStructuredRequest } from '../../../core/contracts/llm.ts'
import type { Signal } from '../../../core/contracts/signals.ts'
import type { Channel, TranscriptSegment } from '../../../core/contracts/transcript.ts'
import { SignalExtractor } from '../SignalExtractor.ts'
import { CHUNK_MAX_WORDS, CHUNK_MIN_WORDS, CHUNK_WINDOW_MS, shouldFlush } from '../chunking.ts'
import { SIGNAL_INSTRUCTIONS, type SignalReply } from '../prompt.ts'
import { dedupKey, toSignals } from '../toSignals.ts'

// ── harness ────────────────────────────────────────────────────────────────

let counter = 0
const seg = (
  channel: Channel,
  text: string,
  startMs: number,
  endMs: number,
  isFinal = true,
): TranscriptSegment => ({
  id: `s${++counter}`,
  channel,
  text,
  startMs,
  endMs,
  isFinal,
  provider: 'stub',
  receivedAt: 0,
})

/** Enough words that the word floor is never what is under test. */
const padding = (words: number): string => Array.from({ length: words }, () => 'ensuite').join(' ')

class StubLlm implements LlmPort {
  inputs: string[] = []
  #queue: (SignalReply | Error)[]

  constructor(queue: (SignalReply | Error)[]) {
    this.#queue = [...queue]
  }

  async complete(_request: LlmRequest): Promise<string> {
    throw new Error('the rail never calls complete')
  }

  async structured<T>(request: LlmStructuredRequest<T>): Promise<T> {
    this.inputs.push(request.input)
    const next = this.#queue.shift() ?? { signaux: [] }
    if (next instanceof Error) throw next
    // Parsed through the caller's own schema, exactly as an adapter would: a
    // reply the schema rejects must be an error here too.
    return request.schema.parse(next)
  }
}

const recorder = (): DiagRecorder & { events: DiagInput[] } => {
  const events: DiagInput[] = []
  return { events, record: (input: DiagInput) => void events.push(input) }
}

/** One minute of speech, long enough to close a chunk on its own. */
const minute = (index: number, text: string, channel: Channel = 'far'): TranscriptSegment =>
  seg(channel, `${text} ${padding(30)}`, index * CHUNK_WINDOW_MS, (index + 1) * CHUNK_WINDOW_MS)

const TJM = 'notre enveloppe est de 520 euros par jour'
const TJM_AGAIN = 'je confirme 520 euros par jour'

const tjmChip = (quote: string): SignalReply => ({
  signaux: [{ type: 'tjm', libelle: 'TJM 520 €', citation: quote }],
})

// ── chunking ───────────────────────────────────────────────────────────────

test('chunking does not fire on every segment', async () => {
  const llm = new StubLlm([])
  const extractor = new SignalExtractor({ llm, onSignal: () => {} })

  // Twelve utterances, five seconds apart: a normal exchange, well under the
  // window and under the word ceiling.
  for (let i = 0; i < 12; i += 1) {
    extractor.push(seg('far', 'oui tout à fait, on est bien sur ce point', i * 5_000, i * 5_000 + 4_000))
  }
  await extractor.idle()
  assert.equal(llm.inputs.length, 0)

  // The segment that closes the minute is the one that spends a call.
  extractor.push(seg('far', `et donc ${padding(20)}`, 58_000, 61_000))
  await extractor.idle()
  assert.equal(llm.inputs.length, 1)
})

test('a quiet minute skips its turn rather than spending a call on silence', () => {
  const quiet = [seg('rep', 'vous m’entendez ?', 0, CHUNK_WINDOW_MS)]
  assert.equal(shouldFlush(quiet), false)
  assert.ok(CHUNK_MIN_WORDS > 0)
})

test('a loud minute fires early, on the word ceiling', () => {
  const loud = [seg('far', padding(CHUNK_MAX_WORDS + 5), 0, 20_000)]
  assert.equal(shouldFlush(loud), true)
})

// ── DEC-21 ─────────────────────────────────────────────────────────────────

test('a signal whose quote is absent from the transcript is dropped', async () => {
  const llm = new StubLlm([
    { signaux: [{ type: 'tjm', libelle: 'TJM 700 €', citation: 'nous partons sur 700 euros' }] },
  ])
  const diagnostics = recorder()
  const emitted: Signal[] = []
  const extractor = new SignalExtractor({ llm, diagnostics, onSignal: (s) => emitted.push(s) })

  extractor.push(minute(0, TJM))
  await extractor.idle()

  assert.equal(emitted.length, 0)
  assert.equal(diagnostics.events.at(0)?.code, 'signals.span.unverified')
})

test('a verified signal carries the span read off the transcript, not the reply', async () => {
  const llm = new StubLlm([tjmChip('520 euros par jour')])
  const emitted: Signal[] = []
  const extractor = new SignalExtractor({ llm, clock: () => 1_700, onSignal: (s) => emitted.push(s) })

  extractor.push(minute(0, TJM, 'far'))
  await extractor.idle()

  assert.equal(emitted.length, 1)
  assert.equal(emitted[0]?.label, 'TJM 520 €')
  assert.equal(emitted[0]?.source.channel, 'far')
  assert.equal(emitted[0]?.source.startMs, 0)
  assert.equal(emitted[0]?.createdAt, 1_700)
})

// ── dedup and seq ──────────────────────────────────────────────────────────

test('the same fact twice yields one chip', async () => {
  const llm = new StubLlm([tjmChip('520 euros par jour'), tjmChip('je confirme 520 euros')])
  const emitted: Signal[] = []
  const extractor = new SignalExtractor({ llm, onSignal: (s) => emitted.push(s) })

  extractor.push(minute(0, TJM))
  await extractor.idle()
  extractor.push(minute(1, TJM_AGAIN))
  await extractor.idle()

  assert.equal(llm.inputs.length, 2)
  assert.equal(emitted.length, 1)
})

test('dedup folds case, spacing and the currency sign', () => {
  assert.equal(dedupKey('tjm', 'TJM 520 €'), dedupKey('tjm', 'tjm  520€'))
  assert.notEqual(dedupKey('tjm', 'TJM 520 €'), dedupKey('objection', 'TJM 520 €'))
  assert.notEqual(dedupKey('tjm', 'TJM 520 €'), dedupKey('tjm', 'TJM 540 €'))
})

test('a duplicate inside one reply never gets a seq', () => {
  const segments = [seg('far', TJM, 0, 5_000)]
  const result = toSignals({
    reply: {
      signaux: [
        { type: 'tjm', libelle: 'TJM 520 €', citation: '520 euros par jour' },
        { type: 'tjm', libelle: 'tjm 520€', citation: '520 euros par jour' },
        { type: 'mode', libelle: 'régie', citation: 'enveloppe est de 520' },
      ],
    },
    segments,
    seen: new Set<string>(),
    nextSeq: 0,
    createdAt: 0,
    id: (n) => `sig-${n}`,
  })

  assert.equal(result.duplicates, 1)
  assert.deepEqual(
    result.signals.map((s) => s.seq),
    [0, 1],
  )
})

test('seq is monotonic and stable across a re-run', async () => {
  const run = async (): Promise<Signal[]> => {
    const llm = new StubLlm([
      {
        signaux: [
          { type: 'tjm', libelle: 'TJM 520 €', citation: '520 euros par jour' },
          { type: 'profil', libelle: '2× Dev Java senior', citation: 'deux dev java senior' },
          { type: 'autre', libelle: 'inventé', citation: 'jamais prononcé' },
        ],
      },
      { signaux: [{ type: 'mode', libelle: 'régie', citation: 'ce serait de la régie' }] },
    ])
    const emitted: Signal[] = []
    const extractor = new SignalExtractor({
      llm,
      clock: () => 42,
      newId: (n) => `sig-${n}`,
      onSignal: (s) => emitted.push(s),
    })
    extractor.push(minute(0, `${TJM}, il nous faut deux dev java senior`))
    await extractor.idle()
    extractor.push(minute(1, 'ce serait de la régie sur site'))
    await extractor.idle()
    return emitted
  }

  const first = await run()
  const second = await run()

  assert.deepEqual(
    first.map((s) => s.seq),
    [0, 1, 2],
  )
  assert.deepEqual(first, second)
})

test('a resumed session continues the numbering it replayed', async () => {
  const existing: Signal[] = [
    {
      id: 'sig-0',
      seq: 0,
      kind: 'tjm',
      label: 'TJM 520 €',
      source: { quote: '520 euros', channel: 'far', startMs: 0, endMs: 1 },
      createdAt: 0,
    },
  ]
  const llm = new StubLlm([
    {
      signaux: [
        // Already on the rail: must not be re-announced.
        { type: 'tjm', libelle: 'tjm 520 €', citation: '520 euros par jour' },
        { type: 'mode', libelle: 'régie', citation: 'ce serait de la régie' },
      ],
    },
  ])
  const emitted: Signal[] = []
  const extractor = new SignalExtractor({
    llm,
    existing,
    newId: (n) => `sig-${n}`,
    onSignal: (s) => emitted.push(s),
  })

  extractor.push(minute(0, `${TJM}, ce serait de la régie`))
  await extractor.idle()

  assert.equal(emitted.length, 1)
  assert.equal(emitted[0]?.seq, 1)
})

// ── DEC-26: nothing here may break a meeting ───────────────────────────────

test('a model failure records a diagnostic and does not throw', async () => {
  const llm = new StubLlm([new Error('502 bad gateway'), tjmChip('520 euros par jour')])
  const diagnostics = recorder()
  const emitted: Signal[] = []
  const extractor = new SignalExtractor({ llm, diagnostics, onSignal: (s) => emitted.push(s) })

  extractor.push(minute(0, 'un premier échange sans intérêt particulier'))
  await extractor.idle()

  assert.equal(diagnostics.events.length, 1)
  assert.equal(diagnostics.events[0]?.code, 'signals.chunk.failed')
  assert.equal(diagnostics.events[0]?.module, 'signals')

  // And the next chunk is still attempted: one bad minute is not a dead rail.
  extractor.push(minute(1, TJM))
  await extractor.idle()
  assert.equal(llm.inputs.length, 2)
  assert.equal(emitted.length, 1)
})

test('a malformed reply is an error, not a guess', async () => {
  const diagnostics = recorder()
  const llm = new StubLlm([
    // The DEC-7 failure: a field for a person. The strict schema refuses it.
    { signaux: [{ type: 'tjm', libelle: 'TJM 520 €', citation: '520 euros', qui: 'Marc Dupont' }] },
  ] as unknown as SignalReply[])
  const emitted: Signal[] = []
  const extractor = new SignalExtractor({ llm, diagnostics, onSignal: (s) => emitted.push(s) })

  extractor.push(minute(0, TJM))
  await extractor.idle()

  assert.equal(emitted.length, 0)
  assert.equal(diagnostics.events[0]?.code, 'signals.chunk.failed')
})

test('a consumer that throws cannot take the session with it', async () => {
  const llm = new StubLlm([tjmChip('520 euros par jour')])
  const diagnostics = recorder()
  const extractor = new SignalExtractor({
    llm,
    diagnostics,
    onSignal: () => {
      throw new Error('the renderer is gone')
    },
  })

  extractor.push(minute(0, TJM))
  await extractor.idle()
  assert.equal(diagnostics.events[0]?.code, 'signals.chunk.failed')
})

test('stopping abandons the pending window and produces nothing more', async () => {
  const llm = new StubLlm([tjmChip('520 euros par jour')])
  const emitted: Signal[] = []
  const extractor = new SignalExtractor({ llm, onSignal: (s) => emitted.push(s) })

  extractor.stop()
  extractor.push(minute(0, TJM))
  await extractor.idle()

  assert.equal(llm.inputs.length, 0)
  assert.equal(emitted.length, 0)
})

// ── DEC-5 / DEC-14: the document is unreachable from here ──────────────────

test('the module has no way to write to the document', async () => {
  const surface = Object.getOwnPropertyNames(SignalExtractor.prototype).sort()
  assert.deepEqual(surface, ['constructor', 'idle', 'push', 'stop'])

  const extractor = new SignalExtractor({ llm: new StubLlm([]), onSignal: () => {} })
  // Every field is `#private`: there is no document, editor or view to reach.
  assert.deepEqual(Object.keys(extractor), [])

  const module = await import('../index.ts')
  for (const name of Object.keys(module)) {
    assert.doesNotMatch(name, /doc|editor|prosemirror|transaction|note|insert|write/i, name)
  }
})

test('the prompt never asks for deterministic data (DEC-7)', () => {
  assert.match(SIGNAL_INSTRUCTIONS, /nom de personne/)
  assert.match(SIGNAL_INSTRUCTIONS, /e-mail/)
  assert.match(SIGNAL_INSTRUCTIONS, /français/)
})
