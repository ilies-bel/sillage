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
  // every field a module invents, and it would be wrong by omission. That holds
  // of the *key*. It does not hold of a lowercase or all-caps **word** as a
  // value — see the grammar's docblock, which no longer claims it does.
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
  /*
   * **And the argument for making ASCII `'` a delimiter was half of one.** « Where
   * it appears it comes from an English library or a JSON echo, and there it is
   * quoting a value » — true of the apostrophe that *opens* a quotation, and false
   * of every other apostrophe in the same sentence, which is a possessive or an
   * elision. See « an apostrophe is not a delimiter, and an odd count changes
   * nothing »: with an odd count this rule published the name it had been given
   * already delimited.
   */
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
   * A capitalised word standing alone is a proper noun. The cost is stated
   * rather than hidden: `main.ts:423` records `err.name`, so `TypeError` is now
   * `[string:9]` while the `code` still says `app.uncaughtException`.
   *
   * **« Until it is part of a structured identifier » is what this used to say,
   * and it was the hole the next round found.** `isSafeString` short-circuited on
   * `segments.length > 1`, so one hyphen was enough — see « a capitalised word is
   * a proper noun wherever it stands » below, which is the same property asserted
   * of the spelling these fields actually take.
   */
  for (const name of ['Sodexial', 'Neovia', 'Acme', 'NeoviaSante']) {
    assert.equal(redactDetail({ subject: name }).subject, `[string:${name.length}]`)
  }
  assert.equal(redactDetail({ name: 'TypeError' }).name, '[string:9]')
  // The vendor half of a model id is the one position that still admits one.
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

/*
 * ===========================================================================
 * The fourth round, and why every one of the twenty tests above stayed green
 * through all three defects it found.
 *
 * They are green *right now*, unchanged, on a file that was publishing a client's
 * name. Each one was written to exercise the rule being added that round, so the
 * corpus grew along one axis at a time:
 *
 *   — every ASCII-apostrophe fixture had an **even** number of apostrophes, and
 *     not one contained a possessive or an elision. `'esn' | 'libre'` is what a
 *     test author writes; `The mailbox's owner rejected 'Jean-Pierre Dupont'` is
 *     what a mail server sends.
 *   — every `redactDetail` proper-noun fixture was a **single word** —
 *     `Sodexial`, `Neovia`, `Acme`, `NeoviaSante` — because the rule under test
 *     that round was about a *lone* segment. A hyphen was never typed, and one
 *     hyphen was all it took: `isSafeString` returned on `segments.length > 1`
 *     before the lone-segment test could run.
 *   — and nothing anywhere asked what happens to a message this product did not
 *     write, because `redactMessage`'s contract did not distinguish them.
 *
 * So the three blocks below are built the other way round: from the shape of the
 * *input* the product actually receives, not from the rule being added.
 * ===========================================================================
 */

/**
 * **Round four, finding one: quoting *published* a name that arrived delimited.**
 *
 * ASCII `'` was made a self-closing delimiter on the argument that product prose
 * never contains one, so where one appears it is quoting a value. The half that
 * was missed is that the *rest* of that sentence is a vendor's English or a Java
 * backend's French — and both are full of apostrophes that quote nothing. With an
 * odd count the pairing ate the gaps, exactly as it had with mismatched
 * delimiters one round earlier, and this time the result was worse than a miss.
 * Measured against the shipped function before the fix:
 *
 *     in   The mailbox's owner rejected recipient 'Jean-Pierre Dupont' for 'Sodexial'
 *     out  The mailbox[quoted]Jean-Pierre Dupont[quoted]Sodexial'
 *
 *     in   l'objet 'Sodexial — comité' n'a pas pu être créé
 *     out  l[quoted]Sodexial — comité[quoted]a pas pu être créé
 *
 * `'Sodexial'` was at least delimited on the way in. On the way out it is bare
 * prose, and the innocent English around it is what went — strictly worse than
 * having no rule. The live path is `modules/crm/vsa/http.ts`'s `messageOf`, which
 * returns VerySwing's body verbatim into `outbox.failed`, and a Java/SQL backend
 * emits ASCII `'`.
 */
test('an apostrophe is not a delimiter, and an odd count changes nothing', () => {
  for (const [input, expected] of [
    [
      "The mailbox's owner rejected recipient 'Jean-Pierre Dupont' for 'Sodexial'",
      "The mailbox's owner rejected recipient [quoted] for [quoted]",
    ],
    ["l'objet 'Sodexial — comité' n'a pas pu être créé", "l'objet [quoted] n'a pas pu être créé"],
    // A quotation whose *content* has apostrophes is taken whole: the run is
    // lazy and closes on the first `'` that is not inside a word.
    ["received 'l'appel d'offres Néovia' invalide", 'received [quoted] invalide'],
    // An elision at the start of a word is never an opener, wherever it sits.
    ["d'Ivoire 'Sodexial' rejeté", "d'Ivoire [quoted] rejeté"],
    // U+2019 still pairs with nothing — `check:french` makes it *the* apostrophe
    // in every string this product writes.
    ['l’échec de l’appel n’a pas été signalé', 'l’échec de l’appel n’a pas été signalé'],
  ] as const) {
    assert.equal(redactMessage(input), expected)
  }

  // The three from earlier rounds, unchanged: the fix must not cost the case the
  // ASCII delimiter was added for.
  assert.equal(
    redactMessage("Expected 'esn' | 'libre', received 'Néovia Santé'"),
    'Expected [quoted] | [quoted], received [quoted]',
  )
  assert.equal(redactMessage('valeur par défaut retenue : « Acme »'), 'valeur par défaut retenue : [quoted]')
  assert.equal(redactMessage('rejected "un extrait de conversation"'), 'rejected [quoted]')
})

/**
 * **Round four, finding two: one hyphen defeated the whole PASCAL rule.**
 *
 * The round before this one refused a lone capitalised word, because `Agenda`
 * records `detail: { subject: event.context.subject }` and a meeting's objet is
 * very often the client's name and nothing else. But `isSafeString` short-
 * circuited — `segments.length > 1 || LONE_SEGMENT.test(…)` — so a value with a
 * separator in it never reached the test at all. Measured on the shipped
 * function before the fix:
 *
 *     'Sodexial'           → [string:8]   (the case the round was written for)
 *     'Sodexial-staffing'  → passes verbatim
 *     'Dupont-Marechal'    → passes verbatim
 *     'CR-Sodexial'        → passes verbatim
 *     'Sodexial-Q3'        → passes verbatim
 *
 * A hyphenated objet and a double-barrelled French surname are how these fields
 * are actually spelled, and the file's docblock said meanwhile that it « cannot
 * be wrong by omission ».
 */
test('a capitalised word is a proper noun wherever it stands, hyphen or not', () => {
  for (const objet of [
    'Sodexial',
    'Sodexial-staffing',
    'Sodexial-Q3',
    'CR-Sodexial',
    'Dupont-Marechal',
    'Néovia-Santé',
    'Neovia_Sante',
    'Comite-Sodexial-2026',
    'JP-Dupont',
  ]) {
    assert.match(
      String(redactDetail({ subject: objet }).subject),
      /^\[string:\d+\]$/,
      `« ${objet} » est passé en clair`,
    )
  }
})

test('and the one capitalised word this product mints still survives', () => {
  /*
   * `Xenova/whisper-small` is a Hugging Face repo id
   * (`core/contracts/models.ts`) and `model:` is the field the memory gate and
   * the download path are diagnosed through. It is admitted by **position** —
   * the vendor half of a one-slash value — and the rest of the value is held to
   * the same grammar as everything else, so the exemption is one capitalised
   * word in one slot and cannot be reached from anywhere else.
   */
  assert.equal(redactDetail({ model: 'Xenova/whisper-small' }).model, 'Xenova/whisper-small')
  assert.equal(
    redactDetail({ model: 'onnx-community/whisper-base' }).model,
    'onnx-community/whisper-base',
  )
  // The vendor slot is not a licence for the rest of the value.
  assert.match(String(redactDetail({ k: 'Sodexial/Comité' }).k), /^\[string:\d+\]$/)
  assert.match(String(redactDetail({ k: 'Xenova/' }).k), /^\[string:\d+\]$/)
  assert.match(String(redactDetail({ k: 'Users/Jean-Pierre/notes.db' }).k), /^\[string:\d+\]$/)
})

test('and the whole detail vocabulary is unchanged by the tightening', () => {
  /*
   * Tightening this grammar has exactly the same failure mode as loosening it,
   * in the other direction: a bundle of `[string:13]` diagnoses nothing. Every
   * value here is a real `detail:` payload, grepped from `electron/`.
   */
  const vocabulary = {
    channel: 'far',
    provider: 'local-whisper',
    from: 'groq-whisper',
    to: 'azure-fr',
    model: 'Xenova/whisper-small',
    meetingId: 'evt-606ec6e9bd8a8ff2',
    intentId: 'man-m1a2b3c4-550e8400',
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    kind: 'crm.opportunity',
    linkType: 'OPPY',
    recipe: 'besoin-commercial',
    state: 'recording',
    command: 'pushSettled',
    referential: 'taskStatuses',
    reason: 'tooQuiet',
    code: 'capture.level.tooQuiet',
    version: '0.1.4',
    at: '2026-09-11T08:15:00.000Z',
  }
  assert.deepEqual(redactDetail(vocabulary), vocabulary)
})

/*
 * ---------------------------------------------------------------------------
 * **Round four, finding three: the message half stops being free-form.**
 *
 * The verdict written into this file after the third round was that a denylist
 * over free-form text cannot be made safe, only made narrower: « Néovia Santé »
 * is an ordinary capitalised French word and no rule separates it from « Windows
 * Defender ». Finding one is that fourth narrowing, and it was the round's
 * *third* attempt at quoting alone.
 *
 * So the narrowing stops and the call site declares. `DiagEvent.origin` is
 * `'foreign'` when the text is not a literal this product wrote, and the bundle
 * carries `[message:N]` for it. `npm run check:diag` is what makes that
 * omission-proof: a `.record({…})` whose `message:` is anything but a string
 * literal must declare, so the fifty-fifth call site fails CI rather than
 * leaking. Forty-eight sites declare today, twenty-six of them `'foreign'`.
 *
 * The destination is **not** `detail`, which the previous round proposed. The
 * grammar there admits identifier shapes, and a word is a shape it cannot refuse:
 * `far`, `rep`, `whisper` and `sodexial` are one thing to it (see the block
 * above, and the docblock, which no longer claims otherwise).
 * ---------------------------------------------------------------------------
 */

/**
 * A foreign message, as five real adapters deliver it — and deliberately five
 * that **no** rule in this file touches. There is no delimiter, no address, no
 * locator and no unbroken run: just a client's name in an English or French
 * sentence somebody else wrote. That is what a denylist over free-form text is,
 * and it is why the narrowing stopped.
 */
const FOREIGN_BODIES = [
  // crm/vsa/http.ts `messageOf` → VsaError.message → Outbox `outbox.failed`.
  'Le tiers Néovia Santé est inconnu du référentiel',
  'Contact Dupont-Marechal not found for account Sodexial',
  // Graph, through OutlookMail's `reason`.
  'Mailbox for Jean-Pierre Dupont at Sodexial is over quota',
  // Zod, through OpenAiCompatibleLlm's issues — no quotes at all this time.
  'client: Expected string, received Néovia Santé at $.interlocuteurs[0]',
  // A native capture error, through capture/index.ts `message(error)` —
  // `native-module/src/microphone.rs:115`, which quotes the requested id and
  // not the list beside it.
  'Input device not found. Available devices: Écouteurs de Jean-Pierre, Casque JP Dupont',
]

const foreignEvent = (message: string): DiagEvent => ({
  id: 'd9',
  ts: 3000,
  severity: 'error',
  code: 'crm.task.failed',
  module: 'crm',
  message,
  origin: 'foreign',
  detail: { retryable: false },
  meetingId: 'm-42',
})

test('a foreign message leaves as its length, and nothing a denylist missed', () => {
  /*
   * Every body below survives `redactMessage` with a name in it — that is the
   * point, and it is asserted rather than assumed, so this test measures the
   * *gap* the declaration closes rather than restating the fix. Two of the five
   * point, and it is asserted rather than assumed — so this test measures the
   * *gap* the declaration closes rather than restating the fix. None of the five
   * has a delimiter, an address, a locator or an unbroken run for any rule in
   * this file to catch.
   */
  const NAMES = ['Jean-Pierre', 'Néovia Santé', 'Dupont-Marechal', 'Sodexial', 'JP Dupont']
  let leakedWithoutTheFlag = 0
  for (const body of FOREIGN_BODIES) {
    const denylisted = redactMessage(body)
    if (NAMES.some((n) => denylisted.includes(n))) leakedWithoutTheFlag++

    const redacted = redactDiagEvent(foreignEvent(body))
    assert.equal(redacted.message, `[message:${body.length}]`)
    assert.equal(redacted.origin, 'foreign')
    for (const name of NAMES) assert.ok(!redacted.message.includes(name))
  }
  // Not « some of them »: the corpus exists because the denylist cannot do this.
  assert.equal(leakedWithoutTheFlag, FOREIGN_BODIES.length)

  // `code`, `detail` and `meetingId` are untouched, which is where the
  // diagnostic actually lives: what failed, whether it may be retried, and on
  // which call. The vendor's sentence is the only thing withheld.
  const one = redactDiagEvent(foreignEvent(FOREIGN_BODIES[0] as string))
  assert.equal(one.code, 'crm.task.failed')
  assert.deepEqual(one.detail, { retryable: false })
  assert.equal(one.meetingId, 'm-42')
})

test('an authored message is still swept, and `full` mode still keeps everything', () => {
  // `origin: 'authored'` is a claim about provenance, not about hygiene: a
  // template this product wrote can still interpolate a path.
  const authored: DiagEvent = {
    ...foreignEvent('enregistrements/neovia-sante-comite.wav — 312.4 s à 16000 Hz'),
    code: 'capture.file.opened',
    origin: 'authored',
  }
  assert.equal(redactDiagEvent(authored).message, '[chemin] — 312.4 s à 16000 Hz')

  // And a row with no `origin` at all — every event stored before the field
  // existed — reads as authored rather than throwing or being withheld.
  const legacy = { ...foreignEvent('2 connecteurs en défaut') }
  delete (legacy as { origin?: unknown }).origin
  assert.equal(redactDiagEvent(legacy).message, '2 connecteurs en défaut')
  assert.equal(redactDiagEvent(legacy).origin, undefined)

  // `full` is the mode that says it carries client content, and it carries it.
  const event = foreignEvent(FOREIGN_BODIES[0] as string)
  assert.deepEqual(buildDiagBundle('full', [event], environment, 4000).events, [event])
})
