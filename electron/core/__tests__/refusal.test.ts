/**
 * A refusal is not a failure.
 *
 * DEC-26 fills this app with sentences composed on purpose for a rep to read,
 * and every one of them crosses the IPC boundary as a thrown `Error`, because
 * that is how a promise says no. `register.ts` logged all of them at `error`
 * severity — so a rep asking a question about a call nobody spoke on wrote a red
 * line into the diagnostics bundle, beside the lines that mean the native module
 * would not load. On a support call that bundle is the evidence, and one where
 * the product working and the product broken look identical is DEC-27's cost
 * with none of its benefit.
 *
 * The end-to-end run found two on a clean first launch, both of them the app
 * behaving exactly as designed.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isRefusal, refuse, Refusal } from '../contracts/refusal.ts'

test('a stated reason is recognised, and keeps its sentence', () => {
  const stated = refuse('La réunion est en cours — les questions attendent la fin de l’appel.')
  assert.equal(isRefusal(stated), true)
  // The renderer prints `message` either way: the sentence is the same sentence
  // and only the log learns the difference.
  assert.match(stated.message, /les questions attendent la fin de l’appel/)
  assert.ok(stated instanceof Error)
})

test('an ordinary failure is not one', () => {
  assert.equal(isRefusal(new Error('ENOENT: no such file')), false)
  assert.equal(isRefusal(new TypeError('x is not a function')), false)
  assert.equal(isRefusal('une chaîne'), false)
  assert.equal(isRefusal(null), false)
  assert.equal(isRefusal(undefined), false)
})

test('the brand survives what `instanceof` does not', () => {
  /*
   * The check is the brand and not the class, deliberately. esbuild can bundle
   * two copies of a module, and `err instanceof Refusal` then silently answers
   * no — which would turn every refusal back into an `error` with no test
   * failing. A plain object carrying the brand is what a second copy of the
   * class produces at the boundary, and it has to be recognised.
   */
  const fromAnotherCopy = Object.assign(new Error('la même phrase'), { refusal: true as const })
  assert.equal(fromAnotherCopy instanceof Refusal, false)
  assert.equal(isRefusal(fromAnotherCopy), true)
})

test('a cause is carried, because the log wants both', () => {
  // The rep reads the French; the diagnostic keeps what actually happened.
  const cause = new Error('SQLITE_BUSY')
  const stated = refuse('Le coffre-fort n’est pas disponible sur cette machine.', { cause })
  assert.equal(stated.cause, cause)
})
