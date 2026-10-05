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
import { useDismiss } from './app/useDismiss.ts'
import { useReturnFocus } from './app/useReturnFocus.ts'
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

  /*
   * **The sheet's exit lives here, because `Échap` does.**
   *
   * Réglages is drawn in two branches below — over first run, and over the
   * calendar — and closed three ways: its ✕, its veil, and `Échap` through the
   * table below. The first two are the sheet's own and it ran its own exit on
   * them; the third is a route change one component up, and it unmounted the
   * sheet between two frames. Measured (`scratch/escape-check.mjs`): ✕ →
   * `leaving`, Échap → `unmounted`.
   *
   * Nesting a second `useShortcuts` inside the sheet would not fix it —
   * `app/shortcuts.ts` adds one listener per caller and both would fire, so
   * `Échap` would start an exit and navigate out from under it in the same
   * frame. The dismissal belongs wherever the last way out lives, which is here.
   *
   * Called unconditionally and before every early return, as a hook must be;
   * when no sheet is open `dismiss` closes nothing.
   */
  const closeReglages = useCallback(() => {
    if (inReglages !== null) setInReglages(null)
    else back()
  }, [inReglages, back])
  const { leaving: reglagesLeaving, dismiss: dismissReglages } = useDismiss(closeReglages)
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
    /*
      Both ways of holding a sheet open take the exit, and that is two branches
      rather than one because they are two different states: first run opens it
      with no route change at all (`inReglages`), and the calendar opens it as a
      route. Measured (`scratch/escape-check.mjs`), wiring only the first left
      `Échap` on the calendar still unmounting between two frames — which is the
      branch a rep actually meets, since first run happens once.
    */
    ...(inReglages || route.screen === 'reglages'
      ? { retour: dismissReglages }
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

  /*
   * First run is on screen — with or without the sheet over it. One expression
   * instead of the two inline copies this was, because the two branches below
   * that read it differ only by the sheet.
   */
  const firstRun =
    replay || (onboarding.state.status === 'ready' && !onboarding.state.value.seen)

  /**
   * **A sheet is drawn, and the screen behind it is out of reach** — which until
   * now meant out of reach of the *pointer* only.
   *
   * The veil stops every press (measured: a click on « Démarrer une réunion »
   * behind it times out at 2 500 ms and the sheet stays open) and
   * `aria-modal="true"` tells a reader that nothing outside the dialog exists.
   * Real focus was told neither: on the `reglages` stage, at 1280×800 and
   * 960×600 alike, 64 of the 78 focusable elements on screen were behind the
   * veil, none of them hidden from anything, and of 90 presses of `Tab` 76
   * landed on one of them. One `Tab` and one `Entrée` started an ad-hoc meeting
   * from under the veil; aimed at a day row's *Ouvrir* it opened a live
   * recording, and on first run « Passer » behind the veil skips the
   * onboarding.
   *
   * `inert` rather than a focus trap, and the choice is measured rather than
   * tasteful: it is one attribute, it takes the subtree out of the tab order
   * **and** out of the accessibility tree — so `aria-modal` becomes true of the
   * document instead of a claim about it — and it needs no `keydown` of its own
   * beside the three ways out this screen already has. Driven both ways round:
   * 90 `Tab` and 90 `Maj Tab` from a freshly opened sheet land 84 times inside
   * the dialog, 6 times on `<body>` at the wrap, and **0** times outside. A
   * trap would have to re-implement what `Tab` means, including `Maj Tab` off
   * the first control and every focus a script moves, and it would leave the
   * background in the reader's tree while the dialog says it is not there.
   *
   * It is exactly the condition under which a sheet is rendered below, and that
   * matters in one direction only: « Revoir la présentation » replaces the
   * screen *behind* the sheet, so the rep is left on a first-run step that must
   * not be inert. `firstRun` is the branch that happens in, and `inReglages` is
   * null by then.
   */
  const sheetOpen = bootReady && (firstRun ? inReglages !== null : route.screen === 'reglages')
  /*
   * Called before the first early return, as a hook must be, and with the whole
   * condition rather than one branch's — the way out of the sheet is a route
   * change in this component either way.
   */
  useReturnFocus(sheetOpen)

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
   *
   * **One branch, not two.** This was two returns whose JSX differed only by
   * the sheet beside the onboarding, and keeping them apart would have cost the
   * thing the comment below claims: React reuses a fiber by type and position,
   * so `[Onboarding, sheet]` → `Onboarding` keeps the step the rep was on,
   * while `[wrapper, sheet]` → `Onboarding` would throw the screen away and
   * rebuild it the moment the sheet closed. The wrapper the sheet needs has to
   * be in both states, so the two states are one branch.
   */
  if (firstRun) {
    /*
      The sheet, over the step the rep left — not instead of it. Réglages is a
      drawer (V2), so first run stays on screen behind the veil and coming back
      out of it is the same screen rather than a re-mount. Measured through a
      marked DOM node, both smoke sizes: the step's own « Réglages › » button is
      the same element after the sheet has been and gone, and focus is back on
      it.
    */
    return (
      <>
        {/*
          `h-full` because `#root` is `height: 100%` and `Onboarding`'s own root
          is `h-full` — the wrapper passes the height straight through, measured
          at 0,0 1280×800 and 0,0 960×600 with and without it. It exists for
          `inert`, whose argument is on `sheetOpen` above.
        */}
        <div className="h-full" inert={sheetOpen}>
          <Onboarding
            onDone={() => {
              setReplay(false)
              onboarding.set({ seen: true })
            }}
            /*
              **Réglages is a detour, not an exit.**

              It used to mark the onboarding seen and navigate, which meant the
              two rows whose remedy is a setting were one-way doors: the rep who
              left by the one link that actually fixes their problem never saw
              step 3, and never saw this screen again. That is the last rep who
              should lose it.

              So the flag is not written here — `Onboarding` records it, on every
              exit, including this one, so a rep who quits from Réglages is still
              not nagged — and the route is remembered instead. Coming back out
              of Réglages lands on the step they left.
            */
            onReglages={({ section, step }) => {
              setResume(step)
              setInReglages(section)
            }}
            initialStep={resume}
          />
        </div>
        {inReglages !== null ? (
          <Reglages section={inReglages} leaving={reglagesLeaving} onBack={dismissReglages} />
        ) : null}
      </>
    )
  }

  return (
    <div className="bg-canvas flex h-full flex-col">
      {/*
        **The screen, and `inert` while a sheet is over it** — the argument is
        on `sheetOpen` above. It goes on the box that already exists rather than
        on a wrapper, and the sheet moved out from under it to be its sibling,
        for two reasons: `inert` is inherited, so a sheet inside this box would
        have been inert along with everything else; and the calendar is then one
        child in one position in both the `agenda` and the `reglages` branch,
        which is what lets React keep it — and the rep's day, and the button
        focus comes back to — across the sheet opening and closing. The sheet is
        `fixed inset-0` with no transformed ancestor either side of the move, so
        it paints in the same place: measured 784×680 at 248,60 (1280×800) and
        784×536 at 88,32 (960×600), before and after, and the calendar's own box
        is 240,134 287×421 / 188,118 215×421 with the sheet open or closed.
      */}
      <div className="min-h-0 flex-1" inert={sheetOpen}>
        {route.screen === 'agenda' || route.screen === 'reglages' ? (
          <Agenda
            onOpen={open}
            onHistorique={historique}
            onReglages={reglages}
          />
        ) : route.screen === 'historique' ? (
          <Historique
            onBack={back}
            onReglages={reglages}
            query={route.query}
            filter={route.filter}
          />
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

      {/*
        **The sheet is drawn over the calendar, which stays mounted.**

        Réglages stopped being a screen (V2): a rep who opens it to look at a
        connector has not left the day they were on, and replacing the window
        made them find it again on the way back. The route is still a route —
        `Échap` and the ✕ both pop it — but what it renders is the calendar plus
        a dialog over it.
      */}
      {route.screen === 'reglages' ? (
        <Reglages
          section={route.section}
          leaving={reglagesLeaving}
          onBack={dismissReglages}
          onOnboarding={() => setReplay(true)}
        />
      ) : null}
    </div>
  )
}
