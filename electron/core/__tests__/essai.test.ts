/**
 * The dry run's verdict.
 *
 * The trial exists because capture is the one subsystem that cannot be repaired
 * after the call, and its whole value is in *which* channel it reports. These
 * hold the three things that make the report worth trusting:
 *
 *  · the two channels are never merged into one green tick — they have opposite
 *    failures and opposite fixes;
 *  · a silent channel is reported as « rien n'a été entendu », never as a broken
 *    machine: the rep may simply not have played anything, and a false statement
 *    about their hardware is one they will act on;
 *  · nothing is graded. « Tout va bien » after twenty seconds of silence would
 *    be the same lie in the other direction.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ESSAI_SECONDS,
  essaiHealth,
  essaiLines,
  essaiSummary,
  essaiWorthRepeating,
  EssaiRecordSchema,
  EssaiResultSchema,
  type EssaiResult,
} from '../contracts/essai.ts'

const result = (rep: boolean, far: boolean): EssaiResult => ({
  rep: { heard: rep, peak: rep ? 0.4 : 0.001 },
  far: { heard: far, peak: far ? 0.3 : 0.001 },
  floor: 0.01,
  seconds: ESSAI_SECONDS,
})

test('the schema accepts what the main process reports', () => {
  assert.doesNotThrow(() => EssaiResultSchema.parse(result(true, true)))
})

test('both channels heard is the only case that says there is nothing left to do', () => {
  assert.match(essaiSummary(result(true, true)), /rien d’autre à régler/)
  assert.equal(essaiWorthRepeating(result(true, true)), false)
})

test('the client’s side missing is named as the half that matters', () => {
  // The rep cannot discover this on their own: their own voice is in the
  // transcript, so the recording looks like it worked, and the compte-rendu
  // comes back describing a monologue.
  assert.match(essaiSummary(result(true, false)), /le client non/)
  assert.equal(essaiWorthRepeating(result(true, false)), true)
})

test('the rep’s own side missing is the mirror image', () => {
  assert.match(essaiSummary(result(false, true)), /Le client serait capté, vous non/)
})

test('silence is reported as silence, never as a fault', () => {
  const summary = essaiSummary(result(false, false))
  assert.match(summary, /Rien n’a été entendu/)
  // Conditional, because the rep may simply have said nothing for twenty
  // seconds — which is not a broken machine and must not be called one.
  assert.match(summary, /Si vous avez parlé ou joué un son/)
  assert.doesNotMatch(summary, /panne|erreur|échec/i)
})

test('each channel gets its own sentence, in the rep’s vocabulary', () => {
  const lines = essaiLines(result(true, false))
  assert.deepEqual(
    lines.map((line) => line.channel),
    ['rep', 'far'],
  )
  // Never « rep » and never « far »: those are the code's words for the two
  // sides, and this screen is read by somebody who has not seen the code.
  assert.equal(lines[0]?.title, 'Votre voix')
  assert.equal(lines[1]?.title, 'L’audio de votre ordinateur')

  assert.equal(lines[0]?.heard, true)
  assert.match(lines[0]?.sentence ?? '', /Entendue/)
  // And the failing one says what to check, not that something is wrong.
  assert.match(lines[1]?.sentence ?? '', /l’audio système est autorisé dans Réglages/)
})

/**
 * **No sentence on this screen names a permission one of the two platforms
 * does not have.**
 *
 * The far-channel remedy said « vérifiez l’autorisation d’enregistrement de
 * l’écran ». Windows has no screen-recording authorisation to grant —
 * CLAUDE.md's platform table says so in one row — so on HR-2's **primary**
 * platform half the remedy sent a rep hunting for a setting that does not
 * exist, on the screen DEC-45 makes the authority over the boot probe.
 * `capturePermission.ts` had already settled the platform-neutral word and its
 * header argues it; this file had not followed.
 *
 * `check-platform.mjs` cannot catch this. It scans for platform *signals in
 * code* — a `process.platform`, a `darwin` literal — and a mac-only concept
 * inside a French sentence is invisible to it. A claim about wording belongs in
 * a test over the wording, which is this.
 *
 * The list is the two macOS-only concepts this product could name, spelled the
 * way a rep would read them. It is deliberately short: a broad screen for
 * « anything mac-ish » would be a check nobody could keep true.
 */
test('aucune phrase de l’essai ne nomme une autorisation propre à macOS', () => {
  const MAC_ONLY = [/enregistrement de l’écran/i, /Préférences Système/i]

  const sentences = [
    ...essaiLines({
      rep: { heard: false, peak: 0 },
      far: { heard: false, peak: 0 },
      floor: 0.01,
      seconds: 20,
    }).map((line) => line.sentence),
    ...essaiLines({
      rep: { heard: true, peak: 0.5 },
      far: { heard: true, peak: 0.5 },
      floor: 0.01,
      seconds: 20,
    }).map((line) => line.sentence),
  ]

  // A floor on the enumeration: four sentences, or this has stopped reading the
  // thing it claims to read.
  assert.equal(sentences.length, 4)

  for (const sentence of sentences) {
    for (const mac of MAC_ONLY) {
      assert.ok(!mac.test(sentence), `phrase propre à macOS : ${sentence}`)
    }
  }
})

/*
 * ── the verdict, kept ───────────────────────────────────────────────────────
 *
 * `runEssai` returned this and wrote nothing, so a rep who ran the trial, read
 * « Vous seriez capté, le client non » and closed the card got a header saying
 * « Tout fonctionne » and a *Requis* row saying « Audio · connecté ». The one
 * failure the trial exists to catch survived a rep who ran it and understood it.
 */
test('a trial that heard both sides implies nothing — there is nothing to say', () => {
  assert.equal(essaiHealth({ ...result(true, true), at: 1_760_000_000_000 }), null)
  // And no trial at all is not a claim about the machine.
  assert.equal(essaiHealth(null), null)
})

test('a silent far channel degrades the capture row, with the trial’s own sentence', () => {
  const record = {
    rep: { heard: true, peak: 0.42 },
    far: { heard: false, peak: 0.001 },
    floor: 0.02,
    seconds: 20,
    at: 1_760_000_000_000,
  }
  const health = essaiHealth(record)
  assert.ok(health)
  // `degraded`, never `down`: the device opens and the meeting records. What is
  // in doubt is whether one side of it will be in the recording (DEC-32).
  assert.equal(health.state, 'degraded')
  assert.match(health.reason, /le client non/)
  assert.match(health.reason, /Relancez l’essai/)
  // Nothing to retry from a row — the fix is on the machine, then the trial.
  assert.equal(health.retryable, false)
  // Dated by the measurement, not by boot: « depuis » has to mean when it was
  // established, or the row is a state the app has merely been holding.
  assert.equal(health.since, record.at)
})

test('a silent rep channel degrades it too, and says which side', () => {
  const health = essaiHealth({
    rep: { heard: false, peak: 0.001 },
    far: { heard: true, peak: 0.5 },
    floor: 0.02,
    seconds: 20,
    at: 1_760_000_000_000,
  })
  assert.ok(health)
  assert.match(health.reason, /Le client serait capté, vous non/)
})

test('a record that cannot be parsed is not a health claim', () => {
  // The store can hold a row written by an older build. A malformed one must not
  // be able to put a sentence on the connector board.
  assert.equal(EssaiRecordSchema.safeParse(result(true, true)).success, false, 'at est requis')
  assert.equal(EssaiRecordSchema.safeParse({ ...result(true, true), at: 1 }).success, true)
})

test('silence on both channels is not a degradation — it establishes nothing', () => {
  /*
   * `heard` is `peak > SPEECH_FLOOR`, so a rep who runs the trial in a quiet
   * room and says nothing measures false on both. Persisting that puts a
   * permanent warning on the connector row and, by DEC-32, moves the general
   * app status — the app telling somebody their machine is broken on the
   * strength of twenty seconds in which nobody did anything.
   *
   * It is the rule `essaiWorthRepeating` already states fifty lines up, and for
   * one commit this function contradicted it.
   */
  const silence = { ...result(false, false), at: 1_760_000_000_000 }
  assert.equal(essaiHealth(silence), null)
  // And it is still worth offering again, which is the honest response to it.
  assert.equal(essaiWorthRepeating(silence), true)
})
