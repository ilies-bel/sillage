/**
 * First run. Three screens, and each one exists because something breaks
 * without it (`core/contracts/onboarding.ts`).
 *
 * ## The one that matters
 *
 * Step 2. The app had no onboarding at all, so the first time a rep pressed
 * *Démarrer une réunion* the operating system asked them for microphone and
 * screen-recording permission — in the OS's own words, over a screen that had
 * explained nothing, thirty seconds before a client joined. On macOS the
 * screen-recording prompt is the one people refuse, and refusing it silently
 * costs the far end of every call this product exists to capture: the rep is
 * transcribed, the client is not, and nothing says so until the compte-rendu
 * comes back describing a monologue.
 *
 * So the permissions are asked for **before** they are needed, at a moment when
 * saying no costs nothing, on rows that say what each one buys.
 *
 * The rows are the real connector rows and the buttons are the real retries —
 * the same `health:retry` Réglages calls, over the same snapshot (DEC-32). A
 * hand-written checklist would be a second place where « is capture working »
 * is decided, and the day the two disagreed the rep would be looking at the
 * wrong one.
 *
 * ## What it refuses to be
 *
 * **It is not a gate.** *Continuer* is live on every step, including a step
 * where nothing is granted, and it never greys out (DEC-26). A rep who dismisses
 * this still has a calendar, a notepad and a recorder — holding the window shut
 * to protest a missing subsystem takes away everything that still works, which
 * is the same reasoning the splash follows.
 *
 * **It does not nag.** `onboarding:seen` is recorded whichever way the rep
 * leaves, because showing it again to somebody who said no is how an onboarding
 * becomes the thing people close without reading.
 *
 * **It promises nothing it has not measured.** Every state on step 2 is read
 * from `health:snapshot` and updated by `health:changed`, so a row says
 * « connecté » because it is, not because a button was pressed.
 */
import { useCallback, useState } from 'react'
import type { ConnectorHealth, ConnectorId, HealthSnapshot } from '../../electron/core/contracts/health.ts'
import { REQUIRED_CONNECTORS } from '../../electron/core/contracts/status.ts'
import { EssaiAudio } from './capture/EssaiAudio.tsx'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { Button, ReadingColumn, StateDot, unavailable, type StateDotProps } from '../ui/index.ts'
import type { SectionId } from './Reglages.tsx'

export interface OnboardingProps {
  /** Recorded as seen, then the calendar. The rep is never sent here again. */
  onDone: () => void
  /**
   * *Réglages ›*, and it is a **detour**: the caller is told which pane to open
   * and which step to come back to, because a rep sent to settings from step 2
   * has not read step 3 yet.
   */
  onReglages: (target: { section: SectionId; step: Step }) => void
  /** Where to resume, coming back from that detour. */
  initialStep?: Step
}

/** Three steps, and the rep can always go on to the next one. */
export type Step = 'quoi' | 'besoins' | 'essai'
const ORDER: readonly Step[] = ['quoi', 'besoins', 'essai']

/**
 * What each required subsystem buys, in the rep's terms.
 *
 * Not the connector's own label — « Audio » is what Réglages calls it, and
 * Réglages is a screen for somebody who already knows what the app does. Here
 * the row has to answer « why is it asking me this ».
 */
const NEEDS: Record<
  (typeof REQUIRED_CONNECTORS)[number],
  { title: string; why: string; section: SectionId }
> = {
  capture: {
    title: 'Le micro et l’audio de votre ordinateur',
    // The clause « vous seul le serez » used to close this sentence *and* the
    // permission warning forty pixels below it, verbatim, on the row a first-run
    // rep reads most carefully. The warning is the one that has to carry it: it
    // is the one that appears only when it is true.
    why: 'Sillage ne rejoint jamais la réunion : il écoute ce que votre machine joue et ce que dit votre micro. Il lui faut les deux pour que l’appel soit entier.',
    section: 'connecteurs',
  },
  transcribe: {
    title: 'La transcription',
    why: 'Sur cette machine par défaut. Le modèle est téléchargé une fois et reste ici.',
    section: 'transcription',
  },
  llm: {
    title: 'L’analyse',
    why: 'Ce qui écrit le compte-rendu à la fin de l’appel. À choisir dans Réglages.',
    section: 'llm',
  },
}

const TONE: Record<ConnectorHealth['state'], StateDotProps['tone']> = {
  ok: 'ok',
  degraded: 'warn',
  down: 'down',
}

const STATE_WORD: Record<ConnectorHealth['state'], string> = {
  ok: 'prêt',
  degraded: 'à vérifier',
  down: 'indisponible',
}

export function Onboarding({ onDone, onReglages, initialStep = 'quoi' }: OnboardingProps) {
  const [step, setStep] = useState<Step>(initialStep)

  /*
   * Recorded on the way out, and *then* the caller is told.
   *
   * The other order loses the flag whenever the write is slower than the
   * re-render, which is every time — the calendar mounts, `onboarding:state`
   * is not re-read, and the next launch shows this again.
   */
  const record = useCallback(async () => {
    try {
      await invoke('onboarding:seen', {})
    } catch {
      // A preference that would not save is not worth trapping the rep behind.
      // The worst case is seeing this screen once more.
    }
  }, [])

  const leave = useCallback(async () => {
    await record()
    onDone()
  }, [record, onDone])

  /*
   * *Réglages ›* is a way out too, and it has to record the same thing.
   *
   * It does not go through `leave`, so without this the rep who left by the one
   * link that actually fixes their problem would be shown this screen again on
   * the next launch — the one rep who least deserves it.
   */
  const toReglages = useCallback(
    async (section: SectionId) => {
      await record()
      /*
       * The step goes with it. Réglages replaces this screen rather than
       * covering it, so without carrying the step the rep comes back to step 1
       * — re-reading « Sillage écoute l'appel » as the reward for having gone
       * and fixed the thing the screen asked them to fix.
       */
      onReglages({ section, step })
    },
    [record, onReglages, step],
  )

  const index = ORDER.indexOf(step)

  return (
    <div className="bg-canvas grain flex h-full flex-col">
      {/*
        Centred, and the column is the same `.measure` every prose surface in
        this app uses. It was left-aligned against the window edge, which on a
        1280 laptop put three paragraphs in the first 900px and a thousand
        pixels of nothing beside them — a first screen that reads as a pane that
        failed to load. `mx-auto` on the header, the body and the footer alike,
        so the three stay on one axis as the step changes height.
      */}
      <header className="mx-auto flex w-full max-w-[58ch] shrink-0 items-baseline gap-inline px-gutter pb-4 pt-7">
        <h1 className="text-brand-900 font-display text-display leading-none">Sillage</h1>
        <p className="text-muted min-w-0 flex-1 text-ui">Première utilisation</p>
        {/*
          The way out, on every step and in the same place. An onboarding whose
          only exit is the end of it is a modal, and a rep who installed this
          between two meetings has ninety seconds.
        */}
        <Button variant="text" className="shrink-0" onClick={() => void leave()}>
          Passer
        </Button>
      </header>

      {/*
        `my-auto` inside a flex column: a short step is centred in the window,
        and a long one is not clipped — auto margins collapse to zero the moment
        the child is taller than the box, which `items-center` does not do.

        **And a step taller than the box needed the other half of that sentence.**
        `<main>` carried `overflow-y-auto` and nothing else, so it scrolled with no
        edge and no control — measured on the shipped screen at 960×600, the size
        `app/main.ts` declares as the minimum: step 3 held 514 pixels in a 460-pixel
        box and **hid 54 of them behind a hard edge**, on the one screen a rep sees
        exactly once, with the last beat — « vous validez, une fois », which is the
        whole of DEC-4 — the thing cut. Nothing in the repo could see it either:
        `--scrollers` skips a landmark, correctly, because a landmark is the page's
        own scroll region rather than a box inside one.
        `ReadingColumn` is that missing half and is deliberately the *shared* one —
        the same mask and the same page turn the compte-rendu pane and *Historique*
        wear, never a number this screen picks for itself. `<main>` stays the
        landmark and stops being the scroller, so there is exactly one.
      */}
      <main className="flex min-h-0 flex-1 flex-col">
        {/*
          `what` completes two templates inside `ReadingColumn` — « Lire la suite
          {what} » and « Remonter dans {what} » — and **no French phrase is correct
          in both**: the first wants « de », the second refuses it. Measured on the
          shipped component at 960×600, where two presses reach the foot of step 3,
          the control then reads « Remonter dans de cette étape ». The descending
          label is the one every rep meets, at every size, and the ascending one
          only after the column has been read to its end, so that is the one kept
          right. *Historique* feeds the same template « de la transcription » on
          four panes; `Review.tsx` composes both labels itself instead, which is the
          fix — in `src/ui/`, which is another lane's file.
        */}
        <ReadingColumn what="de cette étape" className="flex flex-col px-gutter pb-block">
          <div className="measure mx-auto my-auto w-full">
            {step === 'quoi' ? <Quoi /> : step === 'besoins' ? <Besoins onReglages={(section) => void toReglages(section)} /> : <Essai onReglages={() => void toReglages('connecteurs')} />}
          </div>
        </ReadingColumn>
      </main>

      <footer className="border-subtle bg-card shrink-0 border-t px-gutter py-row">
        <div className="measure mx-auto flex items-center gap-inline">
          {/*
            Three dots, not « étape 2 sur 3 ». The count is worth knowing and the
            sentence is not — it is the same information spelled out at the width
            of a line, on a screen whose whole argument is that it is short.

            **And for several rounds only one of the three was visible.** Measured
            against the footer's own `#fdfefe`: the completed dot was `brand-300`
            at **1.99:1** and the upcoming one `bg-subtle` at **1.11:1**, against
            WCAG 1.4.11's 3:1 floor for a graphic that carries information. So a
            rep saw a single dot and no count at all — which is exactly the thing
            the comment above says is worth knowing, lost to the one failure this
            codebase keeps finding: a design that is right in the source and
            invisible on screen.

            `brand-500` (3.02:1) for a step already done and a ruled outline in
            `--text-muted` (5.04:1) for one still ahead — filled means behind you,
            hollow means ahead, and both are legible. `ring` rather than `border`
            so the dot keeps its 8px box either way; 8 rather than 6 because three
            marks two pixels across are a smudge, not a count. Not a target: it is
            `aria-hidden` and the `<ol>` carries the sentence for anyone who
            cannot see it.
          */}
          <ol className="flex shrink-0 items-center gap-1.5" aria-label={`Étape ${index + 1} sur 3`}>
            {ORDER.map((id, at) => (
              <li
                key={id}
                aria-hidden
                /*
                  Measured by `shot.mjs --contrast` at WCAG 1.4.11's 3:1: this
                  mark says which step you are on by colour and fill alone, and
                  for several rounds two of the three were under the floor.
                */
                data-graphic={`étape ${at + 1}`}
                className={`h-2 w-2 rounded-full ${
                  at === index
                    ? 'bg-brand-700'
                    : at < index
                      ? 'bg-brand-500'
                      : 'bg-transparent ring-1 ring-inset ring-muted'
                }`}
              />
            ))}
          </ol>

          <span className="min-w-0 flex-1" />

          {index > 0 ? (
            <Button variant="text" onClick={() => setStep(ORDER[index - 1] as Step)}>
              Retour
            </Button>
          ) : null}
          {/*
            Never withheld, on any step, including one where nothing has been
            granted (DEC-26). The permissions are worth asking for and are not
            worth trapping somebody behind: a rep with no microphone still has a
            calendar, a notepad and a recorder.
          */}
          <Button
            variant="primary"
            onClick={() => (index === ORDER.length - 1 ? void leave() : setStep(ORDER[index + 1] as Step))}
          >
            {index === ORDER.length - 1 ? 'Terminer' : 'Continuer'}
          </Button>
        </div>
      </footer>
    </div>
  )
}

/**
 * Step 1 — what the thing is.
 *
 * Three sentences and each is load-bearing. The first is the one a rep will
 * otherwise get wrong: they will look for a bot in the attendee list, not find
 * one, and conclude nothing is recording. The other two are the promises that
 * decide whether this ever gets run on a real client (DEC-4, DEC-30) — a rep who
 * does not believe them uses it on internal calls and nothing else.
 */
function Quoi() {
  return (
    <section>
      <h2 className="text-strong font-display mb-3 text-[22px] leading-tight">
        Sillage écoute l’appel, il n’y participe pas.
      </h2>
      <p className="text-body mb-block text-copy leading-relaxed">
        Aucun robot ne rejoint la réunion et personne ne voit que vous enregistrez. Sillage écoute
        ce que votre ordinateur joue et ce que dit votre micro, puis écrit le compte-rendu à la fin.
      </p>

      <ul className="space-y-row">
        <Promise title="Rien ne part sans vous">
          À la fin de l’appel, Sillage vous montre le compte-rendu, la tâche VerySwing et le
          brouillon de relance. Rien n’est créé tant que vous n’avez pas validé — une fois.
        </Promise>
        <Promise title="La transcription reste sur cette machine">
          C’est le réglage par défaut. L’audio est transcrit puis effacé ; il n’est jamais conservé.
        </Promise>
        <Promise title="Vos notes restent les vôtres">
          Sillage n’écrit jamais dans votre bloc-notes pendant l’appel. Ce que vous tapez est à
          vous, et rien ne s’y ajoute tout seul.
        </Promise>
      </ul>
    </section>
  )
}

function Promise({ title, children }: { title: string; children: string }) {
  return (
    <li>
      <h3 className="text-strong text-copy font-semibold">{title}</h3>
      {/* `.measure` on the paragraph and not inherited: `ch` resolves against
          the element's own size, so the step's own measure is a wider one once
          the text inside is `--type-ui`. The class goes on the prose that wears
          the size. */}
      <p className="text-muted measure text-ui leading-relaxed">{children}</p>
    </li>
  )
}

/**
 * Step 2 — the permissions, live.
 *
 * The rows are `health:snapshot` filtered to the required subsystems (DEC-32),
 * kept current by `health:changed`, with the same `health:retry` Réglages calls.
 * Nothing here is a checklist the screen maintains for itself.
 */
function Besoins({ onReglages }: { onReglages: (section: SectionId) => void }) {
  const health = useInvoke('health:snapshot', {})
  const [busy, setBusy] = useState<ConnectorId | null>(null)

  /*
   * `health:snapshot` is a record keyed by connector, not a list of rows —
   * Réglages builds *its* rows out of the settings snapshot, which also carries
   * labels this screen does not want (« Audio » is what the app calls it once
   * you already know what it does). Here the record is read directly and the
   * wording comes from `NEEDS`.
   */
  const snapshot: HealthSnapshot | null =
    health.state.status === 'ready' ? health.state.value : null

  // `set` takes a value, not an updater — the same call Réglages makes on the
  // same broadcast, so the two screens cannot disagree about a connector.
  useBroadcast('health:changed', (payload) => {
    if (snapshot) health.set({ ...snapshot, [payload.connector]: payload.health })
  })

  const retry = async (id: ConnectorId) => {
    setBusy(id)
    try {
      await invoke('health:retry', { connector: id })
    } catch {
      // The row already carries its own reason from the snapshot, and a failed
      // retry does not add one — it repeats it.
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <h2 className="text-strong font-display mb-3 text-[22px] leading-tight">
        Ce dont Sillage a besoin
      </h2>
      <p className="text-body mb-block text-copy leading-relaxed">
        Trois choses, et c’est tout. Vous pouvez les régler maintenant ou plus tard — l’application
        s’ouvre dans tous les cas.
      </p>

      <ul className="space-y-block">
        {REQUIRED_CONNECTORS.map((id) => {
          const row: ConnectorHealth | null = snapshot?.[id] ?? null
          const state = row?.state ?? 'down'
          return (
            <li key={id} className="border-subtle border-t pt-row first:border-t-0 first:pt-0">
              <div className="flex items-baseline gap-inline">
                <h3 className="text-strong min-w-0 flex-1 text-copy font-semibold">
                  {NEEDS[id].title}
                </h3>
                {/*
                  Measured, never asserted. The dot says « prêt » because the
                  snapshot does, not because a button was pressed — which is the
                  difference between an onboarding and a form.
                */}
                <span className="shrink-0">
                  <StateDot
                    tone={row ? TONE[state] : 'pending'}
                    label={row ? STATE_WORD[state] : 'vérification…'}
                  />
                </span>
              </div>
              <p className="text-muted measure mt-1 text-ui leading-relaxed">{NEEDS[id].why}</p>

              {row && row.state !== 'ok' ? (
                <div className="mt-2 flex items-baseline gap-inline">
                  <p className="text-warn min-w-0 flex-1 text-ui">{row.reason}</p>
                  {/*
                    Two remedies and they are not interchangeable. A connector
                    that says retrying is worth something gets the retry; one
                    that needs a decision — a model to pick, a key to paste —
                    gets the screen where the decision is made. Neither is
                    offered where it cannot work (DEC-26).
                  */}
                  {row.retryable ? (
                    <Button
                      className="shrink-0"
                      onClick={() => void retry(id)}
                      {...unavailable(busy === id, 'Vérification…')}
                    >
                      {busy === id ? 'Vérification…' : 'Autoriser'}
                    </Button>
                  ) : (
                    <Button
                      variant="nav"
                      className="shrink-0"
                      onClick={() => onReglages(NEEDS[id].section)}
                    >
                      Réglages ›
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Step 3 — what will happen, and twenty seconds of proof that it can.
 *
 * ## The trial
 *
 * Everything else in this app is recoverable after the call: a model can be
 * configured later and the compte-rendu still gets written (DEC-39), a CRM that
 * is down drains, a token expires and the draft lands on the next attempt.
 * **Capture is the one thing that cannot be repaired afterwards.** Step 2 asks
 * for the permissions and reads the connector health back, which is a statement
 * about *grants* and not about sound — the grant can be given and the loopback
 * still produce nothing, and the microphone can be granted and muted in
 * hardware. The only way to know is to listen.
 *
 * So the rep can. `capture:essai` opens both channels for twenty seconds and
 * reports what each one heard, separately, because the two have opposite
 * failures: silence on their own channel means the compte-rendu reads as a
 * briefing the client delivered; silence on the machine's means it reads as a
 * monologue — and that second one is invisible from the inside, because their
 * own voice is in the transcript and the recording looks like it worked.
 *
 * Granola plays a video out of the speakers and transcribes it back. The
 * mechanism is right; the framing is theirs — it demonstrates the product. This
 * demonstrates the *machine*, which is the question a rep about to run it on a
 * real client actually has.
 *
 * It is offered, never automatic: a capture that started because somebody opened
 * a page is a capture nobody asked for. It stores nothing, transcribes nothing
 * and creates no meeting.
 *
 * ## The beats, and the two surfaces they used to leave out (US-18)
 *
 * They exist because knowing where the button is and what the end asks for is
 * what makes the first real call unremarkable. Measured on the version before
 * this one, on this file:
 *
 *     grep -niE "pastille|par-dessus|planifi|détect|notification" Onboarding.tsx
 *       → nothing
 *
 * Two things the product does on the first call were described nowhere, on the
 * one screen whose entire job is « voilà ce qui se passera ».
 *
 * **The pill** (`app/windows/Overlay.ts`, `src/widget/Widget.tsx`). Beat 1 said
 * « L'en-tête affiche alors deux barres de niveau » — the header of the window
 * the rep is about to leave behind Teams for fifty minutes. What actually
 * happens on *Enregistrer* is a second window: `main.ts` creates it `frame:
 * false`, `transparent: true`, `skipTaskbar: true`, at the `screen-saver`
 * always-on-top level and visible on every Space, positioned by
 * `overlayPlacement.ts`'s `defaultOrigin` — bottom centre of the work area —
 * over the face of the person on the call, and it carries
 * `window.setContentProtection(true)` (`main.ts`, « out of the screen share »).
 * It is the most visible thing this product does and the one surface with **no
 * taskbar entry and nothing to alt-tab to**, which is why `overlayPlacement.ts`
 * treats even a saved origin as « a request, never an instruction ». A rep who
 * has not been told what it is has that same problem on their first call, so
 * beat 2 names where it appears, what is on it, that it is out of a screen
 * share, that it can be dragged (`.drag-region`, `index.css`), and the two ways
 * out of it — *Ouvrir Sillage* and *Terminer*, both in the panel the chevron
 * opens, the second behind a confirmation.
 *
 * **The unscheduled-call detector** (`core/domain/adHoc.ts`). `AD_HOC_DWELL_MS`
 * is 25 000 ms of an application holding a **microphone** without interruption —
 * not a calendar entry, not a process list — and `Agenda.#armAdHoc` then arms a
 * meeting and fires `onArmed`, which `main.ts` turns into one OS notification
 * (DEC-46) whose click opens the window on it. Beat 1 described only the manual
 * route, which is exactly the case the detector now covers, so the detector
 * arrived as the app doing something nobody had mentioned, during a client call.
 * It is an **offer**: nothing in `adHoc.ts` starts a recording, the row is a
 * « Prêt » in the day list carrying *Enregistrer* (`agenda/DayPane.tsx`), and
 * ignoring it costs nothing.
 *
 * **The mention sentence** (`src/widget/mention.ts`, US-11) is named in the same
 * beat as the pill and in one clause, because it is a control *on* the pill —
 * not a fourth thing to read.
 *
 * What this section still refuses: a picture of the pill (an image of a surface
 * is a second place it is described, and it goes stale), and a fourth step —
 * three is the count the progress dots draw.
 */
function Essai({ onReglages }: { onReglages: () => void }) {
  return (
    <section>
      <h2 className="text-strong font-display mb-3 text-[22px] leading-tight">
        Votre premier appel
      </h2>
      <p className="text-body mb-block text-copy leading-relaxed">
        Rien de plus à préparer. Voilà ce qui se passera.
      </p>

      <EssaiAudio onReglages={onReglages} />

      <ol className="space-y-row">
        <Beat
          n="1"
          title="Vous démarrez"
          says={[
            'Depuis le calendrier, sur la réunion du jour — ou avec « Démarrer une réunion » si elle n’y est pas.',
            'Et si l’appel n’était pas prévu, Sillage le remarque : quand une application garde le micro vingt-cinq secondes d’affilée, la journée affiche une ligne « Prêt » et une notification vous le dit. C’est une proposition, jamais un enregistrement — rien ne s’enregistre avant que vous n’appuyiez sur « Enregistrer », et ne pas y répondre ne coûte rien.',
          ]}
        />
        <Beat
          n="2"
          title="Une pastille reste au-dessus de l’appel"
          says={[
            'Dès que l’enregistrement commence, une pastille s’affiche en bas de l’écran, par-dessus l’appel : les deux barres de niveau — la vôtre et celle du client, et tant qu’elles bougent l’appel est capté —, la durée, de quoi marquer un moment, et un bouton qui copie la phrase prévenant votre interlocuteur que l’échange est transcrit, à coller dans la conversation ou à lire à voix haute.',
            'Elle n’apparaît ni dans un partage d’écran, ni dans la barre des tâches : pour revenir à l’application, ouvrez son panneau puis « Ouvrir Sillage ». « Terminer » est au même endroit et demande confirmation avant d’arrêter l’enregistrement. Vous pouvez la déplacer en la faisant glisser ; elle revient là où vous l’avez posée.',
          ]}
        />
        <Beat
          n="3"
          title="Vous prenez vos notes, normalement"
          says={[
            'Le bloc-notes est à vous. À droite, Sillage note au passage ce qu’il entend — profil, TJM, durée, objections — sans rien écrire chez vous.',
          ]}
        />
        <Beat
          n="4"
          title="Vous validez, une fois"
          says={[
            'À la fin, le compte-rendu s’écrit et Sillage vous montre ce qu’il s’apprête à créer. Chaque valeur porte l’extrait de l’appel dont elle vient, et celles qu’il n’a pas pu retrouver dans l’enregistrement sont signalées. Vous corrigez, vous validez, c’est parti.',
          ]}
        />
      </ol>
    </section>
  )
}

/**
 * One beat, in one or two paragraphs.
 *
 * `says` is a list rather than a `children` string because two of the four beats
 * now hold two sentences' worth of two different facts — what the pill *is* and
 * how to get out of it — and one paragraph of six lines on a first-run screen is
 * a paragraph nobody finishes. `.measure` goes on each `<p>`, never on the
 * wrapper: `ch` resolves against the element's own font size, so a wrapper
 * wearing it at one size leaves a child at another completely unconstrained.
 */
function Beat({ n, title, says }: { n: string; title: string; says: readonly string[] }) {
  return (
    <li className="flex gap-3">
      <span className="text-brand-700 w-4 shrink-0 tabular-nums text-copy font-semibold">{n}</span>
      <div className="min-w-0 space-y-1">
        <h3 className="text-strong text-copy font-semibold">{title}</h3>
        {says.map((line) => (
          <p key={line} className="text-muted measure text-ui leading-relaxed">
            {line}
          </p>
        ))}
      </div>
    </li>
  )
}
