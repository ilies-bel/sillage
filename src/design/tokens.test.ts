/**
 * VISION.md §6 is the specification for the palette. `tokens.css` is its only
 * transcription. This test is what keeps the two the same file in two places
 * rather than two files that used to agree.
 *
 * Palette drift is the quietest kind of design rot: nobody notices one hex
 * becoming its neighbour, and by the time someone does, the spec and the
 * product disagree with no record of which one moved.
 *
 * The second half of this file applies DEC-21 to the palette itself: confidence
 * is measured, not self-reported. Every contrast ratio written in a comment is
 * recomputed here from the WCAG 2.x formula, so a comment that has gone stale
 * fails the suite — which matters more than the number being right in the first
 * place, because an unverified ratio beside a colour reads exactly like a
 * verified one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** `--name: value;` → Map, ignoring comments and `var()` aliases. */
const declarations = (css: string): Map<string, string> => {
  const found = new Map<string, string>();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found.set(name, value.trim().replace(/\s*\/\*.*?\*\/\s*$/, "").trim());
  }
  return found;
};

/** The single ```css block in VISION.md §6. */
const visionPalette = (): Map<string, string> => {
  const vision = read("../../VISION.md");
  const section = vision.slice(vision.indexOf("### Visual language"));
  const block = /```css\n([\s\S]*?)```/.exec(section);
  expect(block, "VISION.md §6 must still hold a ```css palette block").toBeTruthy();
  return declarations(block![1]);
};

describe("the palette matches VISION.md §6", () => {
  const spec = visionPalette();
  const tokens = declarations(read("./tokens.css"));

  test("VISION.md still specifies a palette worth checking against", () => {
    // Guards the parser above: a refactor of VISION.md that moves the block
    // would otherwise make this whole suite pass by comparing nothing.
    expect(spec.size).toBeGreaterThanOrEqual(16);
  });

  test.each([...spec])("%s is %s", (name, value) => {
    expect(tokens.get(name)).toBe(value);
  });

  test("every colour the product uses is one VISION.md names", () => {
    // The other direction. An extra `--brand-blue` invented in tokens.css and
    // never argued for in VISION.md is exactly how a palette becomes 40 colours.
    const invented = [...tokens]
      .filter(([, value]) => /^#[0-9a-f]{3,8}$/i.test(value))
      .map(([name]) => name)
      .filter((name) => !spec.has(name));

    expect(invented).toEqual([]);
  });
});

describe("the rules VISION.md §6 states in prose", () => {
  const tokens = declarations(read("./tokens.css"));

  test("radius stays in the 10–14px band", () => {
    for (const name of ["--radius-sm", "--radius", "--radius-lg"]) {
      const px = Number.parseInt(tokens.get(name) ?? "", 10);
      expect(px, name).toBeGreaterThanOrEqual(10);
      expect(px, name).toBeLessThanOrEqual(14);
    }
  });

  test("motion stays at or under 150ms", () => {
    for (const name of ["--motion", "--motion-fast"]) {
      const ms = Number.parseInt(tokens.get(name) ?? "", 10);
      expect(ms, name).toBeLessThanOrEqual(150);
    }
  });

  test("provenance aliases point at the two tokens DEC-5 names", () => {
    // Rep text `--text-strong`, agent text `--text-muted`. Colour alone, no
    // badges — so these two aliases are the entire provenance mechanism.
    expect(tokens.get("--ink-rep")).toBe("var(--text-strong)");
    expect(tokens.get("--ink-agent")).toBe("var(--text-muted)");
  });
});

// ── Measured contrast (DEC-21 applied to the palette) ───────────────────────

/** WCAG 2.x relative luminance. No dependency — it is nine lines. */
const luminance = (hex: string): number => {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex.slice(0, 7);
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio, 1–21. Order-independent. */
const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/**
 * Every ratio a comment claims, with the surface it claims it against.
 *
 * The comment has to open on the same line as the declaration it belongs to —
 * `[ \t]*`, not `\s*` — or a paragraph comment introducing the *next* group of
 * tokens would be attributed to the last token of the previous one, and the
 * check would silently start grading the wrong pair.
 *
 * Every ratio must name its surface — `N.NN:1 on #hex`. There is no default,
 * on purpose: a ratio measured against an implied background is a ratio nobody
 * can re-check, which is the failure this whole block exists to prevent.
 * `unreferenced` counts the ones that forgot, and a test below refuses them.
 */
interface Claim {
  token: string;
  value: string;
  ratio: number;
  against: string;
}

const claims = (css: string): { verifiable: Claim[]; unreferenced: string[] } => {
  const verifiable: Claim[] = [];
  const unreferenced: string[] = [];
  const declaration = /(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;[ \t]*\/\*([\s\S]*?)\*\//g;
  for (const [, token, value, comment] of css.matchAll(declaration)) {
    for (const [, ratio, against] of comment.matchAll(
      /(\d+(?:\.\d+)?):1(?:\s*on\s*(#[0-9a-fA-F]{6}))?/g,
    )) {
      if (against === undefined) unreferenced.push(`${token} — ${ratio}:1 on what?`);
      else verifiable.push({ token, value, ratio: Number(ratio), against });
    }
  }
  return { verifiable, unreferenced };
};

describe("every contrast ratio written down is a measured one", () => {
  const files = {
    "tokens.css": claims(read("./tokens.css")),
    "VISION.md §6": claims(
      (() => {
        const vision = read("../../VISION.md");
        const section = vision.slice(vision.indexOf("### Visual language"));
        return /```css\n([\s\S]*?)```/.exec(section)![1];
      })(),
    ),
  };

  for (const [where, { verifiable, unreferenced }] of Object.entries(files)) {
    test(`${where} still carries ratios worth checking`, () => {
      // Guards the parser: a reformat that stopped it matching would otherwise
      // turn this whole block into a suite that verifies nothing.
      expect(verifiable.length).toBeGreaterThanOrEqual(12);
    });

    test(`${where} states the surface every ratio was measured against`, () => {
      expect(unreferenced).toEqual([]);
    });

    for (const claim of verifiable) {
      test(`${where}: ${claim.token} is ${claim.ratio}:1 on ${claim.against}`, () => {
        // ±0.02, which is one step of the two decimals the comments are written
        // to. A stale ratio is worse than no ratio: it reads as measured.
        expect(contrast(claim.value, claim.against)).toBeCloseTo(claim.ratio, 1);
        expect(Math.abs(contrast(claim.value, claim.against) - claim.ratio)).toBeLessThanOrEqual(
          0.02,
        );
      });
    }
  }
});

describe("the palette clears WCAG AA where it has to", () => {
  const tokens = declarations(read("./tokens.css"));
  const hex = (name: string): string => {
    const value = tokens.get(name);
    expect(value, `${name} must be a hex in tokens.css`).toMatch(/^#[0-9a-f]{6}$/i);
    return value!;
  };

  /** Every surface a screen puts text on. `--bg-subtle` is the hardest. */
  const SURFACES = ["--bg-canvas", "--bg-card", "--bg-card-soft", "--bg-inner", "--bg-subtle"];

  /**
   * `--text-muted` is in this list and that is the whole reason it is not the
   * `#7d8c98` the palette was first drafted with: 3.09:1 on `--bg-subtle`, and
   * it is `--ink-agent`, so the entire compte-rendu would have been written
   * below AA. `--brand-700` and `--brand-900` are the two ramp steps VISION.md
   * §6 clears for text; the four lighter ones are deliberately not here.
   */
  const CARRIES_TEXT = ["--text-strong", "--text-body", "--text-muted", "--brand-700", "--brand-900"];

  for (const fg of CARRIES_TEXT) {
    for (const bg of SURFACES) {
      test(`${fg} clears 4.5:1 on ${bg}`, () => {
        expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  test("--brand-500 clears 3:1 — borders, focus rings, state dots", () => {
    // VISION.md §6 measures the ramp against white, and `--brand-500` is the
    // step chosen to sit just over the 3:1 non-text bar there (3.05:1).
    //
    // Known and deliberate gap, worth stating rather than hiding: on the two
    // tinted surfaces it lands at 2.89:1 (`--bg-canvas`) and 2.73:1
    // (`--bg-subtle`). A 1px border at that ratio is fine; a focus ring drawn
    // in it on the canvas is not, and should use `--brand-700`.
    for (const bg of ["--bg-inner", "--bg-card"]) {
      expect(contrast(hex("--brand-500"), hex(bg)), bg).toBeGreaterThanOrEqual(3);
    }
  });

  test("--brand-300 does NOT clear 4.5:1 — this assertion is the point", () => {
    // Deliberate, and it is why the ramp exists at all. `#4dc2fb` is the
    // client's own blue and it is 2.01:1 on white: a fill and a wash, never
    // text, never an icon, never a border, never a state dot.
    //
    // If someone "fixes" the brand blue by darkening `--brand-300` in place,
    // this fails loudly — which is the correct outcome, because the fill that
    // large brand areas are painted with would have silently changed colour
    // across every screen. The darker value they wanted is `--brand-500` or
    // `--brand-700`, which already exist for exactly that.
    expect(contrast(hex("--brand-300"), hex("--bg-inner"))).toBeLessThan(4.5);
  });
});

describe("fonts are shipped, not fetched", () => {
  // Comments stripped: this file explains *why* Gelica and SN Pro are absent,
  // and a check that reads prose would fail on its own explanation.
  const fonts = read("./fonts.css").replace(/\/\*[\s\S]*?\*\//g, "");

  test("no @font-face reaches the network", () => {
    // The renderer's CSP has no `font-src` escape, so a remote URL here is a
    // font that silently never loads — and, worse, a request that tells a third
    // party when a rep opened the app.
    const remote = [...fonts.matchAll(/url\(["']?([^"')]+)["']?\)/g)]
      .map(([, url]) => url)
      .filter((url) => /^(https?:)?\/\//.test(url));

    expect(remote).toEqual([]);
  });

  test("the licensed faces blume uses are not shipped", () => {
    // Gelica and SN Pro are commercially licensed (VISION.md §6). Fraunces and
    // Inter are the open substitutes, and both travel with their OFL text.
    expect(fonts).not.toMatch(/Gelica|SN Pro/i);
    expect(fonts).toMatch(/Fraunces/);
    expect(fonts).toMatch(/Inter/);
  });
});
