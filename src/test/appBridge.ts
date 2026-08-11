/**
 * A stand-in for `window.app`, typed exactly like the real preload bridge.
 *
 * Typed rather than `any` on purpose: these tests are the only place the
 * renderer's use of the IPC contract is checked at all, so a channel renamed in
 * `core/contracts/ipc.ts` should break them at compile time rather than at
 * runtime in front of someone.
 */
import type {
  AppBridge,
  BroadcastChannel,
  BroadcastPayload,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
} from '../../electron/core/contracts/ipc.ts'

type AnyListener = (payload: unknown) => void
type Responder = (payload: unknown) => unknown

export interface FakeBridge extends AppBridge {
  /** Answer a channel. Throwing from here is how a failing channel is tested. */
  when<C extends InvokeChannel>(
    channel: C,
    responder: (payload: InvokeRequest<C>) => InvokeResponse<C> | Promise<InvokeResponse<C>>,
  ): FakeBridge
  /** Push a broadcast to whoever subscribed, as the main process would. */
  emit<C extends BroadcastChannel>(channel: C, payload: BroadcastPayload<C>): void
  calls: Array<{ channel: string; payload: unknown }>
  listenerCount(channel: BroadcastChannel): number
}

export const fakeBridge = (): FakeBridge => {
  const responders = new Map<string, Responder>()
  const listeners = new Map<string, Set<AnyListener>>()
  const calls: Array<{ channel: string; payload: unknown }> = []

  const bridge: FakeBridge = {
    calls,

    invoke: (channel, payload) => {
      calls.push({ channel, payload })
      const responder = responders.get(channel)
      if (!responder) {
        return Promise.reject(new Error(`canal sans réponse dans le test: ${channel}`))
      }
      try {
        return Promise.resolve(responder(payload)) as never
      } catch (error) {
        return Promise.reject(error) as never
      }
    },

    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set<AnyListener>()
      set.add(listener as AnyListener)
      listeners.set(channel, set)
      return () => {
        set.delete(listener as AnyListener)
      }
    },

    when: (channel, responder) => {
      responders.set(channel, responder as Responder)
      return bridge
    },

    emit: (channel, payload) => {
      for (const listener of listeners.get(channel) ?? []) listener(payload)
    },

    listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
  }

  return bridge
}

/** Installs the bridge on `window` and returns a teardown. */
export const installBridge = (bridge: FakeBridge): (() => void) => {
  const previous = (window as { app?: AppBridge }).app
  ;(window as { app?: AppBridge }).app = bridge
  return () => {
    ;(window as { app?: AppBridge }).app = previous
  }
}
