/**
 * The one piece of logic in the bridge, and why it is there.
 *
 * `ipcRenderer.invoke` rejects with a message it composes itself —
 * `Error invoking remote method 'meeting:ask': Error: <ours>` — and the renderer
 * prints `error.message` straight into an `alert`. Every refusal in this product
 * is a written French sentence that names what to do (DEC-26), and what a rep
 * actually read was an English stack-shaped prefix in front of it, naming an
 * internal channel.
 *
 * **No test in the repo could see it.** The renderer's tests inject a fake
 * bridge that throws a clean `Error`; the screenshot harness stubs `window.app`.
 * The string exists only when a real `ipcRenderer` sits between the two, which is
 * why it took `scripts/e2e.mjs` — the run that starts the packaged application —
 * to find it. This holds the shape so it cannot come back.
 *
 * The function is re-declared here rather than imported: `preload.ts` calls
 * `contextBridge.exposeInMainWorld` at module scope, so importing it outside
 * Electron throws before a test can reach anything. The two are kept identical
 * by the last test in this file, which reads the source.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { refuse } from '../core/contracts/refusal.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PRELOAD = path.resolve(HERE, '../preload.ts')

/** A copy of `unwrap` in `preload.ts`. Kept honest by the last test. */
const unwrap = (channel: string, error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error)
  const prefix = `Error invoking remote method '${channel}': `
  if (!message.startsWith(prefix)) return error instanceof Error ? error : new Error(message)
  const inner = message.slice(prefix.length).replace(/^[A-Za-z][A-Za-z0-9]*:\s*/, '')
  return new Error(inner)
}

/**
 * What Electron puts on the wire for a rejected `invoke`: its own prefix, then
 * the thrown value's **`name`**, then the message.
 *
 * Composed from a real error rather than from the word `Error`, because the
 * fixture that hardcoded it is the reason this file was green over the defect
 * for as long as `Refusal` has existed. A test whose fixture cannot produce the
 * shape the product produces asserts nothing about the product.
 */
const asElectronWraps = (channel: string, error: Error): Error =>
  new Error(`Error invoking remote method '${channel}': ${error.name}: ${error.message}`)

const wrapped = (channel: string, inner: string): Error =>
  asElectronWraps(channel, new Error(inner))

test('the rep reads the sentence the main process wrote, and nothing else', () => {
  const french = 'Aucune transcription n’a été enregistrée pour cet appel.'
  assert.equal(unwrap('meeting:ask', wrapped('meeting:ask', french)).message, french)
})

test('a refusal that names the screen to go to keeps its own colon', () => {
  // The strip takes one leading `Error: ` and no more — the sentence itself
  // contains punctuation, and eating past it would truncate the instruction.
  const french =
    'Aucun modèle de langage n’est configuré — ajoutez-en un dans Réglages, « Modèle de langage ».'
  assert.equal(unwrap('meeting:ask', wrapped('meeting:ask', french)).message, french)
})

test('a subclass name is stripped too', () => {
  const raw = new Error("Error invoking remote method 'review:confirm': TypeError: pas de compte")
  assert.equal(unwrap('review:confirm', raw).message, 'pas de compte')
})

test('the shipped Refusal reaches the rep as the sentence and nothing else', () => {
  /*
   * **The class the product actually throws across this boundary**, not a
   * stand-in. `core/contracts/refusal.ts` sets `name = 'Refusal'` so the
   * diagnostic log can tell « I am telling the rep something » from « something
   * went wrong », and `ipc/register.ts` throws it at thirty-four sites — every
   * « Aucune transcription n’a été enregistrée pour cet appel. », every « le
   * coffre-fort n’est pas disponible sur cette machine ».
   *
   * The strip read `/^[A-Za-z]*Error:/`, which matches every built-in and not
   * this one, so what a rep read was « Refusal: » in front of the French.
   * Measured over the real preload in a real window on `meeting:get`,
   * `meeting:ask` and `settings:setProviderField` before this line existed.
   */
  const french = 'Aucune transcription n’a été enregistrée pour cet appel.'
  const thrown = refuse(french)
  assert.equal(thrown.name, 'Refusal', 'le nom sérialisé par Electron')
  assert.equal(unwrap('meeting:ask', asElectronWraps('meeting:ask', thrown)).message, french)
})

test('no refusal this app ships can be eaten by the strip', () => {
  /*
   * The other half of widening it. « One leading identifier and a colon » is
   * removed whatever the identifier is called, which is what makes the strip as
   * wide as the rule — and it would be a truncation if a French sentence ever
   * opened on an ASCII word and a colon. So the sentences are read rather than
   * assumed: every literal handed to `refuse(...)` under `electron/`, checked
   * against the same expression the bridge applies.
   *
   * Only the *start* of each message can be eaten, which is why a first literal
   * is enough even where the call spans lines.
   */
  const files = [
    'app/ipc/register.ts',
    'app/session/Agenda.ts',
    'core/contracts/ask.ts',
    'modules/llm/config.ts',
  ]
  let seen = 0
  for (const file of files) {
    const source = readFileSync(path.resolve(HERE, '..', file), 'utf8')
    for (const [, literal] of source.matchAll(/refuse\(\s*['"`]([^'"`\n]*)/g)) {
      seen += 1
      assert.ok(
        !/^[A-Za-z][A-Za-z0-9]*:\s/.test(literal),
        `« ${literal} » commence par un identifiant et deux points — le préfixe la tronquerait`,
      )
    }
  }
  // A scan that matched nothing would be a green check over no subject.
  assert.ok(seen >= 20, `seulement ${seen} refus lus — la lecture des sources a cessé de trouver`)
})

test('a message that is not Electron’s wrapper is passed through untouched', () => {
  // Anchored on the channel, so a sentence that merely contains the word
  // « Error » is not mangled — and the original `Error` instance is preserved
  // rather than rebuilt, so nothing downstream loses a subclass.
  const own = new Error('Error: un mot dans la phrase')
  assert.equal(unwrap('meeting:ask', own), own)
  assert.equal(unwrap('meeting:ask', 'une chaîne nue').message, 'une chaîne nue')
})

test('a wrapper for a different channel is left alone', () => {
  // It cannot happen through this bridge, and if it ever did, guessing would be
  // worse than passing it on: a message the preload does not recognise is a
  // message it has no business rewriting.
  const raw = wrapped('review:get', 'quelque chose')
  assert.equal(unwrap('meeting:ask', raw), raw)
})

test('the copy above is the function `preload.ts` actually ships', () => {
  /*
   * `preload.ts` runs `contextBridge.exposeInMainWorld` at module scope, so it
   * cannot be imported outside Electron, and a hand-copied function is a second
   * implementation the day somebody edits one of them.
   *
   * Compared on the three lines that carry the behaviour rather than on the
   * whole text: the type annotations are stripped at runtime and the comments
   * are not, so a character-for-character match would fail on formatting and
   * teach whoever hits it to delete the test.
   */
  const source = readFileSync(PRELOAD, 'utf8')
  const shipped = /const unwrap = \(channel: string, error: unknown\): Error => \{[\s\S]*?\n\}/.exec(
    source,
  )?.[0]
  assert.ok(shipped, 'unwrap introuvable dans preload.ts')

  const load = (text: string) =>
    text
      .replace(/\/\/[^\n]*/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && line !== '}' && line !== '{')

  // The signature line differs by construction — type stripping leaves the
  // annotations behind in one and not the other — so both are compared on the
  // body, which is where the behaviour is.
  const body = (lines: readonly string[]) =>
    lines.filter((line) => !/=>\s*\{$/.test(line) && !line.startsWith('const unwrap'))

  const mine = body(load(unwrap.toString()))
  const theirs = body(load(shipped))
  for (const line of mine) {
    assert.ok(
      theirs.includes(line),
      `la copie de ce test a divergé de preload.ts — absente là-bas : ${line}`,
    )
  }
  // And nothing extra ships: a branch added there and not here would be
  // untested behaviour on the one path no other test can reach.
  assert.equal(theirs.length, mine.length, 'preload.ts a une ligne que ce test ne couvre pas')
})
