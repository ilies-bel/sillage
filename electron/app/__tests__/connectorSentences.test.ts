/**
 * **The sentence a rep reads is ours, and a remote's own words never replace it.**
 *
 * Four connectors map a failure to a `ConnectorHealth.reason`, and that string is
 * rendered verbatim on the four surfaces a rep actually reads: the onboarding's
 * health rows (`Onboarding.tsx`), Réglages' *Requis* / *Optionnel* cards
 * (`Reglages.tsx`), the review gate's « … — sera envoyé dès le rétablissement »
 * line (`Review.tsx`), and `EnhancementNotice`'s « Le compte-rendu n'a pas pu
 * être rédigé : … ». All four weld it into a French sentence.
 *
 * Each mapper's terminal branch returned `error.message` — and for three of the
 * four that string is composed by the *remote*: `messageOf` in both `graph.ts`
 * files reads Microsoft's `error.message` and `vsa/http.ts` reads VerySwing's.
 * So a revoked Entra token put
 *
 *     « Le compte-rendu n'a pas pu être rédigé : Access token has expired or is
 *       not yet valid. »
 *
 * on the screen that explains why the product's one output is missing, and a
 * missing Graph scope put « Insufficient privileges to complete the operation. —
 * sera envoyé dès le rétablissement. » at the confirmation gate. Every one of
 * those adapters is otherwise scrupulously French; the leak was one expression
 * per file, on the branch nobody exercises locally because it needs a real
 * tenant to refuse you.
 *
 * The remote's words are kept — they are the evidence, and « Incorrect API key
 * provided » is precisely what tells a rep which key they pasted — but they
 * follow our clause and never stand as the whole sentence. This test is the
 * check: a reason must open with one of the openings its module declares here,
 * so a new branch fails until somebody writes its French.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { calendarHealth, GraphError as CalendarGraphError } from '../../modules/calendar/index.ts'
import { mailHealth, GraphError as MailGraphError } from '../../modules/mail/index.ts'
import { crmHealth } from '../../modules/crm/index.ts'
import { vsaError } from '../../modules/crm/vsa/http.ts'
import { llmHealth } from '../../modules/llm/index.ts'
import { LlmError } from '../../core/contracts/llm.ts'
import type { ConnectorHealth } from '../../core/contracts/health.ts'

/** Verbatim bodies. Every one of these is a sentence Microsoft, OpenAI or VSA writes. */
const REMOTE = {
  expired: 'Access token has expired or is not yet valid.',
  forbidden: 'Insufficient privileges to complete the operation.',
  badModel: 'The model `gpt-5-turbo` does not exist or you do not have access to it.',
  vsa: 'Unknown column in request',
}

const OPENINGS: Record<string, readonly string[]> = {
  calendrier: ['calendrier', 'accès au calendrier'],
  messagerie: ['messagerie', 'accès à la messagerie', 'brouillon'],
  VerySwing: ['VerySwing', 'session VerySwing', 'connexion VerySwing'],
  modèle: ['modèle de langage', 'réponse du modèle', 'clé API du modèle', 'quota du fournisseur', 'le fournisseur de modèle'],
}

/** `ConnectorHealth` is a union and only two of its arms carry a sentence. */
const reasonOf = (health: ConnectorHealth): string => (health.state === 'ok' ? '' : health.reason)

const opensInFrench = (reason: string, family: keyof typeof OPENINGS): void => {
  const ok = OPENINGS[family]!.some((opening) => reason.startsWith(opening))
  assert.ok(
    ok,
    `« ${reason} » does not open with any declared French clause for ${family}. ` +
      `A rep reads this verbatim on four screens.`,
  )
}

test('a refused Graph request never speaks English at the calendar card', () => {
  for (const [status, message] of [[400, REMOTE.expired], [404, REMOTE.forbidden]] as const) {
    const health = calendarHealth(new CalendarGraphError({ status, message, retryable: false }), 0)
    opensInFrench(reasonOf(health), 'calendrier')
    assert.ok(reasonOf(health).includes(message), 'the remote’s own words are evidence and are kept')
  }
})

test('a refused Graph request never speaks English at the messagerie card', () => {
  for (const [status, message] of [[400, REMOTE.expired], [403, REMOTE.forbidden]] as const) {
    const health = mailHealth(new MailGraphError({ status, message, retryable: false }), 0)
    opensInFrench(reasonOf(health), 'messagerie')
  }
})

test('a refused VerySwing request opens on VerySwing', () => {
  const health = crmHealth(vsaError(400, JSON.stringify({ message: REMOTE.vsa })), 0)
  opensInFrench(reasonOf(health), 'VerySwing')
})

test('a model the server does not have is named in French first', () => {
  const health = llmHealth(new LlmError({ kind: 'unknown', message: REMOTE.badModel, retryable: false }), 0)
  opensInFrench(reasonOf(health), 'modèle')
  assert.ok(reasonOf(health).includes('gpt-5-turbo'), 'the model id is the actionable half and is kept')
})

test('an internal throw is not handed to a rep as a remedy', () => {
  // `Cannot read properties of undefined (reading 'get')` was the whole reason
  // on every card, for every connector, on any unexpected throw.
  const thrown = new TypeError("Cannot read properties of undefined (reading 'get')")
  opensInFrench(reasonOf(calendarHealth(thrown, 0)), 'calendrier')
  opensInFrench(reasonOf(mailHealth(thrown, 0)), 'messagerie')
  opensInFrench(reasonOf(crmHealth(thrown, 0)), 'VerySwing')
  opensInFrench(reasonOf(llmHealth(thrown, 0)), 'modèle')
})
