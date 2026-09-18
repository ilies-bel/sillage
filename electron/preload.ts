/**
 * The bridge. No logic — with exactly one exception, below.
 *
 * Both halves of it are generated from `core/contracts/ipc.ts`, so main,
 * preload and renderer cannot drift: a channel that is not in the contract is
 * not reachable from the renderer at all, and the renderer gets its types from
 * the same file (ARCHITECTURE.md §5.B).
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  BROADCAST_CHANNEL_NAMES,
  INVOKE_CHANNEL_NAMES,
  type AppBridge,
  type BroadcastChannel,
  type BroadcastPayload,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
} from './core/contracts/ipc.ts'

const invokeAllowed = new Set<string>(INVOKE_CHANNEL_NAMES)
const broadcastAllowed = new Set<string>(BROADCAST_CHANNEL_NAMES)

/**
 * **Electron's own wrapper, taken back off the sentence a rep reads.**
 *
 * `ipcRenderer.invoke` rejects with a message it composes itself:
 * `Error invoking remote method 'meeting:ask': Error: <ours>`. Every refusal in
 * this product is a written French sentence that names what to do — « Aucun
 * modèle de langage n'est configuré — ajoutez-en un dans Réglages », « Aucune
 * transcription n'a été enregistrée pour cet appel » — and DEC-26 is the rule
 * that a control which cannot work says why. The renderer prints
 * `error.message` straight into an `alert`, so what a rep actually got was
 * *« Error invoking remote method 'meeting:ask': Error: Aucune transcription… »*:
 * an English stack-shaped prefix in front of the French, on a French product,
 * naming an internal channel.
 *
 * No test in the repo could see it. The renderer's own tests inject a fake
 * bridge that throws a clean `Error`, and the screenshot harness stubs
 * `window.app` — this string exists only when a real `ipcRenderer` is between
 * the two, which is why it took `scripts/e2e.mjs` running the packaged app to
 * find it.
 *
 * The strip is anchored and channel-bound rather than a loose `Error:` search,
 * so a message that legitimately contains the word is untouched, and anything
 * that does not match this exact shape is passed through as it came.
 */
const unwrap = (channel: string, error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error)
  const prefix = `Error invoking remote method '${channel}': `
  if (!message.startsWith(prefix)) return error instanceof Error ? error : new Error(message)
  // What is left is `<Name>: <ours>`, where `<Name>` is `error.name` as Electron
  // serialised it — one leading name and no more, because the sentence itself
  // may contain a colon.
  //
  // **The name is not always `…Error`, and that cost a rep the whole sentence.**
  // This read `/^[A-Za-z]*Error:/`, which is every built-in and none of ours:
  // `core/contracts/refusal.ts` sets `name = 'Refusal'` on purpose — it is the
  // type that separates « I am telling the rep something » from « something went
  // wrong » — and it is thrown at thirty-four sites in `ipc/register.ts`. So the
  // sentence a rep read was « Refusal: Aucune transcription n’a été enregistrée
  // pour cet appel. », an English class name in front of the French, on the one
  // surface DEC-26 exists for. Measured over the real bridge on `meeting:get`,
  // `meeting:ask` and `settings:setProviderField`.
  //
  // So one leading identifier, whatever it is called. What that must never do is
  // eat a French sentence that opens on a word and a colon; `preloadUnwrap`
  // reads every refusal this app ships and asserts none of them can be.
  const inner = message.slice(prefix.length).replace(/^[A-Za-z][A-Za-z0-9]*:\s*/, '')
  return new Error(inner)
}

const bridge: AppBridge = {
  invoke: <C extends InvokeChannel>(channel: C, payload: InvokeRequest<C>) => {
    if (!invokeAllowed.has(channel)) throw new Error(`canal inconnu: ${channel}`)
    return ipcRenderer.invoke(channel, payload).catch((error: unknown) => {
      throw unwrap(channel, error)
    }) as Promise<InvokeResponse<C>>
  },

  on: <C extends BroadcastChannel>(channel: C, listener: (payload: BroadcastPayload<C>) => void) => {
    if (!broadcastAllowed.has(channel)) throw new Error(`canal inconnu: ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown) =>
      listener(payload as BroadcastPayload<C>)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
}

contextBridge.exposeInMainWorld('app', bridge)
