/**
 * Ported from `vendor/anarlog-editor/src/markdown.test.ts` (fastrepl/anarlog, MIT).
 *
 * Dropped with their node types: the task-list, image and fileAttachment
 * suites. Everything else is upstream's, and the `schema mirror` fixture is
 * upstream's minus those types — it is the test that matters most here, because
 * it is what catches a node added to `note/schema.ts` and forgotten in
 * `markdown/schema.ts`.
 */
import { Node as PMNode } from "prosemirror-model";
import { describe, expect, test } from "vitest";

import {
  EMPTY_DOC,
  isValidContent,
  json2md,
  type JSONContent,
  MarkdownSerializationError,
  md2json,
  parseJsonContent,
} from "./markdown";
import { schema as noteSchema } from "./note/schema";

describe("json2md", () => {
  test("renders underline as html tags", () => {
    const markdown = json2md({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "underlined",
              marks: [{ type: "underline" }],
            },
          ],
        },
      ],
    });

    expect(markdown).toBe("<u>underlined</u>");
  });

  test("renders table nodes as markdown tables", () => {
    const markdown = json2md({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Nom" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Rôle | Notes" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Dupont" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Directeur technique" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toBe(
      "| Nom | Rôle \\| Notes |\n| --- | --- |\n| Dupont | Directeur technique |",
    );
  });

  test("renders merged and shorter table rows with consistent columns", () => {
    const markdown = json2md({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 2 },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Trimestre" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Statut" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "T3" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toBe(
      "| Trimestre |  | Statut |\n| --- | --- | --- |\n| T3 |  |  |",
    );

    const roundtripped = md2json(markdown);
    expect(roundtripped.content?.[0]?.content?.[0]?.content).toHaveLength(3);
    expect(roundtripped.content?.[0]?.content?.[1]?.content).toHaveLength(3);
  });

  test("renders table cell hard breaks as parseable break tags", () => {
    const markdown = json2md({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Résumé" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "Premier" },
                        { type: "hardBreak" },
                        { type: "text", text: "Second" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toBe("| Résumé |\n| --- |\n| Premier<br>Second |");
  });

  test("escapes literal table cell break tags", () => {
    const markdown = json2md({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Brut" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "literal <br>" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toBe("| Brut |\n| --- |\n| literal \\<br> |");
  });

  test("preserves table cell backslashes across roundtrip", () => {
    const json: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Chemin" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "C:\\Users\\John" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const roundtripped = md2json(json2md(json));
    const cellText =
      roundtripped.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]
        ?.content?.[0]?.text;

    expect(cellText).toBe("C:\\Users\\John");
  });

  test("preserves table cell backslashes before pipes across roundtrip", () => {
    const json: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Motif" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "literal \\| marker" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const roundtripped = md2json(json2md(json));
    const cellText =
      roundtripped.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]
        ?.content?.[0]?.text;

    expect(cellText).toBe("literal \\| marker");
  });

  /*
   * Adapted from upstream, which asserted `json2md` returns "" on failure. We
   * throw instead: this string becomes the VSA task's `taskDescription`, and a
   * compte-rendu that silently arrives empty is indistinguishable from a
   * successful push.
   */
  test("an unrenderable document is an error, never an empty compte-rendu", () => {
    const unknownToBothSchemas: JSONContent = {
      type: "doc",
      content: [{ type: "clip", attrs: { id: "x" } }],
    };

    expect(() => json2md(unknownToBothSchemas)).toThrow(
      MarkdownSerializationError,
    );
  });
});

describe("md2json", () => {
  test("converts html underline tags to underline marks", () => {
    const json = md2json("<u>underlined</u>");
    const paragraph = json.content?.[0];
    const textNode = paragraph?.content?.[0];

    expect(paragraph?.type).toBe("paragraph");
    expect(textNode?.type).toBe("text");
    expect(textNode?.text).toBe("underlined");
    expect(textNode?.marks).toEqual([{ type: "underline" }]);
  });

  test("handles empty markdown", () => {
    const json = md2json("");
    expect(json.type).toBe("doc");
    expect(json.content).toBeDefined();
  });

  test("converts mixed content document", () => {
    const markdown = `# Introduction

Un peu de texte.

- Premier point
- Deuxième point

Encore du texte.`;

    const json = md2json(markdown);
    expect(json.type).toBe("doc");
    expect(json.content!.length).toBeGreaterThan(3);
  });

  test("converts markdown tables to editor-compatible table JSON", () => {
    const json = md2json(`| Nom | Société | Rôle |
| --- | --- | --- |
| Dupont | Acme SA | Directeur technique |
| Le Roy | Acme SA | Responsable achats |`);

    const table = json.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.content?.[0]?.type).toBe("tableRow");
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(
      table?.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.text,
    ).toBe("Nom");
    expect(table?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
    expect(() => PMNode.fromJSON(noteSchema, json)).not.toThrow();
  });

  test("converts table cell break tags to hard breaks", () => {
    const json = md2json(`| Résumé |
| --- |
| Premier<br>Second |`);

    const cellContent =
      json.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]?.content;
    expect(cellContent).toEqual([
      { type: "text", text: "Premier" },
      { type: "hardBreak" },
      { type: "text", text: "Second" },
    ]);
    expect(() => PMNode.fromJSON(noteSchema, json)).not.toThrow();
  });

  test("keeps escaped table cell break tags as text", () => {
    const json = md2json(`| Brut |
| --- |
| literal \\<br> |`);

    const cellContent =
      json.content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]?.content;
    expect(cellContent).toEqual([{ type: "text", text: "literal <br>" }]);
  });
});

describe("roundtrip", () => {
  test("markdown -> json -> markdown -> json produces consistent results", () => {
    const originalMarkdown = `# Compte-rendu

- Besoin exprimé
- Profils recherchés

Un peu de texte.`;

    const json1 = md2json(originalMarkdown);
    const markdown2 = json2md(json1);
    const json2 = md2json(markdown2);

    expect(json1.type).toBe("doc");
    expect(json2.type).toBe("doc");
    expect(json1.content!.length).toBe(json2.content!.length);
  });

  /*
   * Empty paragraphs are load-bearing here in a way they are not upstream. A
   * rep's raw notes are stored as a permanent separate layer (DEC-5) and shown
   * back to them under *Mes notes*; blank lines are how someone separates one
   * thought from the next while half-listening. Collapsing them silently
   * rewrites what they typed.
   */
  test("preserves empty paragraphs across roundtrip", () => {
    const json1: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "first" }],
        },
        { type: "paragraph" },
        { type: "paragraph" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "second" }],
        },
      ],
    };

    const markdown = json2md(json1);
    const json2 = md2json(markdown);

    expect(json2.content!.length).toBe(4);
    expect(json2.content![0].content?.[0]?.text).toBe("first");
    expect(json2.content![1].content).toBeUndefined();
    expect(json2.content![2].content).toBeUndefined();
    expect(json2.content![3].content?.[0]?.text).toBe("second");
  });

  test("serializes empty paragraphs as extra blank lines", () => {
    const markdown = json2md({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    });

    // 1 empty paragraph between = 2 blank lines = 3 consecutive newlines
    expect(markdown).toContain("a\n\n\nb");
    expect(markdown).not.toContain("&nbsp;");
    expect(markdown).not.toContain("\u00A0");
  });

  test("preserves multiple consecutive empty paragraphs", () => {
    const json1: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    };
    const markdown = json2md(json1);
    const json2 = md2json(markdown);

    expect(json2.content!.length).toBe(4);
    expect(json2.content![1].content).toBeUndefined();
    expect(json2.content![2].content).toBeUndefined();
  });

  test("preserves leading empty paragraphs", () => {
    const json1: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    };
    const markdown = json2md(json1);
    const json2 = md2json(markdown);

    expect(json2.content!.length).toBe(3);
    expect(json2.content![0].content).toBeUndefined();
    expect(json2.content![1].content).toBeUndefined();
    expect(json2.content![2].content?.[0]?.text).toBe("hello");
  });

  test("preserves trailing empty paragraphs", () => {
    const json1: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
        { type: "paragraph" },
        { type: "paragraph" },
      ],
    };
    const markdown = json2md(json1);
    const json2 = md2json(markdown);

    expect(json2.content!.length).toBe(3);
    expect(json2.content![0].content?.[0]?.text).toBe("hello");
    expect(json2.content![1].content).toBeUndefined();
    expect(json2.content![2].content).toBeUndefined();
  });

  test("parses leading blank lines from raw markdown", () => {
    const json = md2json("\n\nhello");
    expect(json.content!.length).toBe(3);
    expect(json.content![0].content).toBeUndefined();
    expect(json.content![1].content).toBeUndefined();
    expect(json.content![2].content?.[0]?.text).toBe("hello");
  });
});

describe("isValidContent", () => {
  test("returns true for valid content", () => {
    expect(
      isValidContent({ type: "doc", content: [{ type: "paragraph" }] }),
    ).toBe(true);
  });

  test("returns false for non-object", () => {
    expect(isValidContent("string")).toBe(false);
    expect(isValidContent(null)).toBe(false);
    expect(isValidContent(undefined)).toBe(false);
  });

  test("returns false for doc without content array", () => {
    expect(isValidContent({ type: "doc" })).toBe(false);
  });
});

describe("parseJsonContent", () => {
  test("parses valid JSON string", () => {
    const raw = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    const result = parseJsonContent(raw);
    expect(result.type).toBe("doc");
  });

  test("returns EMPTY_DOC for empty input", () => {
    expect(parseJsonContent("")).toEqual(EMPTY_DOC);
    expect(parseJsonContent(null)).toEqual(EMPTY_DOC);
    expect(parseJsonContent(undefined)).toEqual(EMPTY_DOC);
  });
});

describe("schema mirror", () => {
  // Guard for the note-schema/markdownSchema contract: a node or mark added to
  // the note schema without its mirror makes PMNode.fromJSON throw inside
  // json2md. Upstream's comment says that then "silently returns ''"; here it
  // raises, which is why the second test asserts content rather than emptiness.
  // This fixture must contain every type both schemas share.
  const fixture: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Titre" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "gras", marks: [{ type: "bold" }] },
          { type: "text", text: " italique", marks: [{ type: "italic" }] },
          { type: "text", text: " souligné", marks: [{ type: "underline" }] },
          { type: "text", text: " barré", marks: [{ type: "strike" }] },
          { type: "text", text: " code", marks: [{ type: "code" }] },
          { type: "text", text: " surligné", marks: [{ type: "highlight" }] },
          {
            type: "text",
            text: " lien",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
          { type: "hardBreak" },
          { type: "text", text: "après le saut" },
        ],
      },
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "citation" }] },
        ],
      },
      { type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }] },
      { type: "horizontalRule" },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "un" }] },
            ],
          },
        ],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "deux" }] },
            ],
          },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "h" }] },
                ],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "c" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  test("note schema loads the full fixture", () => {
    expect(() => PMNode.fromJSON(noteSchema, fixture)).not.toThrow();
  });

  test("json2md produces non-empty output for the full fixture", () => {
    const md = json2md(fixture);
    expect(md.trim().length).toBeGreaterThan(0);
    for (const text of ["Titre", "gras", "citation", "const x = 1;", "deux"]) {
      expect(md).toContain(text);
    }
  });
});
