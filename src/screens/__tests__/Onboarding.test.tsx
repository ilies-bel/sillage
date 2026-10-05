/**
 * First run.
 *
 * The prose is not what these guard. What has to hold is everything that makes
 * this an onboarding rather than a wall:
 *
 *  · **it is never a gate** — *Continuer* is live on a step where nothing has
 *    been granted, because a rep with no microphone still has a calendar, a
 *    notepad and a recorder (DEC-26);
 *  · **every exit records it** — including *Passer* and *Réglages ›*, because
 *    showing this again to somebody who said no is how an onboarding becomes the
 *    thing people close without reading;
 *  · **the states are measured** — the rows are `health:snapshot` filtered to
 *    the required subsystems (DEC-32), not a checklist the screen keeps for
 *    itself;
 *  · **the remedy fits the fault** — a retryable connector gets the retry, one
 *    that needs a decision gets the screen where the decision is made, and
 *    neither is offered where it cannot work.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { HealthSnapshot } from '../../../electron/core/contracts/health.ts'
import type { CapturePermission } from '../../../electron/core/contracts/permissions.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../test/appBridge.ts'
import { Onboarding } from '../Onboarding.tsx'

let bridge: FakeBridge
let uninstall: () => void

const HEALTHY: HealthSnapshot = {
  capture: { state: 'ok' },
  transcribe: { state: 'ok' },
  llm: { state: 'ok' },
  calendar: { state: 'ok' },
  crm: { state: 'ok' },
  mail: { state: 'ok' },
}

/** What a machine actually looks like the first time the app is opened on it. */
const FIRST_RUN: HealthSnapshot = {
  ...HEALTHY,
  /*
    The sentence `core/domain/capturePermission.ts` really composes for a Mac
    whose screen-recording prompt has not been answered. It said « macOS n'a pas
    encore autorisé l'enregistrement de l'écran », which the app never emitted —
    a test fixture is a fixture too, and one that invents a string cannot hold
    the screen that prints it.
  */
  capture: {
    state: 'degraded',
    reason:
      'l’audio système n’est pas autorisé — le client ne sera pas enregistré, vous seul le serez. Autorisez-le pour que Sillage puisse l’enregistrer.',
    since: 1,
    retryable: true,
  },
  llm: { state: 'down', reason: 'aucun modèle de langage configuré', since: 1, retryable: false },
}

const open = (health: HealthSnapshot = FIRST_RUN, initialStep?: 'quoi' | 'besoins' | 'essai') => {
  bridge.when('health:snapshot', () => health)
  const done: number[] = []
  const reglages: { section: string; step: string }[] = []
  render(
    <Onboarding
      onDone={() => done.push(1)}
      onReglages={(target) => reglages.push(target)}
      initialStep={initialStep}
    />,
  )
  return { done, reglages }
}

/** Step 1 → step 2. */
const toBesoins = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
  })
  await screen.findByRole('heading', { name: 'Ce dont Sillage a besoin' })
}

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
  bridge.when('onboarding:seen', () => ({ seen: true }))
  bridge.when('health:retry', () => ({ state: 'ok' as const }))
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('it is not a gate', () => {
  test('Continuer is live on a machine where nothing is granted', async () => {
    open()
    await toBesoins()

    // Nothing works on this machine, and the rep can still go on. Holding the
    // window shut to protest a missing subsystem takes away everything that
    // still works — a calendar, a notepad and a recorder.
    const next = screen.getByRole('button', { name: 'Continuer' })
    expect((next as HTMLButtonElement).disabled).toBe(false)
  })

  test('Passer is on every step, in the same place', async () => {
    open()
    expect(screen.getByRole('button', { name: 'Passer' })).toBeTruthy()
    await toBesoins()
    expect(screen.getByRole('button', { name: 'Passer' })).toBeTruthy()
  })
})

describe('every way out records it', () => {
  test('Passer records it before handing back', async () => {
    const { done } = open()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Passer' }))
    })

    await waitFor(() => expect(done).toEqual([1]))
    // Recorded *before* the caller is told: the other order loses the flag
    // whenever the write is slower than the re-render, which is every time.
    expect(bridge.calls.some((call) => call.channel === 'onboarding:seen')).toBe(true)
  })

  /*
   * The one that is easy to miss. *Réglages ›* does not go through the same exit
   * as the buttons in the footer, so without its own write the rep who left by
   * the one link that actually fixes their problem is the one rep shown this
   * screen again on the next launch.
   */
  test('Réglages › records it too', async () => {
    const { reglages } = open()
    await toBesoins()

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Réglages/ })[0] as HTMLElement)
    })

    await waitFor(() => expect(reglages).toHaveLength(1))
    expect(bridge.calls.some((call) => call.channel === 'onboarding:seen')).toBe(true)
  })

  test('a preference that will not save does not trap the rep', async () => {
    bridge.when('onboarding:seen', () => {
      throw new Error('base indisponible')
    })
    const { done } = open()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Passer' }))
    })

    // The worst case is seeing this screen once more. It is not a blank window.
    await waitFor(() => expect(done).toEqual([1]))
  })
})

describe('Réglages is a detour, and it lands on the right pane', () => {
  /*
   * Both links used to land on the section Réglages happens to open on, so a
   * rep told « à choisir dans Réglages » about the language model arrived on
   * the connector list. Routing that stops at the screen is not routing.
   */
  test('the analysis row opens the language-model pane', async () => {
    const { reglages } = open()
    await toBesoins()

    const row = screen.getByText(/aucun modèle de langage configuré/).closest('li')
    await act(async () => {
      fireEvent.click(row?.querySelector('button') as HTMLElement)
    })

    await waitFor(() => expect(reglages[0]?.section).toBe('llm'))
  })

  /*
   * And it carries the step. Réglages *replaces* this screen rather than
   * covering it, so a rep who came back to step 1 would re-read « Sillage
   * écoute l'appel » as the reward for having gone and fixed what was asked.
   */
  test('it carries the step the rep left, and resuming lands there', async () => {
    const { reglages } = open()
    await toBesoins()

    const row = screen.getByText(/aucun modèle de langage configuré/).closest('li')
    await act(async () => {
      fireEvent.click(row?.querySelector('button') as HTMLElement)
    })
    await waitFor(() => expect(reglages[0]?.step).toBe('besoins'))

    // What `App.tsx` does with it: the screen comes back where it was left.
    cleanup()
    open(FIRST_RUN, 'besoins')
    expect(screen.getByRole('heading', { name: 'Ce dont Sillage a besoin' })).toBeTruthy()
  })
})

describe('the rows are measured, and the remedy fits the fault', () => {
  test('a retryable fault gets the retry, and it is the real one', async () => {
    open()
    await toBesoins()

    // The connector's own sentence, not a rewrite of it.
    expect(screen.getByText(/l’audio système n’est pas autorisé/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Autoriser' }))
    })

    // `health:retry`, the same channel Réglages calls — not a second path that
    // could one day disagree about what « autoriser » means.
    const retry = bridge.calls.find((call) => call.channel === 'health:retry')
    expect(retry?.payload).toEqual({ connector: 'capture' })
  })

  test('a fault that needs a decision offers the screen, not a retry', async () => {
    open()
    await toBesoins()

    // « aucun modèle de langage configuré » is not fixed by trying again, so
    // there is no *Autoriser* on that row — offering one would be the dead
    // control DEC-26 forbids.
    const within = screen.getByText(/aucun modèle de langage configuré/).closest('li')
    expect(within?.querySelector('button')?.textContent).toContain('Réglages')
  })

  test('a healthy machine shows no remedy at all', async () => {
    open(HEALTHY)
    await toBesoins()

    expect(screen.queryByRole('button', { name: 'Autoriser' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Réglages/ })).toBeNull()
    // Two rows — transcription ships ready and is not asked for — both measured as ready.
    expect(screen.getAllByText('prêt')).toHaveLength(2)
  })

  test('it names what the permission buys, not what the connector is called', async () => {
    open()
    await toBesoins()

    // « Audio » is what Réglages calls it, and Réglages is a screen for somebody
    // who already knows what the app does. Here the row has to answer « why is
    // it asking me this ».
    expect(screen.getByText(/il écoute ce que votre machine joue et ce que dit votre micro/)).toBeTruthy()

    /*
     * And it says it *once*. « vous seul le serez » closed this sentence and the
     * permission warning forty pixels below it, verbatim, on the row a first-run
     * rep reads most carefully. The warning keeps the clause, because it is the
     * one that only appears when it is true.
     */
    expect(screen.getAllByText(/vous seul le serez/)).toHaveLength(1)
  })
})

describe('the dry run', () => {
  /*
   * Step 2 asks for the permissions and reads the connector health back, which
   * is a statement about *grants* and not about sound: the grant can be given
   * and the loopback still produce nothing. Capture is the one subsystem that
   * cannot be repaired after the call, so it is the one worth listening to
   * before one.
   */
  const toEssai = async () => {
    await toBesoins()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    })
    await screen.findByRole('heading', { name: 'Votre premier appel' })
  }

  test('it is offered and never automatic', async () => {
    open()
    await toEssai()

    // A capture that started because somebody opened a page is a capture
    // nobody asked for.
    expect(bridge.calls.some((call) => call.channel === 'capture:essai')).toBe(false)
    expect(screen.getByRole('button', { name: /^Essai de/ })).toBeTruthy()
  })

  test('it names which side was not heard, and what to check', async () => {
    bridge.when('capture:essai', () => ({
      rep: { heard: true, peak: 0.42 },
      far: { heard: false, peak: 0.003 },
      floor: 0.008,
      seconds: 20,
    }))
    open()
    await toEssai()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Essai de/ }))
    })

    // The failure a rep cannot discover on their own: their own voice is in the
    // transcript, so the recording looks like it worked.
    expect(await screen.findByText(/le client non/)).toBeTruthy()
    // Nothing is staged on `capture:permission` here, so nothing is
    // outstanding — and then the remedy is the half that is true on any host.
    expect(screen.getByText(/vérifiez la sortie audio utilisée/)).toBeTruthy()
    // It does not claim a grant is missing, which it has no way to know and
    // which on this host it has measured as present.
    expect(screen.queryByText(/autorisé/)).toBeNull()
    // And the other channel is reported separately, not merged into a verdict.
    expect(screen.getByText(/Ce que vous dites sera transcrit/)).toBeTruthy()
  })

  /*
   * **The screen-level half of the same guard, on the surface that draws the
   * button.**
   *
   * The contract test (`essai.test.ts`) reads the sentence against the consent;
   * this one checks that the card hands its consent *to* the composer, because
   * for one round it handed it only to the controls below. The two assertions
   * that matter are a pair: the clause appears, and it names the pane that
   * holds the setting rather than Sillage's own — « Réglages » has none
   * (`autoris` appears nowhere in `Reglages.tsx`), and this screen is the one
   * DEC-45 lets outrank the boot probe.
   */
  test('a refused grant is named, and sends the rep to the pane that holds it', async () => {
    bridge.when('capture:permission', () => consent({ state: 'denied', channel: 'screen' }))
    bridge.when('capture:essai', () => ({
      rep: { heard: true, peak: 0.42 },
      far: { heard: false, peak: 0.003 },
      floor: 0.008,
      seconds: 20,
    }))
    open()
    await toEssai()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Essai de/ }))
    })

    await screen.findByText(/le client non/)
    // « l’audio système », not « l’enregistrement de l’écran »: Windows has no
    // screen-recording permission to grant, and it is the primary platform.
    expect(screen.getByText(/l’audio système n’est pas autorisé/)).toBeTruthy()
    expect(screen.getByText(/réglages de confidentialité du système/)).toBeTruthy()
    expect(screen.queryByText(/autorisé dans Réglages/)).toBeNull()
  })

  /*
   * **This test used to assert the mechanism and never the remedy, and that is
   * how the dead button survived a round.**
   *
   * It read: press *Autoriser*, expect `health:retry({ connector: 'capture' })`,
   * expect the trial to run a second time. Both of those stayed true on a
   * machine whose permissions are granted — which is every Windows machine, the
   * primary platform (HR-2), where there is no screen-recording permission to
   * hold back at all. There `health:retry` probes the native module, finds
   * `actionFor('granted') === 'nothing'` for both channels, calls no OS API
   * whatever and republishes `ok`; the trial then re-runs against an unchanged
   * machine and fails identically, for ever. The assertion could not fail,
   * because it never asked what the press achieved.
   *
   * What it asks now is what `contracts/permissions.ts` states: the pane is the
   * remedy, it is offered only where consent is actually being withheld, and
   * pressing it re-measures. `capture/__tests__/EssaiAudio.test.tsx` walks the
   * whole consent matrix; this keeps the one path first run actually takes.
   */
  test('a channel that heard nothing gets the pane, and the pane re-measures', async () => {
    bridge.when('capture:permission', () => consent({ state: 'denied', channel: 'screen' }))
    bridge.when('capture:permission:open', () => ({ opened: true }))
    bridge.when('capture:essai', () => ({
      rep: { heard: true, peak: 0.42 },
      far: { heard: false, peak: 0.003 },
      floor: 0.008,
      seconds: 20,
    }))
    open()
    await toEssai()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Essai de/ }))
    })
    await screen.findByText(/le client non/)

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Ouvrir les réglages' })[0]!)
    })

    expect(bridge.calls.some((call) => call.channel === 'capture:permission:open')).toBe(true)
    // And it listens again, because a grant that changed nothing and a grant
    // that fixed it look identical until something listens.
    expect(bridge.calls.filter((call) => call.channel === 'capture:essai')).toHaveLength(2)
    // Never the prompt. The OS silently returns the old answer to a second ask.
    expect(bridge.calls.some((call) => call.channel === 'health:retry')).toBe(false)
  })

  /*
   * The same twenty seconds on a machine that is holding nothing back: the
   * silence is a mute switch or an audio route, and no button on this card
   * touches either. *Recommencer* is the honest re-run, after the rep has
   * changed something.
   */
  test('a machine with nothing to grant is offered no permission control', async () => {
    bridge.when('capture:permission', () =>
      consent({ state: 'ready', channel: null, reason: null, canOpenSettings: false }),
    )
    bridge.when('capture:essai', () => ({
      rep: { heard: true, peak: 0.42 },
      far: { heard: false, peak: 0.003 },
      floor: 0.008,
      seconds: 20,
    }))
    open()
    await toEssai()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Essai de/ }))
    })
    await screen.findByText(/le client non/)

    expect(screen.queryByRole('button', { name: 'Autoriser' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Recommencer' })).toBeTruthy()
  })

  test('silence is not called a fault', async () => {
    bridge.when('capture:essai', () => ({
      rep: { heard: false, peak: 0.001 },
      far: { heard: false, peak: 0.001 },
      floor: 0.008,
      seconds: 20,
    }))
    open()
    await toEssai()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Essai de/ }))
    })

    // The rep may simply have said nothing. Telling them their machine is
    // broken is a false statement they would act on.
    const summary = await screen.findByText(/Rien n’a été entendu pendant l’essai/)
    expect(summary.textContent).toMatch(/Si vous avez parlé ou joué un son/)
  })

  test('a refusal keeps the main process’s own sentence (DEC-26)', async () => {
    bridge.when('capture:essai', () => {
      throw new Error('Une réunion est en cours d’enregistrement — l’essai attendrait la fin.')
    })
    open()
    await toEssai()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Essai de/ }))
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Une réunion est en cours/)
  })

  test('it never blocks the way out', async () => {
    const { done } = open()
    await toEssai()

    // *Terminer* is live whether the trial has been run, has failed, or has
    // never been touched. It is not a gate (DEC-26).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Terminer' }))
    })
    await waitFor(() => expect(done).toEqual([1]))
  })
})

describe('the three steps', () => {
  test('the first one says the thing a rep would otherwise get wrong', async () => {
    open()
    // They will look for a bot in the attendee list, not find one, and conclude
    // nothing is recording.
    expect(screen.getByText(/Aucun robot ne rejoint la réunion/)).toBeTruthy()
  })

  test('the last one ends the onboarding rather than starting a recording', async () => {
    const { done } = open()
    await toBesoins()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    })
    await screen.findByRole('heading', { name: 'Votre premier appel' })

    // *Terminer*, not *Enregistrer*: starting a capture from here would put a
    // rep who is reading an explanation into a live recording.
    const last = screen.getByRole('button', { name: 'Terminer' })
    await act(async () => {
      fireEvent.click(last)
    })
    await waitFor(() => expect(done).toEqual([1]))
  })

  test('Retour goes back, and is absent on the first step', async () => {
    open()
    expect(screen.queryByRole('button', { name: 'Retour' })).toBeNull()

    await toBesoins()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retour' }))
    })
    expect(screen.getByText(/Aucun robot ne rejoint la réunion/)).toBeTruthy()
  })
})

/**
 * **Step 3 is prose about behaviour, and prose rots** (US-18).
 *
 * The paragraph these replace said « L'en-tête affiche alors deux barres de
 * niveau » about a screen the rep leaves behind Teams for fifty minutes, and it
 * was the truth when it was written. What it described was the whole of what the
 * product did on a call; since then the widget and the unscheduled-call detector
 * shipped, and neither appeared here — shape #7 on this repo's list, on the one
 * screen whose job is « voilà ce qui se passera ».
 *
 * A paragraph no test can see is a paragraph that rots the same way, so these
 * read the **rendered** text of step 3 and require the two surfaces to be named
 * in it. And the twenty-five seconds is read out of `core/domain/adHoc.ts`
 * itself rather than restated here: the renderer may not import `core/domain/`
 * (the import rule), so the constant is read as *source*, which is the
 * `preloadUnwrap.test.ts` shape and the only way a screen's prose can be pinned
 * to a number that lives in the main process.
 */
describe('step 3 describes the product that ships', () => {
  const toEssai = async () => {
    await toBesoins()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    })
    return await screen.findByRole('heading', { name: 'Votre premier appel' })
  }

  /** Everything drawn on step 3, as a reader would meet it. */
  const stepText = async () => {
    const heading = await toEssai()
    const section = heading.closest('section')
    if (!section) throw new Error('step 3 has no section')
    return section.textContent ?? ''
  }

  test('it names the pill, where it is, and the two ways out of it', async () => {
    open()
    const said = await stepText()

    // The surface itself, and where it lands — `overlayPlacement.defaultOrigin`
    // is the bottom centre of the work area, over the call.
    expect(said).toMatch(/pastille/)
    expect(said).toMatch(/en bas de l’écran/)
    expect(said).toMatch(/par-dessus l’appel/)

    // What is on it: the meter (DEC-38), the clock, the mark, and US-11's
    // sentence in one clause rather than as a beat of its own.
    expect(said).toMatch(/barres de niveau/)
    expect(said).toMatch(/marquer un moment/)
    expect(said).toMatch(/transcrit/)

    /*
     * And the two facts a window with no taskbar entry cannot leave unsaid:
     * `skipTaskbar: true` means there is nothing to alt-tab to, so the exits are
     * stated — *Ouvrir Sillage* and *Terminer*, both in the panel the chevron
     * opens, the second behind a confirmation, which `Widget.tsx` draws as a
     * second rectangle and which is said here rather than discovered.
     */
    expect(said).toMatch(/barre des tâches/)
    expect(said).toMatch(/Ouvrir Sillage/)
    expect(said).toMatch(/Terminer/)
    expect(said).toMatch(/confirmation/)

    // `main.ts` carries `setContentProtection(true)` on that window, and what is
    // on it is the client's own name and the rep's commercial notes.
    expect(said).toMatch(/partage d’écran/)
  })

  test('it names the detector as an offer, and never as a recording', async () => {
    open()
    const said = await stepText()

    // The trigger is a held **microphone** and a dwell — not a calendar entry,
    // which is the whole of what `adHoc.ts` was written to stop requiring.
    expect(said).toMatch(/garde le micro/)
    // What the rep sees: the « Prêt » row carrying *Enregistrer* and one OS
    // notification (DEC-46), whose click opens the window and starts nothing.
    expect(said).toMatch(/Prêt/)
    expect(said).toMatch(/notification/)
    // An offer, and ignoring it costs nothing (HR-7).
    expect(said).toMatch(/jamais un enregistrement/)
    expect(said).toMatch(/ne coûte rien/)
  })

  /*
   * The sentence is handed over; nothing here may claim it was accepted. The
   * product cannot know what the client said (`mention.ts`), and a screen that
   * implied otherwise would be inviting the rep to rely on it.
   */
  test('it never claims the client agreed', async () => {
    open()
    const said = await stepText()
    expect(said).not.toMatch(/consent|accept/i)
  })

  /*
   * The one number in this prose, held to the constant it describes.
   *
   * Twenty-five seconds is the whole safety argument in `adHoc.ts` — long enough
   * that a Slack voice note, a dictation and « test your microphone » cannot
   * reach it — so a rep told a different number has been told something about
   * their own day that is false. Read as source, because `src/*` may import
   * `core/contracts/` only.
   */
  test('the dwell it names is the dwell the detector waits', async () => {
    /*
     * From the project root, not from `import.meta.url`: under vitest's jsdom
     * environment that is an `http://` URL — the module was served, not read off
     * disk — and `readFileSync` refuses it (« The URL must be of scheme file »),
     * which is a different failure from the one this test is for. `vitest.config`
     * roots the run at the repo, and a path that stops resolving throws here
     * rather than passing quietly.
     */
    const source = readFileSync(
      join(process.cwd(), 'electron/core/domain/adHoc.ts'),
      'utf8',
    )
    const found = /AD_HOC_DWELL_MS\s*=\s*([\d_]+)/.exec(source)
    // A fixture that cannot find its subject is the first shape on the list.
    expect(found).toBeTruthy()
    const seconds = Number((found as RegExpExecArray)[1]?.replace(/_/g, '')) / 1000
    expect(seconds).toBe(25)

    const inFrench: Record<number, string> = { 20: 'vingt', 25: 'vingt-cinq', 30: 'trente' }
    const word = inFrench[seconds]
    // A dwell nobody here has a French word for is a dwell step 3 cannot state:
    // say so, rather than let the screen keep the old number.
    expect(word, `AD_HOC_DWELL_MS is now ${seconds}s — say it in Onboarding.tsx`).toBeTruthy()

    open()
    const said = await stepText()
    expect(said).toMatch(new RegExp(`${word} secondes`))
  })
})

/**
 * **The step that scrolls says how much of itself is left** (`ui/ReadingColumn`).
 *
 * jsdom measures every box as zero, so nothing here can say how much is hidden —
 * `scripts/harness`'s `onboarding-suite` presses the turn against real layout and
 * is the measurement. What a DOM test *can* hold is the structure that decides
 * which instrument is on the screen at all: the step is inside the shared reading
 * column, and `<main>` is the landmark rather than a second scroller with no mask
 * and no control, which is what it was.
 */
describe('a first-run step never hides its own last beat', () => {
  test('the step rides in the shared reading column, and main is not a scroller', () => {
    open()
    const main = document.querySelector('main')
    expect(main).toBeTruthy()

    // `fade-below` is the contract: the mask and the page turn come with it, and
    // it is the class `--fade` and `--scrollers` both key off.
    const column = main?.querySelector('.fade-below')
    expect(column).toBeTruthy()
    expect(column?.className).toMatch(/overflow-y-auto/)

    /*
     * And exactly one scroller. `<main>` scrolling as well would put a hard edge
     * back above the one that fades — the defect measured at 960×600, 54 pixels
     * of step 3 behind it with nothing saying so, on a landmark `--scrollers`
     * deliberately skips.
     */
    expect(main?.className ?? '').not.toMatch(/overflow-y-auto/)
  })
})

/**
 * **DEC-5's promise is made here, because the rail stopped repeating it.**
 *
 * The signal rail carried « Rien ne migre dans vos notes. » as its last line, in
 * every meeting, for the whole of every call — a statement, drawn permanently,
 * about a thing the product never does, at the foot of the column, which is where
 * the eye ends. Deleting it costs nothing only if the promise really is made
 * somewhere a rep is reading rather than talking, so this is the assertion that
 * came over with it from `session-output.test.tsx` (« la promesse ne disparaît
 * pas, elle change de surface »).
 *
 * Two halves, on two steps, and both are asked of the rendered step rather than
 * of the source: step 1 promises the notepad is untouched, and step 3 names the
 * rail, says what it collects, and says it writes nothing into the notes.
 */
describe('the promise the rail stopped repeating', () => {
  test('step 1 says the notepad is never written into (DEC-5)', () => {
    open()

    expect(screen.getByText(/n’écrit jamais dans votre bloc-notes pendant l’appel/)).toBeTruthy()
  })

  test('step 3 names the rail, what it collects, and that it writes nothing', async () => {
    open()
    await toBesoins()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    })
    const heading = await screen.findByRole('heading', { name: 'Votre premier appel' })
    const said = heading.closest('section')?.textContent ?? ''

    // The rail, by where it is and by what lands in it — the same four kinds the
    // slate draws (DEC-14), so this cannot pass on a sentence about something else.
    expect(said).toMatch(/À droite/)
    expect(said).toMatch(/profil, TJM, durée, objections/)
    expect(said).toMatch(/sans rien écrire chez vous/)
  })
})

/**
 * **Step 2's capture row, and the five states a rep can actually meet.**
 *
 * Three on a host with both prompts — never answered, refused, granted — and two
 * on the primary platform, where the only thing that can be off is a
 * machine-wide microphone switch and there is no screen-recording permission at
 * all (HR-2).
 *
 * What every one of these holds is the same property: **the renderer branches
 * on consent, never on a platform.** `capture:permission` answers four words and
 * a capability, and nothing in `Onboarding.tsx` asks what host it is on — the
 * one time a renderer in this repo did, the notepad shipped an eight-binding
 * mac-first keymap on the platform HR-2 calls primary, and it happened to be
 * correct on Windows, which is the point: the gate is « is this branch
 * declared », and a renderer branch is undeclarable.
 *
 * And the remedy fits which of the two it is. A **refusal** gets the pane and
 * never a second prompt: the OS silently returns the old answer to an ask it has
 * already had, so *Autoriser* on a refusal is a button that can never do
 * anything, for ever, with nothing on screen saying why. A permission **nobody
 * has answered** gets the prompt and never the pane — the case these tests were
 * green over, and the one every rep meets on their first launch.
 */
const consent = (over: Partial<CapturePermission> = {}): CapturePermission => ({
  state: 'denied',
  channel: 'screen',
  reason: 'Vous l’avez refusé : réautorisez Sillage dans les réglages de confidentialité du système.',
  canOpenSettings: true,
  ...over,
})

/** The capture row, found by the thing only it says. */
const captureRow = () =>
  screen.getByText(/il écoute ce que votre machine joue/).closest('li') as HTMLElement

describe('the capture row draws consent, and never a platform', () => {
  /**
   * **First launch, and the remedy it is owed.**
   *
   * `microphone` and `screen` both `not-determined` is every rep's first launch
   * on macOS. The row said « à autoriser » and drew one control — « Ouvrir les
   * réglages » — under a sentence saying « Autorisez-les pour que Sillage puisse
   * les enregistrer »: a privacy pane does not list an application that has
   * never attempted capture, so the only thing on screen sent the rep to a list
   * their app was not in. `actionFor('not-determined')` has answered `ask` all
   * along and `requestCaptureAccess` in `main.ts` fires the prompt on it; what
   * was missing was a channel out of `src/`.
   */
  test('a permission nobody has answered is asked for, not sent to the pane', async () => {
    bridge.when('capture:permission', () => consent({ state: 'to-grant' }))
    bridge.when('capture:permission:request', () =>
      consent({ state: 'ready', channel: null, reason: null, canOpenSettings: false }),
    )
    open()
    await toBesoins()

    await waitFor(() => expect(screen.getByText('à autoriser')).toBeTruthy())
    // One control, and it is the ask. The pane is the remedy for a refusal and
    // this is not one.
    expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()

    await act(async () => {
      fireEvent.click(captureRow().querySelector('button') as HTMLElement)
    })

    expect(bridge.calls.some((call) => call.channel === 'capture:permission:request')).toBe(true)
    expect(bridge.calls.some((call) => call.channel === 'capture:permission:open')).toBe(false)
    // The answer is the re-measured consent, so a grant lands on the row that
    // asked for it rather than on the next launch.
    await waitFor(() => expect(screen.getByText('prêt')).toBeTruthy())
  })

  test('a prompt the rep refused falls through to the pane, in one press', async () => {
    bridge.when('capture:permission', () => consent({ state: 'to-grant' }))
    // What the OS answers when the TCC prompt was refused: the status moves to
    // `denied`, and the pane is the only remedy left.
    bridge.when('capture:permission:request', () => consent())
    bridge.when('capture:permission:open', () => ({ opened: true }))
    open()
    await toBesoins()

    await waitFor(() => expect(screen.getByText('à autoriser')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Autoriser' }))
    })

    await waitFor(() => expect(screen.getByText('refusé')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Ouvrir les réglages' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Autoriser' })).toBeNull()
  })

  /**
   * The macOS screen-recording case, which `main.ts` states on the retry it
   * registers: the prompt is raised, the rep allows it, and the status answers
   * `not-determined` until the app is relaunched. Offering the same ask again
   * would be the dead control DEC-26 forbids — and the pane now works, because
   * the attempt is what put the app in the list.
   */
  test('an ask that moved nothing hands over to the pane and says so', async () => {
    bridge.when('capture:permission', () => consent({ state: 'to-grant' }))
    bridge.when('capture:permission:request', () => consent({ state: 'to-grant' }))
    open()
    await toBesoins()

    await waitFor(() => expect(screen.getByText('à autoriser')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Autoriser' }))
    })

    expect(screen.queryByRole('button', { name: 'Autoriser' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ouvrir les réglages' })).toBeTruthy()
    expect(screen.getByText(/n’a pas encore changé/)).toBeTruthy()
  })

  /**
   * An older main process: the channel is not there and the ask rejects. The row
   * must not be left with no remedy at all — it falls through to the pane, which
   * is what it had before this channel existed.
   */
  test('an ask the main process cannot answer leaves the pane behind it', async () => {
    bridge.when('capture:permission', () => consent({ state: 'to-grant' }))
    open()
    await toBesoins()

    await waitFor(() => expect(screen.getByText('à autoriser')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Autoriser' }))
    })

    expect(screen.getByRole('button', { name: 'Ouvrir les réglages' })).toBeTruthy()
  })

  test('a refusal names itself, and its one control opens the pane', async () => {
    bridge.when('capture:permission', () => consent())
    bridge.when('capture:permission:open', () => ({ opened: true }))
    open()
    await toBesoins()

    await waitFor(() => expect(screen.getByText('refusé')).toBeTruthy())
    // The sentence the main process composed, not a rewrite of it.
    expect(screen.getByText(/réautorisez Sillage dans les réglages de confidentialité/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ouvrir les réglages' }))
    })

    // The pane, and never `health:retry`: asking a second time is the control
    // that can never do anything, because the OS has stopped prompting.
    expect(bridge.calls.some((call) => call.channel === 'capture:permission:open')).toBe(true)
  })

  test('a granted machine says « prêt » and offers nothing', async () => {
    bridge.when('capture:permission', () =>
      consent({ state: 'ready', channel: null, reason: null, canOpenSettings: false }),
    )
    open(HEALTHY)
    await toBesoins()

    await waitFor(() => expect(screen.getAllByText('prêt')).toHaveLength(2))
    expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()
  })

  test('the microphone switch gets the word that names it', async () => {
    /*
      The primary platform's only refusable permission, and « refusé » is the
      wrong word for it: nobody answered a prompt, a machine-wide switch is off
      and is not associated with this app. The word a rep can act on is the one
      naming the thing that is off.
    */
    bridge.when('capture:permission', () =>
      consent({
        state: 'denied',
        channel: 'microphone',
        reason: 'le micro n’est pas autorisé — vous ne serez pas enregistré, seul le client le sera.',
      }),
    )
    open()
    await toBesoins()

    await waitFor(() => expect(screen.getByText('micro bloqué')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Ouvrir les réglages' })).toBeTruthy()
  })

  test('a managed device is told, and offered no button at all', async () => {
    // Neither asking nor visiting a pane changes a profile. A control here would
    // be the dead one DEC-26 forbids, and the sentence is the whole remedy.
    bridge.when('capture:permission', () =>
      consent({
        state: 'blocked',
        channel: 'both',
        reason: 'Cet ordinateur est géré et l’autorisation est bloquée par votre service informatique.',
        canOpenSettings: false,
      }),
    )
    open()
    await toBesoins()

    await waitFor(() => expect(screen.getByText('bloqué')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Ouvrir les réglages' })).toBeNull()
    expect(screen.getByText(/votre service informatique/)).toBeTruthy()
  })

  test('a main process that cannot answer leaves the row as it was', async () => {
    // No `capture:permission` responder: the channel rejects, exactly as it does
    // against a build that does not have it. The row keeps the health sentence
    // and the retry it already had rather than drawing an error (DEC-26).
    open()
    await toBesoins()

    expect(screen.getByText(/l’audio système n’est pas autorisé/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Autoriser' })).toBeTruthy()
  })
})
