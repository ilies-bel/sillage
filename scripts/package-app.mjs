#!/usr/bin/env node
/**
 * The release build, on any host.
 *
 *   node scripts/package-app.mjs [--signed]
 *
 * This used to be one line in `package.json`:
 *
 *   … && cross-env SILLAGE_BUILD_ALL_MAC_ARCHES=1 npm run build:native &&
 *   (electron-builder; code=$?; node scripts/rebuild-native-electron.js; exit $code)
 *
 * which is a POSIX subshell with `$?` in it. On Windows `npm run dist` failed
 * before electron-builder was even reached — on the platform HR-2 calls the
 * primary one. The subshell was not decoration: it exists so the **restore**
 * runs whether or not the pack succeeded, because packing rewrites the native
 * addons for the *target* arch and leaves the working tree unable to run
 * `npm start` until they are rebuilt for the host. A `&&` chain would skip that
 * restore on the one path where it matters most.
 *
 * So the sequencing moves here, where `try/finally` says it in a way both
 * platforms read the same.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const signed = process.argv.includes('--signed')

/**
 * `npm` is `npm.cmd` on Windows, and `spawnSync` without a shell will not find
 * the `.cmd`. `shell: true` is the portable form; every argument here is a
 * literal from this file, never user input.
 */
const run = (command, args, env = {}) => {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

const step = (command, args, env) => {
  const code = run(command, args, env)
  if (code !== 0) {
    console.error(`\n✗ ${command} ${args.join(' ')} — exit ${code}`)
    process.exit(code)
  }
}

/*
 * Both macOS slices, and only on macOS. Apple Silicon and Intel are one
 * product's two halves; Windows arches are handled by electron-builder's own
 * per-target packs, so forcing the flag there would set an env var that
 * `scripts/build-native.js` correctly ignores — and then read as a mac-first
 * build script to whoever came next.
 */
const nativeEnv = process.platform === 'darwin' ? { SILLAGE_BUILD_ALL_MAC_ARCHES: '1' } : {}

step('npm', ['run', 'build'])
step('npm', ['run', 'typecheck:electron'])
step('npm', ['run', 'build:electron'])
step('npm', ['run', 'build:native'], nativeEnv)

let code = 1
try {
  code = run('npx', ['electron-builder', ...(signed ? ['--config', 'electron-builder.signed.cjs'] : [])])
} finally {
  // The restore, in the `finally` the subshell was standing in for.
  console.log('\n> restoring host-arch native addons')
  run('node', ['scripts/rebuild-native-electron.js'])
}

process.exit(code)
