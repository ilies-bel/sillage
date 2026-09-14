/**
 * Is there an update sitting on disk, waiting for a human?
 *
 * One question, asked over the channel Réglages already reads — `update:status`,
 * kept current by `update:changed` (`core/contracts/ipc.ts`). No new channel and
 * no new port: the rail is a second *reader* of a state the main process has
 * always published, which is the whole reason the panel's channel is a status
 * rather than a panel-shaped payload.
 *
 * `phase: 'ready'` and nothing else. `available` is a version that exists and
 * has not been fetched — half a gigabyte the rep has not agreed to spend, and
 * offering « prête » for it would be a lie about what pressing it does.
 * `downloading` is in flight. Anything unanswered, failed or `disabled` is
 * `false`: the rail is chrome on every screen, and a row that appears because a
 * channel rejected would be the app announcing its own plumbing (DEC-26).
 */
import { useBroadcast, useInvoke } from './bridge.ts'

export function useUpdateReady(): boolean {
  const status = useInvoke('update:status', {})
  useBroadcast('update:changed', status.set)
  return status.state.status === 'ready' && status.state.value.phase === 'ready'
}
