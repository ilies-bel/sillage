/**
 * DEC-27's guarantee, as a test rather than a claim.
 *
 * "This export contains no client conversation content" is exactly the sort of
 * promise that is true when it is written and false eighteen modules later. A
 * bundle full of prospect transcripts sitting in a support mailbox is a GDPR
 * incident, and the redacted export is the one the button reaches first.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDiagBundle,
  redactDetail,
  redactDiagEvent,
  redactMessage,
} from '../redactDiagnostics.ts'
import type { DiagEnvironment, DiagEvent } from '../../contracts/diagnostics.ts'

const environment: DiagEnvironment = {
  appVersion: '3.0.0',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.22631',
  electron: '43.1.0',
  node: '24.18.0',
  nativeArch: 'x64',
}

const CONTENT = [
  'On est plutôt sur un TJM de 520 euros',
  'camille.leroy@acme-industries.fr',
  'Acme Industries',
]

const leaky: DiagEvent = {
  id: 'd1',
  ts: 1000,
  severity: 'error',
  code: 'extract.schema.rejected',
  module: 'extract',
  message:
    'validation failed for camille.leroy@acme-industries.fr on "On est plutôt sur un TJM de 520 euros" see https://api.example.fr/x?token=abc',
  detail: {
    transcript: 'On est plutôt sur un TJM de 520 euros',
    attendees: ['camille.leroy@acme-industries.fr'],
    client: { name: 'Acme Industries' },
    durationMs: 4200,
    attempt: 2,
    provider: 'azure-speech-fc',
    ok: false,
    nothing: null,
  },
  meetingId: 'm-42',
}

const serialised = (value: unknown) => JSON.stringify(value)

test('a redacted event carries none of the conversation content', () => {
  const out = serialised(redactDiagEvent(leaky))
  for (const secret of CONTENT) {
    assert.ok(!out.includes(secret), `leaked: ${secret}`)
  }
  assert.ok(!out.includes('token=abc'))
})

test('detail keeps only what cannot carry prose', () => {
  const out = redactDetail(leaky.detail)
  assert.equal(out.durationMs, 4200)
  assert.equal(out.attempt, 2)
  assert.equal(out.ok, false)
  assert.equal(out.nothing, null)
  assert.equal(out.provider, 'azure-speech-fc')

  // Dropped, but described — "a 37-character string was here" is usually as
  // diagnostic as the string and always safe.
  assert.equal(out.transcript, '[string:37]')
  assert.equal(out.attendees, '[array:1]')
  assert.equal(out.client, '[object:1]')
})

test('an address is content even when it is identifier-shaped', () => {
  assert.equal(redactDetail({ who: 'a.b@c.fr' }).who, '[string:8]')
  assert.equal(redactDetail({ who: 'azure-speech' }).who, 'azure-speech')
})

test('an unknown key added by a future module is dropped, not kept', () => {
  // The rule is an allowlist on purpose: a denylist would have to anticipate
  // every field a module invents, and it would be wrong by omission.
  const out = redactDetail({ someFieldNobodyHasWrittenYet: 'un client a dit quelque chose' })
  assert.equal(out.someFieldNobodyHasWrittenYet, '[string:29]')
})

test('messages lose addresses, URLs and quoted runs, and are capped', () => {
  assert.equal(redactMessage('contact bob@example.fr now'), 'contact [email] now')
  assert.equal(redactMessage('see https://x.fr/a?b=c please'), 'see [url] please')
  assert.equal(redactMessage('rejected "un extrait de conversation"'), 'rejected [quoted]')
  // Prose, not `'x'.repeat(500)`: five hundred unbroken characters are a
  // credential by `OPAQUE_RUN`'s reading and come back as `[secret]`, which is
  // correct and measures nothing about the cap.
  assert.equal(redactMessage('le modèle a refusé la réponse '.repeat(40)).length, 240)
})

test('a path is stripped on both platforms, UNC included', () => {
  /*
   * The Windows share is the one that matters most, on the primary platform
   * (HR-2): `\\SRV-PARIS\partage\clients\Neovia.xlsx` names the client in the
   * share and the site in the server, and it is what an error carries when a rep
   * opens a document from a network drive. The drive-letter alternative could
   * never match it — a UNC path has no `X:` — while the docblock said paths were
   * stripped.
   */
  for (const [input, expected] of [
    ['ouverture de \\\\SRV-PARIS\\partage\\clients\\Neovia.xlsx impossible', 'ouverture de [chemin] impossible'],
    ['C:\\Users\\Jean.Dupont\\notes.docx', '[chemin]'],
    ['/Users/jean/notes.md', '[chemin]'],
    ['~/Documents/offre.pdf', '[chemin]'],
  ] as const) {
    assert.equal(redactMessage(input), expected)
  }
  // And a sentence with no path is untouched — this is a denylist, and one that
  // eats ordinary French would make the bundle unreadable.
  assert.equal(redactMessage('le modèle a refusé la réponse'), 'le modèle a refusé la réponse')
})

test('the meeting id survives — it says which call, not who was on it', () => {
  assert.equal(redactDiagEvent(leaky).meetingId, 'm-42')
})

test('the full bundle keeps everything, and says which mode it is', () => {
  const redacted = buildDiagBundle('redacted', [leaky], environment, 2000)
  const full = buildDiagBundle('full', [leaky], environment, 2000)

  assert.equal(redacted.mode, 'redacted')
  assert.deepEqual(full.events, [leaky])
  assert.notDeepEqual(redacted.events, full.events)
  assert.deepEqual(redacted.environment, environment)
})

test('redaction is pure — the input event is not mutated', () => {
  const before = serialised(leaky)
  redactDiagEvent(leaky)
  buildDiagBundle('redacted', [leaky], environment, 2000)
  assert.equal(serialised(leaky), before)
})

test('the allowlist refuses the shapes it exists to catch', () => {
  /*
   * **The file above claims this « cannot be wrong by omission », and at
   * `{1,64}` it passed, verbatim, exactly what it was written to stop.**
   *
   * A key, a bearer token, a URL and a home directory are all « identifier-
   * shaped with no spaces », and every one went straight into the bundle whose
   * own button reads « Sans contenu de conversation. Peut être envoyé au
   * support. » Nothing leaked — no shipped `detail:` payload carries a secret —
   * but the stated property was false, and it failed *toward* shipping one.
   */
  const out = redactDetail({
    apiKey: 'sk-proj-AbCdEf0123456789AbCdEf0123456789',
    bearer: 'Bearer_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    url: 'https://vsa.client.fr/v1/crm/tasks/7f3a-secret-token',
    posix: '/Users/jean.dupont/sillage.db',
    windows: 'C:\\Users\\jean.dupont\\sillage.db',
    home: '~/Library/Sillage/sillage.db',
  })
  for (const [key, value] of Object.entries(out)) {
    assert.match(String(value), /^\[string:\d+\]$/, `${key} est passé en clair`)
  }
})

test('and still admits everything a diagnostic actually carries', () => {
  // There is no cap on the value any more — thirty-two was the length of an
  // Azure key, which is the whole reason it went. The bound is per *segment*,
  // and « the whole vocabulary » below is what keeps it from being tightened
  // into a bundle of `[string:13]`.
  assert.deepEqual(
    redactDetail({
      meetingId: 'evt-606ec6e9bd8a8ff2',
      model: 'Xenova/whisper-small',
      provider: 'local-whisper',
      channel: 'far',
      at: '2026-09-11T08:15:00.000Z',
      version: '0.1.4',
      retryable: true,
      attempts: 3,
    }),
    {
      meetingId: 'evt-606ec6e9bd8a8ff2',
      model: 'Xenova/whisper-small',
      provider: 'local-whisper',
      channel: 'far',
      at: '2026-09-11T08:15:00.000Z',
      version: '0.1.4',
      retryable: true,
      attempts: 3,
    },
  )
})

/**
 * **The bundle's button says « Peut être envoyé au support », and the message
 * half was a denylist.**
 *
 * `redactDetail` is a genuine allowlist and is airtight. `redactMessage` is the
 * other half, and it stripped emails, URLs and quoted runs — so a Windows home
 * directory, which names the rep, went through untouched under a docblock
 * claiming the opposite: « `redactMessage` has always stripped both from the
 * *message* », of a URL and a path.
 */
test('a filesystem path never reaches the bundle', () => {
  assert.equal(
    redactMessage('échec vers C:\\Users\\Jean-Pierre.Dupont\\AppData\\Roaming\\Sillage\\vault.db'),
    'échec vers [chemin]',
  )
  assert.equal(redactMessage('lecture de /Users/jdupont/Library/Sillage/db'), 'lecture de [chemin]')
  assert.equal(redactMessage('modèle absent de ~/.cache/sillage/whisper'), 'modèle absent de [chemin]')

  // And what is not a path stays legible: a support reader needs the sentence.
  assert.equal(redactMessage('2 connecteurs en défaut'), '2 connecteurs en défaut')
  assert.equal(
    redactMessage('transcription indisponible: modèle Xenova/whisper-small absent'),
    'transcription indisponible: modèle Xenova/whisper-small absent',
  )
  // A version, a ratio and a time of day are not paths either.
  assert.equal(redactMessage('v0.1.4 · 3/4 · 14:30'), 'v0.1.4 · 3/4 · 14:30')
})

/*
 * ===========================================================================
 * The third round on this file, and the reason the tests above could not see
 * any of it.
 *
 * Every fixture above was written by hand to exercise the rule being added.
 * None of them was a string this product actually emits — so the suite proved
 * that `redactMessage` removes a path *shaped the way the test wrote one*, and
 * never asked what the forty-odd real `message:` call sites under `electron/`
 * put in front of it. The four defects below were all found by running the
 * shipped function over that corpus instead, and three of them are in strings
 * the previous two rounds' own tests walked straight past.
 *
 * So the corpus is the unit of test now. `REAL_MESSAGES` is filled from the
 * call sites, named by the `code:` each one carries, with the runtime value that
 * call site actually receives.
 * ===========================================================================
 */

/** What must never survive: the client, the rep, the credential. */
const IDENTITIES = ['Néovia Santé', 'Neovia', 'Sodexial', 'Jean-Pierre Dupont', 'Camille Leroy']
const CREDENTIALS = [
  'sk-proj-AbCdEf0123456789AbCdEf0123456789',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  'AIzaSyD-1234567890abcdefghijklmnopqrstu',
  '0123456789abcdef0123456789abcdef',
  '1234567890abcdef1234567890abcdef12345678',
]

test('a credential never survives a message — five providers, five real bodies', () => {
  /*
   * **`redactMessage` removed the URL and left the key sitting next to it.**
   *
   * Every provider here puts the rejected key in its error body, and three call
   * sites interpolate a remote body into a `message:` verbatim:
   * `OpenAiCompatibleLlm.ts:323` (`clé API du modèle refusée — ${detail}`),
   * `crm/vsa/http.ts`'s `messageOf`, which returns VerySwing's own string, and
   * `main.ts:422`, which records any `err.message` at all. Measured against the
   * shipped function, all five passed through unchanged — into the bundle whose
   * button reads « Sans contenu de conversation. Peut être envoyé au support. »
   *
   * The sentence has to survive: a support reader needs « une clé a été
   * refusée », and `[url]` alone said the opposite of that.
   */
  for (const [input, expected] of [
    [
      'clé API du modèle refusée — Incorrect API key provided: sk-proj-AbCdEf0123456789AbCdEf0123456789',
      'clé API du modèle refusée — Incorrect API key provided: sk-proj-[secret]',
    ],
    [
      'Authorization header invalid: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'Authorization header invalid: [secret]',
    ],
    ['API key not valid: AIzaSyD-1234567890abcdefghijklmnopqrstu', 'API key not valid: AIzaSyD-[secret]'],
    [
      'Access denied due to invalid subscription key: 0123456789abcdef0123456789abcdef',
      'Access denied due to invalid subscription key: [secret]',
    ],
    [
      'POST https://vsa.client.fr/v1/crm/tasks refusé — Ocp-Apim-Subscription-Key 0123456789abcdef0123456789abcdef',
      'POST [url] refusé — Ocp-Apim-Subscription-Key [secret]',
    ],
    ['Deepgram rejected token 1234567890abcdef1234567890abcdef12345678', 'Deepgram rejected token [secret]'],
  ] as const) {
    assert.equal(redactMessage(input), expected)
  }

  // And the run rule does not eat what a diagnostic is for. `evt-…` is twenty
  // characters and is the one thing in the bundle that says *which* call broke.
  for (const kept of [
    'réunion evt-606ec6e9bd8a8ff2 remise en attente',
    'transcription indisponible: modèle Xenova/whisper-small absent',
    'transcription reprise par azure-fr après l’échec de local-whisper',
    'version 0.1.4 prête à installer',
    '12 passage(s) du client repris sur le micro du commercial',
    'v0.1.4 · 3/4 · 14:30',
  ]) {
    assert.equal(redactMessage(kept), kept)
  }
})

test('a path loses its tail, not its head — the client’s document is the tail', () => {
  /*
   * **The rule removed the wrong half, and its own comment said so backwards.**
   *
   * `PATH` was greedy to the first whitespace under a comment claiming that « a
   * path with a space in it loses its tail rather than its head, which still
   * removes the part that names a person ». Measured, on the primary platform
   * (HR-2):
   *
   *     in   échec vers C:\Users\Jean-Pierre.Dupont\…\Appel d’offres Néovia.docx
   *     out  échec vers [chemin] d’offres Néovia.docx
   *
   * The rep's home directory went; the client's appel d'offres, by name, stayed.
   * The round that added path stripping tested only paths with no spaces in
   * them, which is every path a test author invents and no path a French rep
   * opens from a share.
   */
  for (const [input, expected] of [
    [
      'échec vers C:\\Users\\Jean-Pierre.Dupont\\Documents\\Appel d’offres Néovia.docx',
      'échec vers [chemin]',
    ],
    ['lecture de /Users/jean.dupont/Documents/Offre Sodexial.pdf', 'lecture de [chemin]'],
    ['modèle absent de ~/Documents/Néovia Santé/notes.md', 'modèle absent de [chemin]'],
    // `capture.file.opened` is `${source.path} — …` and a source path is
    // relative, so no anchor above could see it: it went through whole.
    [
      'enregistrements/neovia-sante-comite.wav — 312.4 s à 16000 Hz',
      '[chemin] — 312.4 s à 16000 Hz',
    ],
    ['écriture de dossiers/Néovia Santé/vault.db impossible', 'écriture de [chemin] impossible'],
    // `\w` is `[A-Za-z0-9_]`, so the `/` after `é` used to read as the start of
    // an absolute path: the tail matched alone and the head stayed standing.
    ['ouverture de Néovia Santé/vault.db impossible', 'ouverture de Néovia [chemin] impossible'],
  ] as const) {
    assert.equal(redactMessage(input), expected)
  }

  // The sentence after the filename is not a path and has to stay legible.
  assert.equal(
    redactMessage('ouverture de \\\\SRV-PARIS\\partage\\clients\\Neovia.xlsx impossible'),
    'ouverture de [chemin] impossible',
  )
  // A ratio, a version and a vendor-qualified model id are not relative paths.
  for (const kept of ['v0.1.4 · 3/4 · 14:30', 'modèle Xenova/whisper-small absent']) {
    assert.equal(redactMessage(kept), kept)
  }
})

test('a quotation is paired with itself, and there is no minimum', () => {
  /*
   * **One character class for both delimiters meant the rule ate the gaps and
   * kept the contents.** `llm.schema.rejected` interpolates Zod's issue
   * messages, and those quote the value they refused:
   *
   *     in   Expected 'esn' | 'libre', received 'Néovia Santé'
   *     out  Expected 'esn' | 'libre[quoted]Néovia Santé'
   *
   * `', received '` is twelve characters and matched the eight-character
   * minimum; the client's name — the only thing in that sentence worth
   * removing — was left in the open. The minimum was the other half of it:
   * `« Neovia »` is ten and went, `« Acme »` is six and stayed, on
   * `crm.referential.fallback`, which is `« ${choice.label} »`.
   */
  assert.equal(
    redactMessage('réponse non conforme — client: Expected \'esn\' | \'libre\', received \'Néovia Santé\''),
    'réponse non conforme — client: Expected [quoted] | [quoted], received [quoted]',
  )
  assert.equal(redactMessage('valeur par défaut retenue : « Acme »'), 'valeur par défaut retenue : [quoted]')
  assert.equal(redactMessage('référentiel « Sodexial » indisponible'), 'référentiel [quoted] indisponible')
  // U+2019 is not a delimiter: `check:french` enforces it as *the* apostrophe in
  // every string this product writes, so pairing on it would eat the elision.
  assert.equal(
    redactMessage('l’échec de l’appel n’a pas été signalé'),
    'l’échec de l’appel n’a pas été signalé',
  )
})

test('the corpus of real messages carries no identity and no credential', () => {
  /*
   * The whole point of the block above: not a rule at a time, but every real
   * call site at once. A new `message:` template that interpolates something it
   * should not is caught here rather than in a review round.
   *
   * The three entries marked « call site » are the residual, and they are named
   * rather than hidden — see the docblock in `redactDiagnostics.ts`: a denylist
   * over free-form French cannot remove a capitalised word that a call site
   * chose to put there, so those three have to be fixed where they are written.
   */
  const REAL_MESSAGES = [
    // main.ts:1447 — session.bleed
    '12 passage(s) du client repris sur le micro du commercial — enceintes ouvertes',
    // main.ts:1495 — lexicon.learned. The worked example: a count, not a name.
    '4 terme(s) appris pour un client',
    // main.ts:2114 / 2172 / 2185
    '3 envoi(s) interrompus par un arrêt de l’application — à vérifier dans l’outil distant',
    // Outbox.ts:284 / 319 / 339
    'connecteur non configuré',
    'intention envoyée',
    // VsaCrm.ts:441 / referentials.ts:235
    'valeur par défaut retenue : « Néovia Santé SAS »',
    'référentiel « Sodexial » indisponible',
    // VsaCrm.ts:431 / 540
    'référentiels VerySwing indisponibles — compte rendu non poussé',
    'aucun compte résolu — compte rendu rattaché au contact libre',
    // Outbox.ts:339 ← VsaError.message ← http.ts messageOf: VerySwing's own body
    'Le tiers « Néovia Santé » est inconnu du référentiel',
    // capture/index.ts:242 / 403 / 568
    'niveau d’entrée trop faible pour être transcrit (crête 0.0031)',
    'micro ouvert à 8000 Hz — lien bande étroite (HFP)',
    'la sortie audio par défaut a changé pendant que la capture système était ouverte',
    // transcribe/index.ts:269, LocalWhisperSession.ts:234 / 377
    'transcription reprise par azure-fr après l’échec de local-whisper',
    'téléchargement du modèle local 42%',
    'fin de réunion: 3 segment(s) non transcrits après 20000 ms',
    // AutoUpdate.ts:276 / 430
    'version 0.1.4 disponible',
    'installation de la version 0.1.4',
    // extract/errors.ts — every one of the four, verbatim
    'Le modèle n’a pas répondu. Le compte-rendu n’a pas été généré.',
    'Rien n’a été transcrit pendant cette réunion.',
    // llm.schema.rejected with Zod quoting the value it refused
    'réponse du modèle non conforme au format attendu — client: Expected \'esn\', received \'Néovia Santé\'',
    // llm auth / quota bodies
    'clé API du modèle refusée — Incorrect API key provided: sk-proj-AbCdEf0123456789AbCdEf0123456789',
    'Authorization header invalid: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    // FileCapture.ts:161, both spellings a source path takes
    'enregistrements/neovia-sante-comite.wav — 312.4 s à 16000 Hz',
    '/Users/jean.dupont/Sillage/neovia.wav — 312.4 s à 16000 Hz',
    // paths from a vault / model / share failure
    'échec vers C:\\Users\\Jean-Pierre.Dupont\\AppData\\Roaming\\Sillage\\vault.db',
    'ouverture de \\\\SRV-PARIS\\partage\\clients\\Neovia.xlsx impossible',
    'modèle absent de ~/Documents/Néovia Santé/notes.md',
    // MsalIdentity.ts:150, main.ts:1119 / 2365
    'connexion Microsoft réussie',
    'coffre-fort système indisponible — les clés seront oubliées à la fermeture',
    'application démarrée',
  ]

  for (const message of REAL_MESSAGES) {
    const out = redactMessage(message)
    for (const secret of [...IDENTITIES, ...CREDENTIALS]) {
      assert.ok(!out.includes(secret), `« ${secret} » a survécu à : ${out}`)
    }
  }
})

test('the detail allowlist refuses a credential at every length, not at a number', () => {
  /*
   * **Twice now the cap has been one character wide of a real key.** Sixty-four
   * passed an OpenAI key (40) and a bearer token (44). Thirty-two — chosen
   * because it sits above an ISO timestamp (24) and below a key — is *exactly*
   * the length of an Azure Speech key and of a Deepgram key's first half, so
   * these two went in verbatim:
   *
   *     '0123456789abcdef0123456789abcdef'   (32)
   *     'AIzaSyD-1234567890abcdefghijklmn'   (32)
   *
   * The interval a single number needed did not exist. So the bound moved onto
   * the *segment*, and this test sweeps **every length** rather than probing one:
   * a boundary error is not a thing that can be one over when all of them are
   * asserted. If a future round loosens the grammar, the length it loosens by
   * fails here.
   */
  const ALPHABETS = {
    hexLower: '0123456789abcdef',
    hexUpper: '0123456789ABCDEF',
    base64: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/',
    base64url: 'AbCdEf-_0123456789GhIjKlMnOpQrStUvWxYz',
    mixedAlnum: 'aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV',
  }
  for (const [name, alphabet] of Object.entries(ALPHABETS)) {
    for (let length = 21; length <= 64; length++) {
      const value = Array.from({ length }, (_, i) => alphabet[i % alphabet.length]).join('')
      assert.equal(
        redactDetail({ k: value }).k,
        `[string:${length}]`,
        `${name} de ${length} caractères est passé en clair`,
      )
    }
  }

  // The five shapes as they actually arrive, at their real lengths.
  for (const credential of CREDENTIALS) {
    assert.equal(redactDetail({ k: credential }).k, `[string:${credential.length}]`)
  }
  // And a credential is refused *below* the segment bound too, because it mixes
  // case and digits inside one piece — which is none of the four shapes at any
  // length. The old rule kept this one at sixteen characters.
  assert.equal(redactDetail({ k: 'AbCdEf0123456789' }).k, '[string:16]')
})

test('the detail allowlist still admits the whole vocabulary — grepped, not invented', () => {
  /*
   * Every value below is a real `detail:` payload from `electron/`. A grammar is
   * only safe if it is also useful: the round that cut the cap to thirty-two
   * warned that « loosening it is how the previous version became useless », and
   * tightening it has the same failure in the other direction — a bundle of
   * `[string:13]` diagnoses nothing.
   */
  const vocabulary = {
    channel: 'far', // capture/index.ts:246
    provider: 'local-whisper', // registry.ts:28
    to: 'azure-fr', // transcribe/index.ts:270
    from: 'groq-whisper',
    model: 'Xenova/whisper-small', // LocalWhisperSession.ts:353 — vendor/name
    meetingId: 'evt-606ec6e9bd8a8ff2', // Outbox.ts:427
    intentId: 'man-m1a2b3c4-550e8400', // register.ts:418
    requestId: '550e8400-e29b-41d4-a716-446655440000', // randomUUID, minted here
    kind: 'crm.opportunity', // push.ts
    linkType: 'OPPY', // VsaCrm.ts:283 — all-caps, a VSA literal
    recipe: 'besoin-commercial', // recipes.ts:138
    state: 'recording', // Agenda.ts:328
    command: 'pushSettled', // MeetingSession.ts:248 — camelCase
    referential: 'taskStatuses', // referentials.ts:236
    version: '0.1.4', // AutoUpdate.ts:277
    at: '2026-09-11T08:15:00.000Z',
  }
  assert.deepEqual(redactDetail(vocabulary), vocabulary)
})

test('a lone proper noun is not an identifier, whatever its shape', () => {
  /*
   * **The allowlist half has leaked too, and this is how.** `Agenda.ts:359`
   * records `detail: { subject: event.context.subject }`, and a meeting's objet
   * opens on the client's own name almost every time — very often as the whole
   * of it: « Sodexial », « Neovia ». Those are ASCII, unspaced and eight
   * characters, so every version of this allowlist kept them in full, under
   * CLAUDE.md's own rule that a client's name « belongs in `detail`, where the
   * allowlist answers `[string:50]` ». It answered `Sodexial`.
   *
   * A capitalised word standing alone is a proper noun until it is part of a
   * structured identifier, which is the difference between `Sodexial` and
   * `Xenova/whisper-small`. The cost is stated rather than hidden:
   * `main.ts:423` records `err.name`, so `TypeError` is now `[string:9]` while
   * the `code` still says `app.uncaughtException`.
   */
  for (const name of ['Sodexial', 'Neovia', 'Acme', 'NeoviaSante']) {
    assert.equal(redactDetail({ subject: name }).subject, `[string:${name.length}]`)
  }
  assert.equal(redactDetail({ name: 'TypeError' }).name, '[string:9]')
  // Beside another segment it is an identifier again, and model ids need it.
  assert.equal(redactDetail({ model: 'Xenova/whisper-small' }).model, 'Xenova/whisper-small')
})

test('a path in detail is refused by the grammar, not by an anchor', () => {
  /*
   * The previous round guarded this with a `LOCATOR` test for `://`, a leading
   * `/` or `~`, and `X:`. A *relative* path matches none of those and every one
   * of its segments is an ordinary word, so `Users/jean.dupont/sillage.db` was
   * kept in full. What refuses it now is that a model id is `vendor/name` and
   * has one slash; a path has more.
   */
  for (const locator of [
    'Users/jean.dupont/sillage.db',
    'dossiers/Néovia/vault.db',
    '/Users/jean.dupont/sillage.db',
    'C:\\Users\\jean.dupont\\sillage.db',
    '\\\\SRV-PARIS\\partage\\Neovia.xlsx',
    '~/Library/Sillage/sillage.db',
    'https://vsa.client.fr/v1/crm/tasks',
    'camille.leroy@acme-industries.fr',
  ]) {
    assert.match(String(redactDetail({ k: locator }).k), /^\[string:\d+\]$/, locator)
  }
})
