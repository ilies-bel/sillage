/**
 * The prose-channel half of DEC-7.
 *
 * Two failure directions and both are expensive, so both are tested. A missed
 * leak puts an invented contact in a client's CRM record. A false positive
 * refuses an honest compte-rendu, and the rep sees "la réponse a été refusée"
 * for a call that went perfectly — which is why the second half of this file is
 * as long as the first.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { findDeterministicLeaks, forbiddenIdentitiesOf } from '../deterministicLeaks.ts'

const identities = forbiddenIdentitiesOf({
  organizer: { name: 'Julien Marchand', email: 'julien.marchand@esn-exemple.fr' },
  attendees: [
    { name: 'Camille Le Roy', email: 'camille.leroy@acme-industries.fr' },
    { name: 'Marc Petit', email: 'marc.petit@acme-industries.fr' },
  ],
})

const leaks = (compteRendu: string): string[] =>
  findDeterministicLeaks({ compteRendu }, identities)

test('a full attendee name is a leak', () => {
  assert.deepEqual(leaks('Échange avec Camille Le Roy.'), ["compteRendu: nom d'un participant"])
  assert.deepEqual(leaks('Point mené par Julien Marchand.'), ["compteRendu: nom d'un participant"])
})

test('two adjacent name tokens are specific enough on their own', () => {
  assert.equal(leaks('Le Roy a confirmé le besoin.').length, 1)
  assert.equal(leaks('Vu avec M. Marc Petit.').length, 1)
})

test('a lone token is a leak only once it is long enough to be a name', () => {
  assert.equal(leaks('Roy a confirmé.').length, 0, 'three letters is not evidence')
  assert.equal(leaks('Camille a confirmé.').length, 1)
  assert.equal(leaks('Marchand a confirmé.').length, 1)
})

test('a surname that is also an ordinary French word is left alone', () => {
  // « Petit » is an attendee's surname *and* an adjective in every third
  // sentence of a French sales summary. Refusing on it would fail good
  // extractions constantly.
  assert.deepEqual(leaks('Un petit lot de trois profils, sur un petit périmètre.'), [])
  assert.deepEqual(leaks('Le roi du secteur.'), [])
})

test('any e-mail address is a leak, invited or not', () => {
  assert.ok(leaks('Écrire à camille.leroy@acme-industries.fr').includes('compteRendu: adresse e-mail'))
  assert.ok(leaks('Écrire à contact@parfaitement-inconnu.fr').includes('compteRendu: adresse e-mail'))
})

test('a phone number is a leak in every French spelling of one', () => {
  for (const number of ['01 42 68 53 00', '+33 6 12 34 56 78', '0612345678', '01.42.68.53.00']) {
    assert.ok(leaks(`Rappeler au ${number}.`).length > 0, number)
  }
})

test('a calendar date is a leak; a spoken approximation is not', () => {
  assert.ok(leaks('Réunion du 12/03/2026.').includes('compteRendu: date calendaire'))
  assert.ok(leaks('Réunion du 2026-03-12.').includes('compteRendu: date calendaire'))
  assert.ok(leaks('Réunion du 12 mars 2026.').includes('compteRendu: date calendaire'))

  // What `dateDemarrage` is free text *for* (DEC-7). Refusing these would be
  // refusing the reply for doing its job.
  assert.deepEqual(leaks('Démarrage souhaité mi-septembre.'), [])
  assert.deepEqual(leaks('Le client vise le 15 septembre pour le démarrage.'), [])
  assert.deepEqual(leaks('Mission de 6 mois, 2 profils, TJM 520 €.'), [])
})

test('citations are exempt — they are transcript, and the transcript has names', () => {
  const reply = {
    compteRendu: "Le client pilote le sujet depuis la DSI.",
    besoin: { valeur: 'Renfort plateforme', citation: 'Camille Le Roy à l’appareil, je suis la DSI' },
  }
  assert.deepEqual(findDeterministicLeaks(reply, identities), [])
})

test('the leak is reported with the path that carried it', () => {
  const reply = {
    compteRendu: 'Rien à signaler.',
    prochainesEtapes: [
      { valeur: { action: 'Relancer Camille Le Roy' }, citation: 'on se rappelle' },
    ],
  }
  assert.deepEqual(findDeterministicLeaks(reply, identities), [
    "prochainesEtapes.0.valeur.action: nom d'un participant",
  ])
})

test('the shape rules hold with no identities at all', () => {
  const reply = { compteRendu: 'Écrire à contact@acme.fr le 12/03/2026.' }
  assert.deepEqual(findDeterministicLeaks(reply), [
    'compteRendu: adresse e-mail',
    'compteRendu: date calendaire',
  ])
})
