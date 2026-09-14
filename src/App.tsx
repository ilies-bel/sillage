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
import { AGENDA, historiqueOf, type Route } from './app/route.ts'
import { useBroadcast, useInvoke } from './app/bridge.ts'
import { Agenda } from './screens/Agenda.tsx'
import { Session } from './screens/Session.tsx'
import { Review } from './screens/Review.tsx'
import { Historique } from './screens/Historique.tsx'
import { Reglages, type SectionId } from './screens/Reglages.tsx'
import { Onboarding, type Step } from './screens/Onboarding.tsx'
import { useShortcuts } from './app/shortcuts.ts'
import { NO_FILTER } from './screens/search/filters.ts'
import { Splash } from './screens/Splash.tsx'

export function App() {
  const [route, setRoute] = useState<Route>(AGENDA)

  // Screen 0 (DEC-30). One read, then kept current by the broadcast — the same
  // shape as every other screen here.
  const boot = useInvoke('boot:state', {})
  useBroadcast('boot:changed', boot.set)

  // First run. Read once — nothing broadcasts it, because the only thing that
  // can change it is this window.
  const onboarding = useInvoke('onboarding:state', {})
  /*
   * Réglages, opened *from* first run. The onboarding stays mounted-in-spirit:
   * this is what sends the rep back to it instead of to the calendar.
   */
  const [inReglages, setInReglages] = useState<SectionId | null>(null)
  /** The step to come back to. Kept here because Réglages *replaces* the screen. */
  const [resume, setResume] = useState<Step>('quoi')
  /**
   * First run, asked for again from an empty day.
   *
   * Separate from `seen`, and it has to be: `seen` is the record that the rep
   * has been through it, and un-setting that to replay it would mean the next
   * launch showed it unasked — which is the nagging the whole screen refuses.
   * This is a request, it lives for as long as the window does, and leaving the
   * replay clears it.
   */
  const [replay, setReplay] = useState(false)

  const open = useCallback((meetingId: string) => {
    setRoute({ screen: 'session', meetingId })
  }, [])

  /*
   * The OS notification's click, and the only thing in this product that
   * navigates without the rep having pressed something *in* it.
   *
   * That exception is the whole point: at 14:30 the rep is in Teams and this
   * window is behind three others, so the offer is on a screen nobody is
   * looking at. The notification reaches them; this is what its click does. It
   * opens the meeting and starts nothing — a capture that began because a
   * notification was clicked is a capture nobody agreed to.
   */
  useBroadcast('session:open', ({ meetingId }) => open(meetingId))

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
  const reglages = useCallback(
    (section?: SectionId) => setRoute({ screen: 'reglages', section }),
    [],
  )

  /*
   * **The three that are about *where you are*, installed once, for every
   * screen** (`app/shortcuts.ts`).
   *
   * They were on the calendar, Historique and Réglages, and on nothing else —
   * so on the session screen none of the six fired, and at the review gate one
   * did. A rep who read the printed table and pressed `Échap` during a call got
   * nothing, which teaches them the keyboard is broken rather than that it is
   * scoped. Here they work wherever the rep is, which is what a *global*
   * shortcut means.
   *
   * `retour` is offered only when there is somewhere to go back to: on the
   * calendar it is not claimed at all, so `Échap` stays whatever the platform
   * says it is rather than becoming a key that does nothing (DEC-26). It never
   * ends a recording — leaving the session screen is navigation, the meeting
   * goes on recording, and the header says so from wherever the rep lands.
   *
   * The other two stay where their control is, and the table says so: *Démarrer
   * une réunion* is the calendar's control and the search field is the
   * calendar's and the reader's.
   */
  useShortcuts({
    historique: () => historique('', NO_FILTER),
    reglages,
    /*
      Réglages is a sheet over the calendar now, not a screen beside it — so
      `Échap` has somewhere to go from the *calendar* route too, whenever one is
      open. The first-run detour opens the same sheet with no route change at
      all, which is why `inReglages` is consulted before the route is.
    */
    ...(inReglages
      ? { retour: () => setInReglages(null) }
      : route.screen === 'agenda'
        ? {}
        : { retour: back }),
  })

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

  /*
   * First run, after the splash and before the calendar
   * (`core/contracts/onboarding.ts`).
   *
   * **After** the splash, because the onboarding's second step reads the health
   * of the three required subsystems and they are not answered until boot is;
   * showing it earlier would put three « vérification… » rows in front of a rep
   * and resolve them under their eyes.
   *
   * A channel that has not answered yet, or that rejects, shows the calendar.
   * The onboarding is worth having and is not worth a blank window: `seen`
   * failing to load says something about the store, not about whether this rep
   * has used the app, and holding the window shut over a *preference* is the one
   * outcome worse than showing it a second time.
   */
  /*
   * Réglages opened from first run, and the way back out of it is *back into*
   * first run — not to the calendar the rep has never reached.
   */
  if (inReglages && (replay || (onboarding.state.status === 'ready' && !onboarding.state.value.seen))) {
    /*
      The sheet, over the step the rep left — not instead of it. Réglages is a
      drawer (V2), so first run stays on screen behind the veil and coming back
      out of it is the same screen rather than a re-mount.
    */
    return (
      <>
        <Onboarding
          onDone={() => {
            setReplay(false)
            onboarding.set({ seen: true })
          }}
          onReglages={({ section, step }) => {
            setResume(step)
            setInReglages(section)
          }}
          initialStep={resume}
        />
        <Reglages section={inReglages} onBack={() => setInReglages(null)} />
      </>
    )
  }

  if (replay || (onboarding.state.status === 'ready' && !onboarding.state.value.seen)) {
    return (
      <Onboarding
        onDone={() => {
          setReplay(false)
          onboarding.set({ seen: true })
        }}
        /*
          **Réglages is a detour, not an exit.**

          It used to mark the onboarding seen and navigate, which meant the two
          rows whose remedy is a setting were one-way doors: the rep who left by
          the one link that actually fixes their problem never saw step 3, and
          never saw this screen again. That is the last rep who should lose it.

          So the flag is not written here — `Onboarding` records it, on every
          exit, including this one, so a rep who quits from Réglages is still not
          nagged — and the route is remembered instead. Coming back out of
          Réglages lands on the step they left.
        */
        onReglages={({ section, step }) => {
          setResume(step)
          setInReglages(section)
        }}
        initialStep={resume}
      />
    )
  }

  return (
    <div className="bg-canvas flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {route.screen === 'agenda' ? (
          <Agenda
            onOpen={open}
            onHistorique={historique}
            onReglages={reglages}
            onOnboarding={() => setReplay(true)}
          />
        ) : route.screen === 'historique' ? (
          <Historique
            onBack={back}
            onReglages={reglages}
            query={route.query}
            filter={route.filter}
          />
        ) : route.screen === 'reglages' ? (
          /*
            **The sheet is drawn over the calendar, which stays mounted.**

            Réglages stopped being a screen (V2): a rep who opens it to look at a
            connector has not left the day they were on, and replacing the window
            made them find it again on the way back. The route is still a route —
            `Échap` and the ✕ both pop it — but what it renders is the calendar
            plus a dialog over it.
          */
          <>
            <Agenda
              onOpen={open}
              onHistorique={historique}
              onReglages={reglages}
              onOnboarding={() => setReplay(true)}
            />
            <Reglages section={route.section} onBack={back} />
          </>
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
