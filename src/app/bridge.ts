/**
 * The renderer's half of the IPC contract, as hooks.
 *
 * `window.app` is already typed from `core/contracts/ipc.ts` (see
 * `src/vite-env.d.ts`), so nothing here re-declares a channel or a payload —
 * these only handle the parts React makes awkward: unsubscribing on unmount,
 * not setting state after it, and not firing a request per keystroke.
 *
 * There is no fetch, no axios and no websocket in this file, and there is not
 * going to be one anywhere under `src/`. The renderer's CSP is
 * `connect-src 'self'`; every byte from outside arrives through this bridge.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BroadcastChannel,
  BroadcastPayload,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse,
} from '../../electron/core/contracts/ipc.ts'

export const invoke = <C extends InvokeChannel>(
  channel: C,
  payload: InvokeRequest<C>,
): Promise<InvokeResponse<C>> => window.app.invoke(channel, payload)

/** Subscribe for the lifetime of the component. */
export function useBroadcast<C extends BroadcastChannel>(
  channel: C,
  listener: (payload: BroadcastPayload<C>) => void,
): void {
  // The listener identity changes on every render in practice, and
  // re-subscribing on every render would drop broadcasts in the gap.
  const held = useRef(listener)
  held.current = listener

  useEffect(() => window.app.on(channel, (payload) => held.current(payload)), [channel])
}

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'failed'; reason: string }

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'erreur inconnue'

/**
 * One request on mount, plus a `reload` the caller can wire to a button.
 *
 * Deliberately not a cache and not a query library. Every screen here reads
 * one thing and is then kept current by a broadcast, so a stale-while-revalidate
 * layer would be machinery with nothing to do.
 */
export function useInvoke<C extends InvokeChannel>(
  channel: C,
  payload: InvokeRequest<C>,
): { state: Loadable<InvokeResponse<C>>; reload: () => void; set: (value: InvokeResponse<C>) => void } {
  const [state, setState] = useState<Loadable<InvokeResponse<C>>>({ status: 'loading' })

  // Serialised so an inline object literal at the call site does not re-fire
  // the request on every render.
  const key = JSON.stringify(payload ?? {})
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = useCallback(() => {
    window.app
      .invoke(channel, JSON.parse(key) as InvokeRequest<C>)
      .then((value) => {
        if (alive.current) setState({ status: 'ready', value })
      })
      .catch((error: unknown) => {
        if (alive.current) setState({ status: 'failed', reason: reasonOf(error) })
      })
  }, [channel, key])

  useEffect(run, [run])

  const set = useCallback((value: InvokeResponse<C>) => {
    setState({ status: 'ready', value })
  }, [])

  return { state, reload: run, set }
}
