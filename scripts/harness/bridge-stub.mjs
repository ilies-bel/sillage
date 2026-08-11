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
    compteRendu: [
      '# Néovia Santé — cadrage renfort data',
      '',
      '## Contexte',
      '',
      'Le budget de la plateforme data a été voté ce matin en comité d’investissement.',
      'Néovia doit sortir ses pipelines Talend historiques avant la fin de l’année et',
      'généralise dbt sur les domaines métier.',
      '',
      '## Besoin',
      '',
      'Deux data engineers confirmés et un lead data pour cadrer la migration. Stack',
      'Databricks / Airflow / dbt, pilotage quotidien côté client.',
      '',
      '## Conditions évoquées',
      '',
      '- Mode : régie',
      '- Démarrage : début septembre 2026',
      '- Durée : 12 mois, clause de sortie à 6 mois',
      '- TJM : 550 € (confirmé) et 650 € (lead) — au-dessus de la grille achats 2025',
      '',
      '## Prochaines étapes',
      '',
      'Envoi de trois CV avec les TJM associés avant vendredi, Sophie Bertrand en copie.',
      'Point de calage la semaine suivante une fois les profils lus.',
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
    mailBody: [
      'Bonjour Élodie,',
      '',
      'Merci pour cet échange. Je vous confirme ce que nous avons calé : deux data',
      'engineers confirmés et un lead data, en régie, pour un démarrage début',
      'septembre sur douze mois.',
      '',
      'Je vous adresse trois CV d’ici vendredi avec le TJM associé à chacun, Sophie',
      'Bertrand en copie. Nous pourrons caler un point la semaine suivante une fois',
      'les profils lus.',
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

  const REVIEW_PANEL = {
    meeting: meetingById('m-neovia-cadrage'),
    edits: REVIEW_EDITS,
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

  const recordFor = (meetingId) => {
    if (RECORDS[meetingId]) return RECORDS[meetingId]
    const m = meetingById(meetingId)
    return {
      meeting: m || meeting({ id: meetingId }),
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
        reason: 'VerySwing injoignable — la sandbox VSA n’a pas répondu en 10 s',
        since: now - 26 * MIN,
        retryable: true,
      },
      mail: {
        state: 'degraded',
        reason: 'jeton Microsoft expiré — reconnectez votre compte pour créer des brouillons',
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
        },
        {
          id: 'deepgram',
          label: 'Deepgram',
          tier: 'cloud',
          residency: 'remote',
          streaming: true,
          cost: 'metered',
          // Configured and usable, and the row still says « hors UE ». The
          // residency is stated, not enforced — a stub that greyed this row
          // would show a screen the app no longer renders.
          configured: true,
          selected: false,
          selectable: true,
          reason: null,
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
        },
      ],
      selected: 'local-whisper',
      reason: null,
    },
    llm: {
      rows: [
        {
          id: 'mistral',
          label: 'Mistral AI (UE)',
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
        },
      ],
      selected: 'mistral',
      reason: null,
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
      {
        id: 'transcribe',
        label: 'Transcription',
        health: {
          state: 'degraded',
          reason: 'modèle « small » chargé — précision moindre sur les noms propres',
          since: now - 52 * MIN,
          retryable: false,
        },
      },
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

  // ── boot ──────────────────────────────────────────────────────────────────
  const BOOT_READY = {
    store: { state: 'ready', value: 'sillage.db · schéma v3' },
    devices: { state: 'ready', value: 'moteur de capture chargé' },
    transcription: { state: 'ready', value: 'Whisper (local)' },
    version: '0.4.2',
  }

  const BOOT_BOOTING = {
    store: { state: 'ready', value: 'sillage.db · schéma v3' },
    devices: { state: 'pending' },
    transcription: { state: 'downloading', value: '42 %', percent: 42 },
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

  const searchRows = (query, filter, limit) => {
    const needle = fold(query)
    let rows = HISTORY_ROWS.slice()
    if (needle) rows = rows.filter((row) => blobOf(row).indexOf(needle) !== -1)
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
      : { events: [], syncedAt: 0, armed: null, reason: 'Aucun calendrier connecté' }

  const healthSnapshot = () => {
    const base = scenario === 'reglages' || scenario === 'historique' ? HEALTH.mixed : HEALTH.agenda
    return entra ? base : { ...base, ...NO_ENTRA_HEALTH }
  }

  const responders = {
    'boot:state': () => (scenario === 'splash' ? BOOT_BOOTING : BOOT_READY),
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
          {
            id: payload.meetingId + ':mail.draft',
            kind: 'mail.draft',
            label: label('mail.draft'),
            summary:
              mailTo.length > 0 ? edits.mailSubject + ' → ' + mailTo.join(', ') : 'Indisponible',
            available: mailTo.length > 0,
            reason: mailTo.length > 0 ? null : 'Aucun destinataire au calendrier.',
          },
        ],
      }
    },
    'review:confirm': (payload) => ({
      ok: true,
      state: 'pushing',
      intentIds: payload.intentIds || [],
    }),

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
