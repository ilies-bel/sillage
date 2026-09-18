/**
 * **A meeting id the harness hands the renderer must be a meeting the harness
 * can open.**
 *
 * The renderer's one move after most presses is « take me to that meeting »:
 * `Agenda.armNow` calls `onOpen(meetingId)`, `DayPane` calls it with the id on
 * the row, `Historique` with the id on the result. Every one of those ends in
 * `meeting:get`. So an id the stub invents rather than derives is a press that
 * navigates the rep to « réunion introuvable: … », and no screenshot can tell
 * that apart from a stage that simply was not driven that far.
 *
 * It shipped. `agenda:arm` answered `` `evt-${eventId}` `` while every meeting in
 * the fixture is `m-*` and the shipped `Agenda.meetingIdFor` is a sha1 digest, so
 * *Préparer* — the central gesture of the detection surface — landed on
 *
 *     réunion introuvable: evt-evt-delcourt-tjm
 *     Retour
 *
 * measured on the shipped stub at 1280×800 and 960×600. `agenda-demarrer-tot`
 * covered that control by *counting* it, which is orthogonal to whether pressing
 * it arrives anywhere.
 *
 * The check is written over the rule and not over that handler: **every channel
 * the stub answers** is invoked, on every scenario × Entra half, and every
 * meeting id anywhere in the reply — a `meetingId` field, or the `id` of a
 * meeting-shaped object — has to resolve through `meeting:get`. Nothing here
 * knows the name `agenda:arm`.
 *
 * The three floors below exist because a check that stops reaching the fixture
 * reports green: if the channel list stops being found, if no channel answers, or
 * if no id is collected, this fails rather than passing on an empty set.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STUB = path.resolve(HERE, '..', 'harness', 'bridge-stub.mjs')

const { installAppBridge } = await import(new URL('../harness/bridge-stub.mjs', import.meta.url).href)
const { pinnedNow } = await import(new URL('../harness/pinnedNow.mjs', import.meta.url).href)

const source = readFileSync(STUB, 'utf8')

/**
 * The channels, read out of the `responders` object itself — a second list beside
 * it is a second thing to forget, which is the shape this file exists to catch.
 */
const channels = () => {
  const open = source.indexOf('const responders = {')
  assert.ok(open > 0, 'objet `responders` introuvable dans bridge-stub.mjs — la lecture a cessé de trouver')
  const body = source.slice(open, source.indexOf('\n  const ', open + 10))
  return [...new Set([...body.matchAll(/^ {4}'([a-z]+:[a-zA-Z:]+)':/gm)].map((m) => m[1]))]
}

/** The scenarios, the way `stagedDay.test.ts` reads them: from the stub's own branches. */
const scenarios = () =>
  [...new Set([...source.matchAll(/scenario [!=]== '([^']+)'/g)].map((m) => m[1]))].sort()

/**
 * Meeting-shaped by its fields rather than by its state, so the union in
 * `core/contracts/meeting.ts` is not copied here to rot.
 */
const isMeeting = (node) =>
  node !== null &&
  typeof node === 'object' &&
  typeof node.id === 'string' &&
  typeof node.state === 'string' &&
  typeof node.title === 'string' &&
  typeof node.updatedAt === 'number'

const collect = (node, out) => {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out)
    return
  }
  if (node === null || typeof node !== 'object') return
  if (isMeeting(node)) out.add(node.id)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'meetingId' && typeof value === 'string') out.add(value)
    collect(value, out)
  }
}

/**
 * One payload shape for every channel, built from the fixture rather than
 * invented: a real meeting id, a real event id, a real mark and a real segment.
 * A handler that destructures something else answers with a throw, which this
 * counts as « no id offered » — and the `answered` floor below is what keeps that
 * from becoming the whole run.
 */
const payloadFor = (fixture) => ({
  meetingId: fixture.meetingId,
  eventId: fixture.eventId,
  title: 'Réunion d’essai',
  clientName: null,
  scheduledStart: null,
  revision: 1,
  recipe: 'libre',
  question: 'De quoi a-t-on parlé ?',
  note: '',
  by: 'rep',
  paused: false,
  markId: 'mark-inexistant',
  segmentId: null,
  providerId: 'openai',
  capability: 'analyse',
  modelId: 'small',
  value: 'x',
  offlineOnly: false,
  filter: null,
  limit: 20,
  query: '',
  pillTop: 0,
  passThrough: false,
})

/**
 * A fresh bridge per channel: several handlers mutate the fixture
 * (`meeting:create` pushes a row, `meeting:mark` pushes a mark, `review:confirm`
 * settles the gate), and a run that let those accumulate would be measuring an
 * arrangement no screen ever reaches.
 */
const withBridge = async (scenario, entra, now, fn) => {
  const globals = globalThis
  const before = globals.window
  globals.window = { addEventListener: () => {} }
  /*
   * The stub's `LATENCY` table holds nine channels for 150 ms and the dry run for
   * 600, which is there so a *stage* can photograph a placeholder. Driven
   * exhaustively — every channel × every scenario × both halves of the Entra axis
   * — that is upwards of five minutes of `setTimeout`, and this asks nothing about
   * time. The delay is collapsed to a turn of the loop rather than removed, so the
   * answer still arrives asynchronously the way the renderer receives it.
   */
  const realTimeout = globals.setTimeout
  globals.setTimeout = (callback) => realTimeout(callback, 0)
  try {
    installAppBridge({ scenario, now, entra })
    return await fn(globals.window.app)
  } finally {
    globals.setTimeout = realTimeout
    globals.window = before
  }
}

test('every meeting id the harness stub hands back opens through meeting:get', async () => {
  const known = channels()
  const scenes = scenarios()
  const now = pinnedNow()

  assert.ok(
    known.length >= 40,
    `${known.length} canal(aux) lus dans \`responders\` — la lecture a cessé de trouver`,
  )
  assert.ok(
    scenes.length >= 8,
    `${scenes.length} scénario(s) lus — le stub a changé de forme et ce test ne regarde plus rien`,
  )

  const offences = []
  let answered = 0
  let offered = 0
  let resolved = 0

  for (const scenario of scenes) {
    for (const entra of [true, false]) {
      // The fixture's own first meeting and first event, so the payload names
      // things that exist.
      const seed = await withBridge(scenario, entra, now, async (app) => {
        const meetings = await app.invoke('meeting:list', {})
        const snapshot = await app.invoke('agenda:snapshot', {})
        return {
          meetingId: meetings[0]?.id ?? 'm-inexistant',
          eventId: snapshot.events[0]?.id ?? 'evt-inexistant',
          events: snapshot.events.map((event) => event.id),
        }
      })

      for (const channel of known) {
        // Every event, not only the first: `agenda:arm` is the one channel whose
        // answer depends on *which* row the rep pressed, and a check that presses
        // one row is the check `agenda-demarrer-tot` already was.
        const payloads =
          channel === 'agenda:arm'
            ? (seed.events.length > 0 ? seed.events : [seed.eventId]).map((eventId) => ({
                ...payloadFor(seed),
                eventId,
              }))
            : [payloadFor(seed)]

        for (const payload of payloads) {
          const reply = await withBridge(scenario, entra, now, async (app) => {
            let answer
            try {
              answer = await app.invoke(channel, payload)
            } catch {
              // A refusal is an answer with no id in it — `agenda:arm` beside a
              // live recording is exactly that, and it is the shipped behaviour.
              return null
            }
            answered += 1
            const ids = new Set()
            collect(answer, ids)
            const bad = []
            for (const id of ids) {
              offered += 1
              try {
                await app.invoke('meeting:get', { meetingId: id })
                resolved += 1
              } catch (error) {
                bad.push(`${id} (${error.message})`)
              }
            }
            return bad
          })
          if (reply !== null && reply.length > 0) {
            offences.push(
              `${channel} (scénario ${scenario}, entra ${entra}, ${JSON.stringify(payload.eventId)}) ` +
                `répond avec ${reply.join(', ')}`,
            )
          }
        }
      }
    }
  }

  assert.ok(answered > 0, 'aucun canal n’a répondu — ce test passerait sans rien conduire')
  assert.ok(
    offered > 0,
    'aucun identifiant de réunion collecté — la reconnaissance a cessé de trouver, ce test ne mesure plus rien',
  )

  assert.deepEqual(
    [...new Set(offences)],
    [],
    `${new Set(offences).size} réponse(s) du harnais nomment une réunion que \`meeting:get\` ` +
      'refuse d’ouvrir : la pression navigue vers « réunion introuvable », et aucune capture ' +
      'ne distingue cela d’une mise en scène qui n’est pas allée jusque-là. ' +
      `(${resolved}/${offered} identifiants ouverts)`,
  )
})
