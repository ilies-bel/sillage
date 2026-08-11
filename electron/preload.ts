/**
 * The bridge. No logic — by design.
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

const bridge: AppBridge = {
  invoke: <C extends InvokeChannel>(channel: C, payload: InvokeRequest<C>) => {
    if (!invokeAllowed.has(channel)) throw new Error(`canal inconnu: ${channel}`)
    return ipcRenderer.invoke(channel, payload) as Promise<InvokeResponse<C>>
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
