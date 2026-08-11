/**
 * The adapter, with no network.
 *
 * What is worth pinning here is not the request shape — that is a JSON blob and
 * a typo in it fails loudly on the first real call. It is the failure
 * behaviours: that a reply which does not match the caller's schema **throws**
 * rather than returning an empty object, that a 401 is not retryable and a 5xx
 * is, and that a timeout is told apart from the rep cancelling.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { LlmError, LlmSchemaError } from '../../../core/contracts/llm.ts'
import { OpenAiCompatibleLlm, contentOf, jsonText } from '../OpenAiCompatibleLlm.ts'
import type { FetchLike } from '../OpenAiCompatibleLlm.ts'
import type { LlmEndpointConfig } from '../config.ts'

const ENDPOINT: LlmEndpointConfig = {
  providerId: 'local-openai',
  chatUrl: 'http://127.0.0.1:11434/v1/chat/completions',
  model: 'mistral-small',
}

/** A server that answers once, with whatever is given. */
const serve = (
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): { fetch: FetchLike; calls: { url: string; body: unknown }[] } => {
  const calls: { url: string; body: unknown }[] = []
  const fetch: FetchLike = async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body) })
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: { get: () => null },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }
  }
  return { fetch, calls }
}

const reply = (content: string): unknown => ({ choices: [{ message: { content } }] })

const SCHEMA = z.strictObject({ tjm: z.number(), devise: z.string() })

test('complete returns the trimmed reply', async () => {
  const { fetch, calls } = serve(reply('  TJM 520 €  '))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  assert.equal(await llm.complete({ instructions: 'i', input: 'u' }), 'TJM 520 €')
  assert.equal(calls[0]?.url, ENDPOINT.chatUrl)
  assert.equal((calls[0]?.body as { model?: string }).model, 'mistral-small')
})

test('a local server with no key is never sent an empty bearer', async () => {
  let headers: Record<string, string> = {}
  const fetch: FetchLike = async (_url, request) => {
    headers = request.headers
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(reply('ok')) }
  }
  await new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch }).complete({ instructions: 'i', input: 'u' })
  assert.equal(headers.Authorization, undefined)
})

test('structured validates against the caller schema and returns the parsed value', async () => {
  const { fetch } = serve(reply('{"tjm":520,"devise":"EUR"}'))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  const result = await llm.structured({ instructions: 'i', input: 'u', schema: SCHEMA })
  assert.deepEqual(result, { tjm: 520, devise: 'EUR' })
})

test('a fenced JSON reply is still validated, not rejected for its wrapper', async () => {
  const { fetch } = serve(reply('Voici:\n```json\n{"tjm":480,"devise":"EUR"}\n```\n'))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  assert.deepEqual(await llm.structured({ instructions: 'i', input: 'u', schema: SCHEMA }), {
    tjm: 480,
    devise: 'EUR',
  })
})

test('a reply that fails the schema throws, and never returns an empty object', async () => {
  const { fetch } = serve(reply('{"tjm":"cinq cents","devise":"EUR"}'))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  const error = await llm
    .structured({ instructions: 'i', input: 'u', schema: SCHEMA })
    .then(() => null, (e: unknown) => e)
  assert.ok(error instanceof LlmSchemaError, 'a typed error, not a silent fallback')
  assert.equal(error instanceof LlmSchemaError ? error.kind : '', 'schema')
  // The path is named, because the likeliest cause is a field DEC-7 forbids.
  assert.match(error instanceof LlmSchemaError ? error.issues.join(' ') : '', /tjm/)
  assert.match(error instanceof LlmSchemaError ? error.raw : '', /cinq cents/)
})

test('an invented field fails validation — DEC-7 depends on this', async () => {
  const { fetch } = serve(reply('{"tjm":520,"devise":"EUR","emailClient":"a@b.fr"}'))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  await assert.rejects(
    llm.structured({ instructions: 'i', input: 'u', schema: SCHEMA }),
    (e: unknown) => e instanceof LlmSchemaError,
  )
})

test('prose where JSON was asked for is an error carrying the prose', async () => {
  const { fetch } = serve(reply('Je ne peux pas répondre.'))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  const error = await llm
    .structured({ instructions: 'i', input: 'u', schema: SCHEMA })
    .then(() => null, (e: unknown) => e)
  assert.ok(error instanceof LlmSchemaError)
  assert.match(error instanceof LlmSchemaError ? error.raw : '', /Je ne peux pas/)
})

test('truncated JSON is an error, not a half-filled compte-rendu', async () => {
  const { fetch } = serve(reply('{"tjm":520,"devise":"EU'))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  await assert.rejects(
    llm.structured({ instructions: 'i', input: 'u', schema: SCHEMA }),
    (e: unknown) => e instanceof LlmSchemaError,
  )
})

test('without native schema binding the prompt asks for JSON and no schema is sent', async () => {
  const { fetch, calls } = serve(reply('{"tjm":1,"devise":"EUR"}'))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch, structuredOutput: false })
  await llm.structured({ instructions: 'Résume.', input: 'u', schema: SCHEMA })
  const body = calls[0]?.body as { response_format?: { type?: string }; messages?: { content: string }[] }
  assert.equal(body.response_format?.type, 'json_object')
  assert.match(body.messages?.[0]?.content ?? '', /JSON/)
})

test('with native schema binding the schema is sent and the prompt is left alone', async () => {
  const { fetch, calls } = serve(reply('{"tjm":1,"devise":"EUR"}'))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch, structuredOutput: true })
  await llm.structured({ instructions: 'Résume.', input: 'u', schema: SCHEMA, schemaName: 'esn' })
  const body = calls[0]?.body as {
    response_format?: { type?: string; json_schema?: { name?: string; schema?: unknown } }
    messages?: { content: string }[]
  }
  assert.equal(body.response_format?.type, 'json_schema')
  assert.equal(body.response_format?.json_schema?.name, 'esn')
  assert.ok(body.response_format?.json_schema?.schema)
  assert.equal(body.messages?.[0]?.content, 'Résume.')
})

test('a server that promised schema enforcement is still revalidated', async () => {
  const { fetch } = serve(reply('{"tjm":"nope","devise":"EUR"}'))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch, structuredOutput: true })
  await assert.rejects(
    llm.structured({ instructions: 'i', input: 'u', schema: SCHEMA }),
    (e: unknown) => e instanceof LlmSchemaError,
  )
})

test('401 is an auth failure and is not retryable', async () => {
  const { fetch } = serve({ error: { message: 'Invalid API key' } }, { ok: false, status: 401 })
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  const error = await llm.complete({ instructions: 'i', input: 'u' }).then(() => null, (e: unknown) => e)
  assert.ok(error instanceof LlmError)
  assert.equal(error instanceof LlmError ? error.kind : '', 'auth')
  assert.equal(error instanceof LlmError ? error.retryable : true, false)
})

test('429 and 5xx are retryable', async () => {
  for (const [status, kind] of [
    [429, 'quota'],
    [503, 'server'],
  ] as const) {
    const { fetch } = serve({}, { ok: false, status })
    const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
    const error = await llm.complete({ instructions: 'i', input: 'u' }).then(() => null, (e: unknown) => e)
    assert.ok(error instanceof LlmError, String(status))
    assert.equal(error instanceof LlmError ? error.kind : '', kind)
    assert.equal(error instanceof LlmError ? error.retryable : false, true)
  }
})

test('a 404 on the model name is not retryable — the request caused it', async () => {
  const { fetch } = serve({ error: { message: 'model not found' } }, { ok: false, status: 404 })
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  const error = await llm.complete({ instructions: 'i', input: 'u' }).then(() => null, (e: unknown) => e)
  assert.equal(error instanceof LlmError ? error.retryable : true, false)
  assert.match(error instanceof Error ? error.message : '', /model not found/)
})

test('a dead server is a network failure, and is retryable', async () => {
  const fetch: FetchLike = async () => {
    throw new Error('ECONNREFUSED')
  }
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  const error = await llm.complete({ instructions: 'i', input: 'u' }).then(() => null, (e: unknown) => e)
  assert.equal(error instanceof LlmError ? error.kind : '', 'network')
  assert.equal(error instanceof LlmError ? error.retryable : false, true)
})

test('a provider that never answers times out rather than holding the rail', async () => {
  const fetch: FetchLike = (_url, request) =>
    new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  const error = await llm
    .complete({ instructions: 'i', input: 'u', timeoutMs: 10 })
    .then(() => null, (e: unknown) => e)
  assert.ok(error instanceof LlmError)
  assert.equal(error instanceof LlmError ? error.kind : '', 'timeout')
  assert.equal(error instanceof LlmError ? error.retryable : false, true)
})

test('the rep cancelling is not reported as a provider failure', async () => {
  const controller = new AbortController()
  const fetch: FetchLike = (_url, request) =>
    new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => reject(new Error('aborted by caller')))
    })
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  const pending = llm
    .complete({ instructions: 'i', input: 'u', signal: controller.signal, timeoutMs: 5_000 })
    .then(() => null, (e: unknown) => e)
  controller.abort()
  const error = await pending
  // Rethrown as-is: no `LlmError`, so `llmHealth` never sees it and the rail
  // never shows a degradation the rep caused on purpose.
  assert.ok(error instanceof Error)
  assert.equal(error instanceof LlmError, false)
})

test('an empty reply is an error, not an empty string handed to the rail', async () => {
  const { fetch } = serve(reply(''))
  const llm = new OpenAiCompatibleLlm({ endpoint: ENDPOINT, fetch })
  await assert.rejects(llm.complete({ instructions: 'i', input: 'u' }), (e: unknown) => e instanceof LlmError)
})

test('contentOf tolerates the array-of-parts shape some servers return', () => {
  assert.equal(contentOf(JSON.stringify({ choices: [{ message: { content: 'x' } }] })), 'x')
  assert.equal(
    contentOf(JSON.stringify({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] })),
    'ab',
  )
  assert.equal(contentOf(JSON.stringify({ choices: [] })), '')
})

test('jsonText finds the object, fenced or not, and gives up honestly', () => {
  assert.equal(jsonText('```json\n{"a":1}\n```'), '{"a":1}')
  assert.equal(jsonText('bla {"a":1} bla'), '{"a":1}')
  assert.equal(jsonText('pas de json ici'), null)
})

// ── the Responses dialect, and the ChatGPT endpoint's own rules (DEC-36) ─────
//
// Everything asserted below about the request body was established against the
// live `https://chatgpt.com/backend-api/codex/responses` on 2026-08-07, by
// sending each variant and reading the refusal. They are pinned here because
// they are invisible in review and expensive in production: each one is a 400
// on **every** call, so getting one wrong does not degrade the app, it removes
// the provider — and the error only appears at the end of a meeting, which is
// the one moment there is no second try.

const CHATGPT: LlmEndpointConfig = {
  providerId: 'chatgpt',
  chatUrl: 'https://chatgpt.com/backend-api/codex/responses',
  model: 'gpt-5.6-sol',
  dialect: 'responses',
  apiKey: () => 'grant-token',
  headers: { 'chatgpt-account-id': 'acct-1', originator: 'codex_cli_rs' },
}

/** An SSE body of the shape the endpoint actually streams. */
const sse = (...events: unknown[]): string =>
  events.map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`).join('')

const delta = (text: string) => ({ type: 'response.output_text.delta', delta: text })

test('the Responses body carries store:false and stream:true, and no token ceiling', async () => {
  const { fetch, calls } = serve(sse(delta('Paris')))
  const llm = new OpenAiCompatibleLlm({ endpoint: CHATGPT, fetch })
  assert.equal(await llm.complete({ instructions: 'i', input: 'q', maxOutputTokens: 512 }), 'Paris')

  const body = calls[0]?.body as Record<string, unknown>
  // « Store must be set to false » — and omitting it is a 400, not a default.
  assert.equal(body.store, false)
  // « Stream must be set to true » — the only mode this endpoint serves.
  assert.equal(body.stream, true)
  // « Unsupported parameter: max_output_tokens ». The caller's ceiling is
  // dropped rather than sent, which is the right way round: sending it fails
  // every call, and this endpoint enforces its own limit anyway.
  assert.ok(!('max_output_tokens' in body))
  assert.ok(!('messages' in body), 'the chat dialect’s shape must not leak into this one')
  assert.equal(body.instructions, 'i')
})

test('the grant is resolved per request, so a rotation is picked up without a restart', async () => {
  let token = 'first'
  const seen: string[] = []
  const fetch: FetchLike = async (_url, request) => {
    seen.push(request.headers.Authorization ?? '')
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => sse(delta('ok')) }
  }
  const llm = new OpenAiCompatibleLlm({
    endpoint: { ...CHATGPT, apiKey: () => token },
    fetch,
  })
  await llm.complete({ instructions: 'i', input: 'q' })
  token = 'second'
  await llm.complete({ instructions: 'i', input: 'q' })

  assert.deepEqual(seen, ['Bearer first', 'Bearer second'])
})

test('an expired grant is an auth failure with its own sentence, not an anonymous 401', async () => {
  // The resolver throws because `codex login` has lapsed. Sending the request
  // without an Authorization header would arrive as a 401 that says nothing —
  // and `retryable` would be the same either way, so the only thing lost is the
  // sentence that names the fix.
  const { fetch, calls } = serve(sse(delta('unreachable')))
  const llm = new OpenAiCompatibleLlm({
    endpoint: {
      ...CHATGPT,
      apiKey: () => {
        throw new Error('session ChatGPT expirée le 12/08/2026 — exécutez `codex login`')
      },
    },
    fetch,
  })
  const error = await llm.complete({ instructions: 'i', input: 'q' }).catch((e: unknown) => e)
  assert.ok(error instanceof LlmError)
  assert.equal(error.kind, 'auth')
  assert.equal(error.retryable, false)
  assert.match(error.message, /codex login/)
  assert.equal(calls.length, 0, 'nothing was sent')
})

test('the schema rides in text.format, flat — not nested as the chat dialect nests it', async () => {
  const { fetch, calls } = serve(sse(delta('{"tjm":650,"devise":"EUR"}')))
  const llm = new OpenAiCompatibleLlm({ endpoint: CHATGPT, structuredOutput: true, fetch })
  assert.deepEqual(await llm.structured({ instructions: 'i', input: 'q', schema: SCHEMA }), {
    tjm: 650,
    devise: 'EUR',
  })

  const format = (calls[0]?.body as { text?: { format?: Record<string, unknown> } }).text?.format
  assert.equal(format?.type, 'json_schema')
  // Flat. `{ json_schema: { … } }` is the chat dialect's nesting and is a 400 here.
  assert.equal(format?.name, 'extraction')
  assert.ok(format?.schema, 'the schema itself, not a wrapper around it')
})

test('without native binding the JSON nudge goes in the input, where this endpoint looks', async () => {
  // « Response input messages must contain the word 'json' in some form to use
  // 'text.format' of type 'json_object' » — the endpoint checks the input, not
  // the instructions, so the nudge the chat dialect puts in the system message
  // would be a 400 here rather than a hint.
  const { fetch, calls } = serve(sse(delta('{"tjm":1,"devise":"EUR"}')))
  const llm = new OpenAiCompatibleLlm({ endpoint: CHATGPT, structuredOutput: false, fetch })
  await llm.structured({ instructions: 'i', input: 'le transcript', schema: SCHEMA })

  const body = calls[0]?.body as { input: { content: { text: string }[] }[]; instructions: string }
  assert.match(body.input[0]!.content[0]!.text, /JSON/)
  assert.doesNotMatch(body.instructions, /JSON/)
})

test('a stream that fails mid-flight is an error, not an empty completion', async () => {
  // The failure arrives as an event on a 200 response, so the HTTP status has
  // already said everything is fine. Ignoring it would report « le modèle n'a
  // pas répondu » about a provider that answered with a refusal.
  const { fetch } = serve(sse(delta('partie'), { type: 'response.failed', response: { error: { message: 'quota' } } }))
  const llm = new OpenAiCompatibleLlm({ endpoint: CHATGPT, fetch })
  const error = await llm.complete({ instructions: 'i', input: 'q' }).catch((e: unknown) => e)
  assert.ok(error instanceof LlmError)
  assert.match(error.message, /quota/)
})

test('the terminal event is read when a gateway sends no deltas at all', async () => {
  const { fetch } = serve(
    sse({
      type: 'response.completed',
      response: { output: [{ content: [{ type: 'output_text', text: 'Paris' }] }] },
    }),
  )
  const llm = new OpenAiCompatibleLlm({ endpoint: CHATGPT, fetch })
  assert.equal(await llm.complete({ instructions: 'i', input: 'q' }), 'Paris')
})

test('a Responses endpoint answering with one object is read too', async () => {
  // `stream: false` is refused by the ChatGPT endpoint but is the normal mode
  // of the Responses API itself. A parser that only handled what we currently
  // ask for would break the moment this dialect met `api.openai.com`.
  const { fetch } = serve({ output: [{ content: [{ type: 'output_text', text: 'Paris' }] }] })
  const llm = new OpenAiCompatibleLlm({ endpoint: CHATGPT, fetch })
  assert.equal(await llm.complete({ instructions: 'i', input: 'q' }), 'Paris')
})

test('the endpoint’s own words survive a 400 — `detail`, not just `error.message`', async () => {
  // « The 'gpt-5' model is not supported when using Codex with a ChatGPT
  // account » is a complete diagnosis and a complete fix. Reducing it to « le
  // fournisseur de modèle a répondu 400 » is how a wrong model name becomes an
  // afternoon.
  const { fetch } = serve(
    { detail: "The 'gpt-5' model is not supported when using Codex with a ChatGPT account." },
    { ok: false, status: 400 },
  )
  const llm = new OpenAiCompatibleLlm({ endpoint: CHATGPT, fetch })
  const error = await llm.complete({ instructions: 'i', input: 'q' }).catch((e: unknown) => e)
  assert.ok(error instanceof LlmError)
  assert.match(error.message, /not supported when using Codex/)
  assert.equal(error.retryable, false)
})
