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
            : 'recording',
      title: 'Néovia Santé — cadrage renfort data',
      eventId: 'evt-neovia-cadrage',
      clientName: 'Néovia Santé',
      scheduledStart: at(0, 14, 30),
      createdAt: at(0, 14, 28),
      startedAt: now - 22 * MIN,
      endedAt: null,
      confirmedAt: null,
      updatedAt: now - 20 * MIN,
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
  ]

  const meetingById = (id) => MEETINGS.find((m) => m.id === id) || null

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
    const start = index * 78_000 + 4_000
    return {
      id: 'seg-neovia-' + (index + 1),
      channel: line[0],
      text: line[1],
      startMs: start,
      endMs: start + 6_400,
      isFinal: true,
      provider: 'local-whisper',
      receivedAt: now - 22 * MIN + start,
    }
  })

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
    },
    {
      id: 'mark-2',
      at: SEGMENTS[SEGMENTS.length - 2].receivedAt - 1_000,
      note: 'revenir sur le plafond achats avant de proposer',
      segmentId: null,
    },
  ]

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
      `Date : ${crWhen(at(0, 14, 30), at(0, 15, 30))}`,
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
        span: { quote: 'il nous manque deux data engineers', channel: 'far', startMs: 182_000, endMs: 186_400 },
      },
      {
        text: '**Mode de collaboration** : régie',
        span: { quote: 'De la régie, clairement', channel: 'far', startMs: 631_000, endMs: 633_800 },
      },
      {
        text: '**TJM évoqué** : 550 €',
        span: { quote: 'plutôt sur du 550 euros pour un data engineer confirmé', channel: 'far', startMs: 742_000, endMs: 747_500 },
      },
      {
        text: '**Démarrage** : début septembre 2026',
        span: { quote: 'Idéalement début septembre', channel: 'far', startMs: 498_000, endMs: 500_900 },
      },
      {
        text: '**Durée de mission** : 12 mois, clause de sortie à 6 mois',
        span: { quote: 'douze mois, avec une clause de sortie à six mois', channel: 'far', startMs: 552_000, endMs: 556_700 },
      },
      {
        text: '**Contexte technique** : Databricks et Airflow en place, dbt en cours de généralisation, sortie des pipelines Talend historiques avant fin d’année.',
        span: { quote: 'Databricks et Airflow, avec du dbt qu’on est en train de généraliser', channel: 'far', startMs: 268_000, endMs: 273_600 },
      },
      {
        text: '2 × Data Engineer — confirmé (Databricks, Airflow, dbt)',
        span: { quote: 'il nous manque deux data engineers', channel: 'far', startMs: 182_000, endMs: 186_400 },
      },
      {
        text: '1 × Lead Data — senior (architecture, cadrage, revue de code)',
        span: { quote: 'un profil plus senior pour cadrer', channel: 'far', startMs: 186_400, endMs: 189_200 },
      },
      {
        text: 'La grille achats plafonne à 550 € sur un profil confirmé — _sans réponse apportée_',
        span: { quote: 'votre TJM de l’an dernier était un peu haut pour nos achats', channel: 'far', startMs: 700_000, endMs: 705_400 },
      },
      {
        text: 'Envoyer 3 CV avec les TJM associés — Julien Marchand — avant vendredi',
        span: { quote: 'Je vous envoie trois CV d’ici vendredi', channel: 'rep', startMs: 788_000, endMs: 791_900 },
      },
      {
        text: 'Mettre Sophie Bertrand en copie — Élodie Vasseur',
        span: { quote: 'Mettez Sophie en copie', channel: 'far', startMs: 812_000, endMs: 814_300 },
      },
      {
        text: 'Point de calage une fois les profils lus — la semaine suivante',
        span: { quote: 'un point de calage la semaine prochaine une fois les CV lus', channel: 'rep', startMs: 840_000, endMs: 845_100 },
      },
    ],
    intents: [
      {
        id: 'm-neovia-cadrage:crm.task',
        kind: 'crm.task',
        label: 'Tâche compte-rendu (VerySwing)',
        summary: 'Néovia Santé — cadrage renfort data · 14:30',
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
        reason: entra ? null : 'Aucun destinataire au calendrier.',
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
      status: 'À valider',
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
      status: 'À valider',
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
      status: 'À valider',
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
      status: 'Validée',
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
      status: 'Validée',
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
      status: 'Validée',
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
      status: 'Validée',
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
      status: 'Abandonnée',
      intents: [],
      matches: [
        { where: 'notes', excerpt: 'appel coupé au bout de 5 min, à reprogrammer' },
      ],
    },
    {
      meeting: meetingById('m-lefort-decouverte'),
      status: 'Validée',
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

  const RECORDS = {
    'm-lefort-decouverte': {
      meeting: meetingById('m-lefort-decouverte'),
      segments: [
        {
          id: 'rec-lefort-1',
          channel: 'far',
          text: 'On a deux départs sur l’équipe plateforme, et la migration Kubernetes ne peut pas attendre.',
          startMs: 96_000,
          endMs: 102_400,
          isFinal: true,
          provider: 'local-whisper',
          receivedAt: at(-14, 15, 3),
        },
        {
          id: 'rec-lefort-2',
          channel: 'rep',
          text: 'Vous cherchez plutôt des profils confirmés ou un lead capable de cadrer ?',
          startMs: 108_000,
          endMs: 112_800,
          isFinal: true,
          provider: 'local-whisper',
          receivedAt: at(-14, 15, 4),
        },
        {
          id: 'rec-lefort-3',
          channel: 'far',
          text: 'Deux ingénieurs DevOps confirmés, un TJM autour de 620 euros, démarrage septembre.',
          startMs: 118_000,
          endMs: 124_600,
          isFinal: true,
          provider: 'local-whisper',
          receivedAt: at(-14, 15, 5),
        },
        {
          id: 'rec-lefort-4',
          channel: 'far',
          text: 'Le sujet qui va coincer, c’est le délai de démarrage : nos achats mettent trois semaines à contractualiser.',
          startMs: 131_000,
          endMs: 138_900,
          isFinal: true,
          provider: 'local-whisper',
          receivedAt: at(-14, 15, 6),
        },
        {
          id: 'rec-lefort-5',
          channel: 'rep',
          text: 'On peut anticiper le sourcing pendant ce temps-là, je vous envoie les premiers profils la semaine prochaine.',
          startMs: 145_000,
          endMs: 152_100,
          isFinal: true,
          provider: 'local-whisper',
          receivedAt: at(-14, 15, 7),
        },
      ],
      notes:
        'Sophie Bertrand pilote côté DSI, Karim Benali côté plateforme.\nBloquant : délai de contractualisation achats (3 semaines).\nPenser à proposer un profil en pré-embauche.',
      compteRendu:
        '## Contexte\n\nDeux départs sur l’équipe plateforme du Groupe Lefort et une migration vers Kubernetes engagée pour le second semestre.\n\n## Besoin\n\nDeux ingénieurs DevOps confirmés (Kubernetes, Terraform, GitLab CI), démarrage septembre, en régie.\n\n## Point de vigilance\n\nLe circuit achats demande trois semaines de contractualisation ; le sourcing doit être lancé en amont.',
      fields: [
        { key: 'account', label: 'Client', confidence: 'ok', span: null },
        {
          key: 'profils',
          label: 'Profils',
          confidence: 'ok',
          span: { quote: 'deux ingénieurs DevOps confirmés', channel: 'far', startMs: 118_000, endMs: 122_000 },
        },
        {
          key: 'tjm',
          label: 'TJM',
          confidence: 'ok',
          span: { quote: 'un TJM autour de 620 euros', channel: 'far', startMs: 120_000, endMs: 123_400 },
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

  const recordFor = (meetingId) => {
    const known = RECORDS[meetingId]
    if (known) return { interlocuteurs: INTERLOCUTEURS[meetingId] || [], ...known }
    const m = meetingById(meetingId)
    return {
      meeting: m || meeting({ id: meetingId }),
      interlocuteurs: INTERLOCUTEURS[meetingId] || [],
      segments: SEGMENTS.slice(0, 6),
      notes: 'Rien de particulier à signaler sur cet appel.',
      compteRendu: '## Contexte\n\nPoint d’avancement sans décision nouvelle.',
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

        This claimed « téléchargement du modèle Whisper — 196 Mo sur 466 Mo » in
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
      reason: 'aucune application Microsoft configurée — le calendrier reste vide',
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

  const SETTINGS = {
    stt: {
      rows: [
        {
          id: 'local-whisper',
          label: 'Whisper (local)',
          tier: 'local',
          residency: 'local',
          streaming: false,
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
          streaming: false,
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
          streaming: true,
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
          streaming: true,
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
          streaming: true,
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
          streaming: true,
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
          streaming: true,
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
      rows: [
        {
          id: 'Xenova/whisper-small',
          label: 'Whisper Small',
          sizeMb: 466,
          speed: 'medium',
          accuracy: 'très bonne',
          bundled: true,
          status: 'ready',
          progress: 100,
          reason: null,
          selected: true,
        },
        {
          id: 'onnx-community/whisper-large-v3-turbo-ONNX',
          label: 'Whisper Large v3 Turbo',
          sizeMb: 1031,
          speed: 'medium',
          accuracy: 'très bonne',
          bundled: false,
          status: 'downloading',
          progress: 38,
          reason: null,
          selected: false,
        },
        {
          id: 'Xenova/whisper-medium',
          label: 'Whisper Medium',
          sizeMb: 1530,
          speed: 'slow',
          accuracy: 'très bonne',
          bundled: false,
          status: 'absent',
          progress: 0,
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

    This staged `downloading` — a progress bar, « 196 Mo sur 466 Mo », an ETA —
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
      value: 'modèle Whisper — 196 Mo sur 466 Mo · environ 1 min',
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

  const blobOf = (row) =>
    fold(
      [
        row.meeting.title,
        row.meeting.clientName,
        row.status,
        row.matches.map((m) => m.excerpt).join(' '),
      ].join(' '),
    )

  const PERIOD_DAYS = { toute: null, '7j': 7, '30j': 30, '90j': 90 }
  const STATUS_LABEL = { tous: null, 'a-valider': 'À valider', validees: 'Validée', abandonnees: 'Abandonnée' }

  /*
   * The anchor `core/contracts/meeting.ts` exports, restated here because a stub
   * cannot import from `electron/`. If the two ever disagree, the screenshots
   * are of a product that does not exist.
   */
  const anchorOf = (meeting) => meeting.scheduledStart || meeting.startedAt || meeting.createdAt

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
    let rows = HISTORY_ROWS.slice().sort((a, b) => anchorOf(b.meeting) - anchorOf(a.meeting))
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
    }
    if (filter.client) rows = rows.filter((row) => row.meeting.clientName === filter.client)
    const days = PERIOD_DAYS[filter.periode]
    if (days) rows = rows.filter((row) => (row.meeting.startedAt || row.meeting.createdAt) >= now - days * 24 * HOUR)
    const wanted = STATUS_LABEL[filter.statut]
    if (wanted) rows = rows.filter((row) => row.status === wanted)
    if (filter.intention && filter.intention !== 'toutes') {
      rows = rows.filter((row) => row.intents.some((i) => i.kind === filter.intention))
    }
    return rows.slice(0, limit)
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
          armed:
            scenario === 'review'
              ? null
              : {
                  meetingId: 'm-neovia-cadrage',
                  eventId: 'evt-neovia-cadrage',
                  subject: 'Néovia Santé — cadrage renfort data',
                },
          reason: '',
        }
      : {
          events: [],
          syncedAt: 0,
          // No calendar connected means no day was asked about.
          window: { from: 0, to: 0 },
          armed: null,
          reason: 'Aucun calendrier connecté',
        }

  /** The health table this scenario reads — see `healthSnapshot` below. */
  const healthBase = () =>
    scenario === 'onboarding'
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
      const m = meetingById(payload.meetingId)
      if (!m) throw new Error('réunion introuvable: ' + payload.meetingId)
      const live = m.id === 'm-neovia-cadrage'
      return {
        meeting: m,
        segments: live ? SEGMENTS : [],
        signals: live ? SIGNALS : [],
        outbox: [],
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

    /** The picker. The stub records nothing; the shot is of the control. */
    'meeting:recipe': (payload) => ({
      recipe: payload.recipe,
      regenerating: false,
      state: meetingById(payload.meetingId)?.state ?? 'idle',
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
    'onboarding:state': () => ({ seen: scenario !== 'onboarding' }),
    'onboarding:seen': () => ({ seen: true }),

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
    'review:transcript': () => ({ segments: SEGMENTS, marks: MARKS }),

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
      const meeting = meetingById(payload.meetingId)
      if (meeting) {
        meeting.state = 'pushing'
        meeting.confirmedAt = now
        meeting.updatedAt = now
      }
      const row = HISTORY_ROWS.find((r) => r.meeting.id === payload.meetingId)
      if (row) row.status = 'Validée'
      harness.emit('session:changed', { meetingId: payload.meetingId, state: 'pushing' })
      return { ok: true, state: 'pushing', intentIds: payload.intentIds || [] }
    },

    'history:search': (payload) => {
      const query = payload.query || ''
      const filter = withFilterDefaults(payload.filter)
      return {
        query,
        filter,
        scanned: HISTORY_ROWS.length,
        clients: CLIENTS,
        rows: searchRows(query, filter, payload.limit || 50),
      }
    },
    'history:record': (payload) => recordFor(payload.meetingId),

    'settings:snapshot': () => SETTINGS,
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
    'models:state': () => SETTINGS.models,

    /*
      The in-meeting widget (`src/widget/Widget.tsx`).

      The meeting it reports is the one the session scenario records, at the
      same objet and the same start, so the pill floating over a call and the
      header of the window behind it cannot disagree about which call it is.
    */
    'widget:state': () => ({
      meeting: {
        meetingId: 'm-neovia-cadrage',
        title: 'Néovia Santé — cadrage renfort data',
        clientName: 'Néovia Santé',
        startedAt: now - 22 * MIN,
        marks: MARKS,
      },
    }),
    'meeting:mark': (payload) => {
      const mark = {
        id: 'mark-' + (MARKS.length + 1),
        at: now,
        note: payload.note || '',
        segmentId: payload.segmentId ?? null,
      }
      MARKS.push(mark)
      harness.emit('moment:marked', { meetingId: payload.meetingId, mark })
      return mark
    },
    // The two window gestures. They move a window and answer a boolean; there
    // is no window here, and `false` would be a lie about a request that was
    // made and honoured everywhere it is real.
    'widget:resize': () => ({ ok: true }),
    'window:focus': () => ({ ok: true }),
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
     * call arriving on the broadcast, then one interim line.
     *
     * The interim is the half of this surface no other screen in the product
     * has ever drawn — it is the only rendering of text that is *not* the
     * record — so a fixture without one photographs the easy half.
     */
    replayWidget(meetingId) {
      const id = meetingId || 'm-neovia-cadrage'
      harness.replaySession(id)
      for (const segment of SEGMENTS.slice(-5)) {
        harness.emit('transcript:appended', { meetingId: id, segment })
      }
      harness.emit('transcript:appended', {
        meetingId: id,
        segment: {
          id: 'seg-interim-far',
          channel: 'far',
          text: 'Sur le plafond, il faudrait qu’on revienne vers les achats',
          startMs: 0,
          endMs: 0,
          isFinal: false,
          provider: 'local-whisper',
          receivedAt: now,
        },
      })
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

  window.app = {
    invoke(channel, payload) {
      calls.push({ channel, payload })
      const responder = responders[channel]
      if (!responder) {
        unanswered.push(channel)
        return Promise.reject(new Error('canal sans réponse dans le harnais: ' + channel))
      }
      try {
        return Promise.resolve(responder(payload || {}))
      } catch (error) {
        return Promise.reject(error)
      }
    },
    on(channel, listener) {
      const set = listeners.get(channel) || new Set()
      set.add(listener)
      listeners.set(channel, set)
      return () => set.delete(listener)
    },
  }
}
