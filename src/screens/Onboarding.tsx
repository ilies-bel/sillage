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
import {
  captureRemedyFor,
  type CapturePermission,
  type CapturePermissionState,
} from '../../electron/core/contracts/permissions.ts'
import { REQUIRED_CONNECTORS } from '../../electron/core/contracts/status.ts'
import { EssaiAudio } from './capture/EssaiAudio.tsx'
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import {
  Button,
  ReadingColumn,
  StateDot,
  Wordmark,
  unavailable,
  type StateDotProps,
} from '../ui/index.ts'
import { SECTION_FOR_CONNECTOR, type SectionId } from './Reglages.tsx'

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
/**
 * Which of the required subsystems are worth a first-run card.
 *
 * Transcription is not one: the weights ship inside the installer and it has
 * no key, no account and no setting to make (HR-4, DEC-30). A card for a thing
 * that is already working is a checklist item a rep cannot act on. The two
 * that remain each need something from them — a consent, a decision.
 */
const ASKED = REQUIRED_CONNECTORS.filter((id) => id !== 'transcribe')

/**
 * `section` is not written out here any more: `SECTION_FOR_CONNECTOR` is
 * Réglages' own table of where a required subsystem is repaired, and two copies
 * of it drift the first time a pane is renamed — which is the same reason
 * `meetingAnchor` and `speakerLabel` live in one place.
 */
const NEEDS: Record<
  (typeof REQUIRED_CONNECTORS)[number],
  { title: string; why: string; section: SectionId }
> = {
  capture: {
    section: SECTION_FOR_CONNECTOR.capture,
    title: 'Le micro et l’audio de votre ordinateur',
    // The clause « vous seul le serez » used to close this sentence *and* the
    // permission warning forty pixels below it, verbatim, on the row a first-run
    // rep reads most carefully. The warning is the one that has to carry it: it
    // is the one that appears only when it is true.
    why: 'Sillage ne rejoint jamais la réunion : il écoute ce que votre machine joue et ce que dit votre micro. Il lui faut les deux pour que l’appel soit entier.',
  },
  transcribe: {
    section: SECTION_FOR_CONNECTOR.transcribe,
    title: 'La transcription',
    why: 'Sur cette machine par défaut. Le modèle est téléchargé une fois et reste ici.',
  },
  llm: {
    section: SECTION_FOR_CONNECTOR.llm,
    title: 'L’analyse',
    why: 'Ce qui écrit le compte-rendu à la fin de l’appel : un modèle sur cette machine ou un fournisseur avec votre clé. À choisir dans Réglages.',
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

/**
 * **The capture row says where consent stands, and it never says which
 * platform it is on.**
 *
 * `capture:permission` answers four words about consent plus `canOpenSettings`,
 * and those two are the whole of what this screen branches on. The five rows a
 * rep can actually meet fall out of them: « à autoriser » and « refusé » and
 * « prêt » on a host with the two prompts, « micro bloqué » and « prêt » on one
 * where only the microphone can be switched off. Nothing here counts hosts —
 * `src/` may not know what it is running on, and the one time a renderer did,
 * the notepad shipped an eight-binding mac-first keymap on the platform HR-2
 * calls primary.
 */
const CONSENT_TONE: Record<CapturePermissionState, StateDotProps['tone']> = {
  ready: 'ok',
  'to-grant': 'warn',
  denied: 'down',
  blocked: 'down',
}

/**
 * `denied` on the microphone alone gets its own word.
 *
 * « refusé » is right for a TCC prompt somebody answered no to and wrong for a
 * machine-wide switch nobody associates with this app — and that switch is the
 * whole of what can be missing on the primary platform. The word a rep can act
 * on is the one naming the thing that is off.
 */
const consentWord = (consent: CapturePermission): string => {
  if (consent.state === 'denied' && consent.channel === 'microphone') return 'micro bloqué'
  if (consent.state === 'denied') return 'refusé'
  if (consent.state === 'to-grant') return 'à autoriser'
  if (consent.state === 'blocked') return 'bloqué'
  return 'prêt'
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

  /*
   * **No `.grain` on this screen, and it is the one measurement nobody had
   * taken.**
   *
   * VISION §6 names the surfaces the tile is for — « splash, empty transcript
   * pane, empty signal rail, empty-state panels » — and then « never on dense
   * text ». This screen is four hundred words of body prose at the muted sizes
   * the palette only just clears AA at, and it wore `grain` on its root for
   * twenty-one rounds.
   *
   * Measured on the shipped PNG at 1280×800, a glyph-free band **inside the
   * reading column** (390,322 500×8 CSS px): σ **2.152 → 0.000**, peak-to-peak
   * **9.0 → 0.00**, mean luminance 244.80 → 248.72 — the tile was under every
   * sentence at full strength, indistinguishable from the empty margin beside
   * it. `--text-muted` #5d6b76 goes from 4.799:1 under the tile's darkest pixel
   * to 4.908:1 on the flat ground.
   *
   * Two things this is *not*. It is not the splash: measured the same way, the
   * splash's prose sits inside a `bg-scrim` card whose ground is already
   * σ 0.000 while its canvas grains at 2.149, so the tile never reaches a word
   * there and its `.grain` stays — `index.css` and VISION both name that file
   * beside this one, from the class list rather than from the pixels. And it is
   * not « paint an opaque ground under the measure »: tried, screenshotted, and
   * the 58ch column came out as a lighter slab cut hard at the text's own edges
   * with no padding around it, which is chrome this screen deliberately dropped.
   *
   * The texture is not lost to the product: `Splash` and `ui/EmptyState` still
   * carry it, which is both of §6's listed surfaces that exist today.
   */
  return (
    <div className="bg-canvas flex h-full flex-col">
      {/*
        Centred, and the column is the same `.measure` every prose surface in
        this app uses. It was left-aligned against the window edge, which on a
        1280 laptop put three paragraphs in the first 900px and a thousand
        pixels of nothing beside them — a first screen that reads as a pane that
        failed to load. `mx-auto` on the header, the body and the footer alike,
        so the three stay on one axis as the step changes height.

        **And for the header that was a sentence, not a fact.** It carried
        `max-w-[58ch]` and `px-gutter` on the *same* element, while `<main>` and
        the `<nav>` below both write the padding outside and put the measure on
        an inner box. `max-width` caps the border box, so the gutter came out of
        the measure: driven on the shipped renderer, the `<header>` spanned the
        reading column exactly — 383.88 → 896.13 at 1280×800, 223.88 → 736.13 at
        960×600 — and its *children* sat at 415.88 → 864.13 and 255.88 → 704.13.
        Exactly `--space-gutter` inside the axis, on both sides, at both sizes,
        on the nine stagings that draw this screen: the wordmark and *Passer*
        inset from the step title and the *Continuer* directly under them, on the
        first screen a rep ever sees. The footer was right the whole time and is
        the shape copied here.

        `--cells`' third claim is what measures it now, and it is measured rather
        than declared: `.measure`'s own cap is probed at the element's own font,
        and the padding only counts when the cap is what the box is sitting on.
      */}
      {/*
          `pt-7` was 28px, and the ladder's rungs are 4/6/8/12/16/20/32 — a
          number this file chose for itself, painted on 18 of this screen's
          stagings. It steps with the window like the calendar's own header:
          20 at 960×600, where every step of this screen already overflows its
          box, and 32 above the `lg` breakpoint. Net at the tight size, −8.
        */}
      <header className="shrink-0 px-gutter pb-row pt-block lg:pt-gutter">
        <div className="measure mx-auto flex w-full items-baseline gap-inline">
          {/*
            See `ui/Logo.tsx` — this drew the previous product's mark, invisibly.
            The mark and the word are one component now (`ui/Wordmark.tsx`): this
            header's proportion, 32px beside 28px, is the one it keeps, and it is
            what the app rail draws too. The word used to be set here, on the
            splash and in the rail in three different ways — measured, two weights
            and two colours, neither of them written down.
          */}
          <Wordmark asHeading className="self-center" />
          <p className="text-muted min-w-0 flex-1 text-ui">Première utilisation</p>
          {/*
            The way out, on every step and in the same place. An onboarding whose
            only exit is the end of it is a modal, and a rep who installed this
            between two meetings has ninety seconds.
          */}
          <Button variant="text" className="shrink-0" onClick={() => void leave()}>
            Passer
          </Button>
        </div>
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
          The noun and its determiner, never a label (R32-2, `ui/readingSubject.ts`).
          `ReadingColumn` draws one control in two grammatical frames — « Lire la
          suite **de cette** étape » going down, « Remonter dans **cette** étape »
          coming back — and it used to interpolate one string into both, so this
          screen read « Remonter dans de cette étape » after the two presses that
          reach the foot of step 3 at 960×600. There is no phrase that is correct
          in both frames, which is why the caller stopped supplying one: `cette`
          is a determiner the component knows how to put « de » in front of.
        */}
        {/*
          **`pt-row` is not decoration: without it the step title touches the
          header.**

          The column is `my-auto`, which centres a short step and collapses to
          zero the moment the content is taller than the box — and at 960×600
          every step is. Measured there, the `h2` of each step stood **0px under
          the header and 12px above its own first paragraph**: a title with more
          room below it than above, which is the third of `--rhythm`'s claims,
          red on ten stagings. 16 above, 12 below.
        */}
        <ReadingColumn
          subject={{ determiner: 'cette', noun: 'étape' }}
          className="flex flex-col px-gutter pb-block pt-row"
        >
          <div className="measure mx-auto my-auto w-full">
            {step === 'quoi' ? <Quoi /> : step === 'besoins' ? <Besoins onReglages={(section) => void toReglages(section)} /> : <Essai onReglages={() => void toReglages('connecteurs')} />}
          </div>
        </ReadingColumn>
      </main>

      {/*
        **The footer is gone, and what stood on it is not.**

        It was a ruled, card-coloured bar across the bottom of the window — the
        furniture of a wizard, on the one screen whose whole argument is that it
        is short, and the heaviest thing on a first-run screen was the chrome
        around the button rather than the button. The three controls stay
        exactly where they were and keep their own axis; what left is the rule
        and the second background.

        It stays **outside** the reading column on purpose. *Continuer* is never
        withheld (DEC-26), and a *Continuer* that has scrolled below the fold is
        withheld in the only sense a rep can measure.
      */}
      <nav aria-label="Progression" className="shrink-0 px-gutter pb-block pt-row">
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
          <ol className="flex shrink-0 items-center gap-tight" aria-label={`Étape ${index + 1} sur 3`}>
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
      </nav>
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
      <h2 className="text-strong font-display mb-inline text-title leading-tight">
        Sillage écoute l’appel, il n’y participe pas.
      </h2>
      <p className="text-body mb-block text-copy leading-relaxed">
        Aucun robot ne rejoint la réunion et personne ne voit que vous enregistrez. Sillage écoute
        ce que votre ordinateur joue et ce que dit votre micro, puis écrit le compte-rendu à la fin.
      </p>

      <ul className="space-y-block">
        <Promise title="Rien ne part sans vous">
          À la fin de l’appel, Sillage vous montre le compte-rendu, la tâche VerySwing et le
          brouillon de relance. Rien n’est créé tant que vous n’avez pas validé — une fois. Et il
          n’écrit jamais dans votre bloc-notes pendant l’appel.
        </Promise>
        <Promise title="La transcription reste sur cette machine">
          C’est le réglage par défaut. L’audio est transcrit puis effacé ; il n’est jamais conservé.
        </Promise>
        <Promise title="Sillage s’adapte à votre vocabulaire">
          TJM, régie, forfait, intercontrat : il connaît les mots du métier. Il apprend aussi les
          vôtres — les noms de vos interlocuteurs et de leurs sociétés, lus dans l’invitation, et
          les termes que vous corrigez, retenus pour les appels suivants.
        </Promise>
      </ul>
    </section>
  )
}

/**
 * One promise: a heading and a sentence. **No box.**
 *
 * These were three identically-sized bordered cards, which is the page
 * structure craft-floor names first — and it is the exact pattern the agenda
 * gave up two commits earlier, still standing on the first screen a rep ever
 * sees. `--bg-canvas` #f7f9fb and `--bg-card` #fdfefe are 1.3% apart in
 * luminance, so the grouping was carried entirely by three identical 1px
 * strokes; VISION.md §6 has asked for « rows, not cards » throughout, and the
 * reference boxes nothing on its equivalent screen.
 *
 * What replaces them is space: `--space-block` between promises against
 * `--space-tight` between a heading and its own sentence, so each pair reads as
 * one thing and the three read as three. Tight groups, generous separation.
 */
function Promise({ title, children }: { title: string; children: string }) {
  return (
    <li>
      <h3 className="text-strong mb-tight text-copy">{title}</h3>
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
   * Consent, read apart from health and on purpose.
   *
   * `health.capture` is one sentence and one tone, which is the right shape for
   * the status strip (DEC-32) and cannot say whether a permission was *refused*
   * or simply never asked — and those two lead a rep to different places. The
   * channel answers it in platform-neutral words, so this screen draws the
   * difference without ever learning what host it is on.
   *
   * A refusal to answer is not an error on screen: an older main process, or a
   * host where nothing can be asked, leaves `consent` null and the row falls
   * back to the health sentence and the retry it already had (DEC-26).
   */
  const permission = useInvoke('capture:permission', {})
  const consent: CapturePermission | null =
    permission.state.status === 'ready' ? permission.state.value : null
  const [opening, setOpening] = useState(false)
  /*
   * **Whether this screen has already made the OS ask.**
   *
   * `to-grant` means nobody has answered, and the remedy for that is the prompt
   * — not the pane, which does not list an application that has never attempted
   * capture. But the ask can leave the status exactly where it was: on macOS the
   * screen-recording grant does not land until the app is relaunched, and
   * `main.ts` says so on the retry it registers. Offering the same press again
   * there is the control DEC-26 forbids, so one ask hands the row over to the
   * pane — which the attempt has just made useful.
   */
  const [asked, setAsked] = useState(false)
  const [granting, setGranting] = useState(false)
  /*
   * A pane that would not open is said out loud.
   *
   * `canOpenSettings` says the host has a URL, which is measured before the
   * press; whether the OS actually took it is only known after. A button that
   * appears to do nothing teaches a rep that the screen is broken, so the one
   * thing it can still tell them is that the door did not open and where to go
   * by hand.
   */
  const [paneRefused, setPaneRefused] = useState(false)

  /*
   * The pane is opened, then consent is re-read. A rep grants it in the window
   * that just came up and comes straight back, and a row still saying « refusé »
   * over a permission they have just given is a screen calling them a liar.
   */
  /*
   * The prompt, then the consent as it stands afterwards — `request` re-measures
   * in the main process, so the row that asked is the row that reports. A
   * rejection (an older build with no such channel) still counts as asked: the
   * pane behind it is what this row had before the channel existed, and leaving
   * the rep with no control at all would be worse than the dead end it replaces.
   */
  const ask = async () => {
    setGranting(true)
    try {
      permission.set(await invoke('capture:permission:request', {}))
    } catch {
      // No sentence of our own: the row already carries the main process's.
    } finally {
      setAsked(true)
      setGranting(false)
    }
  }

  const openSettings = async () => {
    setOpening(true)
    try {
      const { opened } = await invoke('capture:permission:open', {})
      setPaneRefused(!opened)
    } catch {
      setPaneRefused(true)
    } finally {
      setOpening(false)
      permission.reload()
    }
  }

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
      <h2 className="text-strong font-display mb-inline text-title leading-tight">
        Ce dont Sillage a besoin
      </h2>
      <p className="text-body mb-block text-copy leading-relaxed">
        Deux choses. La transcription, elle, est déjà là : rien à installer, rien à régler.
        Vous pouvez faire le reste maintenant ou plus tard — l’application s’ouvre dans tous les
        cas.
      </p>

      {/*
        **The same subtraction page 1 made, on the page beside it.**

        These were three bordered cards with a 6px corner and a drop shadow; the
        radius and the shadow went when `check:tokens` grew a rule for
        off-scale utilities, and the boxes went from page 1 in the same pass —
        leaving first run boxed on one step and bare on the next, which is the
        half-applied shape this whole round has been about.

        Hairlines rather than page 1's pure whitespace, because these rows are
        not prose: each carries a state dot, a value and sometimes a control, so
        two adjacent rows with nothing between them read as one row with two
        dots. It is the same `divide-y` the calendar's lists use.
      */}
      <ul className="divide-y divide-[var(--border-subtle)]">
        {ASKED.map((id) => {
          const row: ConnectorHealth | null = snapshot?.[id] ?? null
          const state = row?.state ?? 'down'
          /*
            The capture row is the only one whose fault is a *consent*, and the
            only one whose remedy is a pane rather than a retry. When the channel
            has answered, it is what this row says; when it has not, the row is
            exactly what it was.
          */
          const permissionRow = id === 'capture' ? consent : null
          /*
            Ask, or open the pane — decided in `core/contracts/permissions.ts`
            because `main.ts` decides the same thing from the two `AccessStatus`es
            and the two must not be able to disagree about which act a press is.
          */
          const remedy = captureRemedyFor(permissionRow, asked)
          return (
            <li key={id} className="py-row">
              <div className="flex items-baseline gap-inline">
                <h3 className="text-strong min-w-0 flex-1 text-copy">
                  {NEEDS[id].title}
                </h3>
                {/*
                  Measured, never asserted. The dot says « prêt » because the
                  snapshot does, not because a button was pressed — which is the
                  difference between an onboarding and a form.
                */}
                <span className="shrink-0">
                  <StateDot
                    tone={
                      permissionRow
                        ? CONSENT_TONE[permissionRow.state]
                        : row
                          ? TONE[state]
                          : 'pending'
                    }
                    label={
                      permissionRow
                        ? consentWord(permissionRow)
                        : row
                          ? STATE_WORD[state]
                          : 'vérification…'
                    }
                  />
                </span>
              </div>
              <p className="text-muted measure mt-hair text-ui leading-relaxed">{NEEDS[id].why}</p>

              {/*
                Consent, when the channel answered: the sentence names what is
                missing and **one** control carries the act that can change it.

                Which act is the whole of this row's history. A refusal gets the
                pane and never a prompt — the OS silently returns the old answer
                to a second ask, so *Autoriser* there is the control DEC-26
                forbids. A permission nobody has answered gets the prompt and
                never the pane, because a pane does not list an application that
                has never attempted capture, and for the life of this screen that
                was the only control it drew on a first launch. A managed device
                gets neither: `canOpenSettings` is false, there is nothing to ask,
                and the sentence is the whole of what can be said.
              */}
              {permissionRow && permissionRow.state !== 'ready' ? (
                <div className="mt-snug flex items-baseline gap-inline">
                  <p className="text-warn measure min-w-0 flex-1 text-ui">{permissionRow.reason}</p>
                  {remedy === 'ask' ? (
                    <Button
                      className="shrink-0"
                      onClick={() => void ask()}
                      {...unavailable(granting, 'Demande…')}
                    >
                      {granting ? 'Demande…' : 'Autoriser'}
                    </Button>
                  ) : remedy === 'open' ? (
                    <Button
                      className="shrink-0"
                      onClick={() => void openSettings()}
                      {...unavailable(opening, 'Ouverture…')}
                    >
                      {opening ? 'Ouverture…' : 'Ouvrir les réglages'}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {/*
                An ask that changed nothing, said out loud — otherwise the only
                thing that happened is that one button became another, and a rep
                who authorised in the panel that just opened is looking at a row
                that still says « à autoriser » for a reason nothing explains.

                The clause about the pane is `canOpenSettings`', because it names
                a place: on a host with no privacy pane the row has no second
                control either, and sending somebody to look for one would be the
                dead end in words that this whole row is about.
              */}
              {permissionRow && asked && permissionRow.state === 'to-grant' ? (
                <p className="text-muted measure mt-hair text-ui leading-relaxed">
                  L’autorisation n’a pas encore changé. Sur certains systèmes elle ne prend effet
                  qu’au prochain démarrage de Sillage
                  {permissionRow.canOpenSettings
                    ? ' ; sinon, ouvrez les réglages de confidentialité — Sillage y figure maintenant.'
                    : '.'}
                </p>
              ) : null}
              {permissionRow && paneRefused ? (
                <p className="text-muted measure mt-hair text-ui leading-relaxed">
                  Les réglages de confidentialité ne se sont pas ouverts. Ouvrez-les vous-même :
                  l’autorisation de Sillage s’y trouve avec celles des autres applications.
                </p>
              ) : null}

              {!permissionRow && row && row.state !== 'ok' ? (
                <div className="mt-snug flex items-baseline gap-inline">
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
      <h2 className="text-strong font-display mb-inline text-title leading-tight">
        Votre premier appel
      </h2>
      <p className="text-body mb-block text-copy leading-relaxed">
        Rien de plus à préparer. En quatre temps :
      </p>

      <EssaiAudio onReglages={onReglages} />

      <ol className="space-y-row">
        <Beat
          n="1"
          title="Vous démarrez"
          says={[
            'Depuis le calendrier, ou avec « Démarrer une réunion ». Si une application garde le micro vingt-cinq secondes, la journée affiche une ligne « Prêt » et une notification vous le propose : c’est une proposition, jamais un enregistrement, et l’ignorer ne coûte rien.',
          ]}
        />
        <Beat
          n="2"
          title="Une pastille reste au-dessus de l’appel"
          says={[
            'Elle se pose en bas de l’écran, par-dessus l’appel, hors du partage d’écran et de la barre des tâches : deux barres de niveau, la durée, de quoi marquer un moment, et la phrase qui prévient votre interlocuteur que l’échange est transcrit.',
            'Son panneau tient « Ouvrir Sillage » et « Terminer », qui demande confirmation.',
          ]}
        />
        <Beat
          n="3"
          title="Vous prenez vos notes, normalement"
          says={[
            'Le bloc-notes est à vous. À droite, Sillage relève ce qu’il entend — profil, TJM, durée, objections — sans rien écrire chez vous.',
          ]}
        />
        <Beat
          n="4"
          title="Vous validez, une fois"
          says={[
            'À la fin, le compte-rendu s’écrit, chaque valeur cite l’extrait dont elle vient, et ce qui n’a pas été retrouvé est signalé. Vous corrigez, vous validez.',
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
    <li className="flex gap-inline">
      <span className="text-brand-700 w-4 shrink-0 tabular-nums text-copy font-semibold">{n}</span>
      <div className="min-w-0 space-y-hair">
        <h3 className="text-strong text-copy">{title}</h3>
        {says.map((line) => (
          <p key={line} className="text-muted measure text-ui leading-relaxed">
            {line}
          </p>
        ))}
      </div>
    </li>
  )
}
