import test from 'node:test'
import assert from 'node:assert/strict'
import { documentToText, isBlankDocument } from '../documentText.ts'

const doc = (...content: unknown[]) => ({ type: 'doc', content })
const p = (...text: string[]) => ({
  type: 'paragraph',
  content: text.map((t) => ({ type: 'text', text: t })),
})

test('paragraphs become lines', () => {
  assert.equal(
    documentToText(doc(p('besoin: 2 dev java'), p('démarrage septembre'))),
    'besoin: 2 dev java\ndémarrage septembre',
  )
})

test('marks are dropped — the model needs the words, not the styling', () => {
  const bold = {
    type: 'paragraph',
    content: [{ type: 'text', text: 'TJM 520', marks: [{ type: 'bold' }] }],
  }
  assert.equal(documentToText(doc(bold)), 'TJM 520')
})

test('a list item is a line of its own', () => {
  const list = {
    type: 'bulletList',
    content: [
      { type: 'listItem', content: [p('un')] },
      { type: 'listItem', content: [p('deux')] },
    ],
  }
  assert.equal(documentToText(doc(list)), 'un\ndeux')
})

test('a hard break stays inside its block — shift+enter is the same thought', () => {
  const withBreak = {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'objection' },
      { type: 'hardBreak' },
      { type: 'text', text: 'délai' },
    ],
  }
  assert.equal(documentToText(doc(withBreak)), 'objection\ndélai')
})

test('table cells are neighbours on a row, not separate thoughts', () => {
  const table = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          { type: 'tableCell', content: [p('Dupont')] },
          { type: 'tableCell', content: [p('DSI')] },
        ],
      },
    ],
  }
  assert.equal(documentToText(doc(table)), 'Dupont DSI')
})

test('empty paragraphs do not become empty lines', () => {
  assert.equal(documentToText(doc(p('a'), { type: 'paragraph' }, p('b'))), 'a\nb')
})

test('an unreadable document is empty, not an exception', () => {
  // It comes out of SQLite as `unknown` and may have been written by an older
  // schema. An empty result runs the extraction on the transcript alone, which
  // is the ordinary DEC-5 case where the rep typed nothing. Throwing would turn
  // an unreadable note into a failed compte-rendu.
  for (const bad of [null, undefined, 42, 'texte', [], { type: 'doc' }, { content: null }]) {
    assert.equal(documentToText(bad), '')
  }
})

test('deep nesting does not lose text', () => {
  const nested = doc({
    type: 'blockquote',
    content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('imbriqué')] }] }],
  })
  assert.equal(documentToText(nested), 'imbriqué')
})

test('isBlankDocument is what decides whether notes are passed at all', () => {
  assert.equal(isBlankDocument(null), true)
  assert.equal(isBlankDocument(doc({ type: 'paragraph' })), true)
  assert.equal(isBlankDocument(doc(p('   '))), true)
  assert.equal(isBlankDocument(doc(p('quelque chose'))), false)
})
