/**
 * THE state machine. One file, one explicit transition table.
 *
 * This is the direct answer to an 11,810-line `ipcHandlers.ts`. That file grew
 * because nothing owned "what is happening right now", so every feature added
 * its own listener and its own implicit state. Here every module is *driven* by
 * the machine and reports back through it; no module subscribes to another
 * module's events (ARCHITECTURE.md §5.A).
 *
 * If a behaviour is hard to place, it belongs here or in `core/domain/` —
 * never in an IPC handler.
 */
import {
  type MeetingContext,
  type MeetingId,
  type MeetingState,
  type SessionCommand,
} from '../../core/contracts/meeting.ts'
import type { MeetingEvent, StoredEvent } from '../../core/contracts/events.ts'
import type { DiagRecorder } from '../../core/contracts/diagnostics.ts'
import { NULL_RECORDER } from '../../core/contracts/diagnostics.ts'
import type { Store } from '../../modules/store/index.ts'

/**
 * Facts the machine needs but does not own. Kept explicit so the transition
 * function stays pure and testable — a guard that reaches into a database is a
 * guard nobody can reason about.
 */
export interface Guards {
  /**
   * Every push intent has reached a terminal state (drained or failed). While
   * false the session stays in `pushing`: a VSA outage leaves the row visibly
   * mid-flight and retryable rather than quietly "done" with nothing in the CRM
   * (DEC-26).
   */
  allIntentsSettled: boolean
}

interface Rule {
  to: MeetingState
  when?: (guards: Guards) => boolean
}

/**
 * The whole table. Read it top to bottom: it is the product's lifecycle.
 *
 * Terminal states (`done`, `aborted`) accept nothing — a late module reporting
 * into a finished session is a bug, and it should surface as a rejected
 * transition in the diagnostics rather than as a silent state change.
 */
export const TRANSITIONS: Readonly<
  Record<MeetingState, Readonly<Partial<Record<SessionCommand, readonly Rule[]>>>>
> = {
  idle: {
    arm: [{ to: 'armed' }],
    // Manual start, for a call with no calendar entry. HR-9 makes arming the
    // primary path, not the only one.
    start: [{ to: 'recording' }],
    abort: [{ to: 'aborted' }],
  },
  armed: {
    start: [{ to: 'recording' }],
    disarm: [{ to: 'idle' }],
    abort: [{ to: 'aborted' }],
  },
  recording: {
    // Silence + grace (DEC-9/DEC-16), or the manual *Terminer* button.
    end: [{ to: 'ended' }],
    abort: [{ to: 'aborted' }],
  },
  ended: {
    // Fires automatically on end-of-meeting. Nothing is surfaced to the rep
    // while this runs (DEC-23).
    extract: [{ to: 'extracting' }],
    abort: [{ to: 'aborted' }],
  },
  extracting: {
    extractionSucceeded: [{ to: 'awaiting_confirmation' }],
    // Back to `ended`, not forward: the LLM being unreachable must cost the
    // enhancement and nothing else. Transcript and raw notes are already
    // durable, and the retry re-enters from here (DEC-26).
    extractionFailed: [{ to: 'ended' }],
    abort: [{ to: 'aborted' }],
  },
  awaiting_confirmation: {
    // The one human gate (DEC-4, HR-7).
    confirm: [{ to: 'pushing' }],
    // User-initiated regeneration, with the rep's edits as context (DEC-5).
    // Never automatic, never behind their back.
    extract: [{ to: 'extracting' }],
    abort: [{ to: 'aborted' }],
  },
  pushing: {
    pushSettled: [{ to: 'done', when: (g) => g.allIntentsSettled }, { to: 'pushing' }],
  },
  done: {},
  aborted: {},
}

export type TransitionOutcome =
  | { ok: true; from: MeetingState; to: MeetingState }
  | { ok: false; state: MeetingState; reason: string }

/**
 * The pure part. `null` means the command is not legal from this state — which
 * is information, not an error: the caller decides whether that is a bug or a
 * race it should ignore.
 */
export const nextState = (
  from: MeetingState,
  command: SessionCommand,
  guards: Guards,
): MeetingState | null => {
  const rules = TRANSITIONS[from][command]
  if (!rules) return null
  for (const rule of rules) {
    if (!rule.when || rule.when(guards)) return rule.to
  }
  return null
}

/**
 * Folds a meeting's log back into its current state.
 *
 * Only `session.transition` events are read. That is deliberate: state is
 * derived from the transitions that were recorded, not re-inferred from
 * their side effects, so a replay cannot reach a state the machine never
 * actually entered.
 */
export const replayState = (events: Iterable<StoredEvent>): MeetingState => {
  let state: MeetingState = 'idle'
  for (const { event } of events) {
    if (event.type === 'session.transition') state = event.to
  }
  return state
}

export interface MeetingSessionOptions {
  diagnostics?: DiagRecorder
  clock?: () => number
}

export class MeetingSession {
  readonly id: MeetingId
  #store: Store
  #state: MeetingState
  #diagnostics: DiagRecorder
  #clock: () => number

  private constructor(
    store: Store,
    id: MeetingId,
    state: MeetingState,
    options: MeetingSessionOptions,
  ) {
    this.#store = store
    this.id = id
    this.#state = state
    this.#diagnostics = options.diagnostics ?? NULL_RECORDER
    this.#clock = options.clock ?? Date.now
  }

  static create(
    store: Store,
    input: {
      id: MeetingId
      title: string
      context?: MeetingContext | null
      /** Only for a manually started meeting — see `events.ts`. */
      clientName?: string | null
      /** The day the rep placed it on, when that is not now (DEC-31). */
      scheduledStart?: number | null
    },
    options: MeetingSessionOptions = {},
  ): MeetingSession {
    store.append(input.id, {
      type: 'meeting.created',
      title: input.title,
      context: input.context ?? null,
      clientName: input.clientName ?? null,
      scheduledStart: input.scheduledStart ?? null,
    })
    return new MeetingSession(store, input.id, 'idle', options)
  }

  /** Crash recovery is replay (DEC-12). There is no other recovery path. */
  static load(
    store: Store,
    id: MeetingId,
    options: MeetingSessionOptions = {},
  ): MeetingSession | null {
    const events = store.log.read(id)
    if (events.length === 0) return null
    return new MeetingSession(store, id, replayState(events), options)
  }

  get state(): MeetingState {
    return this.#state
  }

  /**
   * The only way the state changes. Writes the transition to the log first, so
   * a crash between the state change and its record is impossible — the record
   * *is* the state change.
   */
  dispatch(command: SessionCommand, reason: string | null = null): TransitionOutcome {
    const from = this.#state
    const to = nextState(from, command, this.#guards())

    if (to === null) {
      const message = `${command} is not legal from ${from}`
      this.#diagnostics.record({
        severity: 'warn',
        code: 'session.transition.rejected',
        module: 'session',
        message,
        detail: { from, command },
        meetingId: this.id,
      })
      return { ok: false, state: from, reason: message }
    }

    this.#store.append(
      this.id,
      { type: 'session.transition', from, to, command, reason },
      this.#clock(),
    )
    this.#state = to
    return { ok: true, from, to }
  }

  /** Appends a non-transition event to this meeting's log. */
  emit(event: MeetingEvent, ts?: number): StoredEvent {
    return this.#store.append(this.id, event, ts ?? this.#clock())
  }

  #guards(): Guards {
    const intents = this.#store.projections.outboxFor(this.id)
    return {
      allIntentsSettled:
        intents.length > 0 && intents.every((i) => i.state === 'drained' || i.state === 'failed'),
    }
  }
}
