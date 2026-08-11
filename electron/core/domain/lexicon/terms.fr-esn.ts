/**
 * The static half of the lexicon (DEC-17): vocabulary that is the same in every
 * meeting, so it can be reviewed once by a human and shipped.
 *
 * The other half is per-meeting and comes from the calendar — attendee
 * surnames, the client company, project names off the agenda. That half is
 * worth more than everything in this file, and `boost.ts` puts it first for
 * exactly that reason.
 *
 * ## What belongs here
 *
 * A term earns its place by being **both** hard for French STT and load-bearing
 * in a compte-rendu. "TJM" is both: it is an initialism no acoustic model has a
 * strong prior for, and a rate is the single most quotable number in a sales
 * call. "Réunion" is neither. Padding this list is not free — see the budget in
 * `boost.ts`.
 *
 * `variants` are the observed mis-transcriptions. Nothing reads them yet: the
 * post-STT correction pass (`correct.ts`) is deferred, and boosting providers
 * only ever see `term`. They are recorded at the point of observation because
 * that is the only moment anyone knows them — a variant noticed in a demo and
 * not written down is a variant discovered again a month later.
 */
import type { LexiconTerm } from '../../contracts/lexicon.ts'

/**
 * Commercial and contractual vocabulary. This is the language a rate, a
 * contract type or a staffing decision gets stated in, which is to say it is
 * the language the extraction reads back out.
 */
const ESN: LexiconTerm[] = [
  { term: 'TJM', category: 'esn', variants: ['tédjéem', 'T.J.M.', 'te ji aime', 'tijem'] },
  { term: 'régie', category: 'esn', variants: ['régis', 'régit', 'rézi'] },
  { term: 'forfait', category: 'esn', variants: ['fort fait'] },
  { term: 'intercontrat', category: 'esn', variants: ['inter contrat', 'inter-contrat', 'intercontract'] },
  { term: 'ESN', category: 'esn', variants: ['E.S.N.', 'euh essenne'] },
  { term: 'appel d’offres', category: 'esn', variants: ['appel d’offre', 'appeldoffre'] },
  { term: 'AO', category: 'esn', variants: ['A.O.', 'a o'] },
  { term: 'portage salarial', category: 'esn', variants: ['portage', 'porte age'] },
  { term: 'ADR', category: 'esn', variants: ['A.D.R.', 'adère'] },
  { term: 'CV anonymisé', category: 'esn', variants: ['CV anonimisé'] },
  { term: 'astreinte', category: 'esn', variants: ['a streinte', 'à teinte'] },
  { term: 'préavis', category: 'esn', variants: ['pré avis'] },
  { term: 'avant-vente', category: 'esn', variants: ['avant vente'] },
  { term: 'staffing', category: 'esn', variants: ['staff in', 'stafing'] },
  { term: 'CDI', category: 'esn', variants: ['C.D.I.', 'cédéi'] },
  { term: 'assistance technique', category: 'esn', variants: [] },
  { term: 'centre de services', category: 'esn', variants: [] },
  { term: 'réversibilité', category: 'esn', variants: ['réversibilitée'] },
  { term: 'jalon', category: 'esn', variants: [] },
  { term: 'périmètre', category: 'esn', variants: [] },
]

/**
 * English technical terms, kept verbatim under DEC-22.
 *
 * These are the ones a French speaker says *in English mid-sentence*, which is
 * the case Whisper handles worst: the language is pinned to `fr-FR`, so the
 * decoder is actively biased against the token sequence actually spoken. Every
 * entry here was observed being mangled, not guessed at — "SharePoint" came
 * back as *shirkpoint*, *Sherpoit* and *Charprement* in a single five-minute
 * call.
 */
const TECH_EN: LexiconTerm[] = [
  {
    term: 'SharePoint',
    category: 'tech-en',
    // The last two are the boosted model's own output: prompting fixes the word
    // and still leaves its casing to chance, so correction finishes the job.
    variants: ['shirkpoint', 'Sherpoit', 'Charprement', 'share point', 'sharepoint', 'sharePoint'],
  },
  { term: 'backend', category: 'tech-en', variants: ['back end', 'bac and'] },
  { term: 'frontend', category: 'tech-en', variants: ['front end'] },
  { term: 'Kubernetes', category: 'tech-en', variants: ['kubernète', 'couvernétisse'] },
  { term: 'sprint', category: 'tech-en', variants: [] },
  { term: 'release', category: 'tech-en', variants: ['relise'] },
  { term: 'MVP', category: 'tech-en', variants: ['M.V.P.', 'aime vé pé'] },
  { term: 'proof of concept', category: 'tech-en', variants: ['POC', 'pock'] },
  { term: 'roadmap', category: 'tech-en', variants: ['rode map'] },
  { term: 'Task Force', category: 'tech-en', variants: ['les TF', 'taskforce'] },
  { term: 'Teams', category: 'tech-en', variants: ['times'] },
  { term: 'Outlook', category: 'tech-en', variants: ['out look'] },
  { term: 'Azure', category: 'tech-en', variants: ['azur'] },
  { term: 'API', category: 'tech-en', variants: ['A.P.I.', 'a pi'] },
  { term: 'DevOps', category: 'tech-en', variants: ['dev ops', 'des vops'] },
  { term: 'legacy', category: 'tech-en', variants: ['légacie'] },
  { term: 'run', category: 'tech-en', variants: [] },
  { term: 'build', category: 'tech-en', variants: [] },
]

/**
 * Ordered by how much a hit is worth, because the token budget truncates from
 * the end. Commercial vocabulary first: a mangled TJM costs a wrong number in
 * the CRM, a mangled "roadmap" costs nothing an LLM cannot infer.
 */
export const STATIC_TERMS: readonly LexiconTerm[] = Object.freeze([...ESN, ...TECH_EN])

/** Just the surface forms, in the same order. */
export const staticBoostTerms = (): string[] => STATIC_TERMS.map((t) => t.term)
