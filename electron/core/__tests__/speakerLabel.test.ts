/**
 * Who a turn belongs to.
 *
 * Every transcript surface wrote « Client » for the far channel, on every call.
 * On a call with one client contact that is a name the app *has*, from the
 * calendar, and was throwing away; on a call with three it is the only honest
 * thing to say. Collapsing the two into the second made the common ESN case —
 * one acheteur, one commercial — read as anonymously as a committee.
 *
 * What has to hold is the boundary between the two: **exactly one** is a fact
 * (the channel is measured by the hardware, the name comes from Graph), and two
 * is a guess the product does not make. There is no diarisation, and no amount
 * of plausibility makes « Camille » true of a turn Yann took.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { speakerLabel } from '../contracts/transcript.ts'

const person = (name: string, email = 'x@acme.fr') => ({ name, email })

test('the rep is always the rep — the microphone settles it', () => {
  assert.equal(speakerLabel('rep', []), 'Moi')
  assert.equal(speakerLabel('rep', [person('Camille Le Roy')]), 'Moi')
})

test('one interlocutor is a name, because the record settles which', () => {
  // The channel is measured; the name is Graph's (DEC-7). The join is a fact.
  assert.equal(speakerLabel('far', [person('Camille Le Roy')]), 'Camille')
})

test('two interlocutors is « Client », and stays « Client »', () => {
  // The app cannot say which of them spoke and must not pick the first.
  assert.equal(
    speakerLabel('far', [person('Camille Le Roy'), person('Yann Ferrand')]),
    'Client',
  )
})

test('nobody on the calendar is « Client » too', () => {
  // A meeting the rep started by hand has no attendee list at all.
  assert.equal(speakerLabel('far', []), 'Client')
})

test('an attendee with no name does not count as one', () => {
  // Graph returns a bare address for an external invitee often enough that this
  // is the ordinary case, not a defensive branch — and « » is not a speaker.
  assert.equal(speakerLabel('far', [person('', 'inconnu@acme.fr')]), 'Client')
  // One named beside one unnamed still settles it: only one person on that side
  // has a name to print, and the turn is theirs or nobody's.
  assert.equal(
    speakerLabel('far', [person('Camille Le Roy'), person('', 'inconnu@acme.fr')]),
    'Camille',
  )
})

test('the first name only', () => {
  // The surname is on the compte-rendu's header line, and a transcript's
  // speaker column is fourteen characters wide.
  assert.equal(speakerLabel('far', [person('Marie-Claire Dupont-Aignan')]), 'Marie-Claire')
  assert.equal(speakerLabel('far', [person('  Élodie   Vasseur  ')]), 'Élodie')
})
