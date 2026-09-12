import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OutlookMail, MAIL_SCOPES } from '../OutlookMail.ts'
import { ForbiddenScopeError, GraphError, draftsUrl, type FetchLike } from '../graph.ts'
import { mailHealth } from '../index.ts'
import { ConsentRequiredError, InteractionRequiredError, type IdentityPort } from '../../../core/contracts/identity.ts'
import type { MailDraftPayload } from '../../../core/contracts/push.ts'
import { COMPTE_RENDU_SECTIONS } from '../../../core/contracts/recipes.ts'

const NOW = Date.parse('2026-08-05T08:00:00Z')

const identity: IdentityPort = {
  account: () => ({ homeAccountId: 'h', username: 'claire@shodo.fr', name: 'Claire', tenantId: 't' }),
  signIn: async () => {
    throw new Error('never in a test')
  },
  signOut: async () => {},
  token: async () => 'jeton',
}

const PAYLOAD: MailDraftPayload = {
  subject: 'Suite à notre échange — Aura',
  body: 'Bonjour,\n\nMerci pour le temps accordé.',
  to: ['marc@aura.fr', 'claire@shodo.fr'],
}

interface Call {
  url: string
  method: string | undefined
  headers: Record<string, string> | undefined
  body: string | undefined
}

/** Records every request the module makes, so the assertions can be about all of them. */
const recorder = (
  reply: (call: Call) => { ok: boolean; status: number; body: string; retryAfter?: string },
): { calls: Call[]; fetch: FetchLike } => {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, method: init?.method, headers: init?.headers, body: init?.body }
    calls.push(call)
    const answer = reply(call)
    return {
      ok: answer.ok,
      status: answer.status,
      headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? answer.retryAfter ?? null : null) },
      text: async () => answer.body,
    }
  }
  return { calls, fetch }
}

const created = () => ({ ok: true, status: 201, body: JSON.stringify({ id: 'AAMkAGI2', isDraft: true }) })

// ── the draft ──────────────────────────────────────────────────────────────

test('a draft is one POST to the messages resource, and returns its id', async () => {
  const { calls, fetch } = recorder(created)
  const result = await new OutlookMail({ identity, fetch }).createDraft(PAYLOAD)

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'https://graph.microsoft.com/v1.0/me/messages')
  assert.equal(calls[0]?.method, 'POST')
  assert.equal(calls[0]?.headers?.Authorization, 'Bearer jeton')

  const sent = JSON.parse(calls[0]?.body ?? '{}')
  assert.equal(sent.subject, PAYLOAD.subject)
  assert.equal(sent.body.contentType, 'Text')
  assert.deepEqual(
    sent.toRecipients.map((r: { emailAddress: { address: string } }) => r.emailAddress.address),
    PAYLOAD.to,
  )

  assert.deepEqual(result, { ok: true, intentId: '', remoteId: 'AAMkAGI2' })
})

test('the outbox stamps the intent id, not the adapter', async () => {
  const { fetch } = recorder(created)
  const result = await new OutlookMail({ identity, fetch }).createDraft(PAYLOAD)
  // Empty rather than guessed: the adapter is handed a payload, never a row.
  assert.equal(result.intentId, '')
})

// ── HR-8: no send path exists ──────────────────────────────────────────────

const MODULE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

const moduleSources = (): Array<{ file: string; source: string }> =>
  readdirSync(MODULE_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, source: readFileSync(join(MODULE_DIR, f), 'utf8') }))

test('HR-8 — no file in the module can name a send endpoint or the send scope', () => {
  const files = moduleSources()
  assert.ok(files.length >= 3, 'the module should have been scanned')

  // Assembled from fragments so this test file is not itself a place the
  // forbidden strings live — the check would then always pass on itself.
  const banned = [`/${'send'}`, `Mail.${'Send'}`, `${'send'}Mail`, `${'send'}mail`]

  for (const { file, source } of files) {
    const haystack = source.toLowerCase()
    for (const needle of banned) {
      assert.ok(
        !haystack.includes(needle.toLowerCase()),
        `${file} names "${needle}" — HR-8 says this module creates drafts and nothing else`,
      )
    }
  }
})

test('HR-8 — the only URL the module can build is the messages resource', () => {
  assert.equal(draftsUrl(), 'https://graph.microsoft.com/v1.0/me/messages')
  // No arguments: there is no segment a caller can append or substitute.
  assert.equal(draftsUrl.length, 0)
  assert.deepEqual(MAIL_SCOPES, ['Mail.ReadWrite'])
})

test('DEC-10 — the module never names the calendar resource it must not write', () => {
  for (const { file, source } of moduleSources()) {
    assert.ok(
      !source.toLowerCase().includes(`/me/${'events'}`),
      `${file} names the events resource — DEC-10 forbids writing an Outlook event body`,
    )
  }
})

test('a forbidden scope is refused at construction, before any network call', () => {
  const { calls, fetch } = recorder(created)
  assert.throws(
    () => new OutlookMail({ identity, fetch, scopes: ['Mail.ReadWrite', `Mail.${'Send'}`] }),
    ForbiddenScopeError,
  )
  assert.equal(calls.length, 0)
})

test('a forbidden scope added after construction is refused before the request', async () => {
  const { calls, fetch } = recorder(created)
  const scopes = ['Mail.ReadWrite']
  const mail = new OutlookMail({ identity, fetch, scopes })
  scopes.push(`Mail.${'Send'}`)

  await assert.rejects(() => mail.createDraft(PAYLOAD), ForbiddenScopeError)
  assert.equal(calls.length, 0, 'the guard must run before the token and before the fetch')
})

test('the token is requested for the mail scopes only', async () => {
  const asked: Array<readonly string[] | undefined> = []
  const { fetch } = recorder(created)
  const spy: IdentityPort = {
    ...identity,
    token: async (scopes) => {
      asked.push(scopes)
      return 'jeton'
    },
  }
  await new OutlookMail({ identity: spy, fetch }).createDraft(PAYLOAD)
  assert.deepEqual(asked, [['Mail.ReadWrite']])
})

// ── failures ───────────────────────────────────────────────────────────────

test('a throttled draft comes back retryable, a rejected one does not', async () => {
  const throttled = recorder(() => ({ ok: false, status: 429, body: '', retryAfter: '30' }))
  const first = await new OutlookMail({ identity, fetch: throttled.fetch }).createDraft(PAYLOAD)
  assert.equal(first.ok, false)
  assert.equal(first.ok === false && first.retryable, true)

  const rejected = recorder(() => ({
    ok: false,
    status: 400,
    body: JSON.stringify({ error: { message: 'destinataire invalide' } }),
  }))
  const second = await new OutlookMail({ identity, fetch: rejected.fetch }).createDraft(PAYLOAD)
  assert.equal(second.ok, false)
  assert.equal(second.ok === false && second.retryable, false)
  assert.equal(second.ok === false && second.reason, 'destinataire invalide')
})

/**
 * **A 5xx on the draft create is terminal, for the same reason the 201-with-no-id
 * is.**
 *
 * `POST /me/messages` has no idempotency key, and a 503 or a 504 from a proxy
 * in front of Graph is routinely a request that landed. Retrying it put three
 * identical follow-ups, addressed to the client, in the rep's Outlook — once
 * per attempt in the drain, and again on every relaunch, because the boot
 * re-drains every pending row. `modules/crm/vsa/http.ts` carries the same rule
 * and the measurement behind it; this module's own docblock stated it and the
 * code did the opposite.
 */
test('no 5xx on the draft create is retried', async () => {
  for (const status of [500, 502, 503, 504]) {
    const { fetch, calls } = recorder(() => ({ ok: false, status, body: '' }))
    const result = await new OutlookMail({ identity, fetch }).createDraft(PAYLOAD)
    assert.equal(result.ok, false, `${status} devrait échouer`)
    assert.equal(result.ok === false && result.retryable, false, `${status} ne doit pas être rejoué`)
    assert.equal(calls.length, 1)
  }
})

test('a created draft with no id is terminal — a second POST would leave two drafts', async () => {
  const { fetch } = recorder(() => ({ ok: true, status: 201, body: '{}' }))
  const result = await new OutlookMail({ identity, fetch }).createDraft(PAYLOAD)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.retryable, false)
})

// ── health ─────────────────────────────────────────────────────────────────

test('every failure a rep can hit maps to a reason and an honest retry flag', () => {
  const consent = mailHealth(new ConsentRequiredError(), NOW)
  assert.equal(consent.state, 'down')
  assert.equal(consent.state === 'down' && consent.retryable, false)

  const signIn = mailHealth(new InteractionRequiredError(), NOW)
  assert.equal(signIn.state === 'down' && signIn.retryable, true)

  const forbidden = mailHealth(new ForbiddenScopeError([`Mail.${'Send'}`]), NOW)
  assert.equal(forbidden.state, 'down')
  assert.equal(forbidden.state === 'down' && forbidden.retryable, false)

  const throttled = mailHealth(
    new GraphError({ status: 429, message: 'throttled', retryable: true, retryAfterMs: 30_000 }),
    NOW,
  )
  assert.equal(throttled.state, 'degraded')
  // U+00A0 — see the same assertion in calendar.test.ts.
  assert.ok(throttled.state === 'degraded' && throttled.reason.includes('30\u00a0s'))

  const noScope = mailHealth(new GraphError({ status: 403, message: 'denied', retryable: false }), NOW)
  assert.equal(noScope.state === 'down' && noScope.retryable, false)

  const unknown = mailHealth(new Error('câble débranché'), NOW)
  assert.equal(unknown.state, 'down')
  assert.equal(unknown.state === 'down' && unknown.reason, 'messagerie indisponible — câble débranché')
})

test('a sign-in that has expired is retryable, and nothing was sent', async () => {
  /*
   * **The one call that reliably throws sat outside the block whose docstring
   * promises this method never throws.**
   *
   * `MsalIdentity` raises for a token that needs a fresh sign-in — an expired
   * refresh, a revoked consent, a laptop offline long enough. The throw escaped
   * to `Outbox.#attempt`, which cannot tell a fault from a decision, so the
   * intent was recorded `failed` — and `failed` is terminal here: `drainable()`
   * selects `pending`, the row has no *Réessayer* by design, and a boot-time
   * re-drain skips it. A rep who validated on a train lost the follow-up draft
   * permanently, for a failure that provably created nothing.
   */
  const expired: IdentityPort = {
    ...identity,
    token: async () => {
      throw new Error('interaction requise — reconnectez votre compte Microsoft')
    },
  }
  const seen = recorder(() => ({ ok: true, status: 201, body: '{"id":"AAMkAGI2"}' }))
  const mail = new OutlookMail({
    identity: expired,
    fetch: seen.fetch,
    diagnostics: { record: () => {} },
  })

  const result = await mail.createDraft(PAYLOAD)

  assert.equal(result.ok, false)
  // Retryable because it is a *fact*, not a hope: the request was never sent.
  assert.equal(result.retryable, true)
  assert.match(result.reason ?? '', /interaction requise/)
  assert.equal(seen.calls.length, 0, 'rien ne doit partir sans jeton')
})

test('a failure mid-POST stays terminal, because nobody knows what was created', async () => {
  /*
   * The other side of the same rule, and the reason the token gets its own
   * block instead of a wider `catch`: a request that left and whose answer was
   * lost is the genuinely unknown case. Retrying that is how a mailbox gets two
   * identical drafts, and `/me/messages` has no idempotency key either.
   */
  const mail = new OutlookMail({
    identity,
    fetch: async () => {
      throw new TypeError('fetch failed')
    },
    diagnostics: { record: () => {} },
  })

  const result = await mail.createDraft(PAYLOAD)
  assert.equal(result.ok, false)
  assert.equal(result.retryable, false)
})

// ── the body is the document, character for character (US-6, DEC-44) ───────

/*
 * **Nothing measured what this module does to the text it is handed.**
 *
 * The POST body was asserted for its URL, its method, its `Authorization`, its
 * `subject`, its `contentType` and its recipients — and never for its
 * *content*. Measured on the shipped adapter before this section existed:
 * replacing one line of `messageBody` with
 *
 *     content: payload.body.replace(/^#{1,6} +/gm, '').replace(/^- /gm, '· ').trim()
 *
 * — the flattening a « share this note » feature reaches for first — left
 * **1 228 node tests and 570 renderer tests green**, with every `#`, `##` and
 * `###` stripped out of every draft this product creates.
 *
 * That matters for one reason beyond tidiness. The compte-rendu's markers are
 * *visible* on screen on purpose: `CompteRenduDocument` hangs them in a gutter
 * rather than rendering them away, precisely so the copy a human reads and the
 * copy that leaves the machine are the same document. A module that quietly
 * reshapes the string on its way out makes them two documents, and the only
 * place that difference shows up is a recipient's mailbox.
 *
 * So the assertion is strict equality over the whole string, and the document is
 * the one `renderCompteRendu` composes.
 */

/*
 * Faithful along the axis this test measures: every construct the composer
 * emits, once each — the `#` title, the four deterministic lines (DEC-7), the
 * six `## ` sections read off `COMPTE_RENDU_SECTIONS` so they cannot drift from
 * the recipe, the appended « Éléments retenus » recap with its two `### `
 * subsections, `- ` list lines, `**gras**` and `_italique_` inside a line, a
 * `« … »` quotation (DEC-44 licenses those for words the client really said),
 * the typographic apostrophe, `⚠ faible` with the legend line the composer
 * appends *because* that marker is present, and the trailing newline that
 * `renderCompteRendu` ends every document with.
 *
 * Short in *paragraphs* and complete in *constructs*, deliberately. Length is
 * what a layout fixture needs; what crosses this boundary is characters, and a
 * document missing a marker class is a document this test cannot fail on. The
 * guard below holds it to that — a fixture simpler than the product is the
 * failure this repo has caught six times.
 */
const COMPTE_RENDU = [
  '# Néovia Santé — cadrage renfort data',
  '',
  'Client : Néovia Santé',
  'Date : mardi 5 août 2026, 14:30 – 15:30',
  'Interlocuteurs : Élodie Vasseur (elodie.vasseur@neovia-sante.fr)',
  'Commercial : julien.marchand@synapse-it.fr',
  '',
  COMPTE_RENDU_SECTIONS[0],
  '',
  'Néovia Santé a voté ce matin le budget de sa plateforme data et cherche un renfort pour sortir ses pipelines Talend avant la fin de l’année.',
  '',
  COMPTE_RENDU_SECTIONS[1],
  '',
  'Le budget a été voté ce matin en comité d’investissement. L’équipe interne est décrite comme « trois personnes, dont deux à mi-temps sur le sujet ».',
  '',
  COMPTE_RENDU_SECTIONS[2],
  '',
  'Le client indique qu’« il nous manque deux data engineers » sur la migration.',
  '',
  COMPTE_RENDU_SECTIONS[3],
  '',
  'Databricks et Airflow en place, dbt en cours de généralisation.',
  '',
  COMPTE_RENDU_SECTIONS[4],
  '',
  'La grille achats plafonne à 550 € sur un profil confirmé.',
  '',
  COMPTE_RENDU_SECTIONS[5],
  '',
  'Envoi de trois CV avec les TJM associés avant vendredi.',
  '',
  '## Éléments retenus',
  '',
  '- **Besoin** : Renforcer l’équipe plateforme pour la migration des pipelines Talend.',
  '- **TJM évoqué** : 550 €',
  '',
  '### Profils recherchés',
  '',
  '- 2 × Data Engineer — confirmé (Databricks, Airflow, dbt)',
  '',
  '### Objections et points de vigilance',
  '',
  '- La grille achats plafonne à 550 € — _sans réponse apportée_ ⚠ faible',
  '',
  '⚠ faible : la citation de cette valeur n’a pas été retrouvée dans la transcription. À confirmer auprès du client.',
  '',
].join('\n')

test('the fixture carries every construct the composer writes, or it measures nothing', () => {
  const lines = COMPTE_RENDU.split('\n')
  const has = (predicate: (line: string) => boolean): boolean => lines.some(predicate)

  // The recipe's own headings, read from the recipe. One renamed there and not
  // here is a fixture that has stopped being the document the product writes.
  for (const heading of COMPTE_RENDU_SECTIONS) {
    assert.ok(lines.includes(heading), `${heading} is missing — the fixture is not the composer's document`)
  }
  assert.ok(
    has((l) => l.startsWith('# ')),
    'no `#` title',
  )
  assert.ok(
    has((l) => l.startsWith('### ')),
    'no `###` subsection',
  )
  assert.ok(
    has((l) => l.startsWith('- ')),
    'no `- ` list line',
  )
  assert.ok(
    has((l) => l.includes('**')),
    'no `**gras**` inside a line',
  )
  assert.ok(
    has((l) => /_[^_]+_/.test(l)),
    'no `_italique_` inside a line',
  )
  assert.ok(COMPTE_RENDU.includes('«') && COMPTE_RENDU.includes('»'), 'no « … » quotation')
  assert.ok(COMPTE_RENDU.includes('’'), 'no typographic apostrophe')
  assert.ok(COMPTE_RENDU.includes('⚠ faible'), 'no `⚠ faible` marker')
  assert.ok(
    has((l) => l.startsWith('⚠ faible : ')),
    'no legend line — the composer appends one whenever that marker appears',
  )
  /*
   * `renderCompteRendu` returns `${document}${legend}\n`, and `document` is
   * `trimEnd()`ed before it — so exactly one. This is the character a `.trim()`
   * downstream eats, and the only one on this list that nothing else would
   * notice missing: measured on the CRM side, a `TEXT` codec doing
   * `value.trim()` passed all forty adapter tests.
   */
  assert.ok(COMPTE_RENDU.endsWith('\n'), 'the composer ends every document with a newline')
  assert.ok(!COMPTE_RENDU.endsWith('\n\n'), 'exactly one trailing newline, as the composer writes it')
})

test('the compte-rendu reaches Graph character for character, markers included', async () => {
  const { calls, fetch } = recorder(created)
  const payload: MailDraftPayload = {
    subject: 'Compte-rendu — Néovia Santé, cadrage renfort data',
    body: COMPTE_RENDU,
    to: ['sophie.bertrand@synapse-it.fr'],
  }

  const result = await new OutlookMail({ identity, fetch }).createDraft(payload)
  assert.equal(result.ok, true)

  // Nothing is sent, and there is nothing on the wire that could: one request,
  // to the drafts resource (HR-8).
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, draftsUrl())
  assert.equal(calls[0]?.method, 'POST')

  const sent = JSON.parse(calls[0]?.body ?? '{}')
  /*
   * Strict equality over the whole string. Not a `match`, not a length, not
   * « contains every heading »: the property is that the document was not
   * touched, and only equality says that.
   */
  assert.equal(sent.body.content, COMPTE_RENDU, 'the body Graph receives is the document, unchanged')
  assert.equal(sent.subject, payload.subject, 'the subject is not reshaped either')
  /*
   * `Text`, so nothing in the compte-rendu is interpreted as markup. An `HTML`
   * body carrying the same characters is a *different* document on screen — the
   * markers would vanish, which is exactly the divergence this section exists
   * to refuse.
   */
  assert.equal(sent.body.contentType, 'Text')
})
