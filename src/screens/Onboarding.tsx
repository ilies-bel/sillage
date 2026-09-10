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
import { invoke, useBroadcast, useInvoke } from '../app/bridge.ts'
import { Button, StateDot, unavailable, type StateDotProps } from '../ui/index.ts'
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
    why: 'Sillage ne rejoint jamais la réunion : il écoute ce que votre machine joue et ce que dit votre micro. Sans l’audio système, le client n’est pas enregistré — vous seul le serez.',
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
      <header className="mx-auto flex w-full max-w-[66ch] shrink-0 items-baseline gap-inline px-gutter pb-4 pt-7">
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
      */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-gutter pb-block">
        <div className="measure mx-auto my-auto w-full">
          {step === 'quoi' ? <Quoi /> : step === 'besoins' ? <Besoins onReglages={(section) => void toReglages(section)} /> : <Essai />}
        </div>
      </main>

      <footer className="border-subtle bg-card shrink-0 border-t px-gutter py-row">
        <div className="measure mx-auto flex items-center gap-inline">
          {/*
            Three dots, not « étape 2 sur 3 ». The count is worth knowing and the
            sentence is not — it is the same information spelled out at the width
            of a line, on a screen whose whole argument is that it is short.
          */}
          <ol className="flex shrink-0 items-center gap-1.5" aria-label={`Étape ${index + 1} sur 3`}>
            {ORDER.map((id, at) => (
              <li
                key={id}
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  at === index ? 'bg-brand-700' : at < index ? 'bg-brand-300' : 'bg-subtle'
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
          the element's own size, so 66ch of `--type-copy` is 97 characters once
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
 * Step 3 — the first call.
 *
 * Granola ships a video for this and transcribes it live, which proves the chain
 * on the rep's own machine in two minutes. The equivalent here is the rep's own
 * next meeting: there is no asset to ship, and a fabricated demo recording would
 * prove that the *fixture* works.
 *
 * So this step is the smallest true thing — where the button is, what happens
 * when it is pressed, and what the rep will be asked at the end. It ends the
 * onboarding rather than starting a recording, because starting one from here
 * would put a rep who is reading an explanation into a live capture.
 */
function Essai() {
  return (
    <section>
      <h2 className="text-strong font-display mb-3 text-[22px] leading-tight">
        Votre premier appel
      </h2>
      <p className="text-body mb-block text-copy leading-relaxed">
        Rien de plus à préparer. Voilà ce qui se passera.
      </p>

      <ol className="space-y-row">
        <Beat n="1" title="Vous démarrez">
          Depuis le calendrier, sur la réunion du jour — ou avec « Démarrer une réunion » si elle
          n’y est pas. L’en-tête affiche alors deux barres de niveau : la vôtre et celle du client.
          Tant qu’elles bougent, l’appel est capté.
        </Beat>
        <Beat n="2" title="Vous prenez vos notes, normalement">
          Le bloc-notes est à vous. À droite, Sillage note au passage ce qu’il entend — profil, TJM,
          durée, objections — sans rien écrire chez vous.
        </Beat>
        <Beat n="3" title="Vous validez, une fois">
          À la fin, le compte-rendu s’écrit et Sillage vous montre ce qu’il s’apprête à créer.
          Chaque valeur porte l’extrait de l’appel dont elle vient, et celles qu’il n’a pas pu
          retrouver dans l’enregistrement sont signalées. Vous corrigez, vous validez, c’est parti.
        </Beat>
      </ol>
    </section>
  )
}

function Beat({ n, title, children }: { n: string; title: string; children: string }) {
  return (
    <li className="flex gap-3">
      <span className="text-brand-700 w-4 shrink-0 tabular-nums text-copy font-semibold">{n}</span>
      <div className="min-w-0">
        <h3 className="text-strong text-copy font-semibold">{title}</h3>
        <p className="text-muted measure text-ui leading-relaxed">{children}</p>
      </div>
    </li>
  )
}
