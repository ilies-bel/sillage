/**
 * Ported from `vendor/anarlog-editor/src/note/keymap.ts` (fastrepl/anarlog, MIT).
 * See `src/editor/README.md` for what was dropped from it and why.
 */
import {
  chainCommands,
  createParagraphNear,
  deleteSelection,
  joinBackward,
  joinForward,
  lift,
  liftEmptyBlock,
  newlineInCode,
  selectAll,
  selectNodeBackward,
  selectNodeForward,
  setBlockType,
  splitBlock,
  toggleMark,
  wrapIn,
} from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { Fragment, type MarkType, type NodeType } from "prosemirror-model";
import {
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from "prosemirror-schema-list";
import { TextSelection, type Command, type EditorState } from "prosemirror-state";

import { schema } from "./schema";

// Upstream returned the *name* of the enclosing item because it had two of
// them, `listItem` and `taskItem`. The task model is not ported, so the answer
// is a yes/no and every caller can name `listItem` directly.
function isInListItem(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "listItem") return true;
  }
  return false;
}

function moveListItem(direction: "up" | "down"): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;

    let depth = -1;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "listItem") {
        depth = d;
        break;
      }
    }
    if (depth === -1) return false;

    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    const atBoundary =
      direction === "up" ? index === 0 : index >= parent.childCount - 1;

    if (!atBoundary) {
      // Swap with adjacent sibling
      const siblingIndex = direction === "up" ? index - 1 : index + 1;
      const currentItem = parent.child(index);
      const siblingItem = parent.child(siblingIndex);

      if (dispatch) {
        const tr = state.tr;
        const currentStart = $from.before(depth);
        const currentEnd = $from.after(depth);

        if (direction === "up") {
          const prevStart = currentStart - siblingItem.nodeSize;
          tr.replaceWith(
            prevStart,
            currentEnd,
            Fragment.from([currentItem, siblingItem]),
          );
          const offset = prevStart - currentStart;
          tr.setSelection(
            TextSelection.create(
              tr.doc,
              state.selection.anchor + offset,
              state.selection.head + offset,
            ),
          );
        } else {
          const nextEnd = currentEnd + siblingItem.nodeSize;
          tr.replaceWith(
            currentStart,
            nextEnd,
            Fragment.from([siblingItem, currentItem]),
          );
          const offset = siblingItem.nodeSize;
          tr.setSelection(
            TextSelection.create(
              tr.doc,
              state.selection.anchor + offset,
              state.selection.head + offset,
            ),
          );
        }

        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    // At boundary: lift item into the outer (parent) list.
    // Upstream also checked that the item type matched the outer list type,
    // because a `taskItem` must not land in a bullet list. In this schema
    // `listItem` is the only item type and it is only ever contained by
    // `bulletList` or `orderedList`, so that check could not fail.
    let outerDepth = -1;
    for (let d = depth - 2; d > 0; d--) {
      if ($from.node(d).type.name === "listItem") {
        outerDepth = d;
        break;
      }
    }
    if (outerDepth === -1) return false;

    if (dispatch) {
      const tr = state.tr;
      const currentItem = parent.child(index);
      const currentStart = $from.before(depth);
      const currentEnd = $from.after(depth);
      const anchorOffset = state.selection.anchor - currentStart;

      // Delete the item, or the entire nested list when it's the only child
      if (parent.childCount === 1) {
        tr.delete($from.before(depth - 1), $from.after(depth - 1));
      } else {
        tr.delete(currentStart, currentEnd);
      }

      // Insert into the outer list: before the outer item (up) or after (down)
      const targetPos =
        direction === "up" ? $from.before(outerDepth) : $from.after(outerDepth);
      const insertPos = tr.mapping.map(targetPos);
      tr.insert(insertPos, currentItem);

      tr.setSelection(TextSelection.create(tr.doc, insertPos + anchorOffset));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// Input rules
// ---------------------------------------------------------------------------
function headingRule(nodeType: NodeType, maxLevel: number) {
  return textblockTypeInputRule(
    new RegExp(`^(#{1,${maxLevel}})\\s$`),
    nodeType,
    (match) => ({ level: match[1].length }),
  );
}

function blockquoteRule(nodeType: NodeType) {
  return wrappingInputRule(/^\s*>\s$/, nodeType);
}

function bulletListRule(nodeType: NodeType) {
  return wrappingInputRule(/^\s*([-+*])\s$/, nodeType);
}

function orderedListRule(nodeType: NodeType) {
  return wrappingInputRule(
    /^\s*(\d+)\.\s$/,
    nodeType,
    (match) => ({ start: +match[1] }),
    (match, node) => node.childCount + node.attrs.start === +match[1],
  );
}

function codeBlockRule(nodeType: NodeType) {
  return textblockTypeInputRule(/^```$/, nodeType);
}

function horizontalRuleRule() {
  return new InputRule(
    /^(?:---|___|\*\*\*)\s$/,
    (state, _match, start, end) => {
      const hr = schema.nodes.horizontalRule.create();
      return state.tr.replaceWith(start - 1, end, [
        hr,
        schema.nodes.paragraph.create(),
      ]);
    },
  );
}

function markInputRule(pattern: RegExp, markType: MarkType, delimLen: number) {
  return new InputRule(pattern, (state, match, start, end) => {
    const prefix = match[1];
    const content = match[2];
    const { tr } = state;

    const openStart = start + prefix.length;
    // The typed character that triggered this rule is the last char of
    // the closing delimiter and is NOT in the document yet.  Only the
    // remaining delimLen-1 chars need to be removed.
    const closeCharsInDoc = delimLen - 1;

    const $start = state.doc.resolve(openStart);
    if (!$start.parent.type.allowsMarkType(markType)) return null;

    if (closeCharsInDoc > 0) {
      tr.delete(end - closeCharsInDoc, end);
    }
    tr.delete(openStart, openStart + delimLen);
    tr.addMark(openStart, openStart + content.length, markType.create());
    tr.removeStoredMark(markType);

    return tr;
  });
}

function isInCodeInputContext(state: EditorState) {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.spec.code) {
      return true;
    }
  }

  return Boolean(schema.marks.code.isInSet(state.storedMarks ?? $from.marks()));
}

function textReplacementRule(pattern: RegExp, replacement: string) {
  return new InputRule(pattern, (state, _match, start, end) => {
    if (isInCodeInputContext(state)) {
      return null;
    }

    return state.tr.insertText(replacement, start, end);
  });
}

// Char-style typographic replacements. Patterns capture an optional prefix
// (kept) and the token (replaced); a third group is a kept suffix.
const SYMBOL_REPLACEMENTS: Record<string, string> = {
  "->": "→",
  "<-": "←",
  "<->": "↔",
  "==>": "⇒",
  "<==": "⇐",
  "<=>": "⇔",
  "+-": "±",
  "+/-": "±",
  "=/=": "≠",
};

const ABBREVIATION_REPLACEMENTS: Record<string, string> = {
  "(c)": "©",
  "(r)": "®",
  "(tm)": "™",
};

const FRACTION_REPLACEMENTS: Record<string, string> = {
  "c/o": "℅",
  "1/2": "½",
  "1/3": "⅓",
  "1/4": "¼",
  "1/5": "⅕",
  "1/6": "⅙",
  "1/8": "⅛",
  "2/3": "⅔",
  "2/5": "⅖",
  "3/4": "¾",
  "3/5": "⅗",
  "3/8": "⅜",
  "4/5": "⅘",
  "5/6": "⅚",
  "5/8": "⅝",
  "7/8": "⅞",
};

function mappedReplacementRule(pattern: RegExp, map: Record<string, string>) {
  return new InputRule(pattern, (state, match, start, end) => {
    if (isInCodeInputContext(state)) return null;
    const prefix = match[1] ?? "";
    const replacement = map[(match[2] ?? "").toLowerCase()];
    if (!replacement) return null;
    const suffix = match[3] ?? "";
    return state.tr.insertText(
      replacement + suffix,
      start + prefix.length,
      end,
    );
  });
}

function symbolReplacementRule() {
  return new InputRule(
    /(?:<->|==>|<==|<=>|->|<-|\+\/-|\+-|=\/=)$/,
    (state, match, start, end) => {
      if (isInCodeInputContext(state)) return null;
      const replacement = SYMBOL_REPLACEMENTS[match[0].toLowerCase()];
      if (!replacement) return null;
      return state.tr.insertText(replacement, start, end);
    },
  );
}

// The preceding character must not be a dash, so a line-start `---` survives
// long enough for horizontalRuleRule to claim it on the following space.
function dashReplacementRule() {
  return new InputRule(/([^-])--$/, (state, match, start, end) => {
    if (isInCodeInputContext(state)) return null;
    const prefix = match[1] ?? "";
    return state.tr.insertText("—", start + prefix.length, end);
  });
}

// Same semantics as prosemirror-inputrules smartQuotes/ellipsis, but guarded
// so quotes inside code stay straight.
function quoteRule(pattern: RegExp, replacement: string) {
  return new InputRule(pattern, (state, match, start, end) => {
    if (isInCodeInputContext(state)) return null;
    let insertStart = start;
    if (match.length > 1 && typeof match[1] === "string") {
      insertStart = start + match[0].lastIndexOf(match[1]);
    }
    return state.tr.insertText(replacement, insertStart, end);
  });
}

/**
 * **Wired into the shipped editor** — `Notepad.tsx`'s plugin list, which for as
 * long as this function existed was `[buildKeymap(), history(), dropCursor(),
 * gapCursor()]`. Eight green tests and no caller: typed into the live editor,
 * `# Titre` stayed a paragraph containing a hash, `- point` a paragraph
 * containing a dash, `**gras**` two pairs of asterisks, and `l'appel d'offres`
 * kept U+0027 — on the surface DEC-11 calls « why the app is open ».
 *
 * The apostrophe is the one worth naming twice: everything the app *stores*
 * carries U+2019 (`check:french` enforces it in repo prose and
 * `terms.fr-esn.ts` ships « appel d'offres » as a Whisper boost term), and
 * `history:search` folds the same way, so notes typed with the straight quote
 * were the one text in the product spelled differently from the rest of it.
 */
export function buildInputRules() {
  return inputRules({
    rules: [
      /*
       * Three levels, not six.
       *
       * `index.css` styles `h1 h2 h3` for the notepad and nothing below them,
       * and Tailwind's preflight resets every heading to the paragraph's size
       * and weight — so `#### ` produced an `h4` drawn *exactly* like the
       * paragraph it replaced: a block the rep made and could not see. Three is
       * also what a page of call notes needs. `#### ` now simply stays the four
       * characters that were typed, which is the honest outcome of a vocabulary
       * that stops at three. Pasted documents can still carry h4–h6 — the schema
       * parses them and the CSS draws them, see the note beside it there.
       */
      headingRule(schema.nodes.heading, 3),
      blockquoteRule(schema.nodes.blockquote),
      bulletListRule(schema.nodes.bulletList),
      orderedListRule(schema.nodes.orderedList),
      codeBlockRule(schema.nodes.codeBlock),
      horizontalRuleRule(),
      symbolReplacementRule(),
      dashReplacementRule(),
      mappedReplacementRule(
        /(^|[\s([{])(\((?:c|r|tm)\))$/i,
        ABBREVIATION_REPLACEMENTS,
      ),
      mappedReplacementRule(
        /(^|[\s([{])((?:c\/o|1\/2|1\/3|1\/4|1\/5|1\/6|1\/8|2\/3|2\/5|3\/4|3\/5|3\/8|4\/5|5\/6|5\/8|7\/8))([\s.,;:!?])$/i,
        FRACTION_REPLACEMENTS,
      ),
      quoteRule(/(?:^|[\s{[(<'"‘“])(")$/, "“"),
      quoteRule(/"$/, "”"),
      quoteRule(/(?:^|[\s{[(<'"‘“])(')$/, "‘"),
      quoteRule(/'$/, "’"),
      textReplacementRule(/\.\.\.$/, "…"),
      markInputRule(/(^|[^*])\*\*([^*]+)\*\*$/, schema.marks.bold, 2),
      markInputRule(/(^|[^~])~~([^~]+)~~$/, schema.marks.strike, 2),
      markInputRule(/(^|[^=])==([^=]+)==$/, schema.marks.highlight, 2),
      markInputRule(/(^|[^*])\*([^*]+)\*$/, schema.marks.italic, 1),
      markInputRule(/(^|[^_])_([^_]+)_$/, schema.marks.italic, 1),
      markInputRule(/(^|[^~])~([^~]+)~$/, schema.marks.strike, 1),
    ],
  });
}

// ---------------------------------------------------------------------------
// The block vocabulary, from the keyboard
// ---------------------------------------------------------------------------

/**
 * A press that makes the block it names, and unmakes it on a second press.
 *
 * One key both ways, deliberately: the rep who turned a line into a heading by
 * mistake reaches for the same keystroke to put it back, and a separate « annuler
 * le titre » key is one more thing to have been told about. *Texte normal* is
 * still in the table, because that is the press a rep uses when they do not
 * remember which block they are standing in.
 */
const toggleHeading = (level: number): Command => {
  const heading = schema.nodes.heading;
  return (state, dispatch, view) => {
    const { $from } = state.selection;
    const already = $from.parent.type === heading && $from.parent.attrs.level === level;
    return already
      ? setBlockType(schema.nodes.paragraph)(state, dispatch, view)
      : setBlockType(heading, { level })(state, dispatch, view);
  };
};

const toggleList = (listType: NodeType): Command => (state, dispatch, view) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === listType) {
      return liftListItem(schema.nodes.listItem)(state, dispatch, view);
    }
    /*
     * The same list, the other marker.
     *
     * `wrapInList` on a bullet list asked for numbers builds a numbered list
     * *inside* the bullet — one item, indented, under a bullet nobody asked
     * for. What the rep asked for is these lines, numbered, so the list node
     * changes type and the items stay where they are.
     */
    if (node.type === schema.nodes.bulletList || node.type === schema.nodes.orderedList) {
      if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(depth), listType));
      return true;
    }
  }
  return wrapInList(listType)(state, dispatch, view);
};

const toggleBlockquote: Command = (state, dispatch, view) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === schema.nodes.blockquote) return lift(state, dispatch);
  }
  return wrapIn(schema.nodes.blockquote)(state, dispatch, view);
};

/** One row of what the keymap binds and of what Réglages prints. */
export interface NoteShortcut {
  /** The combination as prosemirror-keymap spells it, without its modifier. */
  combo: string;
  /** The combination as a rep reads it. `Ctrl` and `⌘` both work. */
  keys: string;
  label: string;
  command: Command;
}

/**
 * **The block vocabulary the CSS already drew and the keyboard could not reach.**
 *
 * `index.css` styles `h1 h2 h3 ul ol blockquote pre code hr table th td` for the
 * notepad. Before the input rules were wired and this table existed, *every*
 * `keys[…]` below was undo/redo, a mark, Enter, Backspace, Tab or an arrow —
 * there was no way to make a single one of those blocks, and `Tab`/`Shift-Tab`
 * sank and lifted list items that could not be created. There is no toolbar and
 * there must not be one: HR-10 forbids modal chrome and VISION.md §6 asks for
 * keyboard-first.
 *
 * **The combinations are prosemirror-example-setup's** (`Shift-Mod-1…3`,
 * `Shift-Mod-8`, `Shift-Mod-9`, `Shift-Mod-0`), which is the set a rep who has
 * used any raw-ProseMirror editor already has in their hands, and — measured on
 * the layout these reps actually type on — the one set that survives an AZERTY
 * keyboard. `Ctrl-Alt-<digit>` is the other convention (Word, Google Docs) and
 * it is **AltGr** on a French layout: `Ctrl-Alt-3` is how a rep types `#`, and
 * `#` is the heading trigger of the input rule above. A shortcut that eats the
 * character it is a shortcut *for* is worse than no shortcut.
 *
 * A code block has no row: ``` makes one, and `Shift-Mod-\` — example-setup's
 * key for it — is `AltGr-8` on AZERTY, the same trap. A horizontal rule has no
 * row either; `---` makes one. Both are named in Réglages' lede beside the typed
 * rules, which is where a rep looks for them.
 */
export const NOTE_SHORTCUTS: readonly NoteShortcut[] = [
  { combo: "Shift-1", keys: "Ctrl/⌘ Maj 1", label: "Titre", command: toggleHeading(1) },
  { combo: "Shift-2", keys: "Ctrl/⌘ Maj 2", label: "Sous-titre", command: toggleHeading(2) },
  {
    combo: "Shift-3",
    keys: "Ctrl/⌘ Maj 3",
    label: "Sous-sous-titre",
    command: toggleHeading(3),
  },
  {
    combo: "Shift-0",
    keys: "Ctrl/⌘ Maj 0",
    label: "Texte normal",
    command: setBlockType(schema.nodes.paragraph),
  },
  {
    combo: "Shift-8",
    keys: "Ctrl/⌘ Maj 8",
    label: "Liste à puces",
    command: toggleList(schema.nodes.bulletList),
  },
  {
    combo: "Shift-7",
    keys: "Ctrl/⌘ Maj 7",
    label: "Liste numérotée",
    command: toggleList(schema.nodes.orderedList),
  },
  {
    combo: "Shift-9",
    keys: "Ctrl/⌘ Maj 9",
    label: "Citation",
    command: toggleBlockquote,
  },
];

// ---------------------------------------------------------------------------
// Keymaps
// ---------------------------------------------------------------------------

/**
 * **Both modifiers, never a platform test — where accepting both costs nothing.**
 *
 * `app/shortcuts.ts` states the rule and its justification in one breath: « no
 * shortcut here collides with a browser or OS binding on either platform, so
 * accepting both costs nothing ». Inside a `contenteditable` on macOS that
 * premise holds for `Ctrl`+digit and fails for `Ctrl`+letter, because Blink
 * ships the Cocoa text bindings there — `Ctrl-A` is « start of line », `Ctrl-E`
 * « end of line », `Ctrl-D` « delete forward ». Binding `Ctrl-A` to *select all*
 * on top of one of them would mean a rep pressing what they have pressed for
 * twenty years selects their whole page of notes, and the next character they
 * type replaces it.
 *
 * So the digit combinations below are bound twice, and the letters keep `Mod-`,
 * which is one token resolved by the library rather than a branch in this file.
 * What is gone is `navigator.platform`: it decided whether `Mod-y` was redo and
 * whether eight Cocoa keys were re-declared here, and it is the mac-first
 * mistake HR-2 is about — read on the machine this is written on, never on the
 * Windows laptops this ships to (`check-platform.mjs` exists for it).
 */
const bind = (keys: Record<string, Command>, combo: string, command: Command): void => {
  keys[`Ctrl-${combo}`] = command;
  keys[`Meta-${combo}`] = command;
};

export function buildKeymap() {
  const keys: Record<string, Command> = {};

  keys["Mod-z"] = undo;
  keys["Mod-Shift-z"] = redo;
  /*
   * Unconditional now. It was `if (!mac)`, and the branch bought nothing: `⌘ Y`
   * is not a text binding on macOS — it is Cocoa's « show history », which an
   * Electron window with no such menu never receives — while `Ctrl Y` is redo on
   * Windows, the primary platform.
   */
  keys["Mod-y"] = redo;

  keys["Mod-b"] = toggleMark(schema.marks.bold);
  keys["Mod-i"] = toggleMark(schema.marks.italic);
  keys["Mod-u"] = toggleMark(schema.marks.underline);
  keys["Mod-`"] = toggleMark(schema.marks.code);

  for (const shortcut of NOTE_SHORTCUTS) bind(keys, shortcut.combo, shortcut.command);

  const exitCodeBlockOnEmptyLine: Command = (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.type.spec.code) return false;

    const lastLine = $from.parent.textContent.split("\n").pop() ?? "";
    const atEnd = $from.parentOffset === $from.parent.content.size;
    if (!atEnd || lastLine !== "") return false;

    if (dispatch) {
      const codeBlockPos = $from.before($from.depth);
      const codeBlock = $from.parent;
      const textContent = codeBlock.textContent.replace(/\n$/, "");
      const tr = state.tr;

      tr.replaceWith(
        codeBlockPos,
        codeBlockPos + codeBlock.nodeSize,
        textContent
          ? [
              schema.nodes.codeBlock.create(null, schema.text(textContent)),
              schema.nodes.paragraph.create(),
            ]
          : [schema.nodes.paragraph.create()],
      );

      const newParaPos = textContent
        ? codeBlockPos + textContent.length + 2 + 1
        : codeBlockPos + 1;
      tr.setSelection(TextSelection.create(tr.doc, newParaPos));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };

  keys["Enter"] = chainCommands(
    exitCodeBlockOnEmptyLine,
    newlineInCode,
    (state, dispatch) => {
      if (!isInListItem(state)) return false;
      const { $from } = state.selection;
      if ($from.parent.content.size !== 0) return false;
      return liftListItem(schema.nodes.listItem)(state, dispatch);
    },
    (state, dispatch) => {
      if (!isInListItem(state)) return false;
      return splitListItem(schema.nodes.listItem)(state, dispatch);
    },
    createParagraphNear,
    liftEmptyBlock,
    splitBlock,
  );

  const revertBlockToParagraph: Command = (state, dispatch) => {
    const { $from } = state.selection;
    if (!state.selection.empty || $from.parentOffset !== 0) return false;
    const node = $from.parent;
    if (
      node.type !== schema.nodes.heading &&
      node.type !== schema.nodes.codeBlock
    ) {
      return false;
    }
    return setBlockType(schema.nodes.paragraph)(state, dispatch);
  };

  // Upstream inserted a `joinTaskItemBackward` between `revertBlockToParagraph`
  // and `joinBackward`: `taskItem` is an atom-ish node whose paragraphs
  // prosemirror-commands would not merge on its own. `listItem` needs no such
  // help — `joinBackward` merges list items correctly — so the chain is the
  // plain one again.
  const backspaceCmd: Command = chainCommands(
    /*
     * First, because an input rule fires on a *space* and the rep may have meant
     * the space. « 1. » at the start of a line is a numbered list here and a
     * date, a paragraph number or a price band in a French rep's notes; the
     * keystroke that takes it back has to be the one already under their finger.
     * `undoInputRule` answers false when no rule fired on the last transaction,
     * and when the editor has no `inputRules` plugin at all — which is what
     * keeps the unit tests below, which install the keymap alone, exercising the
     * chain underneath it.
     */
    undoInputRule,
    deleteSelection,
    (state, _dispatch) => {
      const { selection } = state;
      if (selection.$head.pos === 0 && selection.empty) return true;
      return false;
    },
    revertBlockToParagraph,
    joinBackward,
    selectNodeBackward,
  );
  keys["Backspace"] = backspaceCmd;
  keys["Mod-Backspace"] = backspaceCmd;
  keys["Shift-Backspace"] = backspaceCmd;

  const deleteCmd: Command = chainCommands(
    deleteSelection,
    joinForward,
    selectNodeForward,
  );
  keys["Delete"] = deleteCmd;
  keys["Mod-Delete"] = deleteCmd;

  keys["Mod-a"] = selectAll;

  /*
   * Upstream re-declared eight Cocoa text bindings here behind `if (mac)` —
   * `Ctrl-h`, `Ctrl-d`, `Alt-Backspace`, `Ctrl-a`, `Ctrl-e` and three more. They
   * are gone with the platform test, and nothing is lost by it: Blink ships the
   * Cocoa editing behaviour inside a `contenteditable` on macOS, so those keys do
   * on that platform exactly what they did before this file claimed them. The
   * branch could not be lifted instead of deleted — `Ctrl-a` is *select all* on
   * Windows and this file binds it, so applying the block unconditionally would
   * have broken the most-used editing key on the primary platform (HR-2).
   */

  // Prevent Tab from moving focus outside the editor
  keys["Tab"] = (state, dispatch) => {
    if (!isInListItem(state)) return true;
    return sinkListItem(schema.nodes.listItem)(state, dispatch);
  };

  /*
   * `Shift-Tab` outside a list answers false on purpose, where `Tab` answers
   * true: it is the way *out* of a `contenteditable` that traps Tab, and the
   * only one a keyboard-only rep has.
   *
   * Upstream also had a branch here, and two arrow-key handlers, that jumped to
   * a separate title field when the caret sat on the first line. Both hung off an
   * `onNavigateToTitle` callback that no caller in this product passed — and
   * there is nothing for it to reach: a meeting's title is the calendar's objet,
   * drawn in the session header, and this document has no title line
   * (`note/title-layout.ts`, which forced one, is deleted for the same reason).
   * A parameter no caller passes is a feature that silently does not happen.
   */
  keys["Shift-Tab"] = (state, dispatch) => {
    if (!isInListItem(state)) return false;
    return liftListItem(schema.nodes.listItem)(state, dispatch);
  };

  keys["Alt-ArrowUp"] = moveListItem("up");
  keys["Alt-ArrowDown"] = moveListItem("down");

  return keymap(keys);
}
