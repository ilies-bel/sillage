/**
 * The section header VISION.md §6 specifies: short accent rule, then an
 * uppercase, letterspaced, muted label.
 *
 * The rule and the type already live in `.pane-label` in `src/design/index.css`
 * — a component class rather than eight copies of six utilities. This wrapper
 * adds the two things every one of its fifteen call sites also writes by hand:
 * the heading level, and the `mb-inline` under it.
 *
 * It is not a re-implementation. `.pane-label` stays the single definition; if
 * the accent rule ever changes width, it changes in one CSS rule and not here.
 *
 * ## When a pane may wear one — the rule, because four call sites could not
 *
 * **A pane is named by its content. A caption earns its place only where two
 * things on the same screen could otherwise be confused.** The session screen
 * captioned the compte-rendu « COMPTE-RENDU » over a document whose own first
 * line is `# <objet>`, and the signal rail « SIGNAUX » over seven boxes reading
 * « TJM », « Profil », « Démarrage » — and the gate captioned the same document
 * with the same word, two inches under a segmented control already saying which
 * of *Lecture*, *Modifier* and *Transcription* is showing. None of that was a
 * defect any check could see: the strings were right, the contrast passed, the
 * boxes were the right size. It was the app talking about itself, on the screen
 * a rep has open while a client is talking.
 *
 * So before adding one, ask what the box already says. A transcript has
 * timestamps and speaker names; a compte-rendu opens on its own heading; a rail
 * is a list of labelled slots; a form field has a label. None of those needs an
 * eyebrow.
 *
 * **And do not reach for the space it costs as the argument, because two of the
 * three cost none.** Measured on the shipped renderer at 1280×800 and 960×600:
 * on the session pane, where the eyebrow had a line of its own, it was 29 px —
 * 17 of ink plus the `mb-inline` — and the compte-rendu's reading column took every
 * one of them back. In the signal rail and at the gate it sat on a baseline row
 * beside a control taller than itself (« Masquer »; *Copier* and the view
 * switch), so deleting it moved **nothing**: both columns are to the pixel where
 * they were. What those two cost was the first thing the eye lands on in the
 * column, which is not a quantity any of the nine measured checks reports — and
 * is exactly why three screenshot reviews kept them.
 *
 * **The exceptions are real, which is why this is a rule and not a purge:**
 *
 *  - *Historique*'s « Mes notes » and « Extraction » sit side by side and are
 *    both plain French prose with no shape of their own. Two blocks that could
 *    be confused: exactly the case a caption is for.
 *  - *Réglages*' section headers are a long form's navigation, and a rep scrolls
 *    that screen looking for one of them by name.
 *  - « Passées » in *Historique* separates two lists of identical shape on one
 *    screen, and « En attente de validation » carries a count and a link — it is
 *    doing work rather than naming furniture.
 *
 * And a caption is not a page title. A page title names what **changed** — the
 * day, the client, the count — never what the screen permanently is; a back link
 * that names a *destination* (« ‹ Calendrier ») is a third thing again and stays.
 */
import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

export interface SectionHeaderProps {
  children: ReactNode
  /**
   * `h2` by default. `legend` is for the `<fieldset>` in Review — a legend
   * carrying the same visual treatment, which is a real case and not a
   * hypothetical one.
   */
  as?: 'h2' | 'h3' | 'legend'
  className?: string
}

export function SectionHeader({ children, as: Tag = 'h2', className }: SectionHeaderProps) {
  return <Tag className={cn('pane-label mb-inline', className)}>{children}</Tag>
}
