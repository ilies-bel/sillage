import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { loadDevEnv, parseDotEnv } from '../devEnv.ts'

describe('parseDotEnv', () => {
  it('reads plain assignments and ignores comments and blank lines', () => {
    const parsed = parseDotEnv(['# a comment', '', 'A=1', '  B=two  ', '# B=ignored'].join('\n'))
    assert.deepEqual(parsed, { A: '1', B: 'two' })
  })

  it('accepts an `export ` prefix', () => {
    assert.deepEqual(parseDotEnv('export SILLAGE_OPENAI_API_KEY=sk-abc'), {
      SILLAGE_OPENAI_API_KEY: 'sk-abc',
    })
  })

  it('keeps a `#` that is part of the value', () => {
    // The failure this pins: a naive comment-strip truncates the key, and the
    // provider answers 401 in a way that reads like a revoked credential.
    assert.deepEqual(parseDotEnv('KEY=sk-a#b'), { KEY: 'sk-a#b' })
    assert.deepEqual(parseDotEnv('URL=https://h/x#frag'), { URL: 'https://h/x#frag' })
  })

  it('strips a trailing comment only when whitespace separates it', () => {
    assert.deepEqual(parseDotEnv('K=v # trailing'), { K: 'v' })
  })

  it('unwraps quotes and preserves what is inside them', () => {
    assert.deepEqual(parseDotEnv('A="x # y"\nB=\'z\''), { A: 'x # y', B: 'z' })
  })

  it('preserves `=` inside the value', () => {
    assert.deepEqual(parseDotEnv('T=a=b=c'), { T: 'a=b=c' })
  })

  it('skips malformed lines rather than throwing', () => {
    assert.deepEqual(parseDotEnv('novalue\n=noname\n9BAD=x\nOK=1'), { OK: '1' })
  })

  it('reads an empty value as an empty string', () => {
    // `.env.example` ships keys with no value; they must not become "undefined".
    assert.deepEqual(parseDotEnv('EMPTY='), { EMPTY: '' })
  })
})

describe('loadDevEnv', () => {
  const read = () => 'FROM_FILE=file\nALREADY_SET=file'

  it('applies file values that are not already set', () => {
    const env: NodeJS.ProcessEnv = {}
    const applied = loadDevEnv({ isDev: true, root: '/repo', env, read })
    assert.deepEqual(applied, ['FROM_FILE', 'ALREADY_SET'])
    assert.equal(env.FROM_FILE, 'file')
  })

  it('never overwrites the real environment', () => {
    // `.env` is a default, not an override: `KEY=x npm start` and CI must win.
    const env: NodeJS.ProcessEnv = { ALREADY_SET: 'shell' }
    const applied = loadDevEnv({ isDev: true, root: '/repo', env, read })
    assert.equal(env.ALREADY_SET, 'shell')
    assert.deepEqual(applied, ['FROM_FILE'])
  })

  it('does nothing when packaged', () => {
    const env: NodeJS.ProcessEnv = {}
    let opened = false
    const applied = loadDevEnv({
      isDev: false,
      root: '/repo',
      env,
      read: () => {
        opened = true
        return 'A=1'
      },
    })
    // A packaged app must not read a `.env` beside its binary — and must not
    // even look, so the absence is not a permissions error on a rep's laptop.
    assert.equal(opened, false)
    assert.deepEqual(applied, [])
    assert.deepEqual(env, {})
  })

  it('treats a missing file as the normal case', () => {
    const applied = loadDevEnv({
      isDev: true,
      root: '/repo',
      env: {},
      read: () => {
        throw new Error('ENOENT')
      },
    })
    assert.deepEqual(applied, [])
  })
})
