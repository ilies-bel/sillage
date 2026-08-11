import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBoostSet,
  meetingTerms,
  projectNamesFrom,
  surnameOf,
  termsLearnedFrom,
} from '../lexicon/boost.ts'
import { correct } from '../lexicon/correct.ts'
import { STATIC_TERMS, staticBoostTerms } from '../lexicon/terms.fr-esn.ts'
import type { StoredLexiconTerm } from '../../contracts/lexicon.ts'
import type { MeetingContext } from '../../contracts/meeting.ts'

const stored = (term: string, scope: 'account' | 'client'): StoredLexiconTerm => ({
  term,
  category: 'company',
  variants: [],
  scope,
  scopeKey: scope === 'client' ? 'Aura' : '',
  hits: 0,
  createdAt: 0,
})

const attendee = (name: string) => ({
  name,
  email: `${name.replace(/\W/g, '.').toLowerCase()}@client.fr`,
  type: 'required' as const,
  response: 'accepted' as const,
})

const context = (over: Partial<MeetingContext> = {}): MeetingContext => ({
  eventId: 'evt-1',
  subject: 'Point hebdo',
  agenda: '',
  organizer: attendee('Claire Fontaine'),
  attendees: [],
  onlineMeetingJoinUrl: null,
  categories: [],
  sensitivity: 'normal',
  scheduledStart: 0,
  scheduledEnd: 3_600_000,
  seriesMasterId: null,
  timeZone: 'Europe/Paris',
  ...over,
})

test('a surname is taken from whichever position the tenant writes it in', () => {
  assert.equal(surnameOf('Ahmed ZAIOU'), 'ZAIOU')
  assert.equal(surnameOf('ZAIOU, Ahmed'), 'ZAIOU')
  assert.equal(surnameOf('Marie-Claire Deschamps'), 'Deschamps')
})

test('a particle stays attached to the surname it belongs to', () => {
  // The term exists to make the decoder produce the surname *as written*, so
  // dropping the particle produces a term that cannot do its job: « Roy » does
  // not get Whisper to « Le Roy ». French contact lists are full of these.
  assert.equal(surnameOf('Camille Le Roy'), 'Le Roy')
  assert.equal(surnameOf('Jean de La Fontaine'), 'de La Fontaine')
  assert.equal(surnameOf('Erik van Dijk'), 'van Dijk')
  assert.equal(surnameOf('LE ROY, Camille'), 'LE ROY')
})

test('a particle is never a boost term on its own', () => {
  // Boosting a bare "de" biases every French sentence toward a preposition.
  assert.equal(surnameOf('de'), null)
  assert.equal(surnameOf('van'), null)
})

test('a name with nothing usable in it yields nothing', () => {
  assert.equal(surnameOf(''), null)
  assert.equal(surnameOf('   '), null)
  // A room resource, not a person.
  assert.equal(surnameOf('A'), null)
})

test('project names come out of an agenda, sentence openings do not', () => {
  const names = projectNamesFrom('Migration DIMOS et reprise du lot SharePoint. Nous validons le périmètre.')
  assert.ok(names.includes('DIMOS'))
  assert.ok(names.includes('SharePoint'))
  // "Nous" opens a sentence — capitalised by grammar, not by being a name.
  assert.ok(!names.includes('Nous'))
})

test('attendee surnames outrank everything the app already knows', () => {
  const terms = meetingTerms(
    context({ subject: 'Kickoff DIMOS', attendees: [attendee('Ahmed ZAIOU'), attendee('Léo Crozat')] }),
  )
  // The organizer first, then attendees, then anything read out of the text.
  assert.deepEqual(terms.slice(0, 3), ['Fontaine', 'ZAIOU', 'Crozat'])
  assert.ok(terms.indexOf('DIMOS') > terms.indexOf('Crozat'))
})

test('a provider that cannot boost is handed nothing', () => {
  // DEC-17: a list that is silently dropped looks exactly like a list that did
  // not work, so it is never sent in the first place.
  const set = buildBoostSet(context(), { capability: 'none' })
  assert.deepEqual(set.terms, [])
})

test('the per-meeting half survives truncation and the static half is what gives way', () => {
  const set = buildBoostSet(
    context({ attendees: [attendee('Ahmed ZAIOU')] }),
    { capability: 'initialPrompt', maxTerms: 3, includeStatic: true },
  )
  assert.deepEqual(set.terms, ['Fontaine', 'ZAIOU', 'TJM'])
})

test('a term is never boosted twice under two spellings', () => {
  const set = buildBoostSet(context({ subject: 'Point TJM' }), {
    capability: 'initialPrompt',
    stored: [stored('tjm', 'account')],
  })
  const lowered = set.terms.map((t) => t.toLowerCase())
  assert.equal(new Set(lowered).size, lowered.length)
})

test('a client term outranks the account, and both outrank the shipped list', () => {
  const set = buildBoostSet(context({ attendees: [attendee('Ahmed ZAIOU')] }), {
    capability: 'initialPrompt',
    // The order the store returns: client scope first, then account.
    stored: [stored('Aura', 'client'), stored('Shodo', 'account')],
    includeStatic: true,
  })
  assert.deepEqual(set.terms.slice(0, 4), ['Fontaine', 'ZAIOU', 'Aura', 'Shodo'])
  assert.ok(set.terms.indexOf('TJM') > set.terms.indexOf('Shodo'))
})

test('what a meeting teaches is scoped to its client, or dropped', () => {
  const ctx = context({ subject: 'Kickoff DIMOS', attendees: [attendee('Ahmed ZAIOU')] })

  const learned = termsLearnedFrom(ctx, 'Aura')
  assert.deepEqual(
    learned.map((t) => [t.term, t.category, t.scopeKey]),
    [
      ['Fontaine', 'person', 'Aura'],
      ['ZAIOU', 'person', 'Aura'],
      ['DIMOS', 'project', 'Aura'],
    ],
  )

  // No client means no scope to learn into. Filing these under the account
  // would boost one client's surnames in every other client's meetings.
  assert.deepEqual(termsLearnedFrom(ctx, null), [])
  assert.deepEqual(termsLearnedFrom(ctx, '   '), [])
})

test('the shipped vocabulary is not put in the prompt unless it is asked for', () => {
  // Measured, not stylistic: padding a Whisper prompt with generic terms both
  // diluted the names that mattered and inserted "CDI," into speech where
  // nobody said it. The shipped list earns its keep in `correct.ts` instead.
  assert.deepEqual(buildBoostSet(null, { capability: 'initialPrompt' }).terms, [])

  const opted = buildBoostSet(null, { capability: 'initialPrompt', includeStatic: true, maxTerms: 64 })
  assert.ok(opted.terms.includes('TJM'))
  assert.ok(opted.terms.includes('SharePoint'))
})

test('the default budget is small enough that a prompt cannot collapse the decode', () => {
  // Past ~20 terms the transcript falls apart: 25 s of speech came back as
  // "et des services de la production." The budget is the guard against that.
  const set = buildBoostSet(null, { capability: 'initialPrompt', includeStatic: true })
  assert.equal(set.terms.length, 12)
})

test('every static term is unique and non-empty', () => {
  const terms = staticBoostTerms()
  assert.equal(new Set(terms.map((t) => t.toLowerCase())).size, terms.length)
  assert.ok(terms.every((t) => t.trim().length > 0))
  assert.equal(terms.length, STATIC_TERMS.length)
})

// ── Correction ─────────────────────────────────────────────────────────────

test('a known mis-transcription is repaired', () => {
  // Observed in a real call: three spellings of one product in five minutes.
  assert.equal(correct('mon shirkpoint de préprod').text, 'mon SharePoint de préprod')
  assert.equal(correct('le Sherpoit ne marche plus').text, 'le SharePoint ne marche plus')
  assert.equal(correct('un tédjéem de 550 euros').text, 'un TJM de 550 euros')
})

test('a variant is only repaired as a whole word', () => {
  // Without both boundaries "AO" rewrites the middle of "chaos".
  assert.equal(correct('le chaos permanent').text, 'le chaos permanent')
  assert.equal(correct("c'est un a o classique").text, "c'est un AO classique")
})

test('a multi-word variant wins over the shorter one inside it', () => {
  assert.equal(correct('il est en inter contrat').text, 'il est en intercontrat')
})

test('correction reports what it changed', () => {
  const result = correct('le shirkpoint et le tédjéem')
  assert.deepEqual(result.applied.sort(), ['SharePoint', 'TJM'])
})

test('text with nothing to repair is returned unchanged', () => {
  const text = 'Nous validons le périmètre la semaine prochaine.'
  const result = correct(text)
  assert.equal(result.text, text)
  assert.deepEqual(result.applied, [])
})

test('a client term is repaired ahead of the shipped list', () => {
  const result = correct('on passe par Auraq demain', [
    { term: 'AURA', category: 'project', variants: ['Auraq'] },
  ])
  assert.equal(result.text, 'on passe par AURA demain')
})

test('correction never runs on an empty segment', () => {
  assert.deepEqual(correct(''), { text: '', applied: [] })
})
