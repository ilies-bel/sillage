/**
 * A stand-in for the Electron preload bridge, for a plain Chromium.
 *
 * In production `preload.ts` does `contextBridge.exposeInMainWorld('app', …)`.
 * In a browser `window.app` is undefined and every screen renders an error or a
 * spinner, so this installs the same two-method shape *before any app script
 * runs* (`page.addInitScript`).
 *
 * It is deliberately one self-contained function with no imports and no closure
 * over module scope: Playwright serialises it to source and evaluates it in the
 * page. Everything it needs — fixtures, helpers, the scenario switch — lives
 * inside.
 *
 * Shapes are copied from the renderer's own vitest fixtures
 * (`src/screens/__tests__/*.test.tsx`), which are typed against
 * `electron/core/contracts/`. Content is written as a French ESN sales rep's
 * real day.
 *
 * The single argument is `{ scenario, now, entra }`:
 *   · `scenario` picks the dataset (see README)
 *   · `now`      is the pinned instant, minted on the Node side, so the fixtures
 *                and `page.clock.setFixedTime()` agree to the millisecond
 *   · `entra`    `false` stages the case that actually ships to the first demo:
 *                **no Entra app registration at all** (`resolveIdentityConfig()`
 *                returns null in `modules/identity/config.ts`). That is not the
 *                same as a rep who signed out — nothing can be signed into — so
 *                it is its own axis rather than a scenario name. `auth:signIn`
 *                rejects exactly as `app/ipc/register.ts` does, the agenda is
 *                `EMPTY_AGENDA` with the main process's own reason, and
 *                calendar and mail come up `down`, `retryable: false`, with the
 *                sentences `app/main.ts` writes. Defaults to `true`.
 *
 * It also exposes `window.__harness`:
 *   · `emit(channel, payload)`  push a broadcast, as the main process would
 *   · `calls`                   every invoke, for debugging
 *   · `unanswered`              channels asked for that the stub had no answer to
 *   · `health(connector, state)` publish a health edge, and move the table with it
 */

export function installAppBridge(config) {
  const scenario = config.scenario
  const now = config.now
  /** An Entra app registration exists. `false` is the first demo's own case. */
  const entra = config.entra !== false

  // ── time ──────────────────────────────────────────────────────────────────
  // The page runs on Europe/Paris (set by the Playwright context), so local
  // hours are Paris hours and `at()` mints the same instants `atParis()` would.
  const MIN = 60_000
  const HOUR = 3_600_000
  const pad = (n) => String(n).padStart(2, '0')
  const at = (dayOffset, hour, minute) => {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, minute || 0, 0, 0)
    return d.getTime()
  }

  /*
   * The deterministic date line of the compte-rendu, formatted the way
   * `renderCompteRendu` formats it — same locale, same zone, same en dash. It is
   * computed rather than typed so the fixture cannot go stale against the
   * meeting it belongs to; a hard-coded « mardi 9 septembre » beside a meeting
   * the harness places today is the sort of lie this fixture exists not to tell.
   */
  const crWhen = (startsAt, endsAt) => {
    const day = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const clock = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
    })
    return `${day.format(startsAt)}, ${clock.format(startsAt)} – ${clock.format(endsAt)}`
  }

  // ── people ────────────────────────────────────────────────────────────────
  const REP = {
    name: 'Julien Marchand',
    email: 'julien.marchand@synapse-it.fr',
    type: 'required',
    response: 'organizer',
  }
  const guest = (name, email, response) => ({
    name,
    email,
    type: 'required',
    response: response || 'accepted',
  })

  const ACCOUNT = {
    homeAccountId: 'h-julien-marchand',
    username: 'julien.marchand@synapse-it.fr',
    name: 'Julien Marchand',
    tenantId: 'synapse-it.onmicrosoft.com',
  }

  // ── calendar ──────────────────────────────────────────────────────────────
  const event = (id, subject, start, end, attendees, agenda) => ({
    id,
    isCancelled: false,
    isAllDay: false,
    lastModified: now - 2 * HOUR,
    context: {
      eventId: id,
      subject,
      agenda: agenda || '',
      organizer: REP,
      attendees,
      onlineMeetingJoinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_' + id,
      categories: [],
      sensitivity: 'normal',
      scheduledStart: start,
      scheduledEnd: end,
      seriesMasterId: null,
      timeZone: 'Europe/Paris',
    },
  })

  const EVENTS = [
    event(
      'evt-sodexial-staffing',
      'Sodexial — comité de staffing hebdomadaire',
      at(0, 9, 0),
      at(0, 9, 30),
      [guest('Nathalie Coste', 'nathalie.coste@sodexial.fr')],
    ),
    event(
      'evt-lefort-cv',
      'Groupe Lefort — restitution des CV DevOps',
      at(0, 11, 0),
      at(0, 12, 0),
      [
        guest('Sophie Bertrand', 'sophie.bertrand@groupe-lefort.fr'),
        guest('Karim Benali', 'karim.benali@groupe-lefort.fr', 'tentativelyAccepted'),
      ],
      'Passer les 3 profils Kubernetes, caler le démarrage.',
    ),
    event(
      'evt-neovia-cadrage',
      'Néovia Santé — cadrage renfort data',
      at(0, 14, 30),
      at(0, 15, 30),
      [
        guest('Élodie Vasseur', 'elodie.vasseur@neovia-sante.fr'),
        guest('Marc Pontier', 'marc.pontier@neovia-sante.fr'),
      ],
      'Besoin data engineering pour la migration Talend → Databricks.',
    ),
    event(
      'evt-delcourt-tjm',
      'Banque Delcourt — négociation du cadre tarifaire 2026',
      at(0, 16, 0),
      at(0, 17, 0),
      [
        guest('Anne-Laure Girard', 'al.girard@banque-delcourt.fr'),
        guest('Pierre Vasseur', 'pierre.vasseur@banque-delcourt.fr'),
      ],
    ),
    event(
      'evt-arkelia-suivi',
      'Arkelia Logistique — point d’avancement mission',
      at(0, 17, 30),
      at(0, 18, 0),
      [guest('Thomas Rey', 'thomas.rey@arkelia.fr')],
    ),
    event(
      'evt-sodexial-profils',
      'Sodexial — présentation de 3 profils Java',
      at(1, 9, 30),
      at(1, 10, 30),
      [guest('Nathalie Coste', 'nathalie.coste@sodexial.fr')],
    ),
    event(
      'evt-neovia-comite',
      'Néovia Santé — comité technique data',
      at(2, 15, 0),
      at(2, 16, 0),
      [guest('Marc Pontier', 'marc.pontier@neovia-sante.fr')],
    ),
    event(
      'evt-lefort-contrat',
      'Groupe Lefort — revue contractuelle',
      at(3, 10, 0),
      at(3, 11, 0),
      [guest('Sophie Bertrand', 'sophie.bertrand@groupe-lefort.fr')],
    ),
    event(
      'evt-marechal-erp',
      'Groupe Maréchal — qualification besoin ERP',
      at(-1, 10, 0),
      at(-1, 11, 0),
      [guest('Hélène Faure', 'helene.faure@groupe-marechal.fr')],
    ),
  ]

  // ── meetings the store knows about ────────────────────────────────────────
  const meeting = (over) =>
    Object.assign(
      {
        id: 'm-x',
        state: 'done',
        title: 'Réunion',
        eventId: null,
        clientName: null,
        scheduledStart: null,
        createdAt: now - 3 * HOUR,
        startedAt: null,
        endedAt: null,
        confirmedAt: null,
        updatedAt: now - 3 * HOUR,
      },
      over,
    )

  /**
   * **The 14:30 call is not being recorded on the day the app offers an
   * unscheduled one — because the product cannot do both.**
   *
   * `agenda-appel-imprevu` exists to photograph meeting *detection*, and it was
   * photographing the one configuration detection is built to make impossible.
   * `m-neovia-cadrage` had no branch for this scenario, so it fell through to
   * `recording` and sat on the same day as the armed ad-hoc row: a filled
   * *Enregistrer* directly above « En cours ». `Agenda`'s arbitration reads
   * `liveStates()` and counts exactly two states — `armed` and `recording`,
   * deliberately those two and not the six — so a real build would have answered
   * `action: 'none'`, « une réunion est déjà en cours ou proposée », and there
   * would have been no offer to photograph at all. The row four lines below this
   * one already said so in its own docblock (« photographing it would make the
   * fixture argue for a defect ») and was wrong about being the only row on the
   * day. Fourth time this fixture has flattered the app; the comment is a check
   * now, in `harnessFixture.test.ts`.
   *
   * `idle` rather than `done`, and the difference is the clock. `now` is pinned
   * at 14:35 Paris and this call is scheduled at 14:30, so every *after the
   * call* state — `ended`, `awaiting_confirmation`, `done` — stages a cadrage
   * call that ran, was analysed, was read at the gate and was pushed to
   * VerySwing inside five minutes, which is a fixture faster than the product.
   * `aborted` is producible in no time at all but means something specific here:
   * `Orchestrator` dispatches it for « capture indisponible » and « aucun
   * fournisseur de transcription », so it would stage a failed start on the
   * screen that exists to show detection working. `idle` costs nothing and is
   * exactly what this build produces: no Entra registration, so no calendar, so
   * nothing arms the 14:30 invite. The row draws « En attente » and an outline
   * *Ouvrir*, inside `OVERRUN_GRACE_MS` of its slot, and the screen's one filled
   * primary is the unscheduled call — which is the thing the stage is for.
   */
  const NEOVIA_UNARMED = scenario === 'agenda-appel-imprevu'

  /**
   * **When the Néovia call actually ran — one timeline, derived from its slot.**
   *
   * Three unrelated literals used to answer this and they contradicted each other
   * and the clock. `scheduledStart` was `at(0, 14, 30)`, `createdAt` `at(0, 14, 28)`
   * and `startedAt` `now - 22 * MIN` — which against a `now` pinned at 14:35 is
   * **14:13**: fifteen minutes before the meeting row was created and seventeen
   * before the invite the product can only arm five minutes early. `updatedAt`
   * (14:15) was before `createdAt` too. And `SEGMENTS` were spaced 78 seconds
   * apart from that impossible start, so the transcript spanned 23.5 minutes,
   * **two of its nineteen turns landed after `now`** (+10 s and +88 s) along with
   * one of the two marks (+9 s), and `TranscriptReader` prints those as wall clock:
   * a reader showing a client speaking a minute and a half into the future, under a
   * pill saying the call had been recording for 22 minutes.
   *
   * **The pinned instant is not the root cause, and last round's reading of it was
   * the wrong one.** One instant is a *feature*: `shot.mjs` pins `page.clock` to
   * the same value, which is what makes two runs of a stage produce the same pixels.
   * What was wrong is that three numbers each stated part of one fact. Stated once
   * here, everything else reads it.
   *
   * `STEP_MS` is the other half, and it is the density. 19 turns / 1 595 characters
   * over 23.5 minutes is **68 characters a minute**; CLAUDE.md's own measurement of
   * a real call is 124 765 characters over ninety minutes, which is 1 386. At nine
   * seconds a turn the same nineteen turns span 2 min 52 s — **555 characters a
   * minute**, with each turn about 6.4 s of speech in a 9 s slot, which is a
   * conversation rhythm rather than a transcript with 78-second holes in it. The
   * remaining factor of 2.5 is silence, and silence is real.
   *
   * The call therefore starts at its slot and its last turn lands at 14:32:52,
   * comfortably before `now`. Nothing is in the future, `createdAt ≤ startedAt`, and
   * `startedAt ≥ scheduledStart`. `harnessFixture.test.ts` asserts all three, on
   * every meeting, in every scenario — which is what was missing: reverting the one
   * timing hunk the previous round wrote left all six of its tests passing.
   */
  /** Live states — the ones with no end yet. */
  const NEOVIA_LIVE = !(
    scenario === 'review' ||
    scenario === 'compte-rendu' ||
    scenario === 'enhancement-attente' ||
    scenario === 'enhancement-echec'
  )
  /**
   * **A call that has ended is a real call, and this one was three minutes.**
   *
   * `m-neovia-cadrage` is the flagship: every `session*`, `review*`, `widget*` and
   * `session-demander` stage is it. Its slot was 14:30 against a `now` pinned at 14:35,
   * so on the scenarios where it has *ended* — the gate, the compte-rendu, both
   * enhancement cases — it was a **three-minute** sales call that produced eleven typed
   * fields, a full ESN compte-rendu, two marks and an Outlook draft. Round 28's density
   * check divides by the recording and 1 595 characters over 3 minutes is 532 a minute,
   * comfortably inside its band: the one axis a density cannot ask about is whether the
   * recording is long enough to be a call.
   *
   * So the slot moves with the state. Live, it is 14:30 and the pill is five minutes in,
   * which is what the calendar stage is for. Ended, it is 13:45 and the call ran
   * forty-seven minutes, finishing three minutes before the pinned instant — which is
   * what the gate's reader, `review-garde-transcription`, `ReadingColumn`, the `--fade`
   * ramp and the citation scroll have never once been photographed against. CLAUDE.md's
   * own « fifty page turns on a fifty-minute call » was unreachable from any stage.
   *
   * And unarmed, it is **15:30** — after the pinned instant, so the slot the rep placed is
   * outside `ownClaims`' window `[anchor − 30 min, anchor + 80 min)` and stops being a
   * claimant. At 14:30 it was one, so `#calendarOffersAt` answered 14:25, `decideAdHoc`
   * replied « cet appel est au calendrier », and the anonymous row this scenario exists to
   * photograph was never minted: the shipped `Agenda` armed Néovia and left the ad-hoc row
   * idle, inverting all four of the stage's facts. `stagedDay.test.ts` is the check.
   *
   * 15:30 and not a past slot, and not a later one. A past slot (11:00, 12:30 both driven)
   * moves Néovia out of the upcoming list, makes the ad-hoc row last, and its in-flight
   * `riseIn` overhangs — `ul.divide-y — 3px cachés en y`, at both sizes. That is the very
   * artefact the row ordering above was arranged to solve. A slot beyond 15:30 pushes
   * `NEOVIA_CREATED` past the pinned instant, which `harnessFixture.test.ts` refuses. 15:30
   * is the one value that threads both: outside the claim window, `createdAt` still before
   * `now`, and Néovia still ahead of the ad-hoc row on the day.
   */
  const NEOVIA_SLOT = NEOVIA_UNARMED ? at(0, 13, 0) : NEOVIA_LIVE ? at(0, 14, 30) : at(0, 13, 45)
  const NEOVIA_CREATED = NEOVIA_SLOT - 2 * MIN
  const NEOVIA_STARTED = NEOVIA_SLOT
  /**
   * How long the call ran. Three minutes, which is what nineteen turns nine
   * seconds apart occupy — the last one ends at 2 min 52 s.
   *
   * The **duration** is declared and `STEP_MS` fits inside it, rather than the
   * other way round, so the meeting row can state its own end without reading a
   * transcript defined two hundred lines below it. `harnessFixture.test.ts` holds
   * the two together: every `receivedAt` must fall between `startedAt` and
   * `endedAt ?? now`, so tightening the rhythm past the end of the call fails
   * rather than silently dating a turn after the recording stopped.
   */
  const NEOVIA_DURATION_MS = NEOVIA_LIVE ? 3 * MIN : 47 * MIN
  const NEOVIA_ENDED = NEOVIA_STARTED + NEOVIA_DURATION_MS
  /** Live states — the ones with no end yet. */
  const STEP_MS = 9_000

  const MEETINGS = [
    meeting({
      id: 'm-sodexial-staffing',
      state: 'done',
      title: 'Sodexial — comité de staffing hebdomadaire',
      eventId: 'evt-sodexial-staffing',
      clientName: 'Sodexial',
      scheduledStart: at(0, 9, 0),
      createdAt: at(0, 8, 55),
      startedAt: at(0, 9, 1),
      endedAt: at(0, 9, 34),
      confirmedAt: at(0, 9, 41),
      updatedAt: at(0, 9, 41),
    }),
    meeting({
      id: 'm-lefort-cv',
      state: 'awaiting_confirmation',
      title: 'Groupe Lefort — restitution des CV DevOps',
      eventId: 'evt-lefort-cv',
      clientName: 'Groupe Lefort',
      scheduledStart: at(0, 11, 0),
      createdAt: at(0, 10, 58),
      startedAt: at(0, 11, 2),
      endedAt: at(0, 12, 4),
      confirmedAt: null,
      updatedAt: at(0, 12, 6),
    }),
    meeting({
      id: 'm-neovia-cadrage',
      // The two enhancement scenarios are meetings that have *ended* — the
      // whole point of them is the window between « Terminer » and the review
      // gate. Leaving them `recording` drew the waiting notice above a running
      // meter, which is the one place it must never appear.
      state:
        // `compte-rendu` is the session screen *after* the analysis: the pane is
        // beside the notes and the gate is open but unentered, which is the only
        // state in which both are true at once.
        scenario === 'review' || scenario === 'compte-rendu'
          ? 'awaiting_confirmation'
          : scenario === 'enhancement-attente' || scenario === 'enhancement-echec'
            ? 'ended'
            : NEOVIA_UNARMED
              ? 'idle'
              : 'recording',
      title: 'Néovia Santé — cadrage renfort data',
      /*
        **No invite exists on a build with no Entra registration**, and this
        carried one unconditionally — including on `agenda-appel-imprevu`, the
        stage whose entire premise is that branch.

        `ownClaims` filters `eventId === null`, so the fixture routed around the
        feature it was supposed to photograph: driven at the port with this exact
        shape, an event id produces « idle: Néovia » beside « armed: Appel non
        planifié — Teams » and the anonymous row takes the notification, while
        `null` produces one armed row carrying the client's name. The flagship
        detection screenshot argued for the defect after the defect was fixed.

        Seventh time this file has been caught unable to produce the input a
        behaviour lives on, and the second where it produced an input the
        shipped code cannot: `Orchestrator.create` stores `eventId: null`
        whatever is passed, so an `idle` meeting holding an event id is
        unreachable on a build with no calendar.
      */
      eventId: entra ? 'evt-neovia-cadrage' : null,
      clientName: 'Néovia Santé',
      scheduledStart: NEOVIA_SLOT,
      createdAt: NEOVIA_CREATED,
      // An `idle` meeting has never been recorded, so it has no start instant.
      // A state and a timestamp that contradict each other is the same class of
      // lie as the state itself.
      startedAt: NEOVIA_UNARMED ? null : NEOVIA_STARTED,
      /*
       * **And a meeting that has ended has an end**, which this row did not: it
       * carried `endedAt: null` in the `ended` and `awaiting_confirmation`
       * branches, i.e. on every stage of the review gate and both enhancement
       * screens. The recording stops when the last turn has arrived plus the
       * end-of-meeting grace; `NEOVIA_ENDED` is that instant, and the gate opens
       * on it roughly a minute and a half later, which is an extraction rather
       * than a fixture faster than the product.
       */
      endedAt: NEOVIA_UNARMED || NEOVIA_LIVE ? null : NEOVIA_ENDED,
      confirmedAt: null,
      /*
       * A live recording's row was last written when the state changed; segments
       * are their own log and do not touch it. A finished one was last written by
       * the extraction, which lands after the call — 45 s here, which is what
       * puts the gate an unhurried minute and a half before `now` instead of
       * five seconds after the last word (DEC-39's deferred case is the other
       * two scenarios, and they are `ended` for exactly that reason).
       */
      updatedAt: NEOVIA_UNARMED
        ? NEOVIA_CREATED
        : NEOVIA_LIVE
          ? NEOVIA_STARTED
          : NEOVIA_ENDED + 45_000,
    }),
    meeting({
      id: 'm-marechal-erp',
      state: 'done',
      title: 'Groupe Maréchal — qualification besoin ERP',
      eventId: 'evt-marechal-erp',
      clientName: 'Groupe Maréchal',
      scheduledStart: at(-1, 10, 0),
      createdAt: at(-1, 9, 58),
      startedAt: at(-1, 10, 3),
      endedAt: at(-1, 10, 52),
      confirmedAt: at(-1, 11, 6),
      updatedAt: at(-1, 11, 6),
    }),
    meeting({
      id: 'm-delcourt-premier',
      state: 'done',
      title: 'Banque Delcourt — premier contact achats',
      eventId: null,
      clientName: 'Banque Delcourt',
      scheduledStart: at(-3, 14, 0),
      createdAt: at(-3, 13, 55),
      startedAt: at(-3, 14, 2),
      endedAt: at(-3, 14, 48),
      confirmedAt: at(-3, 15, 12),
      updatedAt: at(-3, 15, 12),
    }),
    meeting({
      id: 'm-arkelia-bilan',
      state: 'aborted',
      title: 'Arkelia Logistique — bilan trimestriel',
      eventId: null,
      clientName: 'Arkelia Logistique',
      scheduledStart: at(-7, 11, 0),
      createdAt: at(-7, 10, 57),
      startedAt: at(-7, 11, 4),
      endedAt: at(-7, 11, 9),
      confirmedAt: null,
      updatedAt: at(-7, 11, 9),
    }),
    meeting({
      id: 'm-nordis-renouvellement',
      state: 'done',
      title: 'Nordis Retail — renouvellement des deux missions',
      eventId: null,
      clientName: 'Nordis Retail',
      scheduledStart: at(-9, 9, 30),
      createdAt: at(-9, 9, 25),
      startedAt: at(-9, 9, 31),
      endedAt: at(-9, 10, 12),
      confirmedAt: at(-9, 10, 30),
      updatedAt: at(-9, 10, 30),
    }),
    /*
      A call recorded four days ago and never confirmed — the state
      *En attente de validation* exists for, and the one the fixture had no
      example of: the only « À valider » row was from today, which the calendar
      already draws under *Passées*, so the section could never appear and the
      feature could not be reviewed.
    */
    meeting({
      id: 'm-nordis-support',
      state: 'awaiting_confirmation',
      title: 'Nordis Retail — cadrage support N2',
      eventId: 'AAMkAGI2-nordis-support',
      clientName: 'Nordis Retail',
      scheduledStart: at(-4, 10, 0),
      createdAt: at(-4, 9, 58),
      startedAt: at(-4, 10, 1),
      endedAt: at(-4, 10, 42),
      confirmedAt: null,
      updatedAt: at(-4, 10, 44),
    }),
    meeting({
      id: 'm-lefort-decouverte',
      state: 'done',
      title: 'Groupe Lefort — découverte du besoin plateforme',
      eventId: null,
      clientName: 'Groupe Lefort',
      scheduledStart: at(-14, 15, 0),
      createdAt: at(-14, 14, 58),
      startedAt: at(-14, 15, 1),
      endedAt: at(-14, 15, 58),
      confirmedAt: at(-14, 16, 20),
      updatedAt: at(-14, 16, 20),
    }),
    /*
     * **The unscheduled call, in the state the rep first sees it.**
     *
     * `armed`, never started — an offer, not a recording (HR-7) — with
     * `eventId: null` because a client who rings mid-afternoon put nothing in
     * Outlook. It is staged only for `agenda-appel-imprevu`, which is exactly the
     * demo build's day: no calendar, and one call the app noticed anyway. On
     * every other screen it would be a second armed meeting competing with
     * `m-neovia-cadrage`, which is the « three statements about one meeting »
     * configuration `Agenda.#arm` exists to prevent.
     *
     * **It sits minutes before `now`, not at 11:05, and that was the second half
     * of the same lie.** `adHocContext` writes `scheduledStart: heldSince` — the
     * instant the conferencing application took the microphone — and
     * `decideAdHoc` offers one `AD_HOC_DWELL_MS` later, so an offer still
     * standing is minutes old, not the three and a half hours `at(0, 11, 5)` was
     * against a `now` pinned at 14:35. Worse, 11:05 is *inside* `m-lefort-cv`,
     * which ran 11:02 → 12:04: the fixture staged an offer minted while another
     * meeting was recording, which is the same arbitration rule broken one axis
     * over, in a way no single frame could show. Six minutes is past the dwell,
     * and `#adHocSpent` is what keeps the offer standing until the rep acts on
     * it rather than re-asking on every poll.
     *
     * It is deliberately *before* the 14:30 row rather than after it. This is the
     * one row on the screen that animates (`riseIn`, 150 ms — `DayPane` explains
     * why), and `shot.mjs` measures while it is still running: staged last in its
     * list, the in-flight `translateY` puts three pixels past the bottom of a
     * 128-pixel box and `--scrollers` reports content hidden that settles to
     * nothing a frame later. Nothing is clipped — measured at 130/128 mid-flight
     * and 128/128 after — but the harness cannot tell those apart, and the
     * fixture is not the place to fix that.
     */
    ...(scenario === 'agenda-appel-imprevu'
      ? [
          meeting({
            id: 'm-adhoc-teams',
            state: 'armed',
            title: 'Appel non planifié — Teams',
            eventId: null,
            clientName: null,
            scheduledStart: now - 6 * MIN,
            createdAt: now - 6 * MIN,
            startedAt: null,
            endedAt: null,
            confirmedAt: null,
            updatedAt: now - 6 * MIN,
          }),
        ]
      : []),
  ]

  const meetingById = (id) => MEETINGS.find((m) => m.id === id) || null

  /**
   * **The meeting a calendar invite produces, and it has to be one that opens.**
   *
   * `Agenda.meetingIdFor` is `evt-` + the first sixteen hex digits of
   * `sha1(eventId)`, and `#arm` creates the session under that id the first time
   * an invite is armed — so in the product the id is a pure function of the event
   * and the meeting behind it always exists.
   *
   * Two halves, mirrored here. The **shape** is the product's, `evt-` + sixteen
   * hex digits, so nothing on screen or in a stage can come to depend on a
   * fixture-shaped `m-*`. The **digest** is not: this file is serialised into the
   * page by `addInitScript`, where `node:crypto` does not exist and `crypto.subtle`
   * is asynchronous while `responders` are synchronous. It is FNV-1a, run twice
   * over the id with two offset bases. Run over the fixture's nine event ids the
   * nine results are distinct and twenty characters long, which is the whole of
   * what it has to be; it is stated rather than implied because « derived the way
   * the product derives it » would be false about the bytes.
   *
   * The half that matters is the second one: a fixture meeting that already
   * carries this `eventId` **is** the meeting for that invite, whatever its id
   * spells. That is how `meetingIdFor`'s determinism reads from the outside — arm
   * the same invite twice and you get the same call back, never a second row.
   */
  const meetingIdForEvent = (eventId) => {
    const digest = (base) => {
      let hash = base
      for (let i = 0; i < eventId.length; i += 1) {
        hash ^= eventId.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193) >>> 0
      }
      return hash.toString(16).padStart(8, '0')
    }
    return `evt-${digest(0x811c9dc5)}${digest(0x7ee3a1c7)}`
  }

  const meetingForEvent = (eventId) => MEETINGS.find((m) => m.eventId === eventId) || null

  // ── the live session (Néovia Santé) ───────────────────────────────────────
  const LINES = [
    ['far', 'Bonjour Julien, merci d’avoir décalé, on sortait du comité d’investissement.'],
    ['rep', 'Pas de souci. On avait dit qu’on ferait le point sur le renfort data avant l’été.'],
    ['far', 'Exactement. Le budget plateforme est validé, donc on peut avancer pour de vrai.'],
    ['far', 'Concrètement il nous manque deux data engineers, et si possible un profil plus senior pour cadrer.'],
    ['rep', 'D’accord. Sur quelle stack ? Vous êtes toujours partis sur Databricks ?'],
    ['far', 'Oui, Databricks et Airflow, avec du dbt qu’on est en train de généraliser sur les domaines métier.'],
    /*
      The two turns the compte-rendu quotes.

      Its prose lifted « trois personnes, dont deux à mi-temps sur le sujet » and
      « une quarantaine, peut-être un peu plus » out of thin air — the call
      contained neither, so the fixture's document quoted a conversation that had
      not happened. The real composer cannot do that: the model only ever sees
      the transcript, and `REGISTRE` licenses guillemets for words the client
      actually said. Nothing on screen could show it until the prose's
      quotations became followable; the first one pressed opened the reader on
      « Cet extrait est introuvable dans la transcription ».
    */
    ['far', 'Côté équipe on est trois personnes, dont deux à mi-temps sur le sujet.'],
    ['far', 'Sur les jobs Talend restants, on en a une quarantaine, peut-être un peu plus, sans inventaire consolidé.'],
    ['far', 'Le vrai sujet c’est qu’on doit sortir les pipelines Talend historiques d’ici la fin de l’année.'],
    ['rep', 'Et vous visez un démarrage à quelle échéance ?'],
    ['far', 'Idéalement début septembre. On ne veut pas attaquer la migration sans les renforts en face.'],
    ['far', 'Sur la durée on part sur douze mois, avec une clause de sortie à six mois.'],
    ['rep', 'D’accord. Et sur le mode, vous préférez de la régie ou plutôt un forfait au périmètre ?'],
    ['far', 'De la régie, clairement. On a besoin de piloter au quotidien avec nos propres product owners.'],
    ['far', 'Après il faut qu’on soit honnêtes, votre TJM de l’an dernier était un peu haut pour nos achats.'],
    ['far', 'On est plutôt sur du 550 euros pour un data engineer confirmé, et 650 pour le lead.'],
    ['rep', 'Je note. Je vous envoie trois CV d’ici vendredi, avec le TJM associé à chacun.'],
    ['far', 'Parfait. Mettez Sophie en copie, c’est elle qui valide les entrées en mission chez nous.'],
    ['rep', 'C’est noté. Je vous propose un point de calage la semaine prochaine une fois les CV lus.'],
  ]

  const SEGMENTS = LINES.map((line, index) => {
    const start = index * STEP_MS + 4_000
    return {
      id: 'seg-neovia-' + (index + 1),
      channel: line[0],
      text: line[1],
      startMs: start,
      endMs: start + 6_400,
      isFinal: true,
      provider: 'local-whisper',
      // Measured from when the recording began, so no turn can be dated after
      // the instant the whole fixture is pinned to. See `NEOVIA_STARTED`.
      receivedAt: NEOVIA_STARTED + start,
    }
  })

  /**
   * **A transcript that lasts as long as the call it belongs to.**
   *
   * Every record in this fixture carried the same nineteen turns — 1 595 characters
   * crammed into the first 2 minutes 52 of the call, whatever the call's length. Against
   * the *recording* that is **26 characters a minute** on `m-lefort-cv`, a 62-minute call
   * whose transcript stops after three minutes and is followed by **fifty-nine minutes of
   * silence**; 8 a minute on `m-lefort-decouverte`; 33, 35, 39 on the rest. A real call
   * measures about 1 386 (CLAUDE.md: 124 765 characters over ninety minutes). So every
   * judgement about *Historique*'s four panes, `TranscriptReader`'s scroll,
   * `ReadingColumn`'s « how much is left », the `--fade` ramp, the citation scroll and
   * `interleaveMarks` was made against a document up to **fifty times shorter** than
   * what the product produces — the sixth time this fixture has flattered the app, and
   * the exact shape this file's header records.
   *
   * The round-27 density check could not see it: it divided by the span of the *turns*,
   * which excludes the silence by construction, and read 591 a minute. It measures the
   * recording now.
   *
   * The call's own turns stay first and keep their ids and offsets — `spanOf` locates
   * citations in them and `MARKS` pins to them by id, and a fixture whose marks silently
   * stop pointing at anything is the failure this file's own comment warns about. The
   * rest of the call is filled from `LINES` at `STEP_MS`, which is a conversation rhythm
   * rather than a hole: about 550 characters a minute, with the remaining factor of two
   * and a half being silence, and silence is real.
   */
  const fillCall = (own, from, until, prefix) => {
    const out = own.map((segment) => ({ ...segment, receivedAt: from + segment.startMs }))
    let start = (out.length > 0 ? out[out.length - 1].startMs : -STEP_MS + 4_000) + STEP_MS
    let index = 0
    while (from + start + 6_400 <= until) {
      const line = LINES[index % LINES.length]
      out.push({
        id: `${prefix}-${index + 1}`,
        channel: line[0],
        text: line[1],
        startMs: start,
        endMs: start + 6_400,
        isFinal: true,
        provider: 'local-whisper',
        receivedAt: from + start,
      })
      start += STEP_MS
      index += 1
    }
    return out
  }

  /**
   * **A span's offsets come from the turn it is in, because the gate prints them.**
   *
   * Every one of the eleven field rows draws « vérifié · mm:ss » from
   * `field.span.startMs` (`Review.tsx:1828`), and `source ▸` then opens the reader
   * on the turn — which draws *its own* offset (`TranscriptReader.tsx:450`). Those
   * were two different numbers: the spans were hand-written literals up to
   * `840_000` ms, i.e. fourteen minutes, and none of them landed on the turn
   * carrying the quote even under the old 78-second spacing. So the gate said
   * « vérifié · 14:00 » about evidence the reader placed somewhere else entirely,
   * on the screen whose whole argument is that a claim is checkable.
   *
   * Located rather than declared, by the same fold `locateSegments` uses — accents
   * dropped, case folded, punctuation collapsed — and the offset within the turn is
   * apportioned by where the quote sits in it, which is the best a fixture can
   * honestly say: `modules/transcribe` stamps a segment with its *arrival*, so
   * there are no acoustic offsets inside a turn anywhere in this product.
   *
   * It throws on a quote it cannot find. A span that silently fell back to zero
   * would put « vérifié · 00:00 » on a row and be exactly the kind of quiet
   * fixture lie this file has now been caught in five times.
   */
  const foldQuote = (text) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()

  const spanOf = (quote, channel, segments) => {
    const needle = foldQuote(quote)
    const turn = (segments ?? SEGMENTS).find((segment) => foldQuote(segment.text).includes(needle))
    if (!turn) throw new Error('citation absente de la transcription du harnais : ' + quote)
    const hay = foldQuote(turn.text)
    const spoken = turn.endMs - turn.startMs
    const offset = Math.round((hay.indexOf(needle) / hay.length) * spoken)
    const length = Math.max(1_200, Math.round((needle.length / hay.length) * spoken))
    return {
      quote,
      channel,
      startMs: turn.startMs + offset,
      endMs: Math.min(turn.endMs, turn.startMs + offset + length),
    }
  }

  /**
   * The rep's own marks (`core/contracts/marks.ts`).
   *
   * Two, and they are the two kinds: one made on a line — the price sentence,
   * which is the turn a rep would point at — and one made on the pill with a
   * note typed into it, which is what the widget's field produces. A fixture
   * with only the first would never draw the second's rendering, and the two
   * are laid out differently on every surface that shows them.
   */
  const MARKS = [
    {
      id: 'mark-1',
      // Derived from the record rather than written beside it: a mark pinned to
      // a hand-typed segment id is a fixture that stops pointing at anything
      // the first time a line is added to the transcript above it, and it fails
      // *silently* — the mark simply falls back to its timestamp and the
      // pinned rendering is never photographed again.
      at: SEGMENTS[SEGMENTS.length - 3].receivedAt + 2_000,
      note: '',
      segmentId: SEGMENTS[SEGMENTS.length - 3].id,
      by: 'rep',
    },
    {
      id: 'mark-2',
      at: SEGMENTS[SEGMENTS.length - 2].receivedAt - 1_000,
      note: 'revenir sur le plafond achats avant de proposer',
      segmentId: null,
      by: 'rep',
    },
  ]

  /**
   * The sentence `meeting:mark` is refusing with, or null while it answers.
   *
   * A module-level switch rather than a scenario, because it is a *state a call
   * falls into* and not a dataset: the meeting was recording when the widget was
   * created and stopped being so while the pill was still up. See the responder.
   */
  let REFUSE_MARKS = null
  /** The press did not take — see `refusePause`. */
  let REFUSE_PAUSE = false
  /**
   * Which way `widget:resize` answers the panel opens — see `placeBelow`, and
   * `opensAbove` in `electron/app/windows/overlayPlacement.ts`, which is what
   * decides it in the product.
   */
  let OPENS_ABOVE = true
/** The call stopped while the pill was up — see `refuseMarks`. */
let RECORDING_STOPPED = false

  /**
   * A speech-shaped level history for the header meter — 20 samples, which is
   * exactly the meter's window, so replaying them fills the strip in one go and
   * a still screenshot shows the widget as a rep sees it rather than flat.
   *
   * The shape matters: a flat row of identical bars renders as a progress bar,
   * not a meter. Syllables and the gaps between them are what makes it read as
   * a voice. `floor` is `SPEECH_FLOOR` from `core/domain/inputLevel.ts`, so
   * roughly a third of these sit under the transcription line — which is what
   * the two-tone bars exist to show.
   */
  const LEVEL_HISTORY = [
    0.031, 0.048, 0.062, 0.041, 0.022, 0.009, 0.019, 0.055, 0.081, 0.067, 0.044, 0.028, 0.011,
    0.006, 0.024, 0.061, 0.088, 0.076, 0.042, 0.015,
  ]

  /**
   * And the far end's own history, which is **not** a scaled copy of the rep's.
   *
   * It used to be `rep * 0.55`, from when the meter drew one channel and this
   * number was never seen. Mirrored on screen, a scaled copy renders as a
   * perfectly symmetrical butterfly — which is the one shape a real call never
   * makes, and it hides the defect the second row exists to expose: two people
   * take turns. Loud here where the rep dips, quiet where the rep peaks, with a
   * short overlap at each handover.
   */
  const FAR_LEVEL_HISTORY = [
    0.006, 0.004, 0.011, 0.038, 0.072, 0.091, 0.064, 0.033, 0.012, 0.005, 0.009, 0.047, 0.079,
    0.086, 0.058, 0.026, 0.01, 0.005, 0.021, 0.049,
  ]

  const signal = (seq, kind, label, quote, startMs) => ({
    id: 'sig-neovia-' + seq,
    seq,
    kind,
    label,
    source: { quote, channel: 'far', startMs, endMs: startMs + 5_000 },
    createdAt: now - 22 * MIN + startMs,
  })

  const SIGNALS = [
    signal(1, 'profil', '2 × Data Engineer confirmé — Databricks, Airflow, dbt', 'il nous manque deux data engineers', 238_000),
    signal(2, 'profil', '1 × Lead Data pour le cadrage', 'un profil plus senior pour cadrer', 244_000),
    signal(3, 'demarrage', 'Démarrage souhaité début septembre', 'idéalement début septembre', 706_000),
    signal(4, 'duree', '12 mois — clause de sortie à 6 mois', 'douze mois, avec une clause de sortie à six mois', 784_000),
    signal(5, 'mode', 'Régie, pilotage quotidien côté client', 'de la régie, clairement', 940_000),
    signal(6, 'objection', 'TJM 2025 jugé trop haut par les achats', 'votre TJM de l’an dernier était un peu haut', 1_018_000),
    signal(7, 'tjm', '550 € confirmé · 650 € lead', 'du 550 euros pour un data engineer confirmé, et 650 pour le lead', 1_096_000),
    signal(8, 'etape', 'Envoyer 3 CV avec TJM avant vendredi', 'je vous envoie trois CV d’ici vendredi', 1_174_000),
  ]

  /** The rep's own notes — a real ProseMirror doc, never written by the AI (DEC-5). */
  const NOTES_DOC = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Néovia Santé — cadrage data' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Budget plateforme voté au comité d’investissement de ce matin. Élodie pilote, Marc valide la partie technique.',
          },
        ],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'À retenir' }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '2 data engineers + 1 lead — démarrage septembre' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Régie, 12 mois, sortie possible à 6' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Achats bloquent au-dessus de 550 € — voir si on tient 590 sur le lead' },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Sophie Bertrand en copie sur l’envoi des CV. Relancer jeudi si pas de retour.' },
        ],
      },
    ],
  }

  // ── the review gate (Groupe Lefort / Néovia, per scenario) ────────────────
  const span = (quote, startMs) => ({
    quote,
    channel: 'far',
    startMs,
    endMs: startMs === null ? null : startMs + 5_200,
  })

  const REVIEW_EDITS = {
    taskName: 'Néovia Santé — cadrage renfort data',
    accountId: 'CLI-2318',
    accountName: 'Néovia Santé',
    /*
      The compte-rendu **as `renderCompteRendu` actually composes it**, and that
      is the whole point of this fixture.

      It used to be four headings of narrative and nothing else — no deterministic
      header, no « Éléments retenus », no list sections — which is a document about
      half the length of the real one and missing every part a rep checks. Five
      screenshot passes judged the three-column session layout and the two-column
      gate against it and none of them were looking at the product. What a fixture
      is *for* is to be the thing the code produces; a short one flatters every
      layout it appears in.

      So: the deterministic head (DEC-7 — client, date, interlocuteurs, commercial
      come from Graph, never from the model), the model's six sections
      (`COMPTE_RENDU_SECTIONS`, opening on « ## Résumé » per DEC-40), then the
      recap the composer appends — one bullet per typed field, the three list
      fields under their own `###`, and `⚠ faible` where the citation could not be
      verified (DEC-21), which is the same field the rail flags.

      One line per paragraph: `renderCompteRendu` joins with `\n` and never wraps,
      and `unwrapProse` undoes any wrap the model arrived with — so a fixture
      hard-wrapped at 78 columns showed every screenshot a sentence cut after
      « et », which no rep will ever see.
    */
    compteRendu: [
      '# Néovia Santé — cadrage renfort data',
      '',
      // No `**`: the four deterministic lines are composed in code and carry no
      // emphasis — `compteRendu.ts` says why. The fixture follows the composer.
      'Client : Néovia Santé',
      `Date : ${crWhen(NEOVIA_SLOT, NEOVIA_SLOT + HOUR)}`,
      'Interlocuteurs : Élodie Vasseur (elodie.vasseur@neovia-sante.fr), Marc Pontier (marc.pontier@neovia-sante.fr)',
      'Commercial : julien.marchand@synapse-it.fr',
      '',
      '## Résumé',
      '',
      'Néovia Santé a voté ce matin le budget de sa plateforme data et cherche un renfort pour sortir ses pipelines Talend avant la fin de l’année. Le client annonce deux data engineers confirmés et un lead pour cadrer la migration, en régie, à partir de début septembre, sur douze mois. Le TJM reste le point ouvert : la grille achats plafonne à 550 € sur un profil confirmé et les entrées en mission au-dessus passent par la direction des achats. Trois CV sont attendus avant vendredi.',
      '',
      '## Contexte',
      '',
      'Le budget de la plateforme data a été voté ce matin en comité d’investissement. Néovia doit sortir ses pipelines Talend historiques avant la fin de l’année et généralise dbt sur les domaines métier. L’équipe interne est décrite comme « trois personnes, dont deux à mi-temps sur le sujet ».',
      '',
      '## Besoin exprimé',
      '',
      'Le client indique qu’« il nous manque deux data engineers » sur la migration, et « un profil plus senior pour cadrer » l’architecture cible. Le pilotage reste côté client, au quotidien, ce qui écarte le forfait — « de la régie, clairement ».',
      '',
      '## Échanges et points techniques',
      '',
      'La stack est Databricks et Airflow en place, dbt en cours de généralisation. Le client signale que les jobs Talend restants sont « une quarantaine, peut-être un peu plus », sans inventaire consolidé à ce stade. La reprise de l’historique n’a pas été tranchée pendant l’échange.',
      '',
      '## Objections et points de vigilance',
      '',
      'Le TJM 2025 a été jugé trop élevé par les achats. Le client indique que la grille interne plafonne à 550 € sur un profil confirmé ; au-delà, l’entrée en mission demande une validation côté achats. Aucun engagement n’a été pris sur le lead à 650 €.',
      '',
      '## Prochaines étapes',
      '',
      'Envoi de trois CV avec les TJM associés avant vendredi, la validation achats en copie. Point de calage la semaine suivante, une fois les profils lus.',
      '',
      '## Éléments retenus',
      '',
      '- **Besoin** : Renforcer l’équipe plateforme pour la migration des pipelines Talend vers Databricks, avec un cadrage technique assuré par un profil senior.',
      '- **Mode de collaboration** : régie',
      '- **TJM évoqué** : 550 €',
      '- **Démarrage** : début septembre 2026',
      '- **Durée de mission** : 12 mois, clause de sortie à 6 mois',
      '- **Contexte technique** : Databricks et Airflow en place, dbt en cours de généralisation, sortie des pipelines Talend historiques avant fin d’année.',
      '',
      '### Profils recherchés',
      '',
      '- 2 × Data Engineer — confirmé (Databricks, Airflow, dbt)',
      '- 1 × Lead Data — senior (architecture, cadrage, revue de code)',
      '',
      '### Objections et points de vigilance',
      '',
      '- La grille achats plafonne à 550 € sur un profil confirmé — _sans réponse apportée_ ⚠ faible',
      '',
      '### Prochaines étapes',
      '',
      '- Envoyer 3 CV avec les TJM associés — Julien Marchand — avant vendredi',
      '- Mettre Sophie Bertrand en copie — Élodie Vasseur',
      '- Point de calage une fois les profils lus — la semaine suivante',
      /*
        And the two lines `renderCompteRendu` appends after everything else, which
        this fixture carried neither of for seven review rounds.

        The legend is written **whenever the marker is anywhere in the document**,
        and there is a `⚠ faible` eight lines up. It exists because this string is
        also the body of the VerySwing task, read by a delivery manager who has
        never seen the review gate, its banner or its orange rail — to them the
        marker is a dingbat and a lowercase adjective at the end of a line. So the
        one part of the document that explains the product's own invented token
        (DEC-21) was the part no screenshot had ever shown.

        And the trailing newline, which is unconditional: `return
        `${document}${legend}\n``. It is one empty line in a `whitespace-pre-wrap`
        pane, at the foot of the three surfaces that draw a compte-rendu — the
        gate's reading column, the session pane and *Historique* — and it was
        missing from every one of them.

        `scripts/__tests__/harnessCompteRendu.test.mjs` holds both, derived by
        running the composer rather than by restating its French: reword the
        legend there and this fixture is asked for the new wording.
      */
      '',
      '⚠ faible : la citation de cette valeur n’a pas été retrouvée dans la transcription. À confirmer auprès du client.',
      '',
    ].join('\n'),
    besoin:
      'Renforcer l’équipe plateforme pour la migration des pipelines Talend vers Databricks, avec un cadrage technique assuré par un profil senior.',
    profils: '2 × Data Engineer confirmé (Databricks, Airflow, dbt)\n1 × Lead Data (cadrage, revue d’architecture)',
    modeCollaboration: 'régie',
    tjm: '550 € confirmé · 650 € lead',
    dateDemarrage: 'début septembre 2026',
    dureeMission: '12 mois, clause de sortie à 6 mois',
    contexteTechnique:
      'Databricks et Airflow en place, dbt en cours de généralisation, sortie des pipelines Talend historiques avant fin d’année.',
    objections:
      'Le TJM 2025 est jugé trop élevé par les achats ; la grille interne plafonne à 550 € sur un profil confirmé.',
    prochainesEtapes:
      'Envoyer 3 CV avec TJM avant vendredi — Julien Marchand\nMettre Sophie Bertrand en copie (validation des entrées en mission)\nPoint de calage la semaine suivante',
    montant: 550,
    devise: 'EUR',
    mailSubject: 'Suite à notre échange — renfort data Néovia Santé',
    /*
      One line per paragraph, because that is what `reviewGate.ts` produces.
      This fixture used to hard-wrap at 78 characters, which no code path in the
      product does — and a 500px textarea then re-wrapped the wrapped lines, so
      every screenshot of the gate showed a follow-up broken mid-sentence
      («  : / deux data / engineers confirmés … ») that a rep will never see.
      A fixture that lies makes the design pass lie with it.
    */
    mailBody: [
      'Bonjour Élodie,',
      '',
      'Merci pour cet échange. Je vous confirme ce que nous avons calé : deux data engineers confirmés et un lead data, en régie, pour un démarrage début septembre sur douze mois.',
      '',
      'Je vous adresse trois CV d’ici vendredi avec le TJM associé à chacun, Sophie Bertrand en copie. Nous pourrons caler un point la semaine suivante une fois les profils lus.',
      '',
      'Bien à vous,',
      'Julien Marchand — Synapse IT',
    ].join('\n'),
  }

  const REVIEW_FIELDS = [
    { key: 'taskName', label: 'Objet', confidence: 'ok', span: null },
    { key: 'account', label: 'Client', confidence: 'ok', span: null },
    {
      key: 'besoin',
      label: 'Besoin',
      confidence: 'ok',
      span: span('il nous manque deux data engineers', 238_000),
    },
    {
      key: 'profils',
      label: 'Profils',
      confidence: 'ok',
      span: span('un profil plus senior pour cadrer', 244_000),
    },
    {
      key: 'modeCollaboration',
      label: 'Mode',
      confidence: 'ok',
      span: span('de la régie, clairement', 940_000),
    },
    {
      key: 'tjm',
      label: 'TJM',
      confidence: 'ok',
      span: span('du 550 euros pour un data engineer confirmé, et 650 pour le lead', 1_096_000),
    },
    {
      key: 'dateDemarrage',
      label: 'Démarrage',
      confidence: 'ok',
      span: span('idéalement début septembre', 706_000),
    },
    {
      key: 'dureeMission',
      label: 'Durée',
      confidence: 'ok',
      span: span('douze mois, avec une clause de sortie à six mois', 784_000),
    },
    {
      key: 'contexteTechnique',
      label: 'Contexte technique',
      confidence: 'ok',
      span: span('Databricks et Airflow, avec du dbt', 396_000),
    },
    {
      // Measured, not self-reported (DEC-21): the quote could not be located in
      // the stored transcript, so the row wears ⚠ faible.
      key: 'objections',
      label: 'Objections',
      confidence: 'faible',
      span: span('la grille achats plafonne à 550', null),
    },
    {
      key: 'prochainesEtapes',
      label: 'Prochaines étapes',
      confidence: 'ok',
      span: span('je vous envoie trois CV d’ici vendredi', 1_174_000),
    },
  ]

  /*
    Without a Graph event there are no interlocuteurs, so `draftRelance` opens on
    « Bonjour, » — `firstNames` in `core/domain/reviewGate.ts` says so. This
    fixture served the signed-in body either way, which put « Bonjour Élodie, »
    on the same screen as « Interlocuteurs : aucun au calendrier » and read as a
    contradiction the product does not actually produce.
  */
  const REVIEW_PANEL = {
    meeting: meetingById('m-neovia-cadrage'),
    edits: entra
      ? REVIEW_EDITS
      : { ...REVIEW_EDITS, mailBody: REVIEW_EDITS.mailBody.replace('Bonjour Élodie,', 'Bonjour,') },
    fields: REVIEW_FIELDS,
    accountCandidates: [
      { accountId: 'CLI-2319', name: 'Néovia Santé — Pôle Ouest', confidence: 'ok' },
      { accountId: 'CLI-2331', name: 'Néovia Hospitalisation', confidence: 'faible' },
    ],
    /*
     * Both are deterministic and both come from the Graph event (DEC-7,
     * `modules/extract/facts.ts` `interlocuteursOf`). With no registration
     * there is no event, so there is nobody to write to — which is the whole
     * reason `mail.draft` is greyed rather than pushed into a null port.
     */
    interlocuteurs: entra
      ? [
          guest('Élodie Vasseur', 'elodie.vasseur@neovia-sante.fr'),
          guest('Marc Pontier', 'marc.pontier@neovia-sante.fr'),
        ]
      : [],
    mailTo: entra ? ['elodie.vasseur@neovia-sante.fr', 'sophie.bertrand@neovia-sante.fr'] : [],
    /*
      The panel carries this now, so the line above the draft can name the cause
      that is actually in the way rather than the one an empty `mailTo` happens
      to suggest. `review-sans-entra` is the stage where the two differ.
    */
    mailAccount: entra,
    overall: 'faible',
    /*
      **Where each generated line came from** (DEC-21).

      Twelve bullets carried no provenance at all while the eleven typed rows
      beside them each carried a `[source ▸]` — and the bullets are the operative
      half, « Envoyer 3 CV avec les TJM associés » being the commitment that
      becomes the VerySwing task. `text` is the line **as written**, marker
      excluded, because the renderer matches on equality; `span.quote` is what
      was actually said, because that is what is findable in `SEGMENTS`.

      Every quote below is a verbatim fragment of a real turn in `LINES`, which
      `harnessFixture.test.ts` proves — a fixture whose provenance leads nowhere
      would photograph this feature failing and call it a pass. The objection row
      is deliberately among them: a `⚠ faible` line is the one whose evidence a
      rep most wants to open.
    */
    sources: [
      {
        text: '**Besoin** : Renforcer l’équipe plateforme pour la migration des pipelines Talend vers Databricks, avec un cadrage technique assuré par un profil senior.',
        span: spanOf('il nous manque deux data engineers', 'far'),
      },
      {
        text: '**Mode de collaboration** : régie',
        span: spanOf('De la régie, clairement', 'far'),
      },
      {
        text: '**TJM évoqué** : 550 €',
        span: spanOf('plutôt sur du 550 euros pour un data engineer confirmé', 'far'),
      },
      {
        text: '**Démarrage** : début septembre 2026',
        span: spanOf('Idéalement début septembre', 'far'),
      },
      {
        text: '**Durée de mission** : 12 mois, clause de sortie à 6 mois',
        span: spanOf('douze mois, avec une clause de sortie à six mois', 'far'),
      },
      {
        text: '**Contexte technique** : Databricks et Airflow en place, dbt en cours de généralisation, sortie des pipelines Talend historiques avant fin d’année.',
        span: spanOf('Databricks et Airflow, avec du dbt qu’on est en train de généraliser', 'far'),
      },
      {
        text: '2 × Data Engineer — confirmé (Databricks, Airflow, dbt)',
        span: spanOf('il nous manque deux data engineers', 'far'),
      },
      {
        text: '1 × Lead Data — senior (architecture, cadrage, revue de code)',
        span: spanOf('un profil plus senior pour cadrer', 'far'),
      },
      {
        text: 'La grille achats plafonne à 550 € sur un profil confirmé — _sans réponse apportée_',
        span: spanOf('votre TJM de l’an dernier était un peu haut pour nos achats', 'far'),
      },
      {
        text: 'Envoyer 3 CV avec les TJM associés — Julien Marchand — avant vendredi',
        span: spanOf('Je vous envoie trois CV d’ici vendredi', 'rep'),
      },
      {
        text: 'Mettre Sophie Bertrand en copie — Élodie Vasseur',
        span: spanOf('Mettez Sophie en copie', 'far'),
      },
      {
        text: 'Point de calage une fois les profils lus — la semaine suivante',
        span: spanOf('un point de calage la semaine prochaine une fois les CV lus', 'rep'),
      },
    ],
    intents: [
      {
        id: 'm-neovia-cadrage:crm.task',
        kind: 'crm.task',
        label: 'Tâche compte-rendu (VerySwing)',
        // The slot, formatted rather than typed: `renderCompteRendu` and this
        // summary both name the same instant and a literal here could drift off it.
        summary: `Néovia Santé — cadrage renfort data · ${new Intl.DateTimeFormat('fr-FR', {
          timeZone: 'Europe/Paris',
          hour: '2-digit',
          minute: '2-digit',
        }).format(NEOVIA_SLOT)}`,
        available: true,
        reason: null,
      },
      {
        id: 'm-neovia-cadrage:crm.opportunity',
        kind: 'crm.opportunity',
        label: 'Opportunité (VerySwing)',
        summary: 'Renfort data — 3 profils, régie, 12 mois',
        available: true,
        reason: null,
      },
      {
        id: 'm-neovia-cadrage:mail.draft',
        kind: 'mail.draft',
        label: 'Brouillon de relance (Outlook)',
        summary: entra ? 'Suite à notre échange — renfort data Néovia Santé' : 'Indisponible',
        available: entra,
        /*
          The cause the *product* gives on this build, which is not the one this
          row carried. `draftIntents` has named the deeper one since round 25 —
          no Entra registration means no calendar to have attendees in *and* no
          mailbox to draft from — and `review:preview` in this same file already
          answered that way, so `review-sans-entra` showed one sentence on the
          first frame and a different one after the rep's first keystroke.
        */
        reason: entra ? null : 'Aucun compte Microsoft connecté.',
      },
    ],
  }

  // ── history ───────────────────────────────────────────────────────────────
  const intent = (meetingId, kind, label, state, over) =>
    Object.assign(
      {
        intentId: meetingId + ':' + kind,
        kind,
        label,
        state,
        attempts: state === 'failed' ? 3 : 1,
        lastError: null,
        remoteId: null,
      },
      over || {},
    )

  const HISTORY_ROWS = [
    {
      meeting: meetingById('m-nordis-support'),
      intents: [],
      matches: [
        {
          where: 'notes',
          excerpt: 'deux profils support N2, astreinte à cadrer avec les achats',
        },
      ],
    },
    {
      meeting: meetingById('m-lefort-cv'),
      intents: [],
      matches: [
        {
          where: 'notes',
          excerpt: 'trois CV envoyés, retour de Sophie attendu avant le comité',
        },
      ],
    },
    /*
      Today's call, and the reason it is here.

      `CLIENTS` offers « Néovia Santé » as a filter chip — the store builds that
      list from the client names it holds, and today's meeting is one of them —
      while `HISTORY_ROWS` had no Néovia row at all. So pressing the chip the
      screen itself offered answered « Aucun appel ne correspond », on the one
      client the whole fixture is built around, and `agenda-client` photographed
      an empty state for five review rounds. *Historique* is every meeting, not
      every *finished* meeting (DEC-25).
    */
    {
      meeting: meetingById('m-neovia-cadrage'),
      intents: [],
      matches: [
        {
          where: 'transcript',
          excerpt: '…la grille achats plafonne à 550 euros sur un profil confirmé…',
        },
      ],
    },
    {
      meeting: meetingById('m-sodexial-staffing'),
      intents: [
        intent('m-sodexial-staffing', 'crm.task', 'Tâche compte-rendu (VerySwing)', 'drained', {
          remoteId: 'TASK-4471',
        }),
        intent('m-sodexial-staffing', 'mail.draft', 'Brouillon de relance (Outlook)', 'drained', {
          remoteId: 'AAMkAGI2-draft-91',
        }),
      ],
      matches: [
        {
          where: 'transcript',
          excerpt: '…on reste sur un TJM de 480 euros pour les deux développeurs Java…',
        },
      ],
    },
    {
      meeting: meetingById('m-marechal-erp'),
      intents: [
        intent('m-marechal-erp', 'crm.task', 'Tâche compte-rendu (VerySwing)', 'drained', {
          remoteId: 'TASK-4468',
        }),
        intent('m-marechal-erp', 'crm.opportunity', 'Opportunité (VerySwing)', 'drained', {
          remoteId: 'OPP-1188',
        }),
        intent('m-marechal-erp', 'mail.draft', 'Brouillon de relance (Outlook)', 'failed', {
          lastError: 'jeton Microsoft expiré — reconnexion nécessaire',
        }),
      ],
      matches: [
        {
          where: 'compteRendu',
          excerpt: 'Migration ERP prévue sur 2027, TJM de référence 560 € pour un consultant SAP.',
        },
      ],
    },
    {
      meeting: meetingById('m-delcourt-premier'),
      intents: [
        intent('m-delcourt-premier', 'crm.task', 'Tâche compte-rendu (VerySwing)', 'drained', {
          remoteId: 'TASK-4455',
        }),
      ],
      matches: [
        {
          where: 'transcript',
          excerpt: '…leur grille achats plafonne le TJM à 520 euros sur un profil confirmé…',
        },
      ],
    },
    {
      meeting: meetingById('m-nordis-renouvellement'),
      intents: [
        intent('m-nordis-renouvellement', 'crm.task', 'Tâche compte-rendu (VerySwing)', 'drained', {
          remoteId: 'TASK-4402',
        }),
        intent('m-nordis-renouvellement', 'crm.opportunity', 'Opportunité (VerySwing)', 'pending'),
        intent('m-nordis-renouvellement', 'mail.draft', 'Brouillon de relance (Outlook)', 'drained', {
          remoteId: 'AAMkAGI2-draft-77',
        }),
      ],
      matches: [
        {
          where: 'transcript',
          excerpt: '…on renouvelle les deux missions, même TJM, jusqu’en mars…',
        },
      ],
    },
    {
      meeting: meetingById('m-arkelia-bilan'),
      intents: [],
      matches: [
        { where: 'notes', excerpt: 'appel coupé au bout de 5 min, à reprogrammer' },
      ],
    },
    {
      meeting: meetingById('m-lefort-decouverte'),
      intents: [
        intent('m-lefort-decouverte', 'crm.task', 'Tâche compte-rendu (VerySwing)', 'drained', {
          remoteId: 'TASK-4310',
        }),
        intent('m-lefort-decouverte', 'crm.opportunity', 'Opportunité (VerySwing)', 'blocked'),
      ],
      matches: [
        {
          where: 'transcript',
          excerpt: '…deux ingénieurs DevOps, un TJM autour de 620 euros, démarrage septembre…',
        },
      ],
    },
  ]

  const CLIENTS = [
    'Néovia Santé',
    'Groupe Lefort',
    'Sodexial',
    'Groupe Maréchal',
    'Banque Delcourt',
    'Nordis Retail',
    'Arkelia Logistique',
  ]

  /**
   * The Lefort call's own turns, named rather than inline so `spanOf` can locate a
   * citation in *this* transcript. Two of the fixture's spans belong to this
   * meeting and not to Néovia's, and a helper defaulting to the wrong one would
   * have thrown — which is how this was found.
   *
   * **`receivedAt` is derived from `startMs`, because two surfaces print the two and
   * they were a factor of five apart.** These five stamps were `at(-14, 15, 3)` …
   * `at(-14, 15, 7)` — one minute apart — over turns `startMs` places twelve seconds
   * apart: *Historique*'s reader draws `receivedAt` as wall clock and the gate draws
   * `span.startMs` as an offset, so the same five turns were a four-minute
   * conversation on one screen and a fifty-six-second one on the other. Four hundred
   * and sixty-one characters over four minutes is also **115 a minute**, against
   * roughly 1 386 on a real call, which is the fixture-sparser-than-the-product shape
   * this file's header records — and the reason the five-turn record looked like a
   * comfortable little panel. Derived, it is 493.
   */
  const LEFORT_STARTED = meetingById('m-lefort-decouverte').startedAt
  const LEFORT_SEGMENTS = [
      {
        id: 'rec-lefort-1',
        channel: 'far',
        text: 'On a deux départs sur l’équipe plateforme, et la migration Kubernetes ne peut pas attendre.',
        startMs: 96_000,
        endMs: 102_400,
        isFinal: true,
        provider: 'local-whisper',
        receivedAt: LEFORT_STARTED + 96_000,
      },
      {
        id: 'rec-lefort-2',
        channel: 'rep',
        text: 'Vous cherchez plutôt des profils confirmés ou un lead capable de cadrer ?',
        startMs: 108_000,
        endMs: 112_800,
        isFinal: true,
        provider: 'local-whisper',
        receivedAt: LEFORT_STARTED + 108_000,
      },
      {
        id: 'rec-lefort-3',
        channel: 'far',
        text: 'Deux ingénieurs DevOps confirmés, un TJM autour de 620 euros, démarrage septembre.',
        startMs: 118_000,
        endMs: 124_600,
        isFinal: true,
        provider: 'local-whisper',
        receivedAt: LEFORT_STARTED + 118_000,
      },
      {
        id: 'rec-lefort-4',
        channel: 'far',
        text: 'Le sujet qui va coincer, c’est le délai de démarrage : nos achats mettent trois semaines à contractualiser.',
        startMs: 131_000,
        endMs: 138_900,
        isFinal: true,
        provider: 'local-whisper',
        receivedAt: LEFORT_STARTED + 131_000,
      },
      {
        id: 'rec-lefort-5',
        channel: 'rep',
        text: 'On peut anticiper le sourcing pendant ce temps-là, je vous envoie les premiers profils la semaine prochaine.',
        startMs: 145_000,
        endMs: 152_100,
        isFinal: true,
        provider: 'local-whisper',
        receivedAt: LEFORT_STARTED + 145_000,
      },
  ]

  const RECORDS = {
    'm-lefort-decouverte': {
      meeting: meetingById('m-lefort-decouverte'),
      /*
        The rep's own marks on a call they have already had (DEC-49).

        Here rather than only on the live one, because *Historique*'s reader is
        the surface a mark is *for*: it was made one-handed during the call and
        is read weeks later beside the compte-rendu. That rendering had never
        been drawn by anything — the stage existed, the fixture had no marks,
        and the first screenshot of it was the one that white-screened.
      */
      marks: [
        // Derived from the turn it is pinned to, for the reason `MARKS` is.
      {
        id: 'lefort-mark-1',
        at: LEFORT_SEGMENTS[3].receivedAt + 2_000,
        note: '',
        segmentId: LEFORT_SEGMENTS[3].id,
        by: 'rep',
      },
        {
          id: 'lefort-mark-2',
          at: at(-14, 15, 7),
          note: 'relancer les achats avant le 15',
          segmentId: null,
          by: 'rep',
        },
      ],
      /*
        Its own five cited turns first, then the rest of its fifty-seven minutes — see
        `fillCall`. Five turns and 461 characters over a 57-minute recording is **eight
        characters a minute**, which is what *Historique*'s panes and the reader's scroll
        were judged against.
      */
      segments: fillCall(
        LEFORT_SEGMENTS,
        LEFORT_STARTED,
        meetingById('m-lefort-decouverte').endedAt,
        'rec-lefort-suite',
      ),
      notes:
        'Sophie Bertrand pilote côté DSI, Karim Benali côté plateforme.\nBloquant : délai de contractualisation achats (3 semaines).\nPenser à proposer un profil en pré-embauche.',
      // Ends with the newline `renderCompteRendu` always appends. No marker in it,
      // so no legend — « a clean compte-rendu carries no apparatus at all ».
      compteRendu:
        '## Contexte\n\nDeux départs sur l’équipe plateforme du Groupe Lefort et une migration vers Kubernetes engagée pour le second semestre.\n\n## Besoin\n\nDeux ingénieurs DevOps confirmés (Kubernetes, Terraform, GitLab CI), démarrage septembre, en régie.\n\n## Point de vigilance\n\nLe circuit achats demande trois semaines de contractualisation ; le sourcing doit être lancé en amont.\n',
      fields: [
        { key: 'account', label: 'Client', confidence: 'ok', span: null },
        {
          key: 'profils',
          label: 'Profils',
          confidence: 'ok',
          span: spanOf('deux ingénieurs DevOps confirmés', 'far', LEFORT_SEGMENTS),
        },
        {
          key: 'tjm',
          label: 'TJM',
          confidence: 'ok',
          span: spanOf('un TJM autour de 620 euros', 'far', LEFORT_SEGMENTS),
        },
        {
          key: 'objections',
          label: 'Objections',
          confidence: 'faible',
          span: { quote: 'les achats bloquent au-delà de 600 euros', channel: 'far', startMs: null, endMs: null },
        },
      ],
      overall: 'faible',
      intents: [],
    },
  }

  /*
    The client-side people, so the reader can name the far speaker when there is
    exactly one of them (`speakerLabel`). Two on the Néovia call and one on the
    Lefort call, which is what makes the two readers look different — and which
    is the point: the app names the turn only when the record settles it.
  */
  const INTERLOCUTEURS = {
    'm-neovia-cadrage': [
      { name: 'Élodie Vasseur', email: 'elodie.vasseur@neovia-sante.fr', type: 'required', response: 'accepted' },
      { name: 'Marc Pontier', email: 'marc.pontier@neovia-sante.fr', type: 'required', response: 'accepted' },
    ],
    'm-lefort-decouverte': [
      { name: 'Sophie Bertrand', email: 'sophie.bertrand@groupe-lefort.fr', type: 'required', response: 'accepted' },
    ],
  }

  /*
    A record, as `history:record` answers it.

    `marks` is spread **first** and on every branch, which is not tidiness: the
    real channel is Zod-parsed on the way out and `HistoryRecordSchema.marks`
    carries `.default([])`, so a missing key is invisible in production and a
    hard crash here — `interleaveMarks` iterates it. That is exactly what
    happened: adding marks to the reader white-screened two stages, and the
    suite could not see it because no unit test renders `Historique`. A fixture
    that is missing a field the schema fills in is a fixture that is *stricter*
    than production, and this file has now been caught flattering the product
    three times and failing it once.
  */
  const recordFor = (meetingId) => {
    const known = RECORDS[meetingId]
    if (known) {
      return { marks: [], interlocuteurs: INTERLOCUTEURS[meetingId] || [], ...known }
    }
    const m = meetingById(meetingId) || meeting({ id: meetingId })
    /*
      **A record shown for one call is dated inside that call.**

      The turns are deliberately shared — what a generic record is for is *volume*,
      so the pane is photographed holding a real call rather than the six lines it
      held for thirteen rounds. What is not shareable is *when* they happened: this
      handed Néovia's `receivedAt` stamps to every meeting it has no entry for, so
      *Historique* on the 9:01 Sodexial call drew nineteen turns stamped 14:30 —
      four and a half hours after the recording being read had stopped — and
      `TranscriptReader` prints `receivedAt` as wall clock. The marks came from the
      same instants and moved with them.
    */
    const from = m.startedAt || m.createdAt
    const shift = from - NEOVIA_STARTED
    return {
      meeting: m,
      interlocuteurs: INTERLOCUTEURS[meetingId] || [],
      marks: MARKS.map((mark) => ({ ...mark, at: mark.at + shift })),
      /*
        **The whole call, and it was six turns for as long as this stub
        existed.**

        A rep opens *Historique* to read a fifty-minute call, and every
        screenshot ever taken of that screen showed a record that fits in its
        box. So the transcript pane's bare `max-h-72` — 288 pixels, no mask, no
        page turn, hiding 95% of a real record behind a hard edge — was
        photographed as a comfortable little panel, thirteen rounds running.
        This file's own header records that a fixture shorter than the output
        flatters every layout it appears in; this was the fourth time.
      */
      segments: fillCall(SEGMENTS, from, m.endedAt || now, `seg-${meetingId}`),
      notes: 'Rien de particulier à signaler sur cet appel.',
      // Same: the composer's final newline, and no marker so no legend.
      compteRendu: '## Contexte\n\nPoint d’avancement sans décision nouvelle.\n',
      fields: [{ key: 'account', label: 'Client', confidence: 'ok', span: null }],
      overall: 'ok',
      intents: [],
    }
  }

  // ── health ────────────────────────────────────────────────────────────────
  const HEALTH = {
    /*
      First launch, on a machine where nothing has been set up yet — which is the
      only state the onboarding's second step exists for.

      `capture` is `degraded` and **retryable**: the screen-recording permission
      has not been answered, one channel would still be captured, and pressing
      *Autoriser* re-asks the OS — `main.ts` registers that retry, so the claim
      survives `Orchestrator.#truthful`. `llm` is not retryable, because a
      provider nobody has chosen is not fixed by trying again, so it gets the
      link to Réglages instead. Two remedies, and offering the wrong one is the
      dead control DEC-26 forbids.
    */
    premierLancement: {
      /*
        A first launch on a Mac where the screen-recording prompt has not been
        answered — composed by `core/domain/capturePermission.ts`, word for word.

        This fixture has now been wrong in both directions, which is worth
        recording. It first invented « macOS n’a pas encore autorisé
        l’enregistrement de l’écran… », a string that existed nowhere in
        `electron/` because the app did not look at TCC at all — so the
        onboarding screenshot was a picture of a permission flow the product did
        not have. It was corrected to the native-module failure, which was
        honest and was also the *rare* case: a machine whose binary will not load
        is a broken install, and the common first run is a machine that works and
        has not been given permission yet. The app checks that now, so the
        fixture is the sentence it produces.

        `degraded` and `retryable: true`, both load-bearing: one channel is still
        captured, so a meeting still happens (DEC-26), and *Autoriser* fires the
        real prompt — `main.ts` registers the retry, so `Orchestrator.#truthful`
        lets the claim stand.
      */
      capture: {
        state: 'degraded',
        reason:
          'l’audio système n’est pas autorisé — le client ne sera pas enregistré, vous seul le serez. Autorisez-le pour que Sillage puisse l’enregistrer.',
        since: now - 20 * 1000,
        retryable: true,
      },
      /*
        `ok`, and it is the honest first launch.

        This claimed « téléchargement du modèle Whisper — 204 Mo sur 486 Mo » in
        `degraded`, which the app cannot emit and which is not even true of the
        product: the weights ship inside the installer (`main.ts` says so where
        it explains why the splash never waits on a download), and the only
        transcribe failures are « aucun moteur de transcription disponible » and
        the two language ones. It also painted a *progressing download* in
        `--warn` beside a « Réglages › », so the screen said something was wrong
        with the one subsystem that was working.
      */
      transcribe: { state: 'ok' },
      llm: {
        state: 'down',
        reason: 'aucun modèle de langage configuré',
        since: now - 60 * 1000,
        retryable: false,
      },
      calendar: { state: 'ok' },
      crm: { state: 'ok' },
      mail: { state: 'ok' },
    },
    agenda: {
      capture: { state: 'ok' },
      transcribe: { state: 'ok' },
      calendar: { state: 'ok' },
      llm: { state: 'ok' },
      crm: { state: 'ok' },
      mail: { state: 'ok' },
    },
    /*
      **A capture in trouble while the call is running — the widget's whole
      reason for existing, and the one state no stage had ever staged.**

      `grep -c 'capture:health'` over this file returned 0. So the panel's
      `trouble` strip had never been photographed, and it shipped for a round
      carrying an internal rule six lines below a comment claiming the card had
      none. A fixture missing a state is a claim nothing can falsify.

      The sentence is `capture/index.ts`'s `#checkOutputRoute`, word for word,
      and it is the right one for this surface for a reason beyond convenience:
      it is the only capture failure that happens *during* a call, which is the
      only time this window is on screen. `degraded` and never `down` — the
      microphone is still arriving and the meeting is still being recorded
      (DEC-32) — and it names the side, which is what the strip has to convey.

      Two lines at the card's 340px, deliberately: the strip is a sentence and
      the round that added this also stopped it being set in bold gold, so the
      stage has to carry the case that shows why.
    */
    'widget-ennui': {
      capture: {
        state: 'degraded',
        reason:
          'La sortie audio de l’ordinateur a changé pendant l’appel — le son du client peut ne plus être capté. Terminez et redémarrez l’enregistrement pour le reprendre.',
        since: now - 40 * 1000,
        retryable: true,
      },
      transcribe: { state: 'ok' },
      calendar: { state: 'ok' },
      llm: { state: 'ok' },
      crm: { state: 'ok' },
      mail: { state: 'ok' },
    },
    mixed: {
      capture: { state: 'ok' },
      transcribe: { state: 'ok' },
      calendar: { state: 'ok' },
      llm: { state: 'ok' },
      crm: {
        state: 'down',
        reason: 'VerySwing injoignable — la sandbox VSA n’a pas répondu en 10 s',
        since: now - 26 * MIN,
        retryable: true,
      },
      /*
        `mailHealth`'s own sentence for an expired session, and no other. This
        said « jeton Microsoft expiré — reconnectez votre compte pour créer des
        brouillons » in `degraded`, and the module emits neither: a token failure
        is `down`, and the two strings it can produce are « session Microsoft
        expirée » and « reconnexion à Microsoft nécessaire ». Every review of the
        connectors pane was done against a row the product cannot draw.
      */
      mail: {
        state: 'down',
        reason: 'session Microsoft expirée',
        since: now - 3 * HOUR,
        retryable: true,
      },
    },
  }

  /*
   * What `app/main.ts` seeds when `resolveIdentityConfig()` returns null —
   * verbatim, because the point of the no-Entra screens is to read the
   * sentences the product will actually show, not paraphrases of them.
   */
  /**
   * Verbatim from `app/ipc/register.ts` — the sentence that disables
   * *Se connecter* and states why beside it.
   */
  const NO_REGISTRATION =
    'Aucune application Microsoft n’est configurée — le calendrier et les brouillons Outlook restent indisponibles.'

  const NO_ENTRA_HEALTH = {
    calendar: {
      state: 'down',
      /*
        **Kept equal to `main.ts` by a test, because it drifted.**

        `main.ts` gained a second clause — a rep on a build with no Entra loses
        the calendar *and* every arming offer, and DEC-26 says a degradation is
        stated — and this fixture kept the old one-clause sentence. So every
        `--sans-entra` stage photographed a string the product no longer emits,
        and it flattered the app in the usual direction: shorter, calmer, and
        unable to show whether the real sentence fits the card it is drawn in.
        Four times now. `harnessFixture.test.ts` holds this pair to the source.
      */
      reason:
        'aucune application Microsoft configurée — le calendrier reste vide ; ' +
        'les appels en cours sont tout de même détectés et proposés à l’enregistrement, ' +
        'sans les participants ni l’objet de l’invitation',
      since: now - 3 * HOUR,
      retryable: false,
    },
    mail: {
      state: 'down',
      reason: 'aucune application Microsoft configurée — le brouillon Outlook ne sera pas créé',
      since: now - 3 * HOUR,
      retryable: false,
    },
  }

  // ── settings ──────────────────────────────────────────────────────────────
  /**
   * Rewrites one provider's credential state in place, in whichever section
   * holds it. The stub keeps no vault: what it models is the *shape* of the
   * answer, so the screen can be photographed with a key stored.
   */
  const withCredential = (providerId, credential) => {
    for (const key of ['stt', 'llm']) {
      SETTINGS[key].rows = SETTINGS[key].rows.map((row) =>
        row.id === providerId ? { ...row, credential, configured: credential.stored } : row,
      )
    }
    return SETTINGS
  }

  /*
    **The sentence the pill hands to the client** (US-19,
    `electron/core/contracts/mention.ts`).

    Written out rather than imported, because this file is serialised into the page
    by `addInitScript` and is deliberately one self-contained function with no
    imports. So it is the *second* copy of a string this repo has just finished
    arguing must have only one — which is exactly the condition
    `harnessFixture.test.ts` exists for: it reads this literal out of the source and
    fails when it stops matching `MENTION_SENTENCE_DEFAULT`. A fixture is checked,
    not trusted; it has flattered the app seven times.
  */
  const MENTION_SENTENCE_DEFAULT =
    'Je vous informe que j’utilise un outil qui transcrit cet échange pour en rédiger le ' +
    'compte-rendu ; l’audio n’est pas conservé. Dites-moi si vous préférez que je l’arrête.'

  const SETTINGS = {
    /*
      « Cette machine uniquement » (DEC-37), off — which is the default and the
      state every other row in this fixture is consistent with: a cloud provider
      is configured and selected, and with the switch on it would not be.
    */
    offlineOnly: false,
    /* US-19 — resolved, the way `snapshot()` resolves it in the product. */
    mentionSentence: MENTION_SENTENCE_DEFAULT,
    stt: {
      rows: [
        {
          id: 'local-whisper',
          label: 'Whisper (local)',
          tier: 'local',
          residency: 'local',
          cost: 'free',
          auth: 'none',
          credential: { stored: false, hint: null },
          configured: true,
          selected: true,
          selectable: true,
          reason: null,
          fields: [],
        },
        {
          id: 'local-whisper-large',
          label: 'Whisper large-v3 (local)',
          tier: 'local',
          residency: 'local',
          cost: 'free',
          auth: 'none',
          credential: { stored: false, hint: null },
          configured: false,
          selected: false,
          selectable: false,
          reason: 'poids absents de cette machine — 1,5 Go à installer',
          fields: [],
        },
        {
          id: 'azure-speech-fr',
          label: 'Azure Speech — France Centre',
          tier: 'cloud',
          residency: 'remote',
          cost: 'metered',
          auth: 'apiKey',
          credential: { stored: false, hint: null },
          configured: true,
          selected: false,
          selectable: true,
          reason: null,
          fields: [],
        },
        {
          id: 'soniox',
          label: 'Soniox',
          tier: 'cloud',
          residency: 'remote',
          cost: 'metered',
          auth: 'apiKey',
          credential: { stored: false, hint: null },
          configured: false,
          selected: false,
          selectable: false,
          reason: 'aucune clé enregistrée',
          fields: [],
        },
      ],
      selected: 'local-whisper',
      reason: null,
      fields: [],
    },
    llm: {
      rows: [
        {
          id: 'mistral',
          label: 'Mistral AI',
          tier: 'cloud',
          residency: 'remote',
          cost: 'metered',
          auth: 'apiKey',
          credential: { stored: true, hint: 'a41d' },
          configured: true,
          selected: true,
          selectable: true,
          reason: null,
          fields: [],
        },
        {
          id: 'ollama-qwen',
          label: 'Ollama — Qwen2.5 14B',
          tier: 'local',
          residency: 'local',
          cost: 'free',
          auth: 'none',
          credential: { stored: false, hint: null },
          configured: false,
          selected: false,
          selectable: false,
          reason: 'aucun serveur Ollama détecté sur cette machine',
          fields: [],
        },
        {
          id: 'openai',
          label: 'OpenAI',
          tier: 'cloud',
          residency: 'remote',
          cost: 'metered',
          auth: 'apiKey',
          credential: { stored: false, hint: null },
          configured: false,
          selected: false,
          selectable: false,
          reason: 'aucune clé enregistrée',
          fields: [],
        },
      ],
      selected: 'mistral',
      reason: null,
      fields: [],
    },
    /**
     * The local checkpoints (DEC-35). One shipped with the installer, one
     * mid-download and one absent — the three states the panel has to draw, so
     * a screenshot of this screen shows the progress row rather than a table
     * where every model happens to be installed.
     */
    models: {
      /*
        **The catalogue's own four rows, with the product's own numbers.**

        This table was hand-written and none of its three rows matched
        `whisper/catalog.ts`: Small was `466` against 486, Medium `1530` against
        1614, and Whisper Large v3 Turbo was `1031` — which is the exact figure
        the catalogue records as the defect it removed, « the rep was promised
        1 GB and charged 2.8 ». That row is gone from the product entirely now
        (every one of its inferences throws), so the fixture was staging a
        download of a model a rep cannot select, at a size the product never
        reported, on the one screen that tells a rep what a download will cost.

        Numbers copied from `MODELS`, not imported: this function is serialised
        into the page by `addInitScript`, so it can close over nothing. That is
        what makes a copy the only option and a check the only way to keep it
        honest — `harnessFixture.test.ts` asserts the four ids, labels, sizes,
        speeds and accuracies against the shipped catalogue.

        The statuses are the fixture's own and are the point of the stage: one
        bundled and selected, one mid-download so the progress row is
        photographed rather than a table where everything happens to be
        installed, and two absent.
      */
      rows: [
        {
          id: 'Xenova/whisper-tiny',
          label: 'Whisper Tiny',
          sizeMb: 61,
          speed: 'fast',
          accuracy: 'correcte',
          bundled: false,
          status: 'absent',
          progress: 0,
          reason: null,
          selected: false,
        },
        {
          id: 'Xenova/whisper-base',
          label: 'Whisper Base',
          sizeMb: 130,
          speed: 'fast',
          accuracy: 'bonne',
          bundled: false,
          status: 'absent',
          progress: 0,
          reason: null,
          selected: false,
        },
        {
          id: 'Xenova/whisper-small',
          label: 'Whisper Small',
          sizeMb: 486,
          speed: 'medium',
          accuracy: 'très bonne',
          bundled: true,
          status: 'ready',
          progress: 100,
          reason: null,
          selected: true,
        },
        {
          id: 'Xenova/whisper-medium',
          label: 'Whisper Medium',
          sizeMb: 1614,
          speed: 'slow',
          accuracy: 'très bonne',
          bundled: false,
          status: 'downloading',
          progress: 38,
          reason: null,
          selected: false,
        },
      ],
      selected: 'Xenova/whisper-small',
    },
    connectors: [
      { id: 'capture', label: 'Audio', health: HEALTH.mixed.capture },
      /*
        `ok`, and the fixture used to say otherwise.

        It painted this row amber with « modèle « small » chargé — précision
        moindre sur les noms propres », on the REQUIS rail, which is a state no
        code path in the product produces: `modules/transcribe` reports
        `degraded` on transcription *errors* and on nothing else. So the harness
        was inventing a health, and the health it invented broke DEC-30 — the
        local engine is the default and is never presented as a downgrade, and
        this drew the default engine as a fault on the one screen a rep opens to
        find faults.

        Which checkpoint is loaded is worth knowing and is already on screen,
        neutrally, in *Modèles* below: three rows with their size, their speed
        and their accuracy, and a mark on the selected one.
      */
      { id: 'transcribe', label: 'Transcription', health: { state: 'ok' } },
      { id: 'llm', label: 'Analyse', health: HEALTH.mixed.llm },
      {
        id: 'calendar',
        label: 'Calendrier',
        health: entra ? HEALTH.mixed.calendar : NO_ENTRA_HEALTH.calendar,
      },
      { id: 'crm', label: 'VerySwing', health: HEALTH.mixed.crm },
      { id: 'mail', label: 'Outlook', health: entra ? HEALTH.mixed.mail : NO_ENTRA_HEALTH.mail },
    ],
    auth: entra ? { status: 'signedIn', account: ACCOUNT } : { status: 'signedOut', reason: NO_REGISTRATION },
    probe: {
      at: now - 41 * MIN,
      authenticated: true,
      findings: [
        {
          id: 'listCustomers',
          label: 'liste des clients',
          matters: 'sans elle, aucun compte client n’est proposé au moment de valider',
          required: true,
          state: 'ok',
          status: 200,
          detail: 'disponible — 1 284 comptes',
        },
        {
          id: 'createTask',
          label: 'création d’une tâche compte-rendu',
          matters: 'sans elle, le compte-rendu ne part jamais dans VerySwing',
          required: true,
          state: 'ok',
          status: 200,
          detail: 'disponible',
        },
        {
          id: 'findProspectContacts',
          label: 'recherche de contacts par e-mail',
          matters: 'sans elle, un interlocuteur en adresse personnelle n’est jamais rattaché',
          required: true,
          state: 'missing',
          status: 404,
          detail: 'absente de ce tenant',
        },
        {
          id: 'createOpportunity',
          label: 'création d’opportunité',
          matters: 'sans elle, seule la tâche compte-rendu est créée',
          required: false,
          state: 'ok',
          status: 201,
          detail: 'disponible',
        },
      ],
      columnGaps: [
        { table: 'oppy', column: 'tjm_cible', schema: 'vsa_sandbox' },
      ],
      ok: false,
      summary: 'une capacité manque sur ce tenant : recherche de contacts par e-mail',
    },
    probeReason: null,
    retention: { diagnosticsDays: 90, meetingContent: 'never' },
  }

  const DIAGNOSTICS = [
    {
      id: 'diag-1',
      ts: now - 3 * MIN,
      severity: 'info',
      code: 'transcribe.segment',
      module: 'transcribe',
      message: 'segment final émis (local-whisper)',
      detail: { durationMs: 6400, channel: 'far' },
      meetingId: 'm-neovia-cadrage',
    },
    {
      id: 'diag-2',
      ts: now - 26 * MIN,
      severity: 'error',
      code: 'crm.unreachable',
      module: 'crm',
      message: 'VerySwing injoignable — délai dépassé',
      detail: { status: null, elapsedMs: 10000 },
      meetingId: null,
    },
    {
      id: 'diag-3',
      ts: now - 52 * MIN,
      severity: 'warn',
      code: 'transcribe.model',
      module: 'transcribe',
      message: 'modèle « small » chargé à la place de « medium »',
      detail: { requested: 'medium', loaded: 'small' },
      meetingId: null,
    },
    {
      id: 'diag-4',
      ts: now - 3 * HOUR,
      severity: 'warn',
      code: 'mail.token',
      module: 'mail',
      message: 'jeton Microsoft expiré',
      detail: { scopes: ['Mail.ReadWrite'] },
      meetingId: null,
    },
  ]

  /*
    ── boot ────────────────────────────────────────────────────────────────────

    « ouverte · sur cette machine », not « sillage.db · schéma v3 ». `main.ts`
    stopped publishing the filename and the schema version some time ago — they
    are a support fact and they live in Diagnostics — and this fixture kept the
    old string, so every screenshot of screen 0 opened on a SQLite filename and
    a design pass reported a defect the product does not have.

    The download line carries what a rep waiting on it actually needs: what is
    being fetched, how far along, and that it happens once. `percent` is the bar;
    `value` is the sentence beside it, composed in main (see `boot.ts`).
  */
  const BOOT_READY = {
    store: { state: 'ready', value: 'ouverte · sur cette machine' },
    devices: { state: 'ready', value: 'moteur de capture chargé' },
    transcription: { state: 'ready', value: 'Whisper (local)' },
    version: '0.4.2',
  }

  /*
    **The boot a rep actually gets, mid-answer.**

    This staged `downloading` — a progress bar, « 204 Mo sur 486 Mo », an ETA —
    and `core/contracts/boot.ts` says in as many words that **nothing in the app
    emits that variant**: the weights ship inside the installer, so a first run
    answers all three steps in under a second. The variant is declared for a
    boot-time fetch that does not exist yet, and staging it as *the* splash meant
    the only screenshot of screen 0 was of a flow the product cannot perform,
    while the boot every rep really sees had never been photographed at all.

    Two steps answered and one still pending is the honest picture of a launch in
    flight: it is what the window holds for the few hundred milliseconds the
    splash exists, and `bootAnswered` is what lets it through.
  */
  const BOOT_BOOTING = {
    store: { state: 'ready', value: 'ouverte · sur cette machine' },
    devices: { state: 'pending' },
    transcription: { state: 'ready', value: 'Whisper (local) · sur cette machine' },
    version: '0.4.2',
  }

  /*
    The declared-but-unreached variant, kept and named for what it is.

    `boot.ts` argues the variant should exist before the fetch does, so that the
    day a boot-time download lands the screen is already written rather than
    improvised — and a screen nobody can photograph is a screen nobody checks.
    This is its own scenario so it can be looked at, and so it can never again be
    mistaken for what a first run does.
  */
  const BOOT_DOWNLOADING = {
    store: { state: 'ready', value: 'ouverte · sur cette machine' },
    devices: { state: 'pending' },
    transcription: {
      state: 'downloading',
      // 486 Mo is Whisper Small's size in `whisper/catalog.ts`. It read 466
      // here and in the two comments above, which is a number the product has
      // not reported since the catalogue was corrected.
      value: 'modèle Whisper — 204 Mo sur 486 Mo · environ 1 min',
      percent: 42,
    },
    version: '0.4.2',
  }

  // ── search ────────────────────────────────────────────────────────────────
  const fold = (value) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')

  /*
    **The rep's own marks are in it**, because they are in the product's.

    `searchableRecord` folds five surfaces and the fifth is `marks` — the only
    thing a rep can type from inside the call. A stub that filtered on four of
    them would photograph « Aucun appel ne correspond » for a query the shipped
    search answers, which is the fifth way this fixture has flattered or
    contradicted the app. Read off `RECORDS`, so the stage cannot show a mark the
    expanded row does not also draw.
  */
  const markNotesOf = (meetingId) =>
    ((RECORDS[meetingId] || {}).marks || [])
      .map((mark) => mark.note)
      .filter(Boolean)
      .join(' · ')

  const blobOf = (row) =>
    fold(
      [
        row.meeting.title,
        row.meeting.clientName,
        statusOf(row.meeting),
        markNotesOf(row.meeting.id),
        row.matches.map((m) => m.excerpt).join(' '),
      ].join(' '),
    )

  const PERIOD_DAYS = { toute: null, '7j': 7, '30j': 30, '90j': 90 }

  /*
   * **The bucket is a set of *states*, and it used to be a hand-written word.**
   *
   * `HISTORY_ROWS` carried a literal `status: 'À valider'` per row and the chip
   * filtered on that string — so the fixture decided, by hand, which bucket a
   * meeting was in, and it got the flagship one wrong. `m-neovia-cadrage` is
   * `recording` on every scenario but four, and it was labelled « À valider »:
   * `history:search { statut: 'a-valider' }` returned the call the rep is
   * recording *right now*, so the rail said « 3 appels en attente de validation »
   * where the product says two, and `agenda-hors-fenetre` drew the live call as a
   * row of « En attente de validation » — the section that exists for calls that
   * were recorded and never confirmed.
   *
   * Restated from `core/domain/historySearch.ts`, which a stub cannot import, and
   * held to it by `modules/extract/__tests__/harnessFixture.test.ts`: it drives
   * every scenario through `passesFilter` and refuses a row the product would not
   * have returned.
   */
  const STATUS_STATES = {
    tous: null,
    'a-valider': ['ended', 'extracting', 'awaiting_confirmation'],
    validees: ['pushing', 'done'],
    abandonnees: ['aborted'],
  }

  /*
   * `register.ts`'s own `STATE_LABEL`, which is where a row's status comes from
   * on the shipped channel: `rows.push({ meeting, status: STATE_LABEL[meeting.state], … })`.
   * Derived and no longer stored, so a fixture cannot hold a word that disagrees
   * with the state beside it — which is what `review:confirm` did too, stamping
   * « Validée » on a meeting it had just moved to `pushing` (« Envoi… »).
   */
  const STATE_LABEL = {
    idle: 'En attente',
    armed: 'Prêt',
    recording: 'En cours',
    ended: 'Terminée',
    extracting: 'Analyse…',
    awaiting_confirmation: 'À valider',
    pushing: 'Envoi…',
    done: 'Validée',
    aborted: 'Abandonnée',
  }

  const statusOf = (meeting) => STATE_LABEL[meeting.state]

  /*
   * The anchor `core/contracts/meeting.ts` exports, restated here because a stub
   * cannot import from `electron/`. If the two ever disagree, the screenshots
   * are of a product that does not exist.
   */
  const anchorOf = (meeting) => meeting.scheduledStart || meeting.startedAt || meeting.createdAt

  /*
    **A year and a half of calls**, for the one sentence no stage could show.

    `history:search` returns fifty rows and says so, and the fixture holds nine —
    so « Les 50 appels les plus récents qui correspondent, sur N appels
    parcourus. » had never been drawn by anything, on the screen whose promise it
    qualifies. It is the case the defect lived in twice over: the *result* cap was
    reported one row early, and the *scan* cap was not reported at all.

    Built from the same nine rows so nothing about a row is invented — a date, an
    id and a client suffix per copy, which is what makes them distinct calls
    rather than one drawn eight hundred times. Only this scenario sees them; every
    other stage photographs the nine.
  */
  const CORPUS = (() => {
    const out = []
    for (let copy = 0; copy < 91; copy += 1) {
      for (const row of HISTORY_ROWS) {
        if (out.length >= 812) break
        const id = copy === 0 ? row.meeting.id : `${row.meeting.id}-${copy}`
        /*
         * **Every instant moves, not only the one the list sorts on.**
         *
         * This shifted `scheduledStart` alone and left `createdAt`, `startedAt`
         * and `endedAt` on today, so the eight hundred and twelve calls were all
         * created this afternoon and « il y a 30 semaines » was a date with no
         * meeting behind it. Harmless while the period chip read
         * `startedAt || createdAt` — the two lies cancelled — and a fixture whose
         * period filter and whose printed dates disagree the moment either is
         * fixed.
         */
        const back = copy * 7 * 24 * HOUR
        const slid = (instant) => (instant === null || instant === undefined ? instant : instant - back)
        out.push({
          ...row,
          meeting: {
            ...row.meeting,
            id,
            scheduledStart: (row.meeting.scheduledStart || row.meeting.createdAt) - back,
            createdAt: slid(row.meeting.createdAt),
            startedAt: slid(row.meeting.startedAt),
            endedAt: slid(row.meeting.endedAt),
            confirmedAt: slid(row.meeting.confirmedAt),
            updatedAt: slid(row.meeting.updatedAt),
          },
        })
      }
    }
    return out
  })()

  const corpus = () => (scenario === 'historique-annees' ? CORPUS : HISTORY_ROWS)

  /**
   * **A row a search returns is a meeting that opens** — one store, two questions.
   *
   * `history:search` and `meeting:get` both read `Projections` in the product, so
   * a row that exists for one and not for the other is a shape the store cannot
   * hold. This fixture could: `historique-annees` mints its 812 calls by copying
   * nine rows ninety-one times under `m-…-1` … `m-…-90`, none of which is in
   * `MEETINGS`, so every result past the first nine named a meeting `meeting:get`
   * refused — « réunion introuvable: m-neovia-cadrage-1 » — on the search pane
   * whose results reach `onOpen`. Found by `scripts/__tests__/stubMeetingIds.test.mjs`
   * while it was being written for `agenda:arm`; 11 rows × 2 halves of the Entra
   * axis on that scenario.
   *
   * The corpus is consulted after `MEETINGS`, never instead of it: a row that
   * exists in both is the one the stub mutates.
   */
  const storedMeeting = (id) =>
    meetingById(id) || corpus().find((row) => row.meeting.id === id)?.meeting || null

  const searchRows = (query, filter, limit) => {
    const needle = fold(query)
    /*
      Sorted, and it used to be declaration order.

      `Projections.listMeetings` orders by the meeting's own day, newest first,
      and the fixture was a hand-written array that happened to run 10/09, 09/09,
      07/09, **01/09, 03/09**, 27/08. On a screen whose only organising principle
      is recency that is the defect a rep notices in the first minute — and it
      was in the *harness*, so the screenshots showed it while the code was
      right. A fixture that lies makes the design pass lie with it.
    */
    let rows = corpus().slice().sort((a, b) => anchorOf(b.meeting) - anchorOf(a.meeting))
    if (needle) rows = rows.filter((row) => blobOf(row).indexOf(needle) !== -1)
    /*
      **The `Intitulé` match, composed rather than pre-baked.**

      `blobOf` has always included the title and the client name, so a search for
      « Néovia » *filtered* correctly here — while the product returned nothing
      at all, because its four searchable surfaces were three and none of them
      was the call's own name. The fixture would have gone on showing a row with
      a transcript excerpt under a query that, shipped, matched nothing. That is
      the fourth way this stub has flattered the app, so it composes the match
      the same way `searchableRecord` does and leads with it for the same reason.
    */
    if (needle) {
      rows = rows.map((row) => {
        const name = [row.meeting.title, row.meeting.clientName].filter(Boolean).join(' — ')
        if (fold(name).indexOf(needle) === -1) return row
        if (row.matches.some((m) => m.where === 'meeting')) return row
        return { ...row, matches: [{ where: 'meeting', excerpt: name }, ...row.matches] }
      })
      /*
        And the `Moments marqués` match, composed the same way and second, which
        is where `WHERE_ORDER` puts it: a mark is one sentence the rep chose to
        type while the client was talking.
      */
      rows = rows.map((row) => {
        const notes = markNotesOf(row.meeting.id)
        if (!notes || fold(notes).indexOf(needle) === -1) return row
        if (row.matches.some((m) => m.where === 'marks')) return row
        const lead = row.matches[0] && row.matches[0].where === 'meeting' ? 1 : 0
        const matches = row.matches.slice()
        matches.splice(lead, 0, { where: 'marks', excerpt: notes })
        return { ...row, matches }
      })
    }
    if (filter.client) rows = rows.filter((row) => row.meeting.clientName === filter.client)
    /*
     * `anchorOf`, and it used to be `startedAt || createdAt` — with `anchorOf`
     * declared four lines above it, under a comment saying « if the two ever
     * disagree, the screenshots are of a product that does not exist ». They
     * disagreed. `historique-annees` builds its 812 calls by moving
     * `scheduledStart` back a week per copy and leaving the other two instants
     * on today, so « 7 jours » answered 536 rows the product drops.
     */
    const days = PERIOD_DAYS[filter.periode]
    if (days) rows = rows.filter((row) => anchorOf(row.meeting) >= now - days * 24 * HOUR)
    const states = STATUS_STATES[filter.statut]
    if (states) rows = rows.filter((row) => states.indexOf(row.meeting.state) !== -1)
    if (filter.intention && filter.intention !== 'toutes') {
      rows = rows.filter((row) => row.intents.some((i) => i.kind === filter.intention))
    }
    // One row past the limit, the way the handler collects it: `>= limit` cannot
    // tell « exactly fifty » from « fifty and more », and told a rep to narrow a
    // search that was already complete.
    return rows.slice(0, limit + 1).map((row) => ({ ...row, status: statusOf(row.meeting) }))
  }

  // ── the bridge ────────────────────────────────────────────────────────────
  const withFilterDefaults = (filter) => ({
    client: (filter && filter.client) || null,
    periode: (filter && filter.periode) || 'toute',
    statut: (filter && filter.statut) || 'tous',
    intention: (filter && filter.intention) || 'toutes',
  })

  /*
   * `EMPTY_AGENDA` from `app/ipc/register.ts` when there is no registration —
   * the handler answers rather than throwing, and this has to answer the same
   * way or the screen would be photographed in an error state that production
   * never reaches.
   */
  /**
   * **One conversation, one offer — and the offer is the same fact on both halves
   * of the Entra axis.**
   *
   * This was decided twice, once inside each branch of `agendaSnapshot`, and the
   * two disagreed. The `entra: false` branch offered `m-adhoc-teams` for
   * `agenda-appel-imprevu` and `null` otherwise; the `entra: true` branch offered
   * `m-neovia-cadrage` unconditionally — so on that scenario at `entra: true` the
   * day's one filled *Enregistrer* landed on the **calendar** meeting while
   * `m-adhoc-teams` sat beside it in state `armed` wearing an outline *Ouvrir*:
   * two rows claiming to be the call starting now, and the primary on the wrong
   * one, on the scenario that exists to photograph detection working.
   *
   * Detection does not require Microsoft (DEC-28, DEC-26) — `Agenda` is built over
   * `NULL_CALENDAR` in both branches of `main.ts` and `core/domain/adHoc.ts`
   * decides from a microphone reading and a clock — so the ad-hoc offer is the
   * offer on both halves. `eventId` is null on it because there is no calendar row
   * to join to, which is the whole point, and it stays null even where a calendar
   * exists: a call nobody scheduled has no invite either way.
   *
   * `review` is the one scenario with nothing armed: the gate is open on a call
   * that has finished. And the **calendar** offer keeps the Entra axis it always
   * had — nothing can arm from an invite on a build that cannot read one — which is
   * the asymmetry: the ad-hoc offer survives `entra: false`, the invite-shaped one
   * does not.
   */
  const ARMED_OFFER = NEOVIA_UNARMED
    ? { meetingId: 'm-adhoc-teams', eventId: null, subject: 'Appel non planifié — Teams' }
    : !entra || scenario === 'review'
      ? null
      : {
          meetingId: 'm-neovia-cadrage',
          eventId: 'evt-neovia-cadrage',
          subject: 'Néovia Santé — cadrage renfort data',
        }

  /**
   * The offer as it stands **now** — `ARMED_OFFER` is where the day starts, not
   * where it stays.
   *
   * `Agenda.#arm` writes `#armed` and `#withdrawStanding` takes the previous one
   * back, so a rep who presses *Préparer* changes what the next `agenda:snapshot`
   * says is armed. Reading a `const` there would have drawn **Prêt** on the row
   * the rep just left and nothing on the one they just armed, for the rest of the
   * session.
   */
  let standingOffer = ARMED_OFFER

  const agendaSnapshot = () =>
    entra
      ? {
          events: EVENTS,
          syncedAt: now - 4 * MIN,
          /*
            The days Graph was actually asked about: yesterday through a week
            ahead, which is what `modules/calendar/delta.ts` syncs. The grid
            draws six weeks, so a fixture with a wide-open window would go on
            photographing « Aucune réunion ce jour-là. » on thirty-four days
            nothing had been looked up — the claim this field exists to stop.
          */
          window: { from: now - 24 * HOUR, to: now + 7 * 24 * HOUR },
          /*
           * **And `NEOVIA_UNARMED` applies here too, which it did not.**
           *
           * The `entra: false` branch below stages `m-adhoc-teams` as the offer
           * for `agenda-appel-imprevu` and the meeting row is `idle` there, which
           * is coherent. This branch went on offering `m-neovia-cadrage`
           * unconditionally — so at `entra: true` the same scenario put the day's
           * one filled *Enregistrer* on the **calendar** meeting while
           * `m-adhoc-teams` sat beside it in state `armed` wearing an outline
           * *Ouvrir*: two rows claiming to be the call starting now, and the
           * primary on the wrong one, on the scenario that exists to photograph
           * detection. No stage drives that combination — `agenda-appel-imprevu`
           * is `entra: false` — but `harnessFixture.test.ts` walks both halves of
           * the axis deliberately, because a fixture that is only coherent on the
           * half somebody happened to stage is a fixture waiting for the next
           * stage.
           */
          armed: standingOffer,
          reason: '',
        }
      : {
          events: [],
          syncedAt: 0,
          // No calendar connected means no day was asked about.
          window: { from: 0, to: 0 },
          /*
           * **And `armed` is no longer always null here, which it used to be by
           * construction.**
           *
           * `Agenda` was built only when Entra was configured, so a no-Entra
           * build could not arm anything and this branch was honest. It is built
           * over a `NULL_CALENDAR` now, and `core/domain/adHoc.ts` decides from a
           * microphone reading and a clock — so the demo build DEC-28 calls the
           * first deliverable detects an unscheduled call and offers it, with no
           * Microsoft account at all. A fixture that kept `null` here would go on
           * photographing the screen the product no longer has.
           */
          armed: standingOffer,
          reason:
            scenario === 'agenda-appel-imprevu'
              ? 'Teams émet du son hors calendrier'
              : 'Aucun calendrier connecté',
        }

  /** The health table this scenario reads — see `healthSnapshot` below. */
  /*
    Every first-run scenario is a first run — `onboarding`, and the three that
    photograph the other states of its capture row. Spelling the family once
    keeps a new permission stage from silently landing on the calendar's health,
    which is the shape this stub has been caught in before.
  */
  const firstRun = scenario.startsWith('onboarding')

  const healthBase = () =>
    firstRun
      ? HEALTH.premierLancement
      : scenario === 'reglages' || scenario === 'historique'
        ? HEALTH.mixed
        : (HEALTH[scenario] ?? HEALTH.agenda)

  const healthSnapshot = () => {
    /*
      A fresh install is not a healthy one, and the onboarding fixture used to
      pretend otherwise — three green « prêt » rows, which is the one state the
      screen does not exist for. What a rep actually meets on first launch is a
      microphone that has not been authorised, a model still downloading and no
      analysis provider chosen yet, and those are the three rows worth
      photographing.
    */
    const base = healthBase()
    return entra ? base : { ...base, ...NO_ENTRA_HEALTH }
  }

  /**
   * The five capture rows, word for word as `core/domain/capturePermission.ts`
   * composes them. A fixture that invents a sentence is a picture of a product
   * that does not exist — this file's own header records that happening to this
   * very row.
   */
  const CAPTURE_PERMISSION = {
    onboarding: {
      state: 'to-grant',
      channel: 'screen',
      reason:
        'l’audio système n’est pas autorisé — le client ne sera pas enregistré, vous seul le serez. Autorisez-le pour que Sillage puisse l’enregistrer.',
      canOpenSettings: true,
    },
    'onboarding-refuse': {
      state: 'denied',
      channel: 'screen',
      reason:
        'l’audio système n’est pas autorisé — le client ne sera pas enregistré, vous seul le serez. Vous l’avez refusé : réautorisez Sillage dans les réglages de confidentialité du système.',
      canOpenSettings: true,
    },
    /*
      The primary platform (HR-2): no screen-recording permission to grant at
      all, and a machine-wide microphone switch that is off.
    */
    'onboarding-micro': {
      state: 'denied',
      channel: 'microphone',
      reason:
        'le micro n’est pas autorisé — vous ne serez pas enregistré, seul le client le sera. Vous l’avez refusé : réautorisez Sillage dans les réglages de confidentialité du système.',
      canOpenSettings: true,
    },
    /* A managed device: the sentence is the whole remedy, and there is no button. */
    'onboarding-gere': {
      state: 'blocked',
      channel: 'both',
      reason:
        'Ni le micro ni l’audio système ne sont autorisés — une réunion ne serait pas enregistrée. Cet ordinateur est géré et l’autorisation est bloquée par votre service informatique.',
      canOpenSettings: false,
    },
    'onboarding-pane-morte': {
      state: 'denied',
      channel: 'screen',
      reason:
        'l’audio système n’est pas autorisé — le client ne sera pas enregistré, vous seul le serez. Vous l’avez refusé : réautorisez Sillage dans les réglages de confidentialité du système.',
      canOpenSettings: true,
    },
    /*
      **Réglages is a machine that is already set up, and this fell through to
      the onboarding row.**

      `CAPTURE_PERMISSION[scenario] ?? CAPTURE_PERMISSION.onboarding` gave every
      *Réglages* stage a screen permission that had never been granted — which is
      a first-run fact, not the fact about a rep who has been using the product
      for a fortnight and has come back because their headset changed. It is also
      the one arrangement in which the dry run's dead *Autoriser* could not be
      seen: with a grant genuinely outstanding the button was the right control
      for the wrong reason, so `reglages-essai` photographed a working remedy
      over a card that had none on any real machine.

      `ready` with no pane is the ordinary case and the primary platform's (HR-2)
      only case: Windows has no screen-recording permission to hold back at all.
    */
    reglages: {
      state: 'ready',
      channel: null,
      reason: null,
      canOpenSettings: false,
    },
  }

  const responders = {
    'boot:state': () =>
      scenario === 'splash-telechargement'
        ? BOOT_DOWNLOADING
        : scenario === 'splash'
          ? BOOT_BOOTING
          : BOOT_READY,
    'auth:state': () =>
      entra
        ? { status: 'signedIn', account: ACCOUNT }
        : { status: 'signedOut', reason: NO_REGISTRATION },
    'auth:signIn': () => {
      // `app/ipc/register.ts` rejects with exactly this when `identity` is null.
      if (!entra) throw new Error(NO_REGISTRATION)
      return { status: 'signedIn', account: ACCOUNT }
    },
    'auth:signOut': () => (entra ? { status: 'signedOut' } : { status: 'signedOut', reason: NO_REGISTRATION }),

    'agenda:snapshot': agendaSnapshot,
    'agenda:refresh': agendaSnapshot,
    /*
     * ***Préparer* on an upcoming invite — the central gesture of this surface,
     * and until this round it landed on an error page.**
     *
     * The line here was `({ meetingId: \`evt-${eventId}\` })`, under a docblock
     * claiming it answered « the id the product would compose ». It did not:
     * `Agenda.meetingIdFor` is a sha1 digest, every meeting in this fixture is
     * `m-*`, and `src/screens/Agenda.tsx` takes that id straight to `onOpen` and
     * therefore to `meeting:get`. Driven on the shipped stub at 1280×800 and at
     * 960×600 — press *Préparer* on the 16:00 Banque Delcourt row on the week —
     * the whole of what the rep then saw was
     *
     *     réunion introuvable: evt-evt-delcourt-tjm
     *     Retour
     *
     * `agenda-demarrer-tot` covers that control by *counting* it — « at least two
     * *Préparer* on the week » — which is orthogonal to whether pressing one
     * arrives anywhere. No count is put on how long that stood: this tree has one
     * root commit, so « how many rounds » is not a thing anything here can measure.
     *
     * What it answers now is `Agenda.armNow` read against `#arm`, in its order:
     *
     *  1. an event that is no longer on screen is refused, in its own words;
     *  2. a standing offer for this same meeting is **kept as it stands** — `#arm`
     *     returns early, and `armNow` then finds `#armed.eventId === eventId` and
     *     answers with it;
     *  3. a call under way takes the conversation: `#arm` declines to arm, and
     *     `armNow` names the live call (`CLAUDE.md`: « a refusal names the live
     *     call ») — which is the shipped sentence, fixed one round ago and, like
     *     the success, never once photographed;
     *  4. a meeting past the call cannot be armed — `dispatch` refuses and
     *     `armNow` throws the flat sentence;
     *  5. otherwise the invite's meeting is armed, the previous standing offer is
     *     withdrawn (`#withdrawStanding`, `disarm` → `idle`), and the id comes
     *     back.
     *
     * A meeting is **minted** when the invite has none, which is the ordinary case
     * on this screen: four of the five upcoming rows have no meeting at all. It
     * goes into `MEETINGS`, so `meeting:list` shows it, `meeting:get` opens it and
     * the session screen the rep lands on is a real one — the same reason
     * `meeting:create` pushes its row rather than forgetting it.
     */
    'agenda:arm': ({ eventId }) => {
      const event = EVENTS.find((candidate) => candidate.id === eventId)
      if (!event) throw new Error('Cet événement n’est plus dans le calendrier affiché.')

      const existing = meetingForEvent(eventId)
      const held = existing !== null && standingOffer !== null && standingOffer.meetingId === existing.id
      if (!held) {
        const busy = MEETINGS.find((m) => m.state === 'recording' && m.id !== existing?.id)
        if (busy) {
          throw new Error(
            `« ${busy.title} » est déjà en cours d’enregistrement. Terminez-la, puis reprenez ` +
              'celle-ci — elle reste proposée.',
          )
        }
        // `arm` is legal from `idle`; the two live states keep the offer standing.
        // Everything past the call is `MeetingSession`'s refusal.
        if (existing && !['idle', 'armed', 'recording'].includes(existing.state)) {
          throw new Error('Cette réunion ne peut plus être démarrée.')
        }
      }

      let target = existing
      if (target === null) {
        target = meeting({
          id: meetingIdForEvent(eventId),
          state: 'armed',
          title: event.context.subject || 'Réunion',
          eventId,
          /*
           * Null, and that is the product's answer rather than a shortcut:
           * `Agenda.#arm` calls `orchestrator.create` with an id, a title and the
           * event's context and passes no `clientName`, so `Projections` writes
           * `event.clientName ?? null`. The account is resolved later, from VSA
           * and Graph (DEC-7) — never from the objet line the fixture could parse.
           */
          clientName: null,
          scheduledStart: event.context.scheduledStart,
          createdAt: now,
          startedAt: null,
          endedAt: null,
          confirmedAt: null,
          updatedAt: now,
        })
        MEETINGS.push(target)
      }

      if (!held) {
        if (target.state === 'idle') {
          target.state = 'armed'
          target.updatedAt = now
        }
        /*
         * `#withdrawStanding`: the offer being replaced is disarmed, and only when
         * it is still merely `armed` — a recording one is the row to show and is
         * left exactly where it is.
         */
        const previous = standingOffer && standingOffer.meetingId !== target.id
          ? meetingById(standingOffer.meetingId)
          : null
        if (previous && previous.state === 'armed') {
          previous.state = 'idle'
          previous.updatedAt = now
        }
        standingOffer = { meetingId: target.id, eventId, subject: event.context.subject }
      }
      return { meetingId: target.id }
    },

    'meeting:list': () => MEETINGS,
    /*
     * Kept, not discarded. `meeting:create` is the whole of DEC-31 without a
     * calendar, and a stub that answers with a meeting it then forgets makes
     * that path look like it works while `meeting:get` throws on the very next
     * call — which is the flow the first demo runs on. It goes into `MEETINGS`
     * so the row appears in the grid, opens, and records.
     */
    'meeting:create': (payload) => {
      const created = meeting({
        id: 'm-cree-' + Math.random().toString(36).slice(2, 8),
        state: 'idle',
        title: payload.title,
        clientName: payload.clientName || null,
        scheduledStart: payload.scheduledStart || null,
        createdAt: now,
        updatedAt: now,
      })
      MEETINGS.push(created)
      return created
    },
    'meeting:get': (payload) => {
      // `storedMeeting`, not `meetingById`: the search corpus is the same store.
      const m = storedMeeting(payload.meetingId)
      if (!m) throw new Error('réunion introuvable: ' + payload.meetingId)
      const live = m.id === 'm-neovia-cadrage'
      return {
        meeting: m,
        segments: live ? SEGMENTS : [],
        signals: live ? SIGNALS : [],
        /*
         * The same rows the history list draws, looked up the same way the
         * meeting was — `register.ts` answers this from
         * `historyIntents(store, meetingId)`, one projection for both channels,
         * so a stub that kept a second list here could stage a `done` meeting
         * whose session screen and whose *Historique* row disagreed about
         * whether the client's CRM received anything.
         *
         * This was `outbox: []`, a field no longer on the contract and never on
         * it under that name.
         */
        intents: corpus().find((row) => row.meeting.id === m.id)?.intents ?? [],
        document: live ? NOTES_DOC : null,
        /*
         * The compte-rendu beside the rep's own notes, once the analysis has
         * landed. Staged under its own scenario because on every other screen it
         * is null, and a pane that appeared during a recording would be DEC-23
         * broken in a screenshot nobody could tell apart from the correct one.
         */
        compteRendu: live && scenario === 'compte-rendu' ? REVIEW_EDITS.compteRendu : null,
        /*
         * Which compte-rendu the meeting produces (DEC-43). `libre` is its own
         * scenario because the two draw *different rails* — the free one has no
         * slate — and a header picker photographed only on its default is a
         * control nobody has ever seen in its other position.
         */
        recipe: scenario === 'libre' ? 'libre' : 'besoin-commercial',
      }
    },

    /*
     * The picker — and `regenerating` is answered the way the shipped handler
     * answers it, which for eight rounds it was not.
     *
     * It was a flat `false`, so **no stage could ever produce the one input this
     * channel exists for**: `register.ts` compares the choice against the stored
     * extraction's recipe and calls a real change `changed`, which is exactly
     * besoin-commercial → libre on the `review` scenario. A fixture that answers
     * `false` there photographs a press with no consequence, and the consequence
     * is the whole of the behaviour — the gate withdraws *Valider*, DEC-4's one
     * irreversible control.
     *
     * **The run then does not happen, and that is faithful rather than lazy.**
     * `void runEnhancement?.(…)` is fired and not awaited; on a machine with no
     * model — the demo build DEC-28 ships first, and any machine whose key has
     * expired — `Enhancement.run` finds no recipe, records `enhancement.deferred`
     * and returns without moving the state, so the gate stays open and no new
     * document ever arrives. Measured on the shipped main process wired the way
     * `main.ts` wires it: the response is
     * `{"recipe":"libre","regenerating":true}` and the only thing that follows is
     * one `enhancement:status` broadcast carrying `{"status":"idle"}`. That is
     * what `enhancement:status` answers here on this scenario, so the stub stages
     * that machine and not a luckier one.
     */
    'meeting:recipe': (payload) => ({
      recipe: payload.recipe,
      regenerating: payload.recipe !== (scenario === 'libre' ? 'libre' : 'besoin-commercial'),
    }),
    /*
     * The objet and the client, typed in the session header. The stub mutates
     * the row in `MEETINGS` rather than answering with a fresh object, so a
     * rename is visible on the calendar the shot returns to — which is the whole
     * of what the channel is for.
     */
    'meeting:rename': (payload) => {
      const m = meetingById(payload.meetingId)
      if (!m) throw new Error('réunion introuvable: ' + payload.meetingId)
      m.title = payload.title
      if (payload.clientName !== null && payload.clientName !== undefined) {
        m.clientName = payload.clientName || null
      }
      m.updatedAt = now
      return m
    },
    'session:command': (payload) => ({
      ok: true,
      state: payload.command === 'start' ? 'recording' : payload.command === 'end' ? 'extracting' : 'idle',
    }),
    'document:save': (payload) => ({ revision: (payload.revision || 0) + 1 }),

    /*
     * The end-of-meeting notice. `--scenario enhancement-attente` is the state
     * the harness exists to make reviewable: a meeting that has ended with no
     * model configured, which is a screen nobody can reach on a machine that
     * *has* one and is exactly the screen that used to be blank.
     */
    'enhancement:status': () =>
      scenario === 'enhancement-attente'
        ? { status: 'waitingForModel' }
        : scenario === 'enhancement-echec'
          ? { status: 'failed', reason: 'le fournisseur a répondu 401' }
          : { status: 'idle' },
    'enhancement:retry': () => ({ status: 'failed', reason: 'le fournisseur a répondu 401' }),

    'health:snapshot': healthSnapshot,
    'health:retry': () => ({ state: 'ok' }),

    /*
      The onboarding dry run (`core/contracts/essai.ts`).

      It replays the same level history the session meter is fed, on the trial's
      reserved id, and then answers — so a screenshot of this step catches a
      meter with a history in it rather than twenty flat bars, and the stage can
      photograph the result without waiting twenty real seconds.

      The verdict is the one that matters: the rep heard, the machine not. That
      is the failure this whole step exists to catch, and it is the one nobody
      would think to stage.
    */
    'capture:essai': () => {
      LEVEL_HISTORY.forEach((rep, index) => {
        harness.emit('audio:level', {
          meetingId: 'essai-audio',
          rep,
          far: index > LEVEL_HISTORY.length - 4 ? 0.002 : FAR_LEVEL_HISTORY[index],
          floor: 0.008,
        })
      })
      /*
        And the verdict is **kept**, the way `main.ts` keeps it: the trial
        outranks the boot probe, so the connector row stops saying « Audio ·
        connecté » the moment twenty seconds of listening says otherwise. A
        fixture that answered and then forgot would photograph the defect this
        was written to fix and call it a pass.
      */
      const result = {
        rep: { heard: true, peak: 0.42 },
        far: { heard: false, peak: 0.003 },
        floor: 0.008,
        seconds: 20,
      }
      // `healthSnapshot` picks the table from the scenario; the trial's verdict
      // has to land on whichever one it picked, not on a key named after it.
      const captureHealth = {
        state: 'degraded',
        reason:
          'Vous seriez capté, le client non — c’est la moitié qui compte le plus. Relancez l’essai de 20 secondes après correction.',
        since: Date.now(),
        retryable: false,
      }
      healthBase().capture = captureHealth
      // One connector per broadcast, which is the shape every listener reads.
      harness.emit('health:changed', { connector: 'capture', health: captureHealth })
      return result
    },

    'diagnostics:recent': () => DIAGNOSTICS,
    'diagnostics:export': (payload) => ({
      path: '/Users/julien/Desktop/sillage-diagnostics-' + payload.mode + '.ndjson',
      events: DIAGNOSTICS.length,
    }),

    'review:get': (payload) => {
      if (payload.meetingId !== 'm-neovia-cadrage' && payload.meetingId !== 'm-lefort-cv') {
        return { open: false, state: 'recording', reason: 'Réunion en cours.' }
      }
      if (scenario !== 'review') {
        return { open: false, state: 'recording', reason: 'Réunion en cours.' }
      }
      return { open: true, panel: REVIEW_PANEL }
    },
    /*
     * *Ce qui sera créé*, recomputed from the form as it stands — the same two
     * compositions and the same `available` predicate as
     * `core/domain/reviewGate.ts` `draftIntents`. Without this the harness
     * renders the frozen pre-fill rows, which is exactly the defect the channel
     * exists to fix, so a screenshot would show it fixed while it was not.
     */
    'review:preview': (payload) => {
      const edits = payload.edits
      const possible = edits.accountId !== null
      const mailTo = REVIEW_PANEL.mailTo
      const label = (kind) => REVIEW_PANEL.intents.find((i) => i.kind === kind).label
      return {
        intents: [
          {
            id: payload.meetingId + ':crm.task',
            kind: 'crm.task',
            label: label('crm.task'),
            summary: edits.taskName + ' — ' + edits.accountName,
            available: true,
            reason: null,
          },
          {
            id: payload.meetingId + ':crm.opportunity',
            kind: 'crm.opportunity',
            label: label('crm.opportunity'),
            summary: possible ? edits.taskName + ' — ' + edits.besoin : 'Indisponible',
            available: possible,
            reason: possible
              ? null
              : 'Compte non résolu — une opportunité ne peut pas être créée sans client identifié.',
          },
          /*
            The same two reasons `reviewGate.ts` gives, in the same order.

            The `sans-entra` scenario is the build the first demo ships in
            (DEC-28) — no Entra registration, so no calendar and no account to
            draft from. « Aucun destinataire au calendrier. » was the only
            sentence this row had, and there it is a true statement about the
            wrong thing: a rep reads it and goes looking for attendees to add,
            which is a search that cannot succeed. The blocker that is actually
            in the way is named first.
          */
          {
            id: payload.meetingId + ':mail.draft',
            kind: 'mail.draft',
            label: label('mail.draft'),
            summary:
              mailTo.length > 0 ? edits.mailSubject + ' → ' + mailTo.join(', ') : 'Indisponible',
            available: mailTo.length > 0,
            reason:
              mailTo.length > 0
                ? null
                : entra
                  ? 'Aucun destinataire au calendrier.'
                  : 'Aucun compte Microsoft connecté.',
          },
        ],
      }
    },
    /*
      *Demander* — one question, answered over this call's transcript, with the
      quotes checked against it (DEC-21).

      The stub answers the way the product does rather than the way a demo
      would: it finds the segments that actually carry the question's terms and
      quotes them **verbatim**, so the citations verify for the same reason real
      ones do. One deliberate exception below.
    */
    /*
      First run (`core/contracts/onboarding.ts`).

      Only the `onboarding` scenario is a fresh install. Every other screen is a
      rep who has been using the app, and an onboarding in front of the calendar
      would make eighteen of the twenty-one screenshots a picture of this one.
    */
    'onboarding:state': () => ({ seen: !firstRun }),
    'onboarding:seen': () => ({ seen: true }),

    /*
      Consent, as `core/contracts/permissions.ts` declares it — four words and a
      capability, and not one of them names a platform. The five rows a rep can
      meet are four fixtures plus the granted one, and each is the shape
      `capturePermissionView` really composes for those statuses.

      `onboarding` itself is « à autoriser », which is what a fresh install on a
      Mac actually is: the screen-recording prompt has not been answered, so one
      channel is at stake — and the remedy is the **prompt**
      (`capture:permission:request`), not the pane. The sentence under the line
      above said « the pane is the surer route to it », which is what the row
      drew and what nothing could reach: a privacy pane does not list an
      application that has never attempted capture.
    */
    'capture:permission': () => CAPTURE_PERMISSION[scenario] ?? CAPTURE_PERMISSION.onboarding,
    /*
      The ask, answered with the consent as it stands afterwards — and
      deliberately unchanged.

      That is the macOS screen-recording truth and not a shortcut: `getSources`
      raises the prompt, the rep allows it in the panel that opens, and
      `getMediaAccessStatus('screen')` goes on answering `not-determined` until
      the app is relaunched. A fixture that flipped to `ready` here would
      photograph the one outcome a first launch does not give you, and would hide
      the fall-through to the pane — which is the whole reason the row tracks
      whether it has already asked.
    */
    'capture:permission:request': () => CAPTURE_PERMISSION[scenario] ?? CAPTURE_PERMISSION.onboarding,
    // The pane opens. A stage that pressed this and got `false` would be
    // photographing the failure message, which `onboarding-pane-morte` is for.
    'capture:permission:open': () => ({ opened: scenario !== 'onboarding-pane-morte' }),

    'meeting:ask': (payload) => {
      const question = fold(payload.question || '')
      /*
        **The segments of the meeting that was asked about, not of the fixture's
        favourite one.**

        This read `SEGMENTS` — Néovia's — whatever meeting id it was handed. On
        the session screen and at the gate that is the meeting anyway, so the lie
        was invisible; on *Historique*, where a rep asks about a call from three
        weeks ago, the answer quoted a different conversation and the citation
        pointed at a turn that is not in that record. Which is the exact failure
        `Demander` exists to prevent, staged by the harness that is supposed to
        prove it does not happen.
      */
      const stored = RECORDS[payload.meetingId]
      const segments = (stored && stored.segments.length > 0 ? stored.segments : SEGMENTS).filter(
        (segment) => segment.isFinal !== false,
      )
      /*
        Three letters, not four — with a stop list.

        A four-letter floor is the obvious rule and it throws away « TJM », which
        is the single most discriminating term a rep will ever type into this box
        on this product. The floor was doing the stop list's job badly; the stop
        list does it properly.
      */
      const STOP = [
        'que', 'qui', 'quoi', 'quel', 'quelle', 'quels', 'quelles', 'est', 'sur', 'dit',
        'les', 'des', 'une', 'pour', 'dans', 'avec', 'cette', 'quest', 'ete', 'ils',
        'elle', 'nous', 'vous', 'leur', 'sont', 'appel', 'client', 'reunion',
      ]
      const terms = (question.match(/\p{L}{3,}|\d{2,}/gu) || []).filter(
        (term) => !STOP.includes(term),
      )

      const hits = segments
        .map((segment) => ({
          segment,
          score: terms.filter((term) => fold(segment.text).includes(term)).length,
        }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)

      if (hits.length === 0) {
        return {
          question: payload.question,
          answered: false,
          answer: '',
          citations: [],
        }
      }

      const who = (segment) => (segment.channel === 'rep' ? 'Le commercial' : 'Le client')
      return {
        question: payload.question,
        answered: true,
        answer:
          who(hits[0].segment) +
          ' revient dessus à ' +
          Math.floor(hits[0].segment.startMs / 60000) +
          ' min : ' +
          hits[0].segment.text.trim() +
          (hits.length > 1
            ? ' ' + who(hits[1].segment) + ' y répond plus loin dans l’échange.'
            : ''),
        citations: [
          ...hits.map((hit) => ({
            span: {
              quote: hit.segment.text.trim(),
              channel: hit.segment.channel,
              startMs: hit.segment.startMs,
              endMs: hit.segment.endMs,
            },
            verified: true,
          })),
          /*
            One unverified citation, on purpose, and it is the state this whole
            feature exists to make visible (DEC-21). A screenshot pass over a
            panel where every quote verifies never sees the `⚠` treatment, and
            the `⚠` treatment is the difference between this and the ask box on
            a general-purpose notetaker.
          */
          {
            span: {
              quote: 'on peut monter à 600 sur le lead si le cadrage tient',
              channel: 'far',
              startMs: null,
              endMs: null,
            },
            verified: false,
          },
        ],
      }
    },
    /*
      The transcript behind `source ▸`. The same rows Historique shows, because
      in the product they are the same rows — one projection, read by two
      screens.
    */
    /*
      The tick this used to carry alone now comes from `LATENCY` at the bottom of
      this file — see the table there, and the reason it stopped being one
      channel's private arrangement.
    */
    /*
      Tiled across the recording, for the reason `fillCall` states: nineteen turns in a
      forty-seven-minute call is 34 characters a minute against a real call's 1 386, and
      the gate's reader, `ReadingColumn`, the `--fade` ramp and the citation scroll are
      exactly the surfaces that a short record flatters. The call's own nineteen turns
      stay first with their ids, so every located span and both marks still resolve.
    */
    /*
      **The meeting it is asked about, which it ignored.**

      The comment above says « the same rows Historique shows, because in the product they
      are the same rows — one projection, read by two screens », and this answered Néovia's
      turns for *every* meeting: measured, `m-lefort-cv` got 313 turns here and 413 from
      `history:record`, and even for Néovia the two handed the same turns **different ids**
      (`seg-neovia-suite-*` against `seg-m-neovia-cadrage-*`), so a mark pinned to a tiled
      turn resolved at the gate and not in *Historique*. One record, read through the one
      function that builds it, which is what the sentence claimed all along.
    */
    'review:transcript': (payload) => {
      const record = recordFor(payload.meetingId)
      return { segments: record.segments, marks: record.marks }
    },

    /*
      **A confirmation that changes nothing is a fixture showing the product
      failing.**

      This answered `{ok: true}` and mutated no fixture, so the screenshot taken
      after the one irreversible press showed the calendar with the meeting still
      « À valider », the backlog count unchanged, and the row indistinguishable
      from one that had never been validated. In the product that is not what
      happens: `register.ts` emits `confirmation.recorded`, the state machine
      moves to `pushing`, and `Agenda` reloads on `session:changed`. The picture
      published as the proof was a picture of the press not landing — a rep
      looking at that screen presses *Valider* again, on an endpoint with no
      idempotency key.

      So the stub does what the main process does: it moves the meeting, drops it
      out of the backlog, and broadcasts. It is the same rule as everywhere else
      here — a stub that answers with something it then forgets makes a working
      path look broken, and a broken one look fine.
    */
    'review:confirm': (payload) => {
      /*
        **A press that would create nothing does not spend the gate** — the rule
        `app/ipc/register.ts` applies before it dispatches, applied here for the
        same reason every other answer in this file is the handler's answer: a
        stub that always says yes stages a screen the product cannot produce.

        It is the *rule* and not a toggle. `refusePause` arrived as a flag nothing
        called and was wrong on arrival (round 17); this one is reached by the rep's
        own gesture — untick the three rows — so the stage cannot stage a refusal
        the main process would not have made.
      */
      const creating = REVIEW_PANEL.intents.filter(
        (intent) => intent.available && (payload.intentIds || []).includes(intent.id),
      )
      if (creating.length === 0) {
        return {
          ok: false,
          state: 'awaiting_confirmation',
          reason:
            'Rien ne serait créé — aucune action n’est cochée, ou aucune n’est disponible. La raison est indiquée sur chaque ligne.',
        }
      }
      const meeting = meetingById(payload.meetingId)
      if (meeting) {
        meeting.state = 'pushing'
        meeting.confirmedAt = now
        meeting.updatedAt = now
      }
      /*
       * The state above is the whole of it: `status` is derived from it now
       * (`statusOf`), and stamping « Validée » here put that word on a meeting
       * this handler had just moved to `pushing`, which `register.ts` calls
       * « Envoi… ». DEC-4's own distinction — confirmed is not landed.
       */
      harness.emit('session:changed', { meetingId: payload.meetingId, state: 'pushing' })
      return { ok: true, state: 'pushing', intentIds: payload.intentIds || [] }
    },

    'history:search': (payload) => {
      const query = payload.query || ''
      const filter = withFilterDefaults(payload.filter)
      const limit = payload.limit || 50
      // One past the limit, then dropped: exactly the handler's arithmetic, so
      // the sentence a stage photographs is the sentence a rep gets.
      const found = searchRows(query, filter, limit)
      const capped = found.length > limit
      return {
        query,
        filter,
        // The whole corpus, which is what the screen prints beside « les
        // cinquante plus récents » — and what the product's scan now reads.
        scanned: corpus().length,
        clients: CLIENTS,
        rows: capped ? found.slice(0, limit) : found,
        capped,
      }
    },
    'history:record': (payload) => recordFor(payload.meetingId),

    /*
      L'updater, et il est **prêt**.

      C'est l'état que la maquette photographie : la rangée « Mise à jour prête »
      du rail n'existe que sous `phase: 'ready'` (`src/app/update.ts`), et une
      mise en scène qui répondait `idle` ne l'aurait jamais dessinée. Le panneau
      *Mise à jour* de Réglages lit exactement le même canal.
    */
    'update:status': () => ({
      phase: 'ready',
      currentVersion: '0.9.2',
      availableVersion: '0.9.3',
      percent: null,
      reason: null,
      checkedAt: now - 9 * MIN,
      installable: true,
      blockedReason: null,
    }),

    'settings:snapshot': () => settingsSnapshot(),
    /*
      « Cette machine uniquement » (DEC-37), and the fixture **applies** it.

      A stub that flipped the flag and answered the same tables would photograph
      a switch whose copy says « les moteurs hors machine disparaissent des
      listes ci-dessous » beside two cloud rows that had not gone anywhere —
      which is the third time this file has been caught flattering the product.
      `main.ts` removes remote providers from the candidate set, so this does
      the same to the rows and to the selection.
    */
    'settings:setOfflineOnly': (payload) => {
      SETTINGS.offlineOnly = payload.value
      return settingsSnapshot()
    },
    /*
     * DEC-34. The stub stores nothing durable — it answers with the snapshot
     * the screen would get, so a harness screenshot shows the row *after* a
     * save rather than an unanswered channel. The hint is the last four
     * characters, which is all the real handler ever returns either.
     */
    'settings:setCredential': ({ providerId, value }) =>
      withCredential(providerId, {
        stored: true,
        hint: value.trim().length >= 8 ? value.trim().slice(-4) : null,
      }),
    'settings:clearCredential': ({ providerId }) =>
      withCredential(providerId, { stored: false, hint: null }),
    'settings:selectProvider': ({ capability, providerId }) => {
      const section = SETTINGS[capability]
      section.rows = section.rows.map((row) => ({ ...row, selected: row.id === providerId }))
      section.selected = providerId
      return SETTINGS
    },
    'settings:selectModel': ({ modelId }) => {
      SETTINGS.models.rows = SETTINGS.models.rows.map((row) => ({
        ...row,
        selected: row.id === modelId,
      }))
      SETTINGS.models.selected = modelId
      return SETTINGS
    },
    'models:download': ({ modelId }) => {
      SETTINGS.models.rows = SETTINGS.models.rows.map((row) =>
        row.id === modelId ? { ...row, status: 'downloading', progress: 0, reason: null } : row,
      )
      return SETTINGS.models
    },
    'models:cancel': ({ modelId }) => {
      SETTINGS.models.rows = SETTINGS.models.rows.map((row) =>
        row.id === modelId ? { ...row, status: 'cancelled', progress: 0, reason: null } : row,
      )
      return SETTINGS.models
    },

    /*
      The in-meeting widget (`src/widget/Widget.tsx`).

      The meeting it reports is the one the session scenario records, at the
      same objet and the same start, so the pill floating over a call and the
      header of the window behind it cannot disagree about which call it is.
    */
    /*
      **And `{ meeting: null }` is an answer this channel really gives**, which the
      fixture could not produce.

      `app/ipc/register.ts` returns it whenever no meeting is `recording` — twice
      per call, at the start before the state machine has one and at the end once
      `stopRecording` has released it — and `Pill` then draws « Aucun
      enregistrement » with no meter, no clock and no mark button. Five widget
      stages shared one responder that always carried a meeting, so that face had
      been visited by none of the 106 stagings and measured by none of the eight
      checks, on the surface `Widget.tsx`'s whole reveal handshake was written
      around.

      Two halves, deliberately: `widget-sans-reunion` stages it as a *settled*
      answer, which is what makes it photographable and measurable; `LATENCY`
      makes the in-flight version of the same face reachable on every other widget
      stage, which is what makes the transient real.
    */
    'widget:state': () =>
      /*
        **`RECORDING_STOPPED` and not just the scenario**, because the fixture
        was producing a pairing the product cannot.

        `app/ipc/register.ts` derives both this answer and `meeting:mark`'s
        refusal from one condition — `stateOf(id) === 'recording'`. So the state
        `refuseMarks()` stages, « the call stopped recording while the pill was
        still up », makes *this* channel answer `{ meeting: null }` too. The stub
        refused the mark and went on reporting a live recording here, which is
        not a stale copy in the renderer but two channels of one process
        disagreeing about the same fact.

        That mattered: the fix for the pill's contradiction is that a refusal
        proves the window's copy is stale, so the renderer re-reads this channel.
        Against the old fixture the re-read returned the recording again and the
        product looked broken when it was the fixture that was. Sixth time this
        file has been caught unable to produce the input a defect lives on, and
        the first time it produced an impossible one.
      */
      scenario === 'widget-sans-reunion' || RECORDING_STOPPED
        ? { meeting: null, mentionSentence: MENTION_SENTENCE_DEFAULT }
        : {
            /*
              US-19 — the sentence rides every answer, including the one with no
              meeting, because that is the answer `MEASURE_DEADLINE_MS` treats as
              settled either way. The fixture uses the shipped default rather than a
              made-up string: a stub sentence shorter than the product's would
              flatter the card's box, which is the « fixture simpler than the
              product » shape this repo has been caught by seven times.
            */
            mentionSentence: MENTION_SENTENCE_DEFAULT,
            meeting: {
              meetingId: 'm-neovia-cadrage',
              title: 'Néovia Santé — cadrage renfort data',
              clientName: 'Néovia Santé',
              // The one timeline, so the pill's clock and the meeting row agree.
              // It read `now - 22 * MIN` while the row said 14:30, which put the
              // pill's elapsed counter seventeen minutes before the invite.
              startedAt: NEOVIA_STARTED,
              marks: MARKS,
              paused: false,
            },
          },
    'session:pause': (payload) => {
      /*
        **A press that does not take is a thing this channel really does.**

        `Orchestrator.setPaused` returns `false` when it holds no recording for
        the meeting, and `register.ts` answers with the state *unchanged* — so the
        widget sees back the opposite of what it asked for. That is the
        `EndOfMeetingWatch` gap, the same gap `meeting:mark` refuses in, on the one
        control a rep presses because something must not be recorded.

        This entry honoured every request for as long as it existed, so no stage
        and no check had ever drawn the refusal. There was a `refuseMarks()` and no
        `refusePause()`, and the sentence lived only at its own definition site.
      */
      /*
        **The refusal the main process really sends, which is not the request
        inverted.**

        This answered `{ paused: !payload.paused }`. For a *Pause* that is the
        same number `setPaused` gives — it holds no recording, so nothing is
        paused — and for a *Reprendre* it is the opposite of it. So the one
        direction the product cannot show a refusal in was the one direction this
        fixture staged a refusal in perfectly, which is how the sentence
        « L’enregistrement n’a pas pu reprendre. » stayed unreachable for a round
        with a verb pointed straight at it. Seventh time this file has been caught
        unable to produce the input a defect lives on, and the second time it
        produced an impossible one.
      */
      if (REFUSE_PAUSE) return { ok: false, paused: false }
      // Like the main process: the answer is one window's, the broadcast is every
      // window's, and the widget draws the broadcast.
      harness.emit('recording:paused', { meetingId: payload.meetingId, paused: payload.paused })
      return { ok: true, paused: payload.paused }
    },
    'meeting:mark': (payload) => {
      /*
        **A refusal is a thing this channel really does, so the fixture has to be
        able to produce one.**

        `app/ipc/register.ts` rejects `meeting:mark` whenever the meeting is not
        `recording` — which `EndOfMeetingWatch` can make true with the pill still
        floating over the call — and on any store failure. The stub answered
        every press with a mark, so the one rendering that mattered had never been
        drawn by any stage or measured by any check, and the refusal went into an
        `sr-only` paragraph measuring 1×1 while the pill's counter, which is the
        only receipt a press without a note has, correctly did not move. Fifth
        time this fixture has been caught flattering the product, and the same
        shape every time: it could not produce the input the defect lives on.

        Set by `window.__harness.refuseMarks(reason)` — the harness's own verb,
        so a stage says what it is staging instead of monkey-patching the bridge.
      */
      if (REFUSE_MARKS !== null) throw new Error(REFUSE_MARKS)
      const mark = {
        id: 'mark-' + (MARKS.length + 1),
        at: now,
        note: payload.note || '',
        segmentId: payload.segmentId ?? null,
        /*
          Echoed rather than defaulted here, so a stage can tell the rep's marks
          from the product's one — « Prévenir le client » passes `'product'`, and
          the panel draws it with its own glyph and no delete. A fixture that
          answered `'rep'` to everything would flatter exactly the defect
          `MomentMark.by` was added to end.
        */
        by: payload.by ?? 'rep',
      }
      MARKS.push(mark)
      harness.emit('moment:marked', { meetingId: payload.meetingId, mark })
      return mark
    },
    'meeting:forget': (payload) => {
      const index = MARKS.findIndex((mark) => mark.id === payload.markId)
      if (index < 0) return { forgotten: false }
      MARKS.splice(index, 1)
      harness.emit('moment:forgotten', { meetingId: payload.meetingId, markId: payload.markId })
      return { forgotten: true }
    },
    // The two window gestures. They move a window and answer a boolean; there
    // is no window here, and `false` would be a lie about a request that was
    // made and honoured everywhere it is real.
    /*
      **The stacking direction the real placement would answer.**

      This said `above: false` unconditionally — « no window here, so no
      placement » — and the real `opensAbove` returns **true** at 1920×1040,
      1366×728 and 2560×1400, because the widget's default position is the
      bottom of the display and that is the bottom half. So the layout every
      rep's first open actually gets had never been rendered by any stage, by
      any of the six measured checks, or by anything else. Fourth time this
      fixture has been caught flattering the product, and the first time by
      answering a *placement* question it had no business having an opinion on.

      The page is not a display, so this is `true` by the same rule for the same
      reason: a pill drawn near the bottom of a 1280×800 viewport is in its
      bottom half. It was the constant expression `window.innerHeight > 0`,
      which said that and could say nothing else — so the **other** direction,
      the one `opensAbove` returns for a pill in the top half of the display,
      was drawn by no stage and measured by nothing. `placeBelow()` is the
      reversible switch that stands it there; the default is unchanged.
    */
    'widget:resize': () => ({ ok: true, above: OPENS_ABOVE }),
    'widget:passThrough': () => ({ ok: true }),
    /*
      The exit handshake's reply. No stage emits `widget:leave` — the pill's exit
      is a hundred and fifty milliseconds long and a stage photographs a resting
      screen — but the responder is here because a channel the product can invoke
      and the stub cannot answer is a rejected promise inside a `.catch`, which is
      the shape of a fixture that is simpler than the product.
    */
    'widget:left': () => ({ ok: true }),
    /*
      The renderer telling the main process when its own measurement clock started.
      There is no main process here, so the answer is `ok: false` — « nobody re-armed
      anything » — which is the honest reply and the one the renderer is written to
      shrug off (DEC-26). A stub answering `true` would photograph a handshake this
      page cannot complete.
    */
    'widget:measuring': () => ({ ok: false }),
    'window:focus': () => ({ ok: true }),
  }

  /** The settings, with « cette machine uniquement » applied as `main.ts` applies it. */
  const settingsSnapshot = () => {
    if (!SETTINGS.offlineOnly) return SETTINGS
    const local = (section) => {
      const rows = section.rows.filter((row) => row.residency !== 'remote')
      const selected = rows.some((row) => row.id === section.selected)
        ? section.selected
        : (rows.find((row) => row.configured)?.id ?? null)
      return { ...section, rows, selected }
    }
    return { ...SETTINGS, stt: local(SETTINGS.stt), llm: local(SETTINGS.llm) }
  }

  // ── plumbing ──────────────────────────────────────────────────────────────
  const listeners = new Map()
  const calls = []
  const unanswered = []

  const harness = {
    scenario,
    now,
    calls,
    unanswered,
    emit(channel, payload) {
      const set = listeners.get(channel)
      if (!set) return 0
      for (const listener of Array.from(set)) listener(payload)
      return set.size
    },
    /**
     * Fills the header's level meter, which is the session screen's only live
     * surface now that the transcript pane is gone. Emitted synchronously and
     * in full so a single screenshot catches a meter with a history in it.
     */
    /**
     * What the widget's panel draws: the meter, then the last turns of the
     * call arriving on the broadcast.
     *
     * It carried an *interim* line for one round, and that fixture was the only
     * thing in the world that could produce one: every shipped provider is
     * batch, so `isFinal: false` never occurs, and the stub was manufacturing
     * the input for a rendering the product cannot reach. Exactly the shape
     * `harnessFixture.test.ts` exists to catch, in the other direction — a
     * fixture flattering the product by feeding it something real life does not
     * contain.
     */
    replayWidget(meetingId) {
      const id = meetingId || 'm-neovia-cadrage'
      harness.replaySession(id)
      for (const segment of SEGMENTS.slice(-5)) {
        harness.emit('transcript:appended', { meetingId: id, segment })
      }
    },
    /**
     * The call stopped recording while the pill was still up, so `meeting:mark`
     * refuses — the exact sentence `app/ipc/register.ts` rejects with.
     *
     * Reversible with `refuseMarks(null)`, because a stage that leaves the
     * fixture broken for whatever runs next is a stage that breaks the run
     * after it.
     */
    /**
     * The recording ended under the pill, so `session:pause` answers with the
     * state unchanged and the press is refused — what `Orchestrator.setPaused`
     * returning `false` looks like from this window.
     *
     * Reversible with `refusePause(false)`, for the reason `refuseMarks` is.
     */
    refusePause(on) {
      REFUSE_PAUSE = on === undefined ? true : on === true
      /*
        **And `widget:state` moves with it, which is true of the product only
        since `#pausePending` — it was written as though it always had been.**

        The sentence here read « `Orchestrator.setPaused` answers `false` only when
        it holds no recording for the meeting, and `widget:state` answers
        `{ meeting: null }` in exactly that case. One condition, two channels. »
        They were two conditions. `setPaused` keyed on the **capture handle**
        (`#recordings.get(id)`); `widget:state` keys on the **state machine**
        (`stateOf(id) === 'recording'`). `dispatch('start')` sets the second
        synchronously — that broadcast is what puts this window on screen — then
        fires `#openDevices` without awaiting it, so for the length of a device
        open a pause was refused while this channel went on answering a live
        meeting: 8 refusals in 12 samples across 418 ms, driven on the shipped
        class. Through the shipped renderer that is the round-4 defect verbatim,
        « La pause n’a pas pu être prise. » beside `data-graphic="enregistrement en
        cours"` and a running clock — and the refusal's own remedy, re-reading
        this channel, answered the recording again.

        A pause asked for in that window is honoured now, so `setPaused` refuses
        exactly when `stateOf(id) !== 'recording'`, which is exactly when this
        channel answers `{ meeting: null }`. The coupling below is therefore
        correct — and it is held by a test over the two shipped handlers rather
        than by this comment: `app/ipc/__tests__/register.test.ts`, « session:pause
        and widget:state answer the same meeting while the devices open ».
      */
      RECORDING_STOPPED = REFUSE_PAUSE
    },
    /**
     * **The pill in the top half of the display, so the panel opens downward.**
     *
     * `opensAbove` answers on the pill's own half of the screen, and the stub
     * answered `true` unconditionally — defensibly, since the widget's default
     * position is the bottom of the display. What that left is a direction the
     * product draws whenever a rep drags the pill up, reached by no stage: the
     * panel's seam against the pill was measured in one direction only, and the
     * cards' seam spent a whole round on the wrong edge for exactly that reason.
     *
     * Both halves, because the product sends both: `widget:resize` answers the
     * new direction to the next measurement, and `widget:placed` is the
     * broadcast `Overlay` sends when the renderer did not ask — `main.ts:1175`.
     * Without the first, the next `ResizeObserver` reading flips it straight
     * back; without the second, nothing moves until something resizes.
     *
     * Reversible with `placeBelow(false)`, for the reason `refusePause` is.
     */
    placeBelow(on) {
      OPENS_ABOVE = on === false
      harness.emit('widget:placed', { above: OPENS_ABOVE })
    },
    refuseMarks(reason) {
      REFUSE_MARKS =
        reason === undefined
          ? 'Aucun enregistrement en cours — il n’y a pas de moment à marquer.'
          : reason
      /*
        The default reason *is* « the call stopped », so it moves the other
        channel the main process would move with it. A caller passing its own
        reason is staging a store failure **during** a recording, which is the
        other half of what `meeting:mark` rejects on — there the meeting is
        still live and this channel must keep saying so.
      */
      RECORDING_STOPPED = reason === undefined
    },
    /**
     * **A second health edge, which nothing in this harness could produce.**
     *
     * Every staged health came from a *static* table read once by
     * `health:snapshot`, plus exactly one broadcast — the dry run's, on
     * `capture`. So no stage had ever put two connectors in trouble at once, and
     * no stage had ever watched one of them recover while the other stayed down:
     * the state in which the widget's two writers disagreed. `widget-deux-pannes`
     * drives it, and this is the verb.
     *
     * The table moves with the broadcast, for the reason `refuseMarks` moves
     * `RECORDING_STOPPED`: a `health:snapshot` re-read after an edge must answer
     * what the edge said, or the fixture stages a main process that contradicts
     * itself.
     *
     * The sentences are the product's own — `HEALTH` above carries
     * `capture/index.ts`'s route-change line word for word, and `TRANSCRIBE` here
     * is `Orchestrator.#startRecording`'s, which is the transcription failure a
     * rep can actually meet mid-call.
     */
    health(connector, state) {
      const next =
        state === 'ok'
          ? { state: 'ok' }
          : state === 'transcribe-down'
            ? {
                state: 'down',
                reason: 'aucun fournisseur de transcription disponible',
                since: Date.now(),
                retryable: true,
              }
            : state
      healthBase()[connector] = next
      return harness.emit('health:changed', { connector, health: next, at: Date.now() })
    },
    replaySession(meetingId) {
      const id = meetingId || 'm-neovia-cadrage'
      LEVEL_HISTORY.forEach((rep, index) => {
        harness.emit('audio:level', {
          meetingId: id,
          rep,
          far: FAR_LEVEL_HISTORY[index],
          floor: 0.008,
        })
      })
    },
  }

  window.__harness = harness

  /**
   * **The fixture is never faster than the product, because a fixture that is
   * hides every loading state the product has.**
   *
   * `review:transcript` was given a tick last round and forty-four other
   * responders were not, so they all resolved **in the same microtask as the
   * call**: React committed the answer in the same pass as the initial render and
   * no placeholder ever painted. Which means none of them could be photographed,
   * measured by any of the six checks, or reached by any of the 106 stagings —
   * and CLAUDE.md already records what that hid for thirteen rounds. A
   * placeholder that *filled* the Transcription column was covered the instant it
   * appeared, the transcript then replaced it, nothing re-measured, and *Valider*
   * armed on a compte-rendu at `scrollTop` 0. The fixture's speed was the reason
   * no stage could reproduce it.
   *
   * What was unreachable until this table existed, from the audit of every
   * in-flight rendering in `src/`: the gate's own « Chargement… »
   * (`Review.tsx:1037` and its second `null`-sentinel gate at 1060) one column over
   * from that defect; the widget's **placeholder pill** — « Aucun enregistrement »
   * with no meter, no clock and no mark button, which the product paints at the
   * start of every recording and which `Widget.tsx`'s whole `MEASURE_DEADLINE_MS`
   * handshake exists because of; the entire twenty-second `capture:essai` face (a
   * different heading, a different button label, a `role="status"` line and the
   * essai `LevelMeter`); Réglages' « Chargement… », « Lecture de l’état… » and
   * « Lecture du journal… »; *Historique*'s « Chargement… » and « Recherche… »;
   * and the *Splash*'s three « en cours… » rows.
   *
   * **`DEFAULT` is a macrotask, not a duration**, and that is the load-bearing
   * part: `setTimeout(…, 0)` is enough to put the answer in a *later task* than
   * the render that asked for it, so every `{ status: 'loading' }` branch commits
   * at least one frame. It costs a stage nothing measurable and it applies to
   * every channel, including ones added later — which is the half a table of
   * spellings cannot give.
   *
   * The entries are the channels a *stage* has to be able to catch mid-flight, so
   * the delay has to survive a `waitFor` and a screenshot. Each one names the
   * rendering it makes reachable. `harnessFixture.test.ts` holds every key here to
   * a channel the stub actually answers, so a rename fails loudly instead of
   * quietly restoring the instant fixture.
   */
  const DEFAULT_LATENCY_MS = 0
  const LATENCY = {
    // The gate's « Chargement… », and the `edits`/`checked` seeding gate behind it.
    'review:get': 150,
    // The Transcription column's placeholder — the one that armed *Valider*.
    'review:transcript': 150,
    // The placeholder pill, « Aucun enregistrement », which is what the window is
    // revealed carrying if the measurement lands before the answer does.
    'widget:state': 150,
    // Réglages in full: « Chargement… ».
    'settings:snapshot': 150,
    // « Lecture du journal… » under « Erreurs récentes ».
    'diagnostics:recent': 150,
    // *Historique*'s « Chargement… » and the search pane's « Recherche… ».
    'history:record': 150,
    'history:search': 150,
    // The session screen's « Chargement… ».
    'meeting:get': 150,
    // The splash's three « en cours… » rows.
    'boot:state': 150,
    /*
     * The dry run, and the only entry that is not about a frame. The product
     * listens for **twenty seconds** and the whole card changes for the duration:
     * heading, button label, a `role="status"` line and the essai `LevelMeter`.
     * Twenty seconds × 106 stagings is not a fixture; six hundred milliseconds is
     * long enough for a stage to wait for that face, photograph it and measure it,
     * and short enough that the two stages which wait for the *verdict* do not
     * notice.
     */
    'capture:essai': 600,
  }

  window.app = {
    invoke(channel, payload) {
      calls.push({ channel, payload })
      const responder = responders[channel]
      if (!responder) {
        unanswered.push(channel)
        return Promise.reject(new Error('canal sans réponse dans le harnais: ' + channel))
      }
      /*
       * The responder runs immediately — a throw is the main process refusing, and
       * that has to reach the caller as a rejection whatever the latency is — and
       * only the *answer* is held back.
       */
      let answer
      try {
        answer = responder(payload || {})
      } catch (error) {
        return Promise.reject(error)
      }
      const wait = LATENCY[channel] ?? DEFAULT_LATENCY_MS
      return new Promise((resolve, reject) => {
        setTimeout(() => Promise.resolve(answer).then(resolve, reject), wait)
      })
    },
    on(channel, listener) {
      const set = listeners.get(channel) || new Set()
      set.add(listener)
      listeners.set(channel, set)
      return () => set.delete(listener)
    },
  }
}
