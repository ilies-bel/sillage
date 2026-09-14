/**
 * **How long pressing *Terminer* can freeze the main process on Windows.**
 *
 * Source as evidence, the `preloadUnwrap.test.ts` and `echo_canceller.rs` shape:
 * what is asserted is a property of a file no test in this repo can execute.
 * Windows is the primary platform (HR-2) and macOS is where this is written, so
 * `speaker/windows.rs` has never been run — or, until now, even *compiled* — from
 * a development machine.
 *
 * The property. The loopback capture thread reads its `shutdown` flag at the top
 * of the loop and nowhere else, and nothing signals the WASAPI event when the
 * flag is set — `Drop for SpeakerStream` sets it and calls `handle.join()`
 * immediately. So the loop's wait timeout **is** the shutdown latency, and
 * `SystemAudioCapture::stop()` is a synchronous `#[napi]` function, i.e.
 * Electron's main thread. It waited three seconds, and paid the full three
 * exactly when it mattered: the far end has hung up, the render device is silent,
 * so no event fires at all.
 *
 * What this test defends is that the wait is a **named, bounded constant** rather
 * than a literal. A literal is what it was, and a literal is what a future edit
 * would reach for — the call site's own comment said « Timeout is normal when no
 * audio is playing », which is true and is not the reason the number is what it
 * is.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const SOURCE = path.resolve(HERE, '../../../../native-module/src/speaker/windows.rs')

const source = (): string => readFileSync(SOURCE, 'utf8')

/**
 * The same file with its comments removed.
 *
 * Needed because this file *argues about* the alternative it did not take, and
 * the first version of the third test below matched the word `SetEvent` in that
 * argument and failed on the reasoning rather than on the code. A source-reading
 * test that cannot tell prose from code asserts something nobody meant.
 */
const code = (): string =>
  source()
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')

test('the loopback wait is the named stop-latency constant, never a literal', () => {
  const text = source()
  // Guard against passing by absence: if the call is renamed away, say so rather
  // than quietly asserting nothing.
  const calls = [...text.matchAll(/wait_for_event\(\s*([A-Za-z0-9_]+)\s*\)/g)]
  assert.ok(calls.length >= 1, 'no wait_for_event call found — has the capture loop moved?')
  for (const call of calls) {
    assert.equal(
      call[1],
      'MAX_STOP_LATENCY_MS',
      `wait_for_event(${call[1]}) — the wait is the stop latency and has to say so`,
    )
  }
})

test('the stop latency is bounded below a quarter second', () => {
  const declared = /const MAX_STOP_LATENCY_MS:\s*u32\s*=\s*(\d+)\s*;/.exec(source())
  assert.ok(declared, 'MAX_STOP_LATENCY_MS is not declared')
  const ms = Number(declared[1])
  assert.ok(ms > 0, 'a zero timeout is a spin, not a wait')
  assert.ok(
    ms <= 250,
    `${ms} ms of frozen main thread on every Terminer — it was 3000, and that was the defect`,
  )
})

test('the flag is still only read at the top of the loop, which is why the bound matters', () => {
  /*
   * If somebody signals the event on shutdown — the version with no latency at
   * all — this test is what tells them the bound above stopped being
   * load-bearing. It is not a rule against improving it; it is a rule against
   * the reasoning going stale silently.
   */
  const text = code()
  assert.ok(
    /state\.shutdown/.test(text),
    'the shutdown flag is gone — re-derive what bounds `stop()` before trusting the constant',
  )
  assert.ok(
    !/SetEvent/.test(text),
    'the event is signalled on shutdown now — the wait is no longer the stop latency, ' +
      'so rewrite this file’s reasoning rather than keeping a bound that defends nothing',
  )
})
