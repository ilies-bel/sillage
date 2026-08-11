#!/usr/bin/env node
/**
 * The renderer, served as a URL any browser tool can open.
 *
 *   node scripts/harness/serve.mjs            # :5181, proxying Vite on :5180
 *   open http://localhost:5181/?scenario=agenda
 *
 * `shot.mjs` drives Playwright and can therefore inject the bridge itself.
 * Everything else — impeccable's `detect <url>`, its `live` mode, Chrome
 * DevTools, a human with a browser — can only be handed an address, and the
 * address Vite serves is unusable for two reasons:
 *
 *   1. `window.app` does not exist outside Electron, so every screen renders
 *      its error state. A detector pointed at :5180 scans a spinner and
 *      reports nothing, which is exactly what it did.
 *   2. `index.html` sets `script-src 'self'`, so a tool that injects its
 *      overlay through a `<script>` element is refused.
 *
 * So this sits in front of Vite and rewrites one file: the HTML document. The
 * CSP meta tag is dropped and the bridge is imported ahead of `/src/main.tsx`.
 * Nothing under `src/` is patched, no build flag is added, and the production
 * page keeps its CSP — the relaxation exists on this port and nowhere else.
 *
 * The port is deliberately not the app's: anything reached on :5181 is a
 * harness render, and no screenshot taken here can be mistaken for the shipped
 * page.
 */
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const UPSTREAM = process.env.SILLAGE_URL ?? 'http://localhost:5180'
const PORT = Number(process.env.SILLAGE_HARNESS_PORT ?? 5181)
const upstream = new URL(UPSTREAM)

/** The bridge, served from a path Vite will never claim. */
const STUB_ROUTE = '/@harness/bridge-stub.mjs'

const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?>/i
/*
 * Matched rather than compared: in dev the tag reads
 * `src="/src/main.tsx?t=1786037539980"`, Vite's cache-bust, and a literal
 * comparison silently injects nothing — the page then renders its error state
 * and the run looks like a screen with no data rather than a broken proxy.
 */
const MAIN_SCRIPT = /<script type="module" src="\/src\/main\.tsx[^"]*"><\/script>/

/**
 * `scenario` picks the dataset, `now` pins the clock.
 *
 * Playwright's `page.clock` is not available to a plain browser, so the freeze
 * is done in the page: `Date.now()` and a no-argument `new Date()` answer the
 * pinned instant, while timers keep running. Without it the fixtures — minted
 * against a fixed `now` on the server — would drift from the app's own idea of
 * the time within a minute, and the armed meeting would slide out of its slot.
 */
const injection = (mainScript, scenario, now, freeze, entra) => `
    <script>
${freeze ? frozenClock(now) : ''}
    </script>
    <script type="module">
      import { installAppBridge } from '${STUB_ROUTE}'
      installAppBridge({ scenario: ${JSON.stringify(scenario)}, now: ${now}, entra: ${entra} })
    </script>
    ${mainScript}`

const frozenClock = (now) => `
      const Pinned = Date
      const frozen = ${now}
      window.Date = class extends Pinned {
        constructor(...args) {
          super(...(args.length ? args : [frozen]))
        }
        static now() { return frozen }
      }
      window.Date.parse = Pinned.parse
      window.Date.UTC = Pinned.UTC`

/** Today at 14:35 Paris — the same instant `shot.mjs` pins to. */
const pinnedNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const read = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  const guess = Date.UTC(Number(read.year), Number(read.month) - 1, Number(read.day), 14, 35)
  const shown = new Date(guess).toLocaleString('en-US', { timeZone: 'Europe/Paris', hour12: false })
  return guess - (new Date(shown).getHours() - 14) * 3_600_000
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === STUB_ROUTE) {
    const source = fs.readFileSync(path.join(HERE, 'bridge-stub.mjs'))
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    res.end(source)
    return
  }

  let upstreamResponse
  try {
    upstreamResponse = await fetch(new URL(url.pathname + url.search, UPSTREAM), {
      method: req.method,
      headers: { ...req.headers, host: upstream.host },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
      duplex: 'half',
      redirect: 'manual',
    })
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`Vite injoignable sur ${UPSTREAM} — lancez « npm run dev -- --port 5180 ».\n${error.message}`)
    return
  }

  const type = upstreamResponse.headers.get('content-type') ?? ''
  const headers = Object.fromEntries(upstreamResponse.headers)
  // The rewrite changes the length, and a stale validator would let the browser
  // serve the un-bridged document from cache.
  delete headers['content-length']
  delete headers['content-encoding']
  delete headers['etag']

  if (!type.includes('text/html')) {
    res.writeHead(upstreamResponse.status, headers)
    res.end(Buffer.from(await upstreamResponse.arrayBuffer()))
    return
  }

  const scenario = url.searchParams.get('scenario') ?? 'agenda'
  const now = Number(url.searchParams.get('now')) || pinnedNow()
  const freeze = url.searchParams.get('freeze') !== '0'
  /* `?entra=0` — no Entra app registration, which is the first demo's own
     configuration (DEC-28). Not a scenario: it crosses every one of them. */
  const entra = url.searchParams.get('entra') !== '0'
  const source = await upstreamResponse.text()
  if (!MAIN_SCRIPT.test(source)) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('index.html ne charge plus /src/main.tsx — le point d’injection du pont a bougé.')
    return
  }
  const html = source
    .replace(CSP_META, '<!-- CSP levée par scripts/harness/serve.mjs — ce port n’est pas l’application -->')
    .replace(MAIN_SCRIPT, (tag) => injection(tag, scenario, now, freeze, entra))

  res.writeHead(upstreamResponse.status, { ...headers, 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
})

/*
 * Vite's HMR client opens a WebSocket, and a proxy that answers it with a 400
 * fills the console with reconnection errors — noise a detector reports as
 * script errors. Piping the upgrade through costs eight lines.
 */
server.on('upgrade', (req, socket, head) => {
  const target = net.connect(Number(upstream.port || 80), upstream.hostname, () => {
    const lines = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`)
    target.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`)
    if (head?.length) target.write(head)
    target.pipe(socket)
    socket.pipe(target)
  })
  target.on('error', () => socket.destroy())
  socket.on('error', () => target.destroy())
})

server.listen(PORT, () => {
  console.log(`harnais → http://localhost:${PORT}/?scenario=agenda   (Vite: ${UPSTREAM})`)
  console.log('scénarios: splash · agenda · session · review · historique · reglages')
})
