/**
 * Client-specific overrides. **Subclass, don't fork** (CLAUDE.md, DEC-29).
 *
 * The client will have their own developments on top of VerySwing: extra columns
 * on the task, a naming convention on the opportunity, an endpoint of their own.
 * This folder is where that lives, and it exists so the answer to "where do I
 * put it?" is never "in `VsaCrm.ts`, next to the standard behaviour, behind an
 * `if`".
 *
 * Two seams, and they cover different sizes of change:
 *
 * 1. **A client column is a row.** Append it to the table below and it is
 *    written on every push, with the same codec machinery and the same
 *    round-trip test as a standard column. No code changes anywhere.
 *
 * 2. **A client behaviour is an override.** `VsaCrm` reads its field tables
 *    and builds its request bodies through `protected` methods — `taskFields()`,
 *    `opportunityFields()`, `taskBody()`, `opportunityBody()`. A subclass in
 *    this folder overrides one of them and `app/` constructs that subclass
 *    instead. `VsaCrm.ts` never learns the client exists.
 *
 * Both tables are empty today, deliberately. An example subclass would be dead
 * code that the next person copies; the seam is the documentation.
 */
import type { CompteRenduPayload, OpportunityPayload } from '../../../../core/contracts/push.ts'
import type { ExtractionESN } from '../../../../core/contracts/extraction.ts'
import type { FieldRow } from '../fieldMap.ts'

/** Extra columns on `POST /v1/crm/tasks`. Declared with `field()`, like the standard ones. */
export const EXT_TASK_FIELDS: readonly FieldRow<CompteRenduPayload>[] = []

/** Extra columns on `POST /v1/opportunity`. */
export const EXT_OPPORTUNITY_FIELDS: readonly FieldRow<OpportunityPayload>[] = []

/** Extra columns fed from the reviewed extraction rather than from a push payload. */
export const EXT_EXTRACTION_FIELDS: readonly FieldRow<ExtractionESN>[] = []
