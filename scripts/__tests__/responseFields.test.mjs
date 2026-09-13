/**
 * **The resolver, driven against the shipped contract and against the four
 * spellings that used to be skipped in silence.**
 *
 * `check-surfaces.mjs`'s field rule asked its question of twenty of the fifty-two
 * invoke channels and said nothing about the other thirty-two, because the response
 * was found by a name — `/response:\s*([A-Za-z0-9_]+)/` — so `response: z.object({…})`
 * captured `z` and resolved to nothing. Every test below is about one of the two
 * halves of that: the spelling resolves, or the resolver refuses **out loud**.
 *
 * The last two tests read `electron/core/contracts/ipc.ts` itself, because the
 * property that matters is not « the resolver handles a union » but « every channel
 * this product ships is measured by something ». A unit test over fixtures can pass
 * on a contract the check no longer reads.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  channelEntries,
  declarationsIn,
  keysOf,
  resolveFields,
  responseIn,
  stripComments,
} from '../lib/responseFields.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CONTRACTS = path.join(ROOT, 'electron/core/contracts')

const contractSources = readdirSync(CONTRACTS)
  .filter((entry) => entry.endsWith('.ts'))
  .map((entry) => stripComments(readFileSync(path.join(CONTRACTS, entry), 'utf8')))
const declarations = declarationsIn(contractSources)

const fields = (expr, decls = declarations) => {
  const got = resolveFields(expr, decls)
  assert.notEqual(got, null, `unresolved: ${expr}`)
  return [...got].sort()
}

test('an inline z.object is resolved where it stands — the whole finding', () => {
  assert.deepEqual(fields('z.object({ started: z.boolean(), reason: z.string().nullable() })'), [
    'reason',
    'started',
  ])
})

test('a list, a record and a wrapper ship their element’s fields', () => {
  const decls = new Map([
    ['RowSchema', 'z.object({ id: z.string(), label: z.string() })'],
    ['KeySchema', 'z.enum([\'a\', \'b\'])'],
  ])
  assert.deepEqual(fields('z.array(RowSchema)', decls), ['id', 'label'])
  assert.deepEqual(fields('z.record(KeySchema, RowSchema)', decls), ['id', 'label'])
  assert.deepEqual(fields('RowSchema.nullable()', decls), ['id', 'label'])
  // The keys of a record are not fields of it.
  assert.ok(!fields('z.record(KeySchema, RowSchema)', decls).includes('a'))
})

test('every variant of a union ships, so every variant’s fields are read', () => {
  // `session:command`, verbatim: the refusal carries `reason` and the success does
  // not, and a `reason` nobody reads is exactly what this rule is for.
  assert.deepEqual(
    fields(
      `z.discriminatedUnion('ok', [
         z.object({ ok: z.literal(true), state: MeetingStateSchema }),
         z.object({ ok: z.literal(false), state: MeetingStateSchema, reason: z.string() }),
       ])`,
      new Map([['MeetingStateSchema', "z.enum(['idle'])"]]),
    ),
    ['ok', 'reason', 'state'],
  )
})

test('.extend adds to what it inherits', () => {
  const decls = new Map([
    ['BaseSchema', 'z.object({ phase: z.string(), percent: z.number().nullable() })'],
  ])
  assert.deepEqual(fields('BaseSchema.extend({ installable: z.boolean() })', decls), [
    'installable',
    'percent',
    'phase',
  ])
})

test('a scalar response resolves to no fields, and is not a refusal', () => {
  assert.deepEqual(resolveFields('z.boolean()', declarations), [])
  assert.deepEqual(resolveFields("z.enum(['a', 'b'])", declarations), [])
})

/**
 * The half that is the finding: an expression this file cannot read answers `null`,
 * which `check-surfaces.mjs` turns into a red check. `.omit` is the live example —
 * it changes the field set, so guessing would either invent a field or hide one.
 */
test('an expression the resolver cannot read refuses, and never answers a guess', () => {
  const decls = new Map([['BaseSchema', 'z.object({ a: z.string(), b: z.string() })']])
  assert.equal(resolveFields('BaseSchema.omit({ b: true })', decls), null)
  assert.equal(resolveFields('BaseSchema.partial()', decls), null)
  assert.equal(resolveFields('somethingElse(BaseSchema)', decls), null)
  // An identifier no contract declares is a refusal, not an empty field set.
  assert.equal(resolveFields('MysterySchema', decls), null)
  // A spread is not a key, so the object cannot be read and says so.
  assert.equal(keysOf(' ...BaseSchema.shape, extra: z.string() '), null)
})

test('a self-referential schema terminates instead of recursing', () => {
  const decls = new Map([
    ['NodeSchema', 'z.object({ kind: z.string(), children: z.array(NodeSchema) })'],
  ])
  assert.deepEqual(fields('NodeSchema', decls), ['children', 'kind'])
})

/**
 * **The single-line channel, which was not merely unresolved but not a block.**
 *
 * The old `^ {2}'([^']+)':\s*\{([\s\S]*?)^ {2}\},` has no `  },` to stop at on a
 * one-line entry, so it swallowed everything up to the next multi-line channel's
 * close: four channels inside one « block », and the `response:` it read belonged to
 * the first of them.
 */
test('a channel written on one line is its own entry', () => {
  const source = `  'auth:state': { request: z.object({}), response: AuthStateSchema },
  'auth:signIn': { request: z.object({}), response: AuthStateSchema },
  'meeting:get': {
    request: z.object({ meetingId: MeetingIdSchema }),
    response: z.object({ meeting: MeetingSchema }),
  },
`
  const entries = channelEntries(source)
  assert.deepEqual(
    entries.map((entry) => entry.channel),
    ['auth:state', 'auth:signIn', 'meeting:get'],
  )
  assert.equal(responseIn(entries[0].block).trim(), 'AuthStateSchema')
  assert.equal(responseIn(entries[2].block).trim(), 'z.object({ meeting: MeetingSchema })')
})

test('a declaration ends where it ends, not at the next export', () => {
  const decls = declarationsIn([
    `export const FirstSchema = z.object({ a: z.string() })

const helper = 1

export const SecondSchema = z.object({ b: z.string() })
`,
  ])
  assert.deepEqual(fields('FirstSchema', decls), ['a'])
  assert.deepEqual(fields('SecondSchema', decls), ['b'])
})

/**
 * **Every invoke channel the product ships, resolved — measured on the contract.**
 *
 * The number is asserted as « all of them » rather than as 52, because a channel
 * deleted must not make this test greener. What it would have said before the
 * widening: 20 resolved, 32 unresolved, and the check silent about all 32.
 */
test('every invoke channel in the shipped contract resolves', () => {
  const contract = readFileSync(path.join(CONTRACTS, 'ipc.ts'), 'utf8')
  const split = contract.indexOf('Main → renderer')
  assert.ok(split > 0, 'the split between the two channel lists is gone')
  const entries = channelEntries(stripComments(contract.slice(0, split)))
  assert.ok(entries.length > 40, `only ${entries.length} invoke channels read`)

  const declared = [...contract.slice(0, split).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1])
  assert.equal(entries.length, declared.length, 'a declared channel was not read as a block')

  const unresolved = []
  for (const { channel, block } of entries) {
    const expression = block === null ? null : responseIn(block)
    if (expression === null) {
      unresolved.push(`${channel}: aucune réponse lisible`)
      continue
    }
    if (resolveFields(expression, declarations) === null) unresolved.push(channel)
  }
  assert.deepEqual(unresolved, [])
})

/**
 * And the two channels round 33 named, by hand, because « 52 of 52 » is a count and
 * these two are the reason the count matters: `review:confirm` is the only thing in
 * this product that writes into a client's CRM, and `widget:state` is what the
 * pill's whole surface is drawn from.
 */
test('review:confirm and widget:state ship the fields we think they do', () => {
  const contract = readFileSync(path.join(CONTRACTS, 'ipc.ts'), 'utf8')
  const entries = channelEntries(stripComments(contract.slice(0, contract.indexOf('Main → renderer'))))
  const of = (channel) => {
    const entry = entries.find((candidate) => candidate.channel === channel)
    assert.ok(entry, `${channel} is not in the contract`)
    return fields(responseIn(entry.block))
  }
  assert.deepEqual(of('review:confirm'), ['intentIds', 'ok', 'reason', 'state'])
  assert.deepEqual(of('widget:state'), ['meeting', 'mentionSentence'])
})
