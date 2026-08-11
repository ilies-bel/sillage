/**
 * Ported from `vendor/anarlog-editor/src/markdown.ts` (fastrepl/anarlog, MIT).
 * See `src/editor/README.md` for what was dropped from it and why.
 */
import { Node as PMNode } from "prosemirror-model";

import { getParser } from "./markdown/parser";
import { markdownSchema } from "./markdown/schema";
import { getSerializer } from "./markdown/serializer";

export { markdownSchema } from "./markdown/schema";

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface JSONContent {
  type?: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
}

export const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function isValidContent(content: unknown): content is JSONContent {
  if (!content || typeof content !== "object") {
    return false;
  }
  const obj = content as Record<string, unknown>;
  return obj.type === "doc" && Array.isArray(obj.content);
}

export function parseJsonContent(raw: string | undefined | null): JSONContent {
  if (typeof raw !== "string" || !raw.trim()) {
    return EMPTY_DOC;
  }
  try {
    const parsed = JSON.parse(raw);
    return isValidContent(parsed) ? parsed : EMPTY_DOC;
  } catch {
    return EMPTY_DOC;
  }
}

/**
 * The fallback here stays, unlike `json2md`'s. The two directions fail in
 * opposite ways: unparseable markdown degrades to *the same text, as one
 * paragraph* — nothing is lost, and the rep can see and fix it — whereas an
 * unserialisable document degrades to nothing at all.
 */
export function md2json(markdown: string): JSONContent {
  try {
    const doc = getParser().parse(markdown);
    const json = doc.toJSON() as JSONContent;
    if (!json.content || json.content.length === 0) {
      return { type: "doc", content: [{ type: "paragraph" }] };
    }
    return json;
  } catch {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: markdown }],
        },
      ],
    };
  }
}

/** `json2md` could not render the document. Never swallowed — see below. */
export class MarkdownSerializationError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("le compte-rendu n’a pas pu être converti en markdown");
    this.name = "MarkdownSerializationError";
    this.cause = cause;
  }
}

/**
 * **Adapted from upstream, deliberately.** Upstream caught everything here and
 * returned `""`. Its own test file describes the consequence — a node added to
 * the note schema without its mirror "silently returns '' (killing export,
 * copy-as-md, and LLM snapshots)".
 *
 * For us the consequence is worse than a broken export. This function's output
 * is what step 8 writes into the VSA task's `taskDescription`. A silent `""`
 * means a rep clicks *Valider*, the push succeeds, and the CRM records a
 * meeting with an empty compte-rendu — a failure that looks exactly like a
 * success from every side. Throwing puts it in front of the outbox and the
 * health surface, where a failure belongs.
 */
export function json2md(jsonContent: JSONContent): string {
  try {
    const doc = PMNode.fromJSON(markdownSchema, jsonContent);
    return getSerializer().serialize(doc);
  } catch (error) {
    throw new MarkdownSerializationError(error);
  }
}
