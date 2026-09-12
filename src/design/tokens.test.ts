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

  /*
   * **The two curves are one curve, and the relation is what is pinned — not a
   * literal.**
   *
   * This file held the durations to ≤150ms and said nothing at all about easing,
   * and an adversarial round walked straight through the gap: redefining
   * `--ease-in` to `cubic-bezier(0.22, 1, 0.36, 0.99)` restored the blink the
   * exit curve exists to end — measured on the shipped `.widget-leaving` element
   * in Chromium, opacity 0.768 at 9ms, 0.278 at 35ms, 0.018 at 93ms against
   * 0.999 / 0.998 / 0.909 for the real token — and every check in the repo passed.
   * `shot.mjs --motion` now measures the *shape* of whatever curve reaches a
   * departing element, which catches that at the surface; this catches it at the
   * source, and the two are deliberately independent.
   *
   * **Pinning the string would have been the wrong assertion.** `--ease-out` is
   * the one piece of taste here, and it is allowed to be retuned; what must not
   * drift is that `--ease-in` follows it, because the entire argument for having
   * two curves is that they are *the same curve read in two directions* and
   * therefore only one thing to keep consistent. A literal would freeze the taste
   * and still permit the pair to come apart at the next retune.
   *
   * **The relation is a 180° rotation about (0.5, 0.5), not a reflection in the
   * diagonal** — `(x1, y1, x2, y2) → (1−x2, 1−y2, 1−x1, 1−y1)`. Reflecting in the
   * diagonal gives the *inverse* function, `(y1, x1, y2, x2)`, which for
   * `(0.22, 1, 0.36, 1)` is `(1, 0.22, 1, 0.36)` and is not `--ease-in`. The
   * rotation is: reverse the time axis *and* the value axis, which is what
   * « the same motion, played the other way » means. `tokens.css` said
   * « reflected through the diagonal » for a round — the intent was right and the
   * geometry was not, and an unasserted claim in a comment is how that survives.
   */
  const bezier = (value: string): number[] | null => {
    const match = /^cubic-bezier\(([^)]*)\)$/.exec(value.trim());
    if (!match) return null;
    const numbers = match[1].split(",").map((n) => Number.parseFloat(n));
    return numbers.length === 4 && numbers.every((n) => Number.isFinite(n)) ? numbers : null;
  };

  /**
   * The mean of a cubic-bezier easing's progress over its duration: above 0.5 the
   * change is front-loaded, which is what makes an arrival feel instant and a
   * departure a blink. The same measurement `shot.mjs --motion` makes, written
   * out here rather than imported, because that file runs in a browser page.
   */
  const meanProgress = ([x1, y1, x2, y2]: number[]): number => {
    const cubic = (a: number, b: number) => (t: number) =>
      3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
    const X = cubic(x1, x2);
    const Y = cubic(y1, y2);
    let total = 0;
    for (let i = 0; i <= 100; i += 1) {
      let lo = 0;
      let hi = 1;
      for (let step = 0; step < 40; step += 1) {
        const mid = (lo + hi) / 2;
        if (X(mid) < i / 100) lo = mid;
        else hi = mid;
      }
      total += Y((lo + hi) / 2);
    }
    return total / 101;
  };

  test("--ease-in is --ease-out rotated 180° about the midpoint", () => {
    const out = bezier(tokens.get("--ease-out") ?? "");
    const back = bezier(tokens.get("--ease-in") ?? "");
    expect(out, "--ease-out must be a cubic-bezier").not.toBeNull();
    expect(back, "--ease-in must be a cubic-bezier").not.toBeNull();

    const rotated = [1 - out![2], 1 - out![3], 1 - out![0], 1 - out![1]];
    // Rounded to the precision the tokens are written at: the point of this is
    // the pairing, not float equality.
    expect(back!.map((n) => Math.round(n * 100) / 100)).toEqual(
      rotated.map((n) => Math.round(n * 100) / 100),
    );
  });

  test("the exit curve spends its change late and the entrance curve early", () => {
    /*
     * The property the widget's exit actually depends on, stated directly so it
     * survives a future decision to pair the two curves differently. Measured:
     * `--ease-out` 0.827, `--ease-in` 0.173, `linear` exactly 0.5. The bound is
     * 0.55/0.45 rather than 0.5 so that a curve which is *almost* symmetrical
     * fails rather than squeaking through on the third decimal — the attack that
     * defeated the old check measured 0.824.
     */
    const early = meanProgress(bezier(tokens.get("--ease-out") ?? "")!);
    const late = meanProgress(bezier(tokens.get("--ease-in") ?? "")!);
    expect(early, "--ease-out must be front-loaded").toBeGreaterThan(0.55);
    expect(late, "--ease-in must be back-loaded — a departure that blinks is the defect this token exists to end").toBeLessThan(0.45);
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

/*
 * ── the three utilities that draw a rule have to agree ──────────────────────
 *
 * `bg-muted/30` compiled to no rule and the meter's bars were invisible.
 * `ring-card` named a colour `ringColor` did not have and `StateDot`'s outline
 * never drew, so the splash's « Audio » row had a hole where the other two have
 * a dot. `decoration-card` would have resolved through the generic palette to
 * `--bg-card` — a near-white *background* token — and drawn a dotted underline
 * in the colour of the paper.
 *
 * Three instances, one shape: the class name is right, something resolves, and
 * the element is silently unstyled. Whatever `border-*` can say, `ring-*` and
 * `decoration-*` must be able to say, and must say the same thing.
 */
describe('border, ring and decoration name the same rules', () => {
  // Read as text and parsed by the same regexes the rest of this file uses:
  // `tailwind.config.js` is CommonJS and this suite runs as an ES module.
  const config = read('../../tailwind.config.js')
  const scale = (name: string): Record<string, string> => {
    const block = new RegExp(`${name}: \\{([^}]*)\\}`).exec(config)?.[1]
    if (!block) throw new Error(`${name} absent de tailwind.config.js`)
    return Object.fromEntries(
      [...block.matchAll(/([A-Za-z-]+|'[^']+'):\s*'([^']+)'/g)].map((m) => [
        m[1].replace(/'/g, ''),
        m[2],
      ]),
    )
  }
  const borderColor = scale('borderColor')
  const ringColor = scale('ringColor')
  const textDecorationColor = scale('textDecorationColor')

  test('every border token is reachable from ring-* and decoration-*', () => {
    for (const [name, value] of Object.entries(borderColor)) {
      if (name === 'DEFAULT') continue
      expect(ringColor[name], `ring-${name} n’existe pas`).toBe(value)
      expect(textDecorationColor[name], `decoration-${name} n’existe pas`).toBe(value)
    }
  })

  test('and none of them silently means a background', () => {
    // The trap that produced this: `colors.card` is `--bg-card`, so a rule
    // utility that falls through to the generic palette draws in the colour of
    // the surface it sits on.
    for (const scale of [borderColor, ringColor, textDecorationColor]) {
      for (const [name, value] of Object.entries(scale)) {
        expect(String(value), `${name} pointe vers un fond`).not.toMatch(/--bg-/)
      }
    }
  })
})
