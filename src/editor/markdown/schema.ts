/**
 * Ported from `vendor/anarlog-editor/src/markdown/schema.ts` (fastrepl/anarlog, MIT).
 *
 * The markdown mirror of `note/schema.ts`. It exists separately because
 * markdown parsing needs one attribute the note document does not carry
 * (`codeBlock.language`), and because prosemirror-markdown wants a schema it
 * owns. Every node and mark here must have a counterpart in the note schema —
 * see the "schema mirror" tests in `../markdown.test.ts`.
 *
 * See `src/editor/README.md` for what was dropped from it and why.
 */
import {
  type MarkSpec,
  type NodeSpec,
  Node as PMNode,
  Schema,
} from "prosemirror-model";

// ---------------------------------------------------------------------------

const tableCellAttrs = {
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
};

function getTableCellAttrs(dom: Node | string) {
  if (typeof dom === "string") return {};
  const element = dom as HTMLElement;
  const widthAttr = element.getAttribute("data-colwidth");
  const widths =
    widthAttr && /^\d+(,\d+)*$/.test(widthAttr)
      ? widthAttr.split(",").map((value) => Number(value))
      : null;
  const colspan = Number(element.getAttribute("colspan") || 1);

  return {
    colspan,
    rowspan: Number(element.getAttribute("rowspan") || 1),
    colwidth: widths && widths.length === colspan ? widths : null,
  };
}

function setTableCellAttrs(node: PMNode) {
  const attrs: Record<string, string | number> = {};
  if (node.attrs.colspan !== 1) attrs.colspan = node.attrs.colspan;
  if (node.attrs.rowspan !== 1) attrs.rowspan = node.attrs.rowspan;
  if (node.attrs.colwidth)
    attrs["data-colwidth"] = node.attrs.colwidth.join(",");
  return attrs;
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },

  paragraph: {
    content: "inline*",
    group: "block",
    parseDOM: [{ tag: "p" }],
    toDOM() {
      return ["p", 0];
    },
  },

  text: { group: "inline" },

  heading: {
    content: "inline*",
    group: "block",
    attrs: { level: { default: 1 } },
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    })),
    toDOM(node) {
      return [`h${node.attrs.level}`, 0];
    },
  },

  blockquote: {
    content: "block+",
    group: "block",
    defining: true,
    parseDOM: [{ tag: "blockquote" }],
    toDOM() {
      return ["blockquote", 0];
    },
  },

  codeBlock: {
    content: "text*",
    marks: "",
    group: "block",
    code: true,
    defining: true,
    attrs: { language: { default: "" } },
    parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    toDOM() {
      return ["pre", ["code", 0]];
    },
  },

  horizontalRule: {
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM() {
      return ["hr"];
    },
  },

  hardBreak: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM() {
      return ["br"];
    },
  },

  bulletList: {
    content: "listItem+",
    group: "block",
    parseDOM: [{ tag: "ul" }],
    toDOM() {
      return ["ul", 0];
    },
  },

  orderedList: {
    content: "listItem+",
    group: "block",
    attrs: { start: { default: 1 } },
    parseDOM: [
      {
        tag: "ol",
        getAttrs(dom) {
          const el = dom as HTMLElement;
          return {
            start: el.hasAttribute("start") ? +el.getAttribute("start")! : 1,
          };
        },
      },
    ],
    toDOM(node) {
      return node.attrs.start === 1
        ? ["ol", 0]
        : ["ol", { start: node.attrs.start }, 0];
    },
  },

  listItem: {
    content: "paragraph block*",
    defining: true,
    parseDOM: [{ tag: "li" }],
    toDOM() {
      return ["li", 0];
    },
  },

  table: {
    content: "tableRow+",
    group: "block",
    isolating: true,
    tableRole: "table",
    parseDOM: [{ tag: "table" }],
    toDOM() {
      return ["table", ["tbody", 0]];
    },
  },

  tableRow: {
    content: "(tableCell | tableHeader)*",
    tableRole: "row",
    parseDOM: [{ tag: "tr" }],
    toDOM() {
      return ["tr", 0];
    },
  },

  tableCell: {
    content: "block+",
    attrs: tableCellAttrs,
    isolating: true,
    tableRole: "cell",
    parseDOM: [{ tag: "td", getAttrs: getTableCellAttrs }],
    toDOM(node) {
      return ["td", setTableCellAttrs(node), 0];
    },
  },

  tableHeader: {
    content: "block+",
    attrs: tableCellAttrs,
    isolating: true,
    tableRole: "header_cell",
    parseDOM: [{ tag: "th", getAttrs: getTableCellAttrs }],
    toDOM(node) {
      return ["th", setTableCellAttrs(node), 0];
    },
  },
};

const marks: Record<string, MarkSpec> = {
  bold: {
    parseDOM: [{ tag: "strong" }, { tag: "b" }],
    toDOM() {
      return ["strong", 0];
    },
  },

  italic: {
    parseDOM: [{ tag: "em" }, { tag: "i" }],
    toDOM() {
      return ["em", 0];
    },
  },

  underline: {
    parseDOM: [{ tag: "u" }],
    toDOM() {
      return ["u", 0];
    },
  },

  strike: {
    parseDOM: [{ tag: "s" }, { tag: "del" }],
    toDOM() {
      return ["s", 0];
    },
  },

  code: {
    excludes: "_",
    parseDOM: [{ tag: "code" }],
    toDOM() {
      return ["code", 0];
    },
  },

  link: {
    attrs: {
      href: {},
      target: { default: null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs(dom) {
          return {
            href: (dom as HTMLElement).getAttribute("href"),
            target: (dom as HTMLElement).getAttribute("target"),
          };
        },
      },
    ],
    toDOM(node) {
      return ["a", { href: node.attrs.href, target: node.attrs.target }, 0];
    },
  },

  highlight: {
    parseDOM: [{ tag: "mark" }],
    toDOM() {
      return ["mark", 0];
    },
  },
};

export const markdownSchema = new Schema({ nodes, marks });
