/**
 * The session and the audio maths, with no network and no key.
 *
 * The upload path itself is covered by injecting a fake `SttSession`; what is
 * tested directly is everything that would silently corrupt a transcript
 * without ever throwing — the WAV header a provider answers with an empty
 * string when it is wrong, the resample that must match the Rust DSP, and the
 * SSRF guard on a region that gets interpolated into a hostname.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { Channel } from '../../../core/contracts/transcript.ts'
import type { SttSession, SttSessionOptions } from '../SttSession.ts'
import { TranscribeSession, usableSttProviders } from '../index.ts'
import { selectProvider } from '../registry.ts'
import {
  RestSttSession,
  isValidRegion,
  isSilent,
  downsampleToMono16k,
  wavHeader,
  PROVIDERS,
} from '../RestSttSession.ts'

class FakeSession extends EventEmitter implements SttSession {
  readonly providerId = 'fake'
  started = false
  stopped = false
  written: Array<{ bytes: number; sampleRate: number }> = []
  flushes = 0
  /** Set to make `stop()` reject, so the "both channels stop anyway" case is real. */
  failOnStop = false

  start(): void {
    this.started = true
  }
  write(chunk: Buffer, sampleRate: number): void {
    this.written.push({ bytes: chunk.length, sampleRate })
  }
  notifySpeechEnded(): void {
    this.flushes++
  }
  async stop(): Promise<void> {
    this.stopped = true
    if (this.failOnStop) throw new Error('boom')
  }
}

const build = (overrides: Partial<ConstructorParameters<typeof TranscribeSession>[0]> = {}) => {
  const made = new Map<Channel, FakeSession>()
  let now = 1_000
  const session = new TranscribeSession({
    providerId: 'azure-fr',
    apiKey: 'k',
    language: 'fr-FR',
    startedAt: 1_000,
    clock: () => now,
    createSession: (channel: Channel, _options: SttSessionOptions) => {
      const fake = new FakeSession()
      made.set(channel, fake)
      return fake
    },
    ...overrides,
  })
  return { session, made, tick: (ms: number) => (now += ms) }
}

test('start opens one session per channel', () => {
  const { session, made } = build()
  session.start()
  assert.deepEqual([...made.keys()].sort(), ['far', 'rep'])
  assert.ok(made.get('rep')?.started)
  assert.ok(made.get('far')?.started)
})

test('frames reach the session for their own channel and no other', () => {
  const { session, made } = build()
  session.start()
  session.write('rep', Buffer.alloc(320), 16_000)
  session.write('far', Buffer.alloc(640), 48_000)
  assert.deepEqual(made.get('rep')?.written, [{ bytes: 320, sampleRate: 16_000 }])
  assert.deepEqual(made.get('far')?.written, [{ bytes: 640, sampleRate: 48_000 }])
})

test('a segment carries the channel, the provider and the meeting clock', () => {
  const { session, made, tick } = build()
  const segments: unknown[] = []
  session.on('segment', (s) => segments.push(s))
  session.start()
  tick(4_500)
  made.get('far')?.emit('transcript', { text: '  on part sur du régie  ', isFinal: true })
  assert.equal(segments.length, 1)
  assert.deepEqual(segments[0], {
    id: 'far-1',
    channel: 'far',
    text: '  on part sur du régie  ',
    startMs: 4_500,
    endMs: 4_500,
    isFinal: true,
    provider: 'azure-fr',
    receivedAt: 5_500,
  })
})

test('segment ids are unique across both channels', () => {
  const { session, made } = build()
  const ids: string[] = []
  session.on('segment', (s: { id: string }) => ids.push(s.id))
  session.start()
  made.get('rep')?.emit('transcript', { text: 'a', isFinal: true })
  made.get('far')?.emit('transcript', { text: 'b', isFinal: true })
  made.get('rep')?.emit('transcript', { text: 'c', isFinal: true })
  assert.deepEqual(ids, ['rep-1', 'far-2', 'rep-3'])
  assert.equal(new Set(ids).size, 3)
})

test('the VAD flush reaches only the channel that went quiet', () => {
  const { session, made } = build()
  session.start()
  session.speechEnded('rep')
  assert.equal(made.get('rep')?.flushes, 1)
  assert.equal(made.get('far')?.flushes, 0)
})

test('a provider error degrades transcription and never takes capture down', () => {
  const { session, made } = build()
  const health: Array<{ state: string; reason?: string }> = []
  session.on('health', (h) => health.push(h))
  session.on('error', () => {})
  session.start()
  made.get('far')?.emit('error', new Error('429'))
  const last = health.at(-1)
  assert.equal(last?.state, 'degraded')
  assert.match(last?.reason ?? '', /audio système/)
  // Still « dégradée », and DEC-30 does not touch it: one of the two capture
  // channels has stopped producing words, which is a real loss of capability
  // whichever engine is running. What DEC-30 forbids is calling the *local
  // engine* a degradation, not calling a dead channel one.
  assert.match(last?.reason ?? '', /dégradée/)
  // DEC-26: nothing downstream may stop a meeting being recorded.
  assert.notEqual(last?.state, 'down')
})

/*
 * Failover — HR-4's floor, reached mid-meeting.
 *
 * The scenario is the hotel network dying at minute six. Without this the
 * meeting keeps *recording* (DEC-26 holds) and keeps producing nothing, and
 * because the audio is discarded as it is transcribed (DEC-12) there is nothing
 * to go back to: the rest of the call is gone. `made` is keyed by channel and a
 * failover overwrites it, so these tests keep every session ever built.
 */
const buildWithFallback = (fallbackProviderId?: string) => {
  const built: Array<{ channel: Channel; providerId: string; session: FakeSession }> = []
  let now = 1_000
  const session = new TranscribeSession({
    providerId: 'azure-fr',
    ...(fallbackProviderId ? { fallbackProviderId } : {}),
    apiKey: 'k',
    language: 'fr-FR',
    startedAt: 1_000,
    clock: () => now,
    createSession: (channel: Channel, _options: SttSessionOptions, providerId: string) => {
      const fake = new FakeSession()
      built.push({ channel, providerId, session: fake })
      return fake
    },
  })
  session.on('error', () => {})
  /** The most recently built session for a channel — after a failover, the new one. */
  const live = (channel: Channel) => built.filter((b) => b.channel === channel).at(-1)!.session
  const liveProvider = (channel: Channel) =>
    built.filter((b) => b.channel === channel).at(-1)!.providerId
  return { session, built, live, liveProvider, tick: (ms: number) => (now += ms) }
}

const failTimes = (s: FakeSession, times: number) => {
  for (let i = 0; i < times; i++) s.emit('error', new Error('ETIMEDOUT'))
}

test('a provider that keeps failing is replaced by the local floor', () => {
  const { session, built, live, liveProvider } = buildWithFallback('local-whisper')
  session.start()
  assert.equal(session.providerId, 'azure-fr')

  failTimes(live('far'), 3)

  // Both channels move, not just the one that failed: what kills a cloud
  // provider is not a property of one microphone.
  assert.equal(session.providerId, 'local-whisper')
  assert.equal(liveProvider('rep'), 'local-whisper')
  assert.equal(liveProvider('far'), 'local-whisper')
  assert.equal(built.filter((b) => b.providerId === 'local-whisper').length, 2)
})

test('one bad request is a blip, not a reason to change engine for the rest of the meeting', () => {
  const { session, live } = buildWithFallback('local-whisper')
  session.start()
  failTimes(live('far'), 2)
  assert.equal(session.providerId, 'azure-fr')
})

test('a result proves the provider is alive and resets the count', () => {
  const { session, live } = buildWithFallback('local-whisper')
  session.start()
  failTimes(live('far'), 2)
  live('far').emit('transcript', { text: 'la migration est bien lancée', isFinal: true })
  failTimes(live('far'), 2)
  assert.equal(session.providerId, 'azure-fr')
})

test('audio keeps flowing to the engine that replaced the dead one', () => {
  const { session, live } = buildWithFallback('local-whisper')
  session.start()
  const dead = live('rep')
  failTimes(live('far'), 3)

  session.write('rep', Buffer.alloc(320), 16_000)
  assert.equal(dead.written.length, 0, 'nothing goes to the session we gave up on')
  assert.deepEqual(live('rep').written, [{ bytes: 320, sampleRate: 16_000 }])
})

test('segments after a failover name the engine that actually produced them', () => {
  const { session, live, tick } = buildWithFallback('local-whisper')
  const segments: Array<{ provider: string }> = []
  session.on('segment', (s) => segments.push(s))
  session.start()
  live('far').emit('transcript', { text: 'avant', isFinal: true })
  failTimes(live('far'), 3)
  tick(1_000)
  live('far').emit('transcript', { text: 'après', isFinal: true })
  assert.deepEqual(segments.map((s) => s.provider), ['azure-fr', 'local-whisper'])
})

/*
 * DEC-30. The cloud engine was the opt-in upgrade; coming back to the machine's
 * own engine is a return to the default, and the app does not tell a rep their
 * meeting got worse when it did not. `state` is the load-bearing half — a
 * `degraded` here moves the header's general status off *Tout fonctionne* for
 * the rest of the call (DEC-32) no matter how the French beside it is worded.
 */
test('taking over with the local engine is not announced as a degradation', () => {
  const { session, live } = buildWithFallback('local-whisper')
  const health: Array<{ state: string; reason?: string }> = []
  session.on('health', (h) => health.push(h))
  session.start()
  failTimes(live('far'), 3)
  const last = health.at(-1)
  assert.equal(last?.state, 'ok')
  // DEC-26 again: a transcription outage never reports the meeting as down.
  assert.ok(health.every((h) => h.state !== 'down'))
  // Nor in words. Nothing here calls the local engine a retreat.
  assert.ok(health.every((h) => !/repli/i.test(h.reason ?? '')))
})

test('the local engine clears the complaint the dead cloud engine left behind', () => {
  // Not silence: `#onError` already raised `degraded` on the way out, and that
  // sentence is false once words are arriving again. `ok` retracts it.
  const { session, live } = buildWithFallback('local-whisper')
  const health: Array<{ state: string; reason?: string }> = []
  session.on('health', (h) => health.push(h))
  session.start()
  failTimes(live('far'), 3)
  assert.ok(
    health.some((h) => h.state === 'degraded'),
    'the failing cloud provider did complain',
  )
  assert.equal(health.at(-1)?.state, 'ok', 'and the complaint is retracted, not left standing')
})

test('the swap is on the diagnostic record even though it is not on the health strip', () => {
  // DEC-27: what changed is an event in the log. It is just not a degradation.
  const events: Array<{ code: string; detail: Record<string, unknown> }> = []
  const built: Array<FakeSession> = []
  const session = new TranscribeSession({
    providerId: 'azure-fr',
    fallbackProviderId: 'local-whisper',
    apiKey: 'k',
    language: 'fr-FR',
    startedAt: 1_000,
    diagnostics: {
      record: (event) => {
        events.push({ code: event.code, detail: event.detail as Record<string, unknown> })
      },
    },
    createSession: () => {
      const fake = new FakeSession()
      built.push(fake)
      return fake
    },
  })
  session.on('error', () => {})
  session.start()
  failTimes(built.at(-1)!, 3)
  const swap = events.find((e) => e.code === 'transcribe.failover')
  assert.ok(swap, 'the failover is recorded')
  assert.deepEqual(swap?.detail.to, 'local-whisper')
})

test('the floor is one-way — a failing fallback does not start a second migration', () => {
  const { session, built, live } = buildWithFallback('local-whisper')
  session.start()
  failTimes(live('far'), 3)
  const after = built.length
  failTimes(live('far'), 6)
  assert.equal(built.length, after, 'no third set of sessions')
  assert.equal(session.providerId, 'local-whisper')
})

test('with no fallback named, a failing provider stays put', () => {
  const { session, built, live } = buildWithFallback()
  session.start()
  failTimes(live('far'), 5)
  assert.equal(session.providerId, 'azure-fr')
  assert.equal(built.length, 2)
})

test('a session already on the floor has nowhere to fall', () => {
  const { session, built, live } = buildWithFallback('azure-fr')
  session.start()
  failTimes(live('far'), 5)
  assert.equal(built.length, 2)
})

test('the abandoned sessions are stopped, and a stop that hangs does not block the swap', () => {
  const { session, built, live } = buildWithFallback('local-whisper')
  session.start()
  const dead = live('far')
  dead.failOnStop = true
  failTimes(dead, 3)
  // Synchronous assertion on purpose: the swap must not be waiting on the
  // flush of the very provider that stopped answering.
  assert.equal(session.providerId, 'local-whisper')
  assert.ok(built[0]?.session.stopped)
  assert.ok(built[1]?.session.stopped)
})

test('stop stops both channels even when one of them throws', async () => {
  const { session, made } = build()
  session.start()
  const rep = made.get('rep')
  const far = made.get('far')
  if (rep) rep.failOnStop = true
  await session.stop()
  assert.ok(rep?.stopped)
  assert.ok(far?.stopped)
  assert.equal(session.running, false)
})

test('frames after stop are dropped rather than queued for a dead session', async () => {
  const { session, made } = build()
  session.start()
  await session.stop()
  session.write('rep', Buffer.alloc(320), 16_000)
  assert.equal(made.get('rep')?.written.length, 0)
})

/*
 * "Configured" and "installed" are different questions, and only one of them
 * can be answered from the environment.
 *
 * `local-whisper` has no credential to be missing, so `configuredSttProviders`
 * always lists it. Handing that answer to the selector on a machine whose
 * weights were never downloaded picks it — and transformers then starts a
 * several-hundred-megabyte transfer during the meeting it was chosen to make
 * safe. These run with no Electron and no cache, which *is* the unprepared
 * machine.
 */
test('the local engine is not offered when its weights are not on disk', () => {
  assert.equal(usableSttProviders({ env: {} }).includes('local-whisper'), false)
})

test('a key from the vault configures a cloud provider with no environment (DEC-34)', () => {
  assert.deepEqual(usableSttProviders({ stored: { 'azure-fr': 'k' }, env: {} }), ['azure-fr'])
})

test('a configured cloud provider is still offered', () => {
  assert.deepEqual(usableSttProviders({ env: { SILLAGE_AZURE_SPEECH_KEY: 'k' } }), ['azure-fr'])
})

test('an unprepared machine with no keys offers nothing, and says so through the selector', () => {
  const chosen = selectProvider({ configured: usableSttProviders({ env: {} }), language: 'fr-FR' })
  assert.equal(chosen.ok, false)
})

test('the region guard rejects anything that is not an Azure region label', () => {
  assert.equal(isValidRegion('francecentral'), true)
  assert.equal(isValidRegion('westeurope'), true)
  // The region is interpolated into the endpoint hostname.
  assert.equal(isValidRegion('evil.example.com'), false)
  assert.equal(isValidRegion('a/../b'), false)
  assert.equal(isValidRegion(''), false)
  assert.equal(isValidRegion(undefined), false)
})

test('the Azure endpoint falls back to France Central rather than a poisoned host', () => {
  const config = PROVIDERS['azure-fr'].build({
    apiKey: 'k',
    region: undefined,
    language: 'fr-FR',
    prompt: undefined,
  })
  assert.match(config.endpoint, /^https:\/\/francecentral\.stt\.speech\.microsoft\.com\//)
})

test('Whisper providers take the boost terms as a prompt, in ISO-639-1', () => {
  const config = PROVIDERS['groq-whisper'].build({
    apiKey: 'k',
    region: undefined,
    language: 'fr-FR',
    prompt: 'TJM, régie, intercontrat',
  })
  assert.equal(config.fields?.language, 'fr')
  assert.equal(config.fields?.prompt, 'TJM, régie, intercontrat')
})

test('the WAV header describes the bytes that follow it', () => {
  const header = wavHeader(3_200)
  assert.equal(header.length, 44)
  assert.equal(header.toString('ascii', 0, 4), 'RIFF')
  assert.equal(header.toString('ascii', 8, 12), 'WAVE')
  assert.equal(header.readUInt32LE(4), 36 + 3_200, 'RIFF size')
  assert.equal(header.readUInt16LE(20), 1, 'PCM')
  assert.equal(header.readUInt16LE(22), 1, 'mono')
  assert.equal(header.readUInt32LE(24), 16_000, 'sample rate')
  assert.equal(header.readUInt32LE(28), 32_000, 'byte rate')
  assert.equal(header.readUInt16LE(32), 2, 'block align')
  assert.equal(header.readUInt32LE(40), 3_200, 'data size')
})

test('48 kHz decimates to 16 kHz by exactly a third', () => {
  const input = Buffer.alloc(48 * 2)
  for (let i = 0; i < 48; i++) input.writeInt16LE(i * 100, i * 2)
  const out = downsampleToMono16k(input, 48_000)
  assert.equal(out.length, 16 * 2)
  assert.equal(out.readInt16LE(0), 0)
  assert.equal(out.readInt16LE(2), 300, 'took every third sample')
})

test('audio already at 16 kHz passes through untouched', () => {
  const input = Buffer.alloc(32)
  input.writeInt16LE(1234, 0)
  const out = downsampleToMono16k(input, 16_000)
  assert.equal(out.length, 32)
  assert.equal(out.readInt16LE(0), 1234)
})

test('silence is not uploaded, speech is', () => {
  const quiet = Buffer.alloc(4_000)
  assert.equal(isSilent(quiet), true)

  const loud = Buffer.alloc(4_000)
  for (let i = 0; i < 2_000; i++) loud.writeInt16LE(i % 2 === 0 ? 8_000 : -8_000, i * 2)
  assert.equal(isSilent(loud), false)
})

// ── The stop contract, behaviourally ──────────────────────────────────────
//
// This replaces `RestSttSafetyNetGate.test.mjs`, which pinned the opposite
// behaviour by grepping this class's own source for `if (!this.isActive)
// return` at the top of the flush. That guard did stop post-stop uploads — and
// it also discarded the last thing said in the meeting, because `stop()` clears
// the active flag before draining. Step 2b reversed it. What actually needs
// protecting is the pair of properties the guard was reaching for, and both are
// observable without reading the file.

const restSession = (uploads: Buffer[], responses: string[] = []) => {
  let n = 0
  return new RestSttSession('azure-fr', {
    apiKey: 'k',
    language: 'fr-FR',
    upload: async (wav: Buffer) => {
      uploads.push(wav)
      return responses[n++] ?? 'texte'
    },
  })
}

/** Audible Int16LE PCM, past MIN_BUFFER_BYTES so a routine flush would take it. */
const speech = (bytes = 8_000): Buffer => {
  const pcm = Buffer.alloc(bytes)
  for (let i = 0; i < bytes / 2; i++) pcm.writeInt16LE(i % 2 === 0 ? 8_000 : -8_000, i * 2)
  return pcm
}

test('stop uploads the tail exactly once', async () => {
  const uploads: Buffer[] = []
  const session = restSession(uploads, ['on se rappelle vendredi'])
  const heard: string[] = []
  session.on('transcript', (t: { text: string }) => heard.push(t.text))

  session.start()
  session.write(speech(), 16_000)
  await session.stop()

  assert.equal(uploads.length, 1, 'the audio held at stop is sent, not dropped')
  assert.deepEqual(heard, ['on se rappelle vendredi'])
})

test('nothing is uploaded after stop, however the session is poked', async () => {
  const uploads: Buffer[] = []
  const session = restSession(uploads)
  session.start()
  session.write(speech(), 16_000)
  await session.stop()
  assert.equal(uploads.length, 1)

  // The leak this guards: a stopped session that keeps POSTing prospect audio
  // to a vendor for the rest of the process lifetime.
  session.write(speech(), 16_000)
  session.notifySpeechEnded()
  await session.stop()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(uploads.length, 1, 'still one')
})

test('a stopped session never re-arms its safety-net timer', async () => {
  const uploads: Buffer[] = []
  const session = restSession(uploads)
  session.start()
  await session.stop()
  session.write(speech(), 16_000)
  // The backstop interval is 8 s; an orphaned one would fire forever. Nothing
  // may be pending at all — if the handle survived, the process would not exit.
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(uploads.length, 0)
})
