/**
 * **No word on this screen may be the beginning of another word on it.**
 *
 * The agenda draws nine state labels on its rows and two section headings over
 * them, and one of each pair was the other's opening: `STATE_LABEL.idle` was
 * « En attente » and the second section is « En attente de validation ».
 * Measured on `agenda-appel-imprevu` at 1280×800, both were on screen at once —
 * « En attente » on the 14:30 Néovia row at y=239 and « EN ATTENTE DE
 * VALIDATION » at y=710 — saying two unrelated things: that a call has not
 * started, and that a compte-rendu is waiting for the one confirmation DEC-4
 * allows. A rep who reads the first as an abbreviation of the second believes a
 * call they have not held is owed a gesture.
 *
 * ## Why no existing check could see it
 *
 * `--echo` is the check for a string drawn twice, and it compares **whole**
 * casefolded strings: « en attente » and « en attente de validation » are not
 * equal, so it passed on every stage. The overlap is a prefix, which is the one
 * relation between two visible strings nothing measured.
 *
 * ## Why it is a prefix test and not a substring test
 *
 * A substring test would flag « en cours » inside the legend's « enregistrement
 * en cours », which is a phrase a reader parses from its start and never
 * mistakes for the state word. What misleads is a label that *opens* like a
 * longer one, because scanning reads left to right and stops.
 *
 * ## Why it reads the product's own constants
 *
 * The headings are imported rather than written out. A check that restates the
 * copy it guards is a check that goes green the moment somebody renames one side
 * of the pair — which is how a copy change has broken six stages at once here
 * before.
 */
import { describe, expect, it } from 'vitest'
import { STATE_LABEL } from '../entries.ts'
import { PENDING_HEADING } from '../PendingGates.tsx'
import { PAST_HEADING } from '../DayPane.tsx'

/** Every visible label the day list and the two sections around it can draw. */
const DRAWN: readonly string[] = [
  ...Object.values(STATE_LABEL),
  'Prêt', // `DayPane` writes the armed word itself — see its `StateDot` branch.
  PAST_HEADING,
  PENDING_HEADING,
]

const fold = (text: string): string => text.toLocaleLowerCase('fr-FR').trim()

describe('the agenda says one thing per word', () => {
  it('no label on the screen opens another label on the screen', () => {
    const swallowed: string[] = []
    for (const short of DRAWN) {
      for (const long of DRAWN) {
        if (short === long) continue
        if (fold(long).startsWith(fold(short))) swallowed.push(`« ${short} » ⊂ « ${long} »`)
      }
    }

    expect(swallowed, 'a label that begins another is read as its abbreviation').toEqual([])
  })

  /**
   * The state words are also what the rows *are*, so each has to be a claim
   * about a call rather than about the app's own queue. Kept beside the test
   * above because the two failed together: « En attente » was both.
   */
  it('every state label is a word about a call', () => {
    for (const [state, label] of Object.entries(STATE_LABEL)) {
      expect(label.trim(), `${state} has a label`).not.toBe('')
      expect(fold(label), `${state} does not name the validation queue`).not.toContain('valider ')
    }
  })
})
