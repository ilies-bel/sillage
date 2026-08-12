#!/usr/bin/env node
/**
 * The test runner.
 *
 * It exists because of one honest problem. Thirteen of the tests that survived
 * demolition do not import their subject — they import the *compiled* copy of
 * it from `dist-electron/`. Their subjects (`SystemAudioCapture`,
 * `LocalWhisperSTT`, the whisper worker helpers) are on the keep list but still
 * import modules that went with the old product, so the legacy tree no longer
 * compiles and those tests have nothing to load. They passed in a working copy
 * that still held pre-demolition build output; they cannot pass in a clean
 * checkout.
 *
 * Silently dropping them would hide that. So this runner partitions the suite
 * by a mechanical rule — a test that reads `dist-electron` is deferred — runs
 * everything else, and prints what it deferred and why. As step 2 ports each
 * subject into `modules/capture/` and repoints its test at the source, the test
 * rejoins the suite automatically. Nothing to remember, and the list shrinks in
 * public.
 *
 * The new tree needs no build: `.ts` runs under Node's type stripping.
 */
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const tracked = (...globs) =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', ...globs], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)

const rebuilt = tracked('electron/core', 'electron/modules', 'electron/app').filter((f) =>
  f.endsWith('.test.ts'),
)
const tooling = tracked('scripts').filter((f) => f.endsWith('.test.mjs'))
const legacy = tracked('electron').filter((f) => f.endsWith('.test.mjs'))

/**
 * A test is deferred when it names a `dist-electron/` path that is not there.
 *
 * "Mentions dist-electron" would be too blunt — some tests reference the build
 * output for a file the build still produces, and those run fine. Checking the
 * path exists makes the rule exact in both directions: a test rejoins the suite
 * the moment its subject is built again, with nothing to edit here.
 */
const missingBuildOutput = (file, source) => {
  // Only real specifiers — `resolve(__dirname, '…')`, `import('…')`,
  // `from '…'`. Matching every quoted string would drag in the prose of a
  // comment that merely mentions the build directory.
  const referenced = [
    ...source.matchAll(/(?:from|import|require|resolve\([^)]*?,)\s*['"]([^'"]*dist-electron[^'"]*)['"]/g),
  ].map((m) => m[1])

  return referenced.filter((path) => !existsSync(resolve(ROOT, dirname(file), path)))
}

const deferred = []
const runnable = []
for (const file of legacy) {
  const missing = missingBuildOutput(file, readFileSync(join(ROOT, file), 'utf8'))
  if (missing.length > 0) deferred.push({ file, missing })
  else runnable.push(file)
}

const files = [...rebuilt, ...tooling, ...runnable]

if (deferred.length > 0) {
  console.log(
    `\n${deferred.length} test files deferred until their subject is ported (IMPLEMENTATION.md step 2):`,
  )
  for (const { file, missing } of deferred) console.log(`  · ${file}  → ${missing[0]}`)
  console.log('  they load their subject from dist-electron/, which no longer holds it\n')
}

/**
 * A hanging test must fail, not run forever.
 *
 * Node's `--test-timeout` defaults to Infinity, so a test that awaits something
 * that never settles takes the whole suite with it — and `npm test` is the gate
 * (`check.yml`), which means the gate does not go red, it goes *nowhere*. That
 * is strictly worse than a failure: a red run names a test, a hung one burns
 * the job's six-hour ceiling and reports nothing. It happened on
 * `localWhisper.test.ts`'s two-channel test, which never lets its fake worker
 * become ready, and cost two ~6h runs before anyone read the queue.
 *
 * 30 s per *test*, not per file — comfortably above the slowest real one here
 * (a few deliberately wait ~10 s on drain and load-failure paths) and far below
 * anything that reads as "stuck". Raise it for a genuinely slow test by passing
 * `{ timeout }` to that `test()`, which keeps the budget next to the reason.
 */
const TEST_TIMEOUT_MS = 30_000

const result = spawnSync(
  process.execPath,
  [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    `--test-timeout=${TEST_TIMEOUT_MS}`,
    '--test',
    ...files,
  ],
  { cwd: ROOT, stdio: 'inherit' },
)

/**
 * The renderer half, under vitest.
 *
 * A second framework, for one reason: the ported ProseMirror code keeps its
 * upstream tests (CLAUDE.md) and those tests are vitest. Running them from here
 * rather than from a second npm script is what keeps `npm test` meaning "the
 * suite" — a second command is a command someone forgets.
 *
 * Skipped entirely when nothing under `src/` is a test, so the renderer's
 * absence before step 5 costs no time and no noise.
 */
const renderer = tracked('src')
  .filter((f) => /\.test\.tsx?$/.test(f))
  // `--cached` still lists a test deleted from the working tree but not yet
  // staged, and vitest — which globs the real tree — would then report one
  // fewer file than this banner announced.
  .filter((f) => existsSync(join(ROOT, f)))
let rendererStatus = 0

if (renderer.length > 0) {
  console.log(`\n── renderer (${renderer.length} files, vitest + jsdom) ──\n`)
  const run = spawnSync('npx', ['vitest', 'run'], { cwd: ROOT, stdio: 'inherit' })
  rendererStatus = run.status ?? 1
}

process.exit((result.status ?? 1) || rendererStatus)
