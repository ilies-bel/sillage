/**
 * The permission the product cannot record without.
 *
 * What these hold is the distinction the old code did not make at all: one
 * missing channel is not the same failure as the other, and neither is the same
 * as both. On macOS the screen-recording prompt is the one people refuse, and
 * refusing it costs the far end of every call while the recording looks
 * perfectly healthy — so the sentence has to name *which* side goes missing,
 * and the remedy has to match what the OS will actually do next.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isWrittenSentence } from '../../contracts/health.ts'
import { captureRemedyFor } from '../../contracts/permissions.ts'
import {
  actionFor,
  capturePermissionHealth,
  capturePermissionView,
  canPrompt,
  type AccessStatus,
  type CaptureAccess,
} from '../capturePermission.ts'

const NOW = 1_700_000_000_000
const access = (over: Partial<CaptureAccess> = {}): CaptureAccess => ({
  microphone: 'granted',
  screen: 'granted',
  ...over,
})

test('a machine with both permissions has nothing to say', () => {
  // `null`, not `{ state: 'ok' }` — the native module failing to load is a
  // different and worse fact about capture, and a permission probe that
  // returned `ok` would paint over it.
  assert.equal(capturePermissionHealth(access(), NOW), null)
})

test('a host that cannot answer is not a host that refused', () => {
  // Windows has nothing to grant and Linux answers nothing at all. Treating
  // that as a refusal would put a permission warning in front of every rep on
  // the primary platform (HR-2).
  assert.equal(capturePermissionHealth(access({ microphone: 'unknown', screen: 'unknown' }), NOW), null)
})

test('losing the system audio is degraded, and the sentence names what is lost', () => {
  const health = capturePermissionHealth(access({ screen: 'not-determined' }), NOW)
  assert.ok(health)
  // Not `down`: the meeting is still recorded and a transcript still exists.
  // The rep is on it and the client is not, which is the thing to say.
  assert.equal(health.state, 'degraded')
  assert.match(health.reason ?? '', /le client ne sera pas enregistré, vous seul le serez/)
  assert.equal(health.retryable, true)
})

test('losing the microphone is the mirror image, and says so', () => {
  const health = capturePermissionHealth(access({ microphone: 'not-determined' }), NOW)
  assert.ok(health && health.state !== 'ok')
  assert.equal(health.state, 'degraded')
  assert.match(health.reason, /vous ne serez pas enregistré, seul le client le sera/)
})

test('losing both is the only case that is down', () => {
  const health = capturePermissionHealth(
    access({ microphone: 'denied', screen: 'denied' }),
    NOW,
  )
  assert.ok(health && health.state !== 'ok')
  assert.equal(health.state, 'down')
  assert.match(health.reason, /une réunion ne serait pas enregistrée/)
})

test('a permission already refused sends the rep to the system settings', () => {
  // The OS will not prompt twice. A screen that keeps offering « Autoriser »
  // here is offering a button that silently does nothing (DEC-26).
  const health = capturePermissionHealth(access({ screen: 'denied' }), NOW)
  assert.ok(health && health.state !== 'ok')
  assert.match(health.reason, /réautorisez Sillage dans les réglages de confidentialité/)
  assert.equal(actionFor('denied'), 'open')
  assert.equal(canPrompt('denied'), false)
})

test('a permission never asked for is asked for', () => {
  const health = capturePermissionHealth(access({ screen: 'not-determined' }), NOW)
  assert.ok(health && health.state !== 'ok')
  assert.match(health.reason, /Autorisez-le pour que Sillage puisse l’enregistrer/)
  assert.equal(actionFor('not-determined'), 'ask')
})

test('a managed device says so, and offers nothing', () => {
  const health = capturePermissionHealth(
    access({ microphone: 'restricted', screen: 'restricted' }),
    NOW,
  )
  assert.ok(health && health.state !== 'ok')
  assert.match(health.reason, /géré et l’autorisation est bloquée par votre service informatique/)
  // No retry: neither the prompt nor the settings pane can change a profile
  // the rep does not control, and a button that cannot work is worse than the
  // sentence alone.
  assert.equal(health.retryable, false)
  assert.equal(actionFor('restricted'), 'nothing')
})

test('one restricted channel beside one askable channel still offers the retry', () => {
  const health = capturePermissionHealth(
    access({ microphone: 'restricted', screen: 'not-determined' }),
    NOW,
  )
  assert.ok(health && health.state !== 'ok')
  // Half of it is fixable, so the control is worth having — and the sentence
  // is the askable one's, because that is the half a press can change.
  assert.equal(health.retryable, true)
  assert.equal(health.state, 'down')
})

/**
 * **The row the onboarding draws, and the five states a rep can meet.**
 *
 * The point of this shape is what it does *not* carry: no platform, no URL, no
 * « is this a Mac ». `state` is a word about consent and `canOpenSettings` is a
 * capability the caller measured, so the renderer can draw a refusal apart from
 * a permission nobody has answered without containing the one branch `src/` may
 * never contain.
 */
test('a host with nothing missing is ready, and offers nothing', () => {
  const view = capturePermissionView(access(), true, NOW)
  assert.equal(view.state, 'ready')
  assert.equal(view.channel, null)
  assert.equal(view.reason, null)
  // Nothing to fix is nothing to open: a pane offered on a healthy row is a
  // control that can only confuse.
  assert.equal(view.canOpenSettings, false)
})

test('a permission nobody has answered is « à autoriser », not a refusal', () => {
  const view = capturePermissionView(access({ screen: 'not-determined' }), true, NOW)
  assert.equal(view.state, 'to-grant')
  assert.equal(view.channel, 'screen')
  assert.equal(view.canOpenSettings, true)
})

test('a refusal is a refusal, and it names the side that goes missing', () => {
  const both = capturePermissionView(access({ microphone: 'denied', screen: 'denied' }), true, NOW)
  assert.equal(both.state, 'denied')
  assert.equal(both.channel, 'both')

  // The primary platform's only refusable one (HR-2): a machine-wide microphone
  // switch, with no screen-recording permission to grant at all.
  const windows = capturePermissionView(access({ microphone: 'denied' }), true, NOW)
  assert.equal(windows.state, 'denied')
  assert.equal(windows.channel, 'microphone')
})

test('the sentence is the health row’s own, word for word', () => {
  const health = capturePermissionHealth(access({ screen: 'denied' }), NOW)
  assert.ok(health && health.state !== 'ok')
  const view = capturePermissionView(access({ screen: 'denied' }), true, NOW)
  // Two surfaces, one sentence. A second wording is a second place where « what
  // was refused » is decided, and the day they disagree the rep reads the wrong one.
  assert.equal(view.reason, health.reason)
})

test('a managed device is blocked, and is offered no pane', () => {
  // Neither asking nor visiting the pane changes a profile, so a button there
  // would be theatre — the dead control DEC-26 forbids.
  const view = capturePermissionView(access({ microphone: 'restricted', screen: 'restricted' }), true, NOW)
  assert.equal(view.state, 'blocked')
  assert.equal(view.canOpenSettings, false)
})

test('a host with no pane to open says so, and it is never a platform test', () => {
  // `canOpenSettings` comes from the caller having measured a URL. False here
  // means the row draws its sentence and no button, wherever it is running.
  const view = capturePermissionView(access({ microphone: 'denied' }), false, NOW)
  assert.equal(view.state, 'denied')
  assert.equal(view.canOpenSettings, false)
})

/**
 * **One channel never asked, the other already refused — the sentence covered
 * only the first.**
 *
 * `remedy` asked « is any of these askable », and answered « Autorisez-le pour
 * que Sillage puisse l'enregistrer. » for the whole set. With the microphone
 * `not-determined` and screen recording `denied` — a rep who accepted the first
 * macOS prompt and refused the second, then reinstalled — the whole status read
 *
 *     Ni le micro ni l'audio système ne sont autorisés — une réunion ne serait
 *     pas enregistrée. Autorisez-le pour que Sillage puisse l'enregistrer.
 *
 * « Autorisez-le », singular, after a clause naming two, for a pair where
 * authorising fixes exactly one: the OS will not prompt for the refused one
 * again, so nothing the rep can do from that sentence brings back the far end of
 * the call — which is the half the product exists for. They press *Autoriser*,
 * the microphone prompt appears, they accept, and the screen reports a different
 * warning they have already read once.
 *
 * `restricted` beside an askable channel is deliberately *not* this case and the
 * test above it says why: a managed profile is fixable by nobody, so there is no
 * second instruction to give. `denied` has one, and it was missing.
 */
test('one channel to ask for and one already refused names both remedies', () => {
  const health = capturePermissionHealth(
    access({ microphone: 'not-determined', screen: 'denied' }),
    NOW,
  )
  assert.ok(health && health.state !== 'ok')
  assert.equal(health.state, 'down')
  assert.equal(health.retryable, true)
  // The half a prompt can still fix…
  assert.match(health.reason, /Autorisez le micro/)
  // …and the half only the pane can.
  assert.match(health.reason, /réautorisez l’audio système dans les réglages de confidentialité/)
})

test('the mirror pair names them the other way round', () => {
  const health = capturePermissionHealth(
    access({ microphone: 'denied', screen: 'not-determined' }),
    NOW,
  )
  assert.ok(health && health.state !== 'ok')
  assert.match(health.reason, /Autorisez l’audio système/)
  assert.match(health.reason, /réautorisez le micro dans les réglages de confidentialité/)
})

/**
 * Two of the same, and the pronoun that follows « Ni le micro ni l'audio
 * système ». Both remedies were constants, so the `down` case — the only one
 * that names two channels — read « Autorisez-le » and « Vous l'avez refusé »
 * about a pair.
 */
test('two channels in the same state are spoken of as two', () => {
  const never = capturePermissionHealth(
    access({ microphone: 'not-determined', screen: 'not-determined' }),
    NOW,
  )
  assert.ok(never && never.state !== 'ok')
  assert.match(never.reason, /Autorisez-les pour que Sillage puisse les enregistrer/)

  const both = capturePermissionHealth(access({ microphone: 'denied', screen: 'denied' }), NOW)
  assert.ok(both && both.state !== 'ok')
  assert.match(both.reason, /Vous les avez refusés : réautorisez Sillage/)
})

/**
 * **Every sentence this file composes, held to the predicate that decides
 * whether a rep ever reads it.**
 *
 * `isWrittenSentence` (`core/contracts/health.ts`) is what the widget asks
 * before rendering a `reason` verbatim: a `reason` it refuses is replaced by
 * one of four generic sentences that name no channel. The `degraded` reasons
 * here opened on `MIC` / `SCREEN`, which are lowercase because they are also
 * used mid-sentence in the `down` one — so **twelve of the twenty-one status
 * pairs that produce a health at all were being thrown away**, every one of
 * them `degraded`, which is the state DEC-32 reserves for « one channel is
 * missing » and whose whole point is that the sentence names which side. On
 * the widget a rep read « une partie de la réunion peut manquer au
 * compte-rendu » over a live client call; in the onboarding row they read this
 * file's own sentence opening in lower case.
 *
 * Reachable on both platforms. `main.ts` records that the Windows 10 global
 * microphone switch reports `denied`, which is `{microphone:'denied',
 * screen:'unknown'}` → `degraded` → replaced, on HR-2's primary platform.
 *
 * **This test could not have been written where the predicate used to be.** It
 * lived in `src/widget/healthSentence.ts`, and the renderer may import
 * `core/contracts/` only — so nothing under `src/` could reach this composer,
 * and the corpus there hand-wrote samples of what it believed this file says.
 * All three said « L’enregistrement de l’écran », a wording that exists nowhere
 * here. A fixture is not a caller.
 */
test('chaque phrase composée ici est une phrase que la fenêtre rend telle quelle', () => {
  const STATUSES: AccessStatus[] = [
    'granted',
    'denied',
    'not-determined',
    'restricted',
    'unknown',
  ]

  const composed: { pair: string; reason: string }[] = []
  for (const microphone of STATUSES) {
    for (const screen of STATUSES) {
      const health = capturePermissionHealth(access({ microphone, screen }), NOW)
      if (!health || health.state === 'ok') continue
      composed.push({ pair: `${health.state} micro=${microphone} écran=${screen}`, reason: health.reason })
    }
  }

  // A floor on the enumeration itself: a `capturePermissionHealth` that started
  // returning `null` everywhere would otherwise pass this having checked nothing.
  assert.ok(composed.length >= 20, `seulement ${composed.length} paire(s) produisent une santé`)

  const refused = composed.filter(({ reason }) => !isWrittenSentence(reason))
  assert.deepEqual(refused.map(({ pair }) => pair), [], 'phrase(s) que la fenêtre remplacerait')

  // And each one names its channel in the product's own words — which is the
  // thing the generic replacement could never do.
  for (const { pair, reason } of composed) {
    assert.ok(
      reason.includes('micro') || reason.includes('audio système'),
      `${pair} ne nomme aucun côté : ${reason}`,
    )
  }
})

/**
 * **The control the row draws against the act the main process performs.**
 *
 * `actionFor` has answered `ask` for `not-determined` since this file was
 * written, and `requestCaptureAccess` in `main.ts` fires the OS prompt on
 * exactly that answer — but no renderer could reach either, because the only
 * route out of `src/` was `capture:permission:open`. Measured on the shipped
 * renderer at both smoke sizes, first launch (`microphone`/`screen` both
 * `not-determined`, which is every rep's first launch on macOS): one control,
 * « Ouvrir les réglages », 134.33 × 32.59 px, and **zero** controls that ask —
 * under a sentence this file composes which reads « Autorisez-les pour que
 * Sillage puisse les enregistrer. » The pane does not list an application that
 * has never attempted capture, so the one remedy on screen was a list the app
 * was not in.
 *
 * So the two sides are bound here, over all twenty-five status pairs: the row
 * offers the ask exactly when `requestCaptureAccess` will raise a prompt for at
 * least one channel. `captureRemedyFor` reads a `CapturePermissionState` and
 * `actionFor` reads an `AccessStatus`; nothing but this joins them, and a
 * `to-grant` row sent back to the pane goes red here.
 */
test('sur les vingt-cinq paires, la ligne propose l’invite exactement quand main.ts en déclenche une', () => {
  const STATUSES: AccessStatus[] = ['granted', 'denied', 'restricted', 'not-determined', 'unknown']

  let asks = 0
  for (const microphone of STATUSES) {
    for (const screen of STATUSES) {
      const pair = access({ microphone, screen })
      const row = capturePermissionView(pair, true, NOW)
      /*
       * What `requestCaptureAccess` does with this pair, read off the same
       * domain function it calls: a prompt for every channel whose `actionFor`
       * is `ask`, the pane for every `open`, nothing for a managed device.
       */
      const prompts = [pair.microphone, pair.screen].some((status) => actionFor(status) === 'ask')
      const remedy = captureRemedyFor(row, false)
      assert.equal(
        remedy === 'ask',
        prompts,
        `micro=${microphone} écran=${screen} : la ligne propose « ${remedy} » et main.ts ${
          prompts ? 'déclenche une invite' : 'n’en déclenche aucune'
        }`,
      )
      if (prompts) asks += 1
    }
  }

  // A floor on the enumeration: nine of the twenty-five pairs carry at least
  // one `not-determined`, and a `captureRemedyFor` that never answered `ask`
  // would otherwise pass this having agreed with nothing.
  assert.equal(asks, 9, `${asks} paire(s) déclenchent une invite`)
})

/**
 * **An ask that did not move the status, which is the macOS screen-recording
 * case and not a rarity.**
 *
 * `getSources` raises the TCC prompt; the rep allows it in the pane that opens,
 * and `getMediaAccessStatus('screen')` goes on answering `not-determined` until
 * the app is relaunched — `main.ts` says so on the retry it registers. A row
 * that re-offered the ask there would be the dead control DEC-26 forbids, so
 * once asked it falls through to the pane — which, after the attempt, is a list
 * the application is finally in.
 */
test('une invite qui n’a pas bougé le statut passe la main au volet', () => {
  const asked = capturePermissionView(access({ screen: 'not-determined' }), true, NOW)
  assert.equal(captureRemedyFor(asked, false), 'ask')
  assert.equal(captureRemedyFor(asked, true), 'open')

  // Asking needs no URL — a pane is a capability of the host, a prompt is one
  // of the app — so a host with no pane still offers the ask, and offers
  // nothing at all once it has been made.
  const noPane = capturePermissionView(access({ screen: 'not-determined' }), false, NOW)
  assert.equal(captureRemedyFor(noPane, false), 'ask')
  assert.equal(captureRemedyFor(noPane, true), 'none')
})

test('un refus mène au volet, un appareil géré et une absence de réponse à rien', () => {
  // The invariant, in three lines: « A refusal leads to the settings pane, not
  // a prompt. »
  const refused = capturePermissionView(access({ screen: 'denied' }), true, NOW)
  assert.equal(captureRemedyFor(refused, false), 'open')
  assert.equal(captureRemedyFor(refused, true), 'open')

  const managed = capturePermissionView(
    access({ microphone: 'restricted', screen: 'restricted' }),
    true,
    NOW,
  )
  assert.equal(captureRemedyFor(managed, false), 'none')

  assert.equal(captureRemedyFor(capturePermissionView(access(), true, NOW), false), 'none')
  // An older main process, or a channel that threw: the row keeps the health
  // sentence and the retry it already had rather than guessing a remedy.
  assert.equal(captureRemedyFor(null, false), 'none')
})
