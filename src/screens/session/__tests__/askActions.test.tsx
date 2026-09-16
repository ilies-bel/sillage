/**
 * The suggested action on a note, and the one rule it exists to keep.
 *
 * *Demander* opened on an empty field. The three question chips answer « what
 * can I ask it »; none of them answers « et maintenant, je fais quoi de ça ? »,
 * and the product's answer to that is the Outlook follow-up draft it composes
 * at the gate. So the note carries one chip that leads there.
 *
 * What has to hold, and it is the whole story:
 *
 *  · **the chip is offered only where its action can run.** No Microsoft
 *    account means `draftIntents` marks `mail.draft` « Aucun compte Microsoft
 *    connecté. » and no draft is ever created — which is the build DEC-28 ships
 *    the first demo in. No calendar entry means no attendees, so no recipients,
 *    which is that row's other reason. Either one and the chip is absent: a
 *    control that is present and does nothing is DEC-26's own example.
 *  · **the absence is not silence about the panel.** The three questions are
 *    untouched by it, so a rep with no Entra still gets everything *Demander*
 *    was.
 *  · **pressing it writes nothing and confirms nothing** (DEC-25, DEC-4). One
 *    `meeting:ask`, the same channel the text field uses, and no other.
 *
 * Driven through `Session`, not through `AskPanel`: the decision is made by the
 * screen — it is the only thing that holds `eventId` — so a test that handed
 * `AskPanel` an action would be testing the rendering of a conclusion somebody
 * else reached.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { AskAnswer } from '../../../../electron/core/contracts/ask.ts'
import type { Meeting } from '../../../../electron/core/contracts/meeting.ts'
import { fakeBridge, installBridge, type FakeBridge } from '../../../test/appBridge.ts'
import { Session } from '../../Session.tsx'
import { FOLLOW_UP, followUpOffered } from '../askActions.ts'

let bridge: FakeBridge
let uninstall: () => void

const COMPTE_RENDU = '# Néovia Santé\n\n## Résumé\n\nCadrage du renfort data.\n'

const ACCOUNT = {
  homeAccountId: 'h-1',
  username: 'lucas.marechal@sillage.fr',
  name: 'Lucas Maréchal',
  tenantId: 't-1',
}

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  id: 'm-hair',
  state: 'awaiting_confirmation',
  title: 'Néovia Santé — cadrage renfort data',
  // The ordinary case: this meeting came from an invite, so it has attendees.
  eventId: 'AAMkAG',
  clientName: 'Néovia Santé',
  scheduledStart: 1,
  createdAt: 1,
  startedAt: 1,
  endedAt: 2,
  confirmedAt: null,
  updatedAt: 2,
  ...over,
})

/**
 * The screen as the main process would answer for it.
 *
 * `entra: false` is the demo build DEC-28 ships: signed out, **with a reason**,
 * because there is no registration to sign into at all.
 */
const open = (options: { entra?: boolean; over?: Partial<Meeting> } = {}) => {
  const entra = options.entra !== false
  bridge.when('meeting:get', () => ({
    meeting: meeting(options.over ?? {}),
    segments: [],
    signals: [],
    outbox: [],
    document: null,
    compteRendu: COMPTE_RENDU,
    recipe: 'besoin-commercial' as const,
  }))
  bridge.when('auth:state', () =>
    entra
      ? ({ status: 'signedIn', account: ACCOUNT } as const)
      : ({
          status: 'signedOut',
          reason: 'aucune inscription Entra sur cette installation.',
        } as const),
  )
  return render(<Session meetingId="m-hair" onBack={() => {}} onReview={() => {}} />)
}

const chip = () => screen.queryByRole('button', { name: FOLLOW_UP.label })

/**
 * Wait for the read the chip actually depends on, never for the document.
 *
 * `meeting:get` and `auth:state` are two independent round trips: the document
 * text is the first and the chip is a function of the second. Every test below
 * awaited the document and then asserted synchronously, which is a race — and
 * one the suite lost three times in an afternoon, twice inside a worktree
 * agent's full run and once on the main checkout, and **only** under a full
 * parallel run, which is the shape that makes a flake read as noise. A test
 * that sometimes measures nothing is worse than no test: it trains everyone
 * who sees it red to run it again.
 *
 * What it costs is the two assertions that the chip **is** there. The three
 * that assert absence were suspected of being vacuous — « not there » is also
 * true before `auth:state` is answered — and they are **not**: measured with
 * two separate mutations (the rule deleted outright, and the rule offering the
 * chip as soon as the answer is known whatever it says), the old spelling and
 * this one go red identically, 5 and 6 failures respectively. Any mutation
 * that offers the chip offers it on the first render, before either read
 * lands, so the negatives see it. Recorded because it was worth an hour and
 * the next reader should not re-derive it.
 */
const authSettled = async () => {
  await waitFor(() => {
    expect(bridge.calls.some((call) => call.channel === 'auth:state')).toBe(true)
  })
  // The responder is synchronous; this is the flush that lets its resolution
  // reach the component's state before anything is asserted.
  await act(async () => {})
}

beforeEach(() => {
  bridge = fakeBridge()
  uninstall = installBridge(bridge)
})

afterEach(() => {
  cleanup()
  uninstall()
})

describe('the rule, on its own', () => {
  test('a signed-in account and a calendar entry is the only yes', () => {
    const auth = { status: 'signedIn', account: ACCOUNT } as const
    expect(followUpOffered({ auth, fromCalendar: true })).toEqual(FOLLOW_UP)
  })

  test('no Microsoft account, no follow-up — there is no draft to prepare', () => {
    expect(
      followUpOffered({ auth: { status: 'signedOut' }, fromCalendar: true }),
    ).toBeNull()
    expect(
      followUpOffered({
        auth: { status: 'signedOut', reason: 'aucune inscription Entra' },
        fromCalendar: true,
      }),
    ).toBeNull()
  })

  test('a call the calendar never knew about has nobody to address (DEC-7)', () => {
    const auth = { status: 'signedIn', account: ACCOUNT } as const
    expect(followUpOffered({ auth, fromCalendar: false })).toBeNull()
  })

  /*
   * In flight, or a read that failed. Absent is the safe answer here and
   * present is the one that has to be earned: withholding costs the rep a chip
   * whose question they can still type, and offering costs them a step towards
   * a draft that will not be there.
   */
  test('an account that could not be read is not an account', () => {
    expect(followUpOffered({ auth: null, fromCalendar: true })).toBeNull()
  })
})

describe('on the note, through the shipped screen', () => {
  test('the note carries one suggested action, beside the questions', async () => {
    open()
    await authSettled()

    expect(chip()).toBeTruthy()
    // And it has not replaced what the panel already offered.
    expect(screen.getByRole('button', { name: 'Qui décide, et quand ?' })).toBeTruthy()
  })

  test('the demo build has no Entra, so it has no follow-up chip (DEC-26, DEC-28)', async () => {
    open({ entra: false })
    await authSettled()

    expect(chip()).toBeNull()
    // Everything *Demander* was, it stays.
    expect(screen.getByLabelText('Poser une question sur cet appel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Qui décide, et quand ?' })).toBeTruthy()
  })

  test('an unscheduled call has no attendees, so it has no follow-up chip', async () => {
    open({ over: { eventId: null } })
    await authSettled()

    expect(chip()).toBeNull()
  })

  test('signing out takes the offer away without reopening the meeting', async () => {
    open()
    await authSettled()
    expect(chip()).toBeTruthy()

    act(() => {
      bridge.emit('auth:changed', { status: 'signedOut' })
    })

    expect(chip()).toBeNull()
  })
})

describe('pressing it is a read, like everything else here', () => {
  const answer = (): AskAnswer => ({
    question: FOLLOW_UP.question,
    answered: true,
    answer: 'Le commercial s’engage à envoyer trois CV avant vendredi.',
    citations: [
      {
        span: {
          quote: 'je vous envoie trois CV avant vendredi',
          channel: 'rep',
          startMs: 940_000,
          endMs: 946_000,
        },
        verified: true,
      },
    ],
    readFrom: null,
  })

  test('it asks the declared question and shows it above the answer', async () => {
    bridge.when('meeting:ask', () => answer())
    open()
    await authSettled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: FOLLOW_UP.label }))
    })

    const asked = bridge.calls.filter((call) => call.channel === 'meeting:ask')
    expect(asked).toHaveLength(1)
    expect(asked[0]?.payload).toEqual({ meetingId: 'm-hair', question: FOLLOW_UP.question })

    // The chip's label is never the last word on what was asked: the question
    // itself is on screen, above the answer, as every question here is.
    expect(await screen.findByText(FOLLOW_UP.question)).toBeTruthy()
    expect(screen.getByText(/trois CV avant vendredi\./)).toBeTruthy()
    expect(screen.getByText(/« je vous envoie trois CV avant vendredi »/)).toBeTruthy()
  })

  test('it writes nothing, stores nothing and confirms nothing (DEC-25, DEC-4)', async () => {
    bridge.when('meeting:ask', () => answer())
    open()
    await authSettled()

    const before = bridge.calls.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: FOLLOW_UP.label }))
    })

    /*
      The whole of what the press did, named rather than counted: a count would
      pass over a `review:confirm` that replaced an `auth:state`.
    */
    expect(bridge.calls.slice(before).map((call) => call.channel)).toEqual(['meeting:ask'])
  })

  test('asked once, it is spent — the same engagements twice is not an answer', async () => {
    bridge.when('meeting:ask', () => answer())
    open()
    await authSettled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: FOLLOW_UP.label }))
    })

    expect(chip()).toBeNull()
  })
})
