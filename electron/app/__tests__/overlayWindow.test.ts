/**
 * **The widget window's flags, against the docblock that says they matter.**
 *
 * `createOverlayWindow` opens on « Every flag on it is load-bearing and none of
 * them is a style » and then lists seven, each with the cost of getting it
 * wrong. One of them — `focusable: true` — was never written: Electron's
 * default made the sentence true by accident for the whole life of the surface,
 * and `src/widget/Widget.tsx` reasons from it (« a click on the pill focuses
 * this window, which is why it works ») for the note field and for US-11's only
 * transport, `copyText`. Setting `focusable: false`, which is the obvious thing
 * to do to an always-on-top pill, would have taken both away with no gate going
 * red.
 *
 * A comment is not a check (CLAUDE.md). This is the check: every flag the prose
 * names is read out of the prose and looked for in the object that is actually
 * constructed, so a bullet added without a flag fails here, and so does a flag
 * deleted while its bullet stays.
 *
 * Read from the source rather than driven, because `main.ts` is the Electron
 * entry point: importing it opens windows. The two things compared are in the
 * same file, ten lines apart, which is what makes reading it honest.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAIN = readFileSync(path.resolve(HERE, '..', 'main.ts'), 'utf8')

/** The docblock immediately above `createOverlayWindow`, and its constructor. */
const overlayWindow = (): { doc: string; body: string } => {
  const found = /\/\*\*\n(?:[^*]|\*(?!\/))*?Every flag on it is load-bearing[\s\S]*?\*\/\nconst createOverlayWindow[\s\S]*?\n\}\n/.exec(
    MAIN,
  )
  assert.ok(found, 'createOverlayWindow introuvable dans main.ts')
  const text = found[0]
  const split = text.indexOf('const createOverlayWindow')
  return { doc: text.slice(0, split), body: text.slice(split) }
}

test('every flag the docblock names is a flag the window is given', () => {
  const { doc, body } = overlayWindow()

  // `` `name: value` `` in the prose — the shape the bullets use for a
  // constructor option.
  const claimed = [...doc.matchAll(/`([a-zA-Z]+):\s*(true|false)`/g)].map(([, name, value]) => ({
    name,
    value,
  }))
  // A parse that found nothing would be a green check over no subject. Seven
  // bullets, six of which carry an explicit value.
  assert.ok(claimed.length >= 6, `seulement ${claimed.length} option(s) lue(s) dans le docbloc`)

  for (const { name, value } of claimed) {
    assert.match(
      body,
      new RegExp(`^\\s*${name}: ${value},`, 'm'),
      `le docbloc promet « ${name}: ${value} » et le constructeur ne l’écrit pas`,
    )
  }

  // `skipTaskbar` is named without a value, and the two that are not
  // constructor options at all are method calls made straight after.
  assert.match(body, /^\s*skipTaskbar: true,/m)
  assert.match(body, /setAlwaysOnTop\(true, 'screen-saver'\)/)
  assert.match(body, /setVisibleOnAllWorkspaces\(true, \{ visibleOnFullScreen: true \}\)/)
})

test('focusable is written, not inherited', () => {
  /*
   * Called out on its own because it is the one the docblock claimed and the
   * object omitted, and because its default is the value it wants: a check that
   * only compared behaviour would have been green over it for ever.
   */
  const { doc, body } = overlayWindow()
  assert.match(doc, /`focusable: true`/)
  assert.match(body, /^\s*focusable: true,/m)
})
