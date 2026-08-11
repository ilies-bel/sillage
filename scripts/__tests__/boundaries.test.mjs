/**
 * The boundary rule is only worth having if it actually fails. Step 1's
 * acceptance criterion names the case: a deliberate `modules/a → modules/b`
 * import must be rejected.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkFile, classify } from '../lib/boundaries.mjs'

const clean = (file, source) => {
  const found = checkFile(file, source)
  assert.notEqual(found, null, `${file} should be in a layer`)
  return found
}

test('modules/a may not import modules/b', () => {
  const found = clean(
    'electron/modules/crm/VsaAdapter.ts',
    `import { Store } from '../store/index.ts'`,
  )
  assert.equal(found.length, 1)
  assert.match(found[0].why, /modules\/crm may not import modules\/store/)
})

test('a module may import its own folder and core', () => {
  assert.deepEqual(
    clean(
      'electron/modules/crm/VsaAdapter.ts',
      `import { x } from './vsa/fieldMap.ts'
       import type { CrmPort } from '../../core/contracts/crm.ts'`,
    ),
    [],
  )
})

test('core may import nothing but core', () => {
  const found = clean(
    'electron/core/domain/arming.ts',
    `import { Store } from '../../modules/store/index.ts'`,
  )
  assert.equal(found.length, 1)
  assert.match(found[0].why, /core\/ may import nothing but core\//)
})

test('core may not reach electron, the filesystem or the network', () => {
  for (const specifier of ['electron', 'node:fs', 'node:https', 'node:sqlite']) {
    const found = clean('electron/core/domain/arming.ts', `import x from '${specifier}'`)
    assert.equal(found.length, 1, specifier)
    assert.match(found[0].why, /core\/ must stay pure/)
  }
})

test('core may still use the pure builtins', () => {
  assert.deepEqual(
    clean(
      'electron/core/domain/spanVerification.ts',
      `import { randomUUID } from 'node:crypto'
       import { join } from 'node:path'`,
    ),
    [],
  )
})

test('the renderer may import core/contracts and nothing else from electron', () => {
  assert.deepEqual(
    clean(
      'src/screens/Session.tsx',
      `import type { Meeting } from '../../electron/core/contracts/meeting.ts'`,
    ),
    [],
  )

  for (const [file, source, why] of [
    [
      'src/screens/Session.tsx',
      `import { spanVerification } from '../../electron/core/domain/spanVerification.ts'`,
      /core\/contracts\/ only/,
    ],
    [
      'src/screens/Session.tsx',
      `import { Store } from '../../electron/modules/store/index.ts'`,
      /core\/contracts\/ only/,
    ],
    ['src/screens/Session.tsx', `import { ipcRenderer } from 'electron'`, /must not import electron/],
  ]) {
    const found = clean(file, source)
    assert.equal(found.length, 1, source)
    assert.match(found[0].why, why)
  }
})

test('inside src the renderer is an ordinary application', () => {
  // The rule is about what the renderer may reach into `electron/` for. Reading
  // it as "one import path and no other" would forbid `src/editor/` importing
  // its own schema, which is not a boundary at all.
  assert.deepEqual(
    clean(
      'src/editor/note/title-layout.ts',
      `import { schema } from './schema'
       import { tokens } from '../../design/tokens.ts'`,
    ),
    [],
  )
})

test('app may import core and any module', () => {
  assert.deepEqual(
    clean(
      'electron/app/session/Orchestrator.ts',
      `import { Store } from '../../modules/store/index.ts'
       import { Diagnostics } from '../../modules/diagnostics/index.ts'
       import type { MeetingId } from '../../core/contracts/meeting.ts'`,
    ),
    [],
  )
})

test('files outside a layer are reported as unexamined, not as passing', () => {
  assert.equal(checkFile('electron/audio/SystemAudioCapture.ts', `import 'electron'`), null)
  assert.equal(classify('electron/audio/SystemAudioCapture.ts'), null)
  // preload is app, despite sitting at the root of electron/
  assert.deepEqual(classify('electron/preload.ts'), { layer: 'app' })
})
