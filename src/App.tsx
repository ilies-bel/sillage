/**
 * One window (HR-10). The shell is a switch over `Route`, and nothing else.
 *
 * It used to end in a `HealthStrip` — a footer that named all six connectors
 * whenever any of them was unhappy. DEC-32 retired it: three of those six are
 * optional at runtime (DEC-26) and an unreachable VerySwing is not a
 * degradation of the app, so the strip spent client calls announcing things
 * that were not wrong. What replaced it is `screens/StatusControl.tsx`, in the
 * header of *Aujourd'hui*, reading the three required subsystems only.
 *
 * It now starts with one, too: screen 0 (DEC-30) holds the shell until the main
 * process has answered for the store, the audio engine and the transcription
 * engine. Nothing optional is in that list — see `core/contracts/boot.ts`.
 */
import { useCallback, useState } from 'react'
import type { BootState } from '../electron/core/contracts/boot.ts'
import type { HistoryFilter } from '../electron/core/contracts/history.ts'
import { bootAnswered } from '../electron/core/contracts/bootSteps.ts'
import { AGENDA, REGLAGES, historiqueOf, type Route } from './app/route.ts'
import { useBroadcast, useInvoke } from './app/bridge.ts'
import { Agenda } from './screens/Agenda.tsx'
import { Session } from './screens/Session.tsx'
import { Review } from './screens/Review.tsx'
import { Historique } from './screens/Historique.tsx'
import { Reglages } from './screens/Reglages.tsx'
import { Splash } from './screens/Splash.tsx'

export function App() {
  const [route, setRoute] = useState<Route>(AGENDA)

  // Screen 0 (DEC-30). One read, then kept current by the broadcast — the same
  // shape as every other screen here.
  const boot = useInvoke('boot:state', {})
  useBroadcast('boot:changed', boot.set)

  const open = useCallback((meetingId: string) => {
    setRoute({ screen: 'session', meetingId })
  }, [])

  // Offered by the session only once the machine has reached the gate, so
  // there is no route into the review screen during a call (DEC-23).
  const review = useCallback((meetingId: string) => {
    setRoute({ screen: 'review', meetingId })
  }, [])

  const back = useCallback(() => setRoute(AGENDA), [])
  // Both are reached from the calendar and from nowhere else. There is no nav
  // bar and no modal chrome to hold them (HR-10) — the home screen is the hub,
  // and neither screen is somewhere a rep goes during a call.
  //
  // *Historique* is reached from the calendar's **search**, not from a link
  // (DEC-25, VISION.md §6), and it opens on the query and chips that were on
  // screen. That is why this takes two arguments and `reglages` takes none.
  const historique = useCallback((query: string, filter: HistoryFilter) => {
    setRoute(historiqueOf(query, filter))
  }, [])
  const reglages = useCallback(() => setRoute(REGLAGES), [])

  /*
   * The splash holds the window until every required step is answered — and
   * `failed` is answered (`bootAnswered`, in the contract). The app opening is
   * not conditional on transcription being available: a rep whose weights are
   * missing still has capture, still has a notepad and still has a compte-rendu
   * they can write by hand, and holding the window shut would take all of that
   * away to protest one of them. The header status control (DEC-32) is where
   * they read about it afterwards.
   *
   * A channel that *rejects* does not hold it either. `boot:state` failing says
   * something about IPC, not about the store or the audio engine, and trapping
   * the rep behind a screen that can never resolve would be the one outcome
   * worse than an app whose header says a subsystem is down.
   */
  const bootReady =
    boot.state.status === 'failed' ||
    (boot.state.status === 'ready' && bootAnswered(boot.state.value))

  if (!bootReady) {
    const state: BootState | null = boot.state.status === 'ready' ? boot.state.value : null
    return <Splash state={state} />
  }

  return (
    <div className="bg-canvas flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {route.screen === 'agenda' ? (
          <Agenda onOpen={open} onHistorique={historique} onReglages={reglages} />
        ) : route.screen === 'historique' ? (
          <Historique onBack={back} query={route.query} filter={route.filter} />
        ) : route.screen === 'reglages' ? (
          <Reglages onBack={back} />
        ) : route.screen === 'review' ? (
          <Review key={route.meetingId} meetingId={route.meetingId} onBack={back} onConfirmed={back} />
        ) : (
          // Keyed on the meeting: switching sessions must rebuild the editor
          // rather than hand a different document to a live one.
          <Session
            key={route.meetingId}
            meetingId={route.meetingId}
            onBack={back}
            onReview={review}
            onReglages={reglages}
          />
        )}
      </div>
    </div>
  )
}
