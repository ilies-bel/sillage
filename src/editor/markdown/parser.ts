/**
 * Ported from `vendor/anarlog-editor/src/markdown/parser.ts` (fastrepl/anarlog, MIT).
 * See `src/editor/README.md` for what was dropped from it and why.
 */
import MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import { MarkdownParser } from "prosemirror-markdown";

import { markdownSchema } from "./schema";

// ---------------------------------------------------------------------------

function strikethroughPlugin(md: MarkdownIt) {
  md.inline.ruler.before(
    "emphasis",
    "strikethrough",
    (state: StateInline, silent: boolean) => {
      const start = state.pos;
      const marker = state.src.charCodeAt(start);
      if (marker !== 0x7e /* ~ */) return false;
      if (state.src.charCodeAt(start + 1) !== 0x7e) return false;

      const match = state.src.slice(start).match(/^~~([\s\S]+?)~~/);
      if (!match) return false;

      if (!silent) {
        const token = state.push("s_open", "s", 1);
        token.markup = "~~";

        const content = state.push("text", "", 0);
        content.content = match[1];

        const close = state.push("s_close", "s", -1);
        close.markup = "~~";
      }

      state.pos += match[0].length;
      return true;
    },
  );
}

function underlinePlugin(md: MarkdownIt) {
  md.inline.ruler.before(
    "emphasis",
    "underline",
    (state: StateInline, silent: boolean) => {
      const start = state.pos;
      const src = state.src.slice(start);

      // ++text++ syntax
      if (
        state.src.charCodeAt(start) === 0x2b /* + */ &&
        state.src.charCodeAt(start + 1) === 0x2b
      ) {
        const match = src.match(/^\+\+([\s\S]+?)\+\+/);
        if (match) {
          if (!silent) {
            const open = state.push("underline_open", "u", 1);
            open.markup = "++";
            const text = state.push("text", "", 0);
            text.content = match[1];
            const close = state.push("underline_close", "u", -1);
            close.markup = "++";
          }
          state.pos += match[0].length;
          return true;
        }
      }

      // <u>text</u> syntax
      if (state.src.charCodeAt(start) === 0x3c /* < */) {
        const match = src.match(/^<u>([\s\S]+?)<\/u>/);
        if (match) {
          if (!silent) {
            const open = state.push("underline_open", "u", 1);
            open.markup = "<u>";
            const text = state.push("text", "", 0);
            text.content = match[1];
            const close = state.push("underline_close", "u", -1);
            close.markup = "</u>";
          }
          state.pos += match[0].length;
          return true;
        }
      }

      return false;
    },
  );
}

function highlightPlugin(md: MarkdownIt) {
  md.inline.ruler.before(
    "emphasis",
    "highlight",
    (state: StateInline, silent: boolean) => {
      const start = state.pos;
      if (
        state.src.charCodeAt(start) !== 0x3d /* = */ ||
        state.src.charCodeAt(start + 1) !== 0x3d
      ) {
        return false;
      }

      const match = state.src.slice(start).match(/^==([\s\S]+?)==/);
      if (!match) return false;

      if (!silent) {
        const open = state.push("highlight_open", "mark", 1);
        open.markup = "==";
        const text = state.push("text", "", 0);
        text.content = match[1];
        const close = state.push("highlight_close", "mark", -1);
        close.markup = "==";
      }

      state.pos += match[0].length;
      return true;
    },
  );
}

function hardBreakTagPlugin(md: MarkdownIt) {
  md.inline.ruler.before(
    "html_inline",
    "hardbreak_tag",
    (state: StateInline, silent: boolean) => {
      const match = state.src.slice(state.pos).match(/^<br\s*\/?>/i);
      if (!match) return false;

      if (!silent) {
        const token = state.push("hardbreak", "br", 0);
        token.markup = match[0];
      }

      state.pos += match[0].length;
      return true;
    },
  );
}

function tableCellParagraphsPlugin(md: MarkdownIt) {
  md.core.ruler.after("inline", "table_cell_paragraphs", (state) => {
    const tokens = state.tokens;
    const out: Token[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const prev = tokens[i - 1];
      const next = tokens[i + 1];

      if (
        token.type === "inline" &&
        (prev?.type === "th_open" || prev?.type === "td_open") &&
        (next?.type === "th_close" || next?.type === "td_close")
      ) {
        const open = new state.Token("paragraph_open", "p", 1);
        open.level = token.level;
        const inline = new state.Token("inline", "", 0);
        Object.assign(inline, token);
        inline.level = token.level + 1;
        const close = new state.Token("paragraph_close", "p", -1);
        close.level = token.level;

        out.push(open, inline, close);
      } else {
        out.push(token);
      }
    }

    state.tokens = out;
  });
}

// Markdown collapses consecutive blank lines, so empty paragraphs would be lost
// on roundtrip. We use the line maps that markdown-it attaches to top-level
// block tokens to detect blank lines (leading, trailing, and between blocks)
// and emit explicit empty paragraph tokens.
function emptyParagraphsPlugin(md: MarkdownIt) {
  md.core.ruler.after("block", "empty_paragraphs", (state) => {
    const tokens = state.tokens;
    const out: Token[] = [];
    const totalLines = countLines(state.src);

    const pushEmpty = () => {
      out.push(
        new state.Token("paragraph_open", "p", 1),
        new state.Token("paragraph_close", "p", -1),
      );
    };

    let prevEndLine = -1;
    for (const token of tokens) {
      const isTopLevelBlockOpen =
        token.level === 0 && token.nesting >= 0 && token.map !== null;

      if (isTopLevelBlockOpen) {
        // Leading: the entire gap before the first block is empty paragraphs.
        // Between blocks: one blank line is normal separation; the rest are
        // empty paragraphs.
        const extras =
          prevEndLine === -1 ? token.map![0] : token.map![0] - prevEndLine - 1;
        for (let i = 0; i < extras; i++) pushEmpty();
      }

      out.push(token);

      if (isTopLevelBlockOpen) {
        prevEndLine = token.map![1];
      }
    }

    if (prevEndLine === -1) {
      // No blocks at all — every line plus the implicit "current" line is an
      // empty paragraph. Empty input still produces one empty paragraph, which
      // matches the editor's default "blank document" state.
      for (let i = 0; i <= totalLines; i++) pushEmpty();
    } else if (totalLines > prevEndLine) {
      const trailing = totalLines - prevEndLine;
      for (let i = 0; i < trailing; i++) pushEmpty();
    }

    state.tokens = out;
  });
}

function countLines(src: string): number {
  if (src === "") return 0;
  const newlines = (src.match(/\n/g) || []).length;
  return newlines + (src.endsWith("\n") ? 0 : 1);
}

// ---------------------------------------------------------------------------

let _parser: MarkdownParser | null = null;

export function getParser(): MarkdownParser {
  if (_parser) return _parser;

  const md = MarkdownIt("commonmark", { html: false });

  md.use(strikethroughPlugin);
  md.use(underlinePlugin);
  md.use(highlightPlugin);
  md.use(hardBreakTagPlugin);
  md.enable("table");
  // There is no image node in this schema, and MarkdownParser throws on any
  // token it has no spec for. Turning the rule off keeps `![alt](url)` as
  // ordinary text and a link rather than losing the URL or the whole document.
  md.disable("image");
  md.use(tableCellParagraphsPlugin);
  md.use(emptyParagraphsPlugin);

  _parser = new MarkdownParser(markdownSchema, md, {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "listItem" },
    bullet_list: { block: "bulletList" },
    ordered_list: {
      block: "orderedList",
      getAttrs: (tok) => ({ start: +tok.attrGet("start")! || 1 }),
    },
    heading: {
      block: "heading",
      getAttrs: (tok) => ({ level: +tok.tag.slice(1) }),
    },
    code_block: { block: "codeBlock", noCloseToken: true },
    fence: {
      block: "codeBlock",
      getAttrs: (tok) => ({ language: tok.info || "" }),
      noCloseToken: true,
    },
    hr: { node: "horizontalRule" },
    hardbreak: { node: "hardBreak" },
    table: { block: "table" },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: "tableRow" },
    th: { block: "tableHeader" },
    td: { block: "tableCell" },

    em: { mark: "italic" },
    strong: { mark: "bold" },
    s: { mark: "strike" },
    link: {
      mark: "link",
      getAttrs: (tok) => ({
        href: tok.attrGet("href"),
        target: tok.attrGet("target"),
      }),
    },
    code_inline: { mark: "code", noCloseToken: true },

    underline: { mark: "underline" },
    highlight: { mark: "highlight" },
  });

  return _parser;
}
