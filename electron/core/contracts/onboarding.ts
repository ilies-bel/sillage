/**
 * First run — the three things a rep has to know, and the two the machine has
 * to be able to do, before a real client call is worth trusting to this app.
 *
 * ## Why it exists at all
 *
 * The app had none. A fresh install opened on a calendar, and the first time a
 * rep pressed *Démarrer une réunion* the operating system asked them for
 * microphone and screen-recording permission — in the OS's own words, over a
 * screen that had explained nothing, thirty seconds before a client joined. On
 * macOS the screen-recording prompt is the one people refuse, and refusing it
 * silently costs the far end of every call the product exists to capture.
 *
 * So the permissions are asked for **before** they are needed, on a screen that
 * says what each one buys, at a moment when saying no costs nothing.
 *
 * ## Why it is three steps and not a tour
 *
 * A product tour is a thing people click through. Each of these steps exists
 * because something downstream breaks without it:
 *
 *  1. **Ce que fait Sillage** — it never joins the call, it listens to the
 *     machine. A rep who does not know that will look for a bot in the attendee
 *     list, not find one, and conclude nothing is recording. It also states the
 *     two promises the product is built on (DEC-4, DEC-30), because a rep who
 *     does not believe them will not run it on a real client.
 *  2. **Ce dont il a besoin** — the required subsystems (DEC-32), live, with the
 *     control that fixes each one. Not a checklist: the rows are the real health
 *     rows and the buttons are the real retries.
 *  3. **Premier essai** — thirty seconds of recording, ending in a real
 *     compte-rendu. Granola ships a video for this; the equivalent here is that
 *     the rep proves the chain on their own machine, which is stronger and needs
 *     no asset. It is skippable, and skipping it is the common case for a rep
 *     who installed the app between two meetings.
 *
 * ## What it is not
 *
 * It **cannot** be a gate on using the app. A rep who dismisses it still has a
 * calendar, a notepad and a recorder, exactly as before — the same reasoning the
 * splash follows (`App.tsx`): holding the window shut to protest a missing
 * subsystem takes away everything that still works. `seen` is therefore recorded
 * on the way out whichever way the rep leaves.
 */
import { z } from 'zod'

/** The `app_state` key. One string, so `AppState` stays untyped (its own note). */
export const ONBOARDING_KEY = 'onboarding.completed'

export const OnboardingStateSchema = z.object({
  /**
   * Whether the rep has been through it — or dismissed it, which is the same
   * thing as far as showing it again is concerned. Nagging a rep who said no is
   * how an onboarding becomes the thing people close without reading.
   */
  seen: z.boolean(),
})
export type OnboardingState = z.infer<typeof OnboardingStateSchema>
