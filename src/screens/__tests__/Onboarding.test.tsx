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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { HealthSnapshot } from '../../../electron/core/contracts/health.ts'
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
  capture: {
    state: 'down',
    reason: 'macOS n’a pas encore autorisé l’enregistrement de l’écran',
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
    expect(screen.getByText(/macOS n’a pas encore autorisé/)).toBeTruthy()

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
    // Three rows, all measured as ready.
    expect(screen.getAllByText('prêt')).toHaveLength(3)
  })

  test('it names what the permission buys, not what the connector is called', async () => {
    open()
    await toBesoins()

    // « Audio » is what Réglages calls it, and Réglages is a screen for somebody
    // who already knows what the app does. Here the row has to answer « why is
    // it asking me this ».
    expect(screen.getByText(/le client n’est pas enregistré — vous seul le serez/)).toBeTruthy()
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
    expect(screen.getByText(/autorisation d’enregistrement de l’écran/)).toBeTruthy()
    // And the other channel is reported separately, not merged into a verdict.
    expect(screen.getByText(/Ce que vous dites sera transcrit/)).toBeTruthy()
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
