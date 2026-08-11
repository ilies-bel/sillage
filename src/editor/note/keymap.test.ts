/**
 * Ported from `vendor/anarlog-editor/src/note/keymap.test.ts` (fastrepl/anarlog, MIT).
 *
 * The task-list cases are gone with the task nodes. The list-item cases below
 * are new: upstream never had to assert them because `taskItem` shadowed the
 * `listItem` path in Enter, Backspace and Tab. Dropping the shadow is only safe
 * if the path underneath is exercised.
 */
import {
  EditorState,
  Selection,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { describe, expect, it } from "vitest";

import { buildInputRules, buildKeymap } from "./keymap";
import { schema } from "./schema";

describe("buildInputRules", () => {
  it("replaces typed arrow shorthand with an arrow symbol", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("-")]),
    ]);
    const { handled, state } = runTextInput(doc, ">");

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "→" }],
        },
      ],
    });
  });

  it("replaces a double dash after a word with an em dash", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("wait-")]),
    ]);
    const { handled, state } = runTextInput(doc, "-");

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "wait—" }],
        },
      ],
    });
  });

  it("leaves a third dash alone so --- can still become a horizontal rule", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("--")]),
    ]);
    const { handled, state } = runTextInput(doc, "-");

    expect(handled).toBeFalsy();
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "--" }],
        },
      ],
    });
  });

  it("turns --- followed by a space into a horizontal rule", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("---")]),
    ]);
    const { handled, state } = runTextInput(doc, " ");

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [{ type: "horizontalRule" }, { type: "paragraph" }],
    });
  });

  it("replaces typed copyright shorthand with a copyright symbol", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("(c")]),
    ]);
    const { handled, state } = runTextInput(doc, ")");

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "©" }],
        },
      ],
    });
  });

  it("keeps replacement shorthands literal in code blocks", () => {
    const doc = schema.node("doc", null, [
      schema.node("codeBlock", null, [schema.text("-")]),
    ]);
    const { handled, state } = runTextInput(doc, ">");

    expect(handled).not.toBe(true);
    expect(state.doc.toJSON()).toEqual(doc.toJSON());
  });

  it("turns a dash followed by a space into a bullet list", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("-")]),
    ]);
    const { handled, state } = runTextInput(doc, " ");

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        },
      ],
    });
  });

  // The task-list rule is gone, so `[]` is now just two characters. Asserting
  // it stays that way is the only guard against the rule creeping back in.
  it("leaves a typed checkbox as literal text", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("[]")]),
    ]);
    const { handled, state } = runTextInput(doc, " ");

    expect(handled).not.toBe(true);
    expect(state.doc.toJSON()).toEqual(doc.toJSON());
  });
});

describe("buildKeymap", () => {
  it("does not handle Shift+Enter as a hard break shortcut", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello")]),
    ]);
    const { handled, state } = runKeyDownAtEnd(doc, "Enter", {
      shiftKey: true,
    });

    expect(handled).not.toBe(true);
    expect(state.doc.toJSON()).toEqual(doc.toJSON());
  });

  // Upstream's `joinTaskItemBackward` merged the two paragraphs' *text* in one
  // keystroke, because prosemirror-commands would not join two `taskItem`s on
  // its own. `listItem`s it does join: the first Backspace collapses the two
  // items into one holding two paragraphs, and the second merges those — which
  // is the case the next test covers. Two keystrokes, not one, and that is
  // stock ProseMirror behaviour rather than something the port lost.
  it("joins adjacent list items on Backspace", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("one")]),
        ]),
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("two")]),
        ]),
      ]),
    ]);
    // `joinBackward` asks the view whether the cursor really is at the visual
    // start of the textblock; upstream's task-item command never did, which is
    // why its equivalent test did not need this flag.
    const { state } = runBackspaceAtTextStart(doc, "two", true);

    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "one" }],
                },
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "two" }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("joins later list item paragraphs within the same list item", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("one")]),
        ]),
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("two")]),
          schema.node("paragraph", null, [schema.text("three")]),
        ]),
      ]),
    ]);
    const { state } = runBackspaceAtTextStart(doc, "three", true);

    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "one" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "twothree" }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("lifts an empty list item out of the list on Enter", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("one")]),
        ]),
        schema.node("listItem", null, [schema.node("paragraph")]),
      ]),
    ]);
    const { handled, state } = runKeyDownAtEnd(doc, "Enter");

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
              ],
            },
          ],
        },
        { type: "paragraph" },
      ],
    });
  });

  it("splits a non-empty list item on Enter", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("one")]),
        ]),
      ]),
    ]);
    const { handled, state } = runKeyDownAtEnd(doc, "Enter");

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
              ],
            },
            { type: "listItem", content: [{ type: "paragraph" }] },
          ],
        },
      ],
    });
  });

  it("sinks a list item on Tab", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("one")]),
        ]),
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("two")]),
        ]),
      ]),
    ]);
    const { handled, state } = runKeyDownAtEnd(doc, "Tab");

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "two" }],
                        },
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
  });

  it("lifts a nested list item on Shift-Tab", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("one")]),
          schema.node("bulletList", null, [
            schema.node("listItem", null, [
              schema.node("paragraph", null, [schema.text("two")]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const { handled, state } = runKeyDownAtEnd(doc, "Tab", { shiftKey: true });

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "two" }] },
              ],
            },
          ],
        },
      ],
    });
  });

  it("swaps a list item with its previous sibling on Alt-ArrowUp", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("one")]),
        ]),
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("two")]),
        ]),
      ]),
    ]);
    const { handled, state } = runKeyDownAtEnd(doc, "ArrowUp", { altKey: true });

    expect(handled).toBe(true);
    expect(state.doc.toJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "two" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
              ],
            },
          ],
        },
      ],
    });
  });
});

function runKeyDownAtEnd(
  doc: ReturnType<typeof schema.node>,
  key: string,
  init?: KeyboardEventInit,
) {
  const keymap = buildKeymap();
  let state = EditorState.create({
    schema,
    doc,
    selection: Selection.atEnd(doc),
    plugins: [keymap],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
    endOfTextblock: () => false,
  } as Pick<EditorView, "dispatch" | "endOfTextblock" | "state"> as EditorView;
  const handleKeyDown = keymap.props.handleKeyDown;

  const handled = handleKeyDown?.call(
    keymap,
    view,
    new KeyboardEvent("keydown", {
      key,
      ...init,
    }),
  );

  return { handled, state };
}

function runBackspaceAtTextStart(
  doc: ReturnType<typeof schema.node>,
  text: string,
  isEndOfTextblock = false,
) {
  const keymap = buildKeymap();
  const textPos = getTextStartPos(doc, text);
  let state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, textPos),
    plugins: [keymap],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
    endOfTextblock: () => isEndOfTextblock,
  } as Pick<EditorView, "dispatch" | "endOfTextblock" | "state"> as EditorView;
  const handleKeyDown = keymap.props.handleKeyDown;

  const handled = handleKeyDown?.call(
    keymap,
    view,
    new KeyboardEvent("keydown", { key: "Backspace" }),
  );

  expect(handled).toBe(true);
  return { state };
}

function runTextInput(doc: ReturnType<typeof schema.node>, text: string) {
  const inputRules = buildInputRules();
  let state = EditorState.create({
    schema,
    doc,
    selection: Selection.atEnd(doc),
    plugins: [inputRules],
  });

  const view = {
    composing: false,
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
  } as Pick<EditorView, "composing" | "dispatch" | "state"> as EditorView;

  const handleTextInput = inputRules.props.handleTextInput as
    | ((
        view: EditorView,
        from: number,
        to: number,
        text: string,
        deflt: () => Transaction,
      ) => boolean | void)
    | undefined;

  const handled = handleTextInput?.(
    view,
    state.selection.from,
    state.selection.to,
    text,
    () => state.tr.insertText(text, state.selection.from, state.selection.to),
  );

  return { handled, state };
}

function getTextStartPos(doc: ReturnType<typeof schema.node>, text: string) {
  let textPos = -1;

  doc.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      textPos = pos;
      return false;
    }

    return undefined;
  });

  if (textPos === -1) {
    throw new Error(`Missing text node: ${text}`);
  }

  return textPos;
}
