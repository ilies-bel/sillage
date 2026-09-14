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
  // What is left is `Error: <ours>`, or a subclass name — one leading
  // `<Name>: ` and no more, because the sentence itself may contain a colon.
  const inner = message.slice(prefix.length).replace(/^[A-Za-z]*Error:\s*/, '')
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
