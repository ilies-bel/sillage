# Screens

Nine surfaces. Screenshots in `scratch/design-shots/`, all 1280×800 at 2× unless noted.

Every screen shares a **header**: `bg-card`, `border-b border-subtle`, `px-gutter py-3`, and
its contents are always left-to-right: a back link (except on the home screen), the page's own
title, then the screen's controls pushed right.

---

## 1. Agenda — the home screen · `agenda.png`

Two columns, full height.

- **Left, fixed ~500px**: a month grid with a dot under any day that has something; a legend
  for the three dot states; « Aujourd'hui »; « Synchronisé il y a N min ».
- **Right, flexible**: a search field, a `Jour / Semaine / Mois / Liste` segmented control, and
  the day's lists.

The title is **the selected range** — « Dimanche 13 septembre » in `--font-display` at
`--type-display`. It is not the word « Calendrier ». It changes when the rep clicks another
day, and the date is drawn **once** on the screen.

Rows are grouped into three lists, each a card with hairline dividers: today's upcoming calls,
« Passées », and « En attente de validation » with a count and a « Les N › » link.

A row is `time · title + attendees · status word · one control`. **Exactly one control on the
screen is filled** (`--brand-700`), chosen as: the live call, else the armed offer, else the
oldest row awaiting validation. Every other control is bordered.

Variants: `agenda-semaine.png`, `agenda-liste.png`, `agenda-empty.png`, `agenda-client.png`.

## 2. Session — during the call · `session.png`, `session-compte-rendu.png`

The screen a rep has open while a client is talking. Header carries a recording chip (orange
dot + `00:05:00` + a two-channel level meter, the rep above a baseline and the far end below),
the objet, the account, a two-option recipe switch, and *Terminer*.

Body is **two columns while recording, three once a compte-rendu exists**:

| Column | Width | Contents |
|---|---|---|
| notepad | `flex-1 min-w-[260px]`, `bg-inner` | the rep's own typing — a serif title and prose. Never written by AI. |
| compte-rendu | `w-[40%] min-w-[440px] max-w-[560px]` | appears at meeting end |
| signal rail | `w-[22%] min-w-[210px] max-w-[300px]` | seven labelled slots, empty ones drawn as « — » |

The compte-rendu column carries an ask field (« Poser une question sur cet appel… ») with
three suggested question chips and one suggested-action chip.

## 3. Review gate — the one confirmation · `review.png`, `review-valider.png`

**The most important screen in the product and the most constrained.** Two columns inside a
`max-w-[1440px]` centred container.

| Column | Width | Contents |
|---|---|---|
| document | flexible, `bg-inner` | the typeset compte-rendu, plus `Copier` and a `Lecture / Modifier / Transcription` switch |
| rail | `w-[42%] min-w-[380px] max-w-[560px]` | eleven typed fields, each with a `source ▸`, then « Ce qui sera créé » with three checkboxes |

The title is the call. A `⚠ faible — N champ(s) non vérifié(s)` link sits top right when the
app could not verify a field against the transcript.

**The layout is a safety mechanism.** *Valider* is withheld until both columns have actually
been shown, and while it is withheld the primary slot holds the control that *shows the rest*
— never a greyed copy of *Valider*. When a field is unverified the primary reads « Valider
malgré N champ(s) non vérifié(s) » in `--warn`. The page turn and *Valider* must never share a
rectangle: they did, 63ms apart, and a double-click shipped to the CRM.

The compte-rendu is drawn with its markdown markers **hanging in a left gutter** in mono,
muted — `#`, `##`, `- ` — and the prose beside them set as prose. It is not a markdown
renderer: the CRM receives the exact string on screen, so nothing may be hidden.

## 4. Historique · `historique.png`

Search field, a horizontally scrolling chip bar (durations, states, intent kinds, then one
chip per client), and a list of past calls. An expanded row opens four panes —
transcript, « Mes notes », compte-rendu, « Extraction » — plus « Envois ».

The title is **the count and the active filter**: « 9 appels · 90 jours · Validées ». It says
« Aucun appel » when nothing matches and « Plus de 50 appels » when the search hit its ceiling
— never a number it cannot stand behind.

Two of the four pane captions were deleted deliberately (the transcript names itself with
timestamps and speakers; the compte-rendu opens on its own `#` heading). « Mes notes » and
« Extraction » keep theirs because they are two blocks of plain prose side by side.

## 5. Réglages · `reglages.png` + three variants

Left nav rail (Transcription, Modèle de langage, Connecteurs, Raccourcis clavier, Mise à jour,
Diagnostics) and a settings pane. Section headers here are legitimate: it is a long form and
they are its navigation.

## 6. Onboarding · `onboarding.png`, `onboarding-besoins.png`, `onboarding-essai.png`

Three steps, three progress dots. What it is, what it needs, what will happen. *Continuer* is
live on every step and every exit is recorded — it is never a gate.

## 7. Splash · `splash.png`

Boot. Three health rows, each with a `StateDot`.

---

# Things that will look like mistakes and are not

- **Empty slots say « — » and stay that way.** The signal rail draws the whole slate including
  the fields nothing was said about. Filling one would be the app inventing evidence.
- **The muted grey is `--text-muted` at 5.09:1**, not a lighter grey. It is the floor.
- **The reading column is narrower than the box it sits in.** That is `.measure`.
- **Nothing is centred.** There is no centred layout anywhere except the 1440px container.
- **There are no icons except in a few controls.** No icon set, deliberately.
