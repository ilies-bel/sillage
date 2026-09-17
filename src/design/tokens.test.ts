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

/*
 * ── the two blocks this file declares, read apart ───────────────────────────
 *
 * **`declarations()` folds the whole file into one map, last writer wins — and
 * `tokens.css` declares its motion tokens twice.** The second declaration is
 * inside `@media (prefers-reduced-motion: reduce)`, where both durations are
 * `0ms`. So `tokens.get('--motion')` has answered **`0ms`** since that media
 * query was added, and the test below named « motion stays at or under 150ms »
 * has been asserting `0 <= 150` on a number nothing in the product uses.
 *
 * Measured, on this file: setting `--motion: 900ms` in `:root` — the duration
 * every arrival animation runs on, and the one the widget's exit handshake reads
 * off computed style and reports to the main process as how long to keep a
 * frameless always-on-top window over the rep's call — left **110 of 110**
 * assertions green. So did adding a `--motion-attack: 900ms` rung, which
 * `shot.mjs --motion` would then accept as a token duration anywhere in the
 * product, because that check builds its allowed set from every `--motion*` in
 * `:root` precisely so a new rung is honoured the moment it is declared.
 *
 * Shape #3 on `CLAUDE.md`'s list — a check that measures nothing while reporting
 * green — in the file whose whole job is to keep VISION.md §6 and `tokens.css`
 * the same file in two places.
 */
const ROOT_BLOCK = /:root\s*\{([\s\S]*?)\n\}/;
const REDUCED_BLOCK = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\n  \})/;

const block = (css: string, where: RegExp, what: string): Map<string, string> => {
  const found = where.exec(css);
  expect(found, `${what} must still be a block this parser can find`).toBeTruthy();
  return declarations(found![1]);
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

  /*
   * **Discovered, never listed.** This named `["--motion", "--motion-fast"]` by
   * hand, which is the `check:ports` `PORTS`-was-one-entry shape: a rung added to
   * `tokens.css` and not added here is a rung nothing holds to VISION.md §6's
   * ceiling, while `shot.mjs --motion` accepts it as a token the moment it is
   * declared. And it read the folded map, so both values it did check were the
   * `0ms` from the reduced-motion block — see the note beside `ROOT_BLOCK`.
   */
  const rootTokens = block(read("./tokens.css"), ROOT_BLOCK, ":root");
  const reducedTokens = block(
    read("./tokens.css"),
    REDUCED_BLOCK,
    "@media (prefers-reduced-motion: reduce)",
  );
  const rungs = [...rootTokens.keys()].filter((name) => name.startsWith("--motion"));

  test("the ladder still has rungs to check", () => {
    // Guards the two parsers above: a reformat of `tokens.css` that stopped
    // either block matching would otherwise turn every assertion below into a
    // loop over nothing, which is the failure this whole block was written for.
    expect(rungs.length).toBeGreaterThanOrEqual(2);
    expect(rootTokens.get("--motion")).toMatch(/^\d+ms$/);
  });

  test.each(rungs)("%s stays at or under 150ms (VISION.md §6)", (name) => {
    const ms = Number.parseInt(rootTokens.get(name) ?? "", 10);
    expect(ms, name).toBeGreaterThan(0);
    expect(ms, name).toBeLessThanOrEqual(150);
  });

  /*
   * ── each rung held to the band its own evidence gives it ────────────────────
   *
   * **A ceiling shared by every rung is not a ladder.** The assertions above hold
   * each `--motion*` to VISION.md §6's ≤150ms and, separately,
   * `durations.DEFAULT === 'var(--motion-fast)'` in `tailwind.config.js` pins the
   * *mapping*. Neither asks what the numbers are, so the numbers were free:
   * measured on this tree, setting `--motion-fast: 150ms` — which reverts the
   * whole measured result of `c6ea550`, 307 consumers of `transition` back onto
   * the duration US-3 replaced — left **126 of 126** assertions green and
   * `npm run check` at exit 0 over twelve gates. `shot.mjs --motion` cannot see it
   * either: it builds its allowed set from every `--motion*` in `:root`, so a
   * collapsed rung is still a token and still allowed everywhere.
   *
   * A ladder whose rungs can all collapse onto one value is one token edit from
   * being the single curve US-3 replaced, so the rungs are held **apart** — the
   * bands below are disjoint and the values must be distinct — and each is held to
   * the band its evidence gives it.
   *
   * **The numbers are cited, never chosen.** `docs/stories/motion-research.md` is
   * the evidence: §2 is the published standard's four bands (press feedback
   * 100–160 ms · tooltips and small popovers 125–200 · dropdowns and selects
   * 150–250 · modals and drawers 200–500, all under 300), §1 is Granola 7.543.3's
   * own stylesheet, whose base `--default-transition-duration` is `.15s` — the
   * same as `--motion` — and `c6ea550` carries the frame-by-frame measurement
   * behind `--motion-fast`.
   *
   * A rung with no entry here fails, and an entry whose rung has gone fails too:
   * the `check:ports` `HOMES` shape, so this cannot rot back into a ceiling.
   */
  const BANDS = new Map<string, { min: number; max: number; why: string }>([
    [
      "--motion-fast",
      {
        /*
         * The pointer's own feedback, met hundreds of times a day. Above the 70ms
         * `c6ea550` measured and refused — « 70 buys six points over 90 and costs
         * a token nobody can defend » — and at or under the published standard's
         * press-feedback floor of 100, which is the one place the repo's own
         * measurement beats the standard and is allowed to: sampled per animation
         * frame on a probe carrying the product's colours and `--ease-out`, the
         * second frame after the pointer lands is 44 % landed at 150ms, 79 % at
         * 90ms, 85 % at 70ms. 150 is outside this band by construction, because
         * 150 is the number US-3 measured the press away from.
         */
        min: 71,
        max: 100,
        why: "retour au pointeur : au-dessus des 70 ms mesurées puis refusées, au plus la borne basse de 100 ms de la norme (100–160 ms)",
      },
    ],
    [
      "--motion",
      {
        /*
         * A surface arriving or leaving, met once or twice a day: the widget over
         * the call, its panel, the gate's confirmation. Floored at the published
         * standard's smallest band for something that appears (tooltips and small
         * popovers, 125–200 ms) and capped by VISION.md §6's ≤150ms, which is also
         * exactly what Granola's own base duration is. And it is not only a
         * duration: the widget's exit handshake reads it off computed style and
         * reports it to the main process as how long to keep a frameless
         * always-on-top window over the rep's call, so a rung collapsed towards
         * the fast one shortens that window's own life.
         */
        min: 125,
        max: 150,
        why: "surface qui arrive ou qui part : borne basse de la norme pour un popover (125–200 ms), plafond de VISION.md §6 (150 ms), et la durée de base de Granola",
      },
    ],
  ]);

  test("every rung declares the band its evidence gives it", () => {
    const undeclared = rungs.filter((name) => !BANDS.has(name));
    expect(
      undeclared,
      "rungs with no band in tokens.test.ts — say which event the rung is for and cite " +
        "docs/stories/motion-research.md for its band, or the ladder gains a number nothing holds",
    ).toEqual([]);

    const gone = [...BANDS.keys()].filter((name) => !rungs.includes(name));
    expect(gone, "bands whose rung tokens.css no longer declares").toEqual([]);
  });

  test.each([...BANDS])("%s sits in the band its evidence gives it", (name, band) => {
    const ms = Number.parseInt(rootTokens.get(name) ?? "", 10);
    expect(ms, `${name} — ${band.why}`).toBeGreaterThanOrEqual(band.min);
    expect(ms, `${name} — ${band.why}`).toBeLessThanOrEqual(band.max);
  });

  test("the rungs are held apart, and no two bands could ever let them meet", () => {
    // Distinct values first, which is the collapse itself: two rungs at one number
    // is one rung with two names, and `transition` would mean what it meant before
    // US-3 measured it.
    const values = rungs.map((name) => rootTokens.get(name));
    expect(new Set(values).size, `rungs that share a value: ${values.join(" · ")}`).toBe(
      rungs.length,
    );

    // And the bands themselves may not overlap, so no future pair of numbers can
    // pass both tests while sitting on the same value.
    const bands = [...BANDS].sort(([, a], [, b]) => a.min - b.min);
    for (const [index, [name, band]] of bands.entries()) {
      const next = bands[index + 1];
      if (!next) continue;
      expect(band.max, `${name} overlaps ${next[0]}`).toBeLessThan(next[1].min);
    }
  });

  test("the OS setting reaches every rung", () => {
    /*
     * `tokens.css` collapses the durations under `prefers-reduced-motion` « rather
     * than asserting our motion is tasteful enough to be exempt », and that block
     * is a hand-written list of a set declared thirty lines above it. A rung added
     * to the ladder and forgotten there goes on running for the rep who asked
     * their machine for less motion — and `shot.mjs --motion` can only notice it
     * on a stage that happens to draw with it, so a rung used by one screen is
     * caught and a rung used by none is not caught until it is.
     */
    const missing = rungs.filter((name) => Number.parseInt(reducedTokens.get(name) ?? "", 10) !== 0);
    expect(missing, "rungs that keep running under prefers-reduced-motion").toEqual([]);
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
    const out = bezier(rootTokens.get("--ease-out") ?? "");
    const back = bezier(rootTokens.get("--ease-in") ?? "");
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
    const early = meanProgress(bezier(rootTokens.get("--ease-out") ?? "")!);
    const late = meanProgress(bezier(rootTokens.get("--ease-in") ?? "")!);
    expect(early, "--ease-out must be front-loaded").toBeGreaterThan(0.55);
    expect(late, "--ease-in must be back-loaded — a departure that blinks is the defect this token exists to end").toBeLessThan(0.45);
  });

  /*
   * ── the curve family, discovered and pinned by shape ──────────────────────
   *
   * `shot.mjs --motion` builds its allowed-curve set from every `--ease*` in
   * `:root`, deliberately, so a new curve is honoured the moment it is declared.
   * Which means this file is the only place that can ask what a newly declared
   * curve *does* — and the check's own docblock records what happens when it
   * cannot: renaming `--ease-out` turned the direction rule **off** rather than
   * red, because `enterCurve` became `''` and `allowedEase.has('')` is false.
   * A curve that does not parse here is the same failure at the source.
   */
  const easings = [...rootTokens.keys()].filter((name) => name.startsWith("--ease"));

  test("the curve family still has curves to check", () => {
    expect(easings.length).toBeGreaterThanOrEqual(2);
  });

  test.each(easings)("%s is a curve this product can reason about", (name) => {
    expect(bezier(rootTokens.get(name) ?? ""), `${name} must be a cubic-bezier`).not.toBeNull();
  });

  /**
   * The highest progress a curve reaches anywhere in its span. Above 1 it has
   * gone past its endpoint and come back, which is an overshoot.
   */
  const peakProgress = ([, y1, , y2]: number[]): number => {
    const Y = (t: number) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
    let peak = 0;
    for (let i = 0; i <= 1000; i += 1) peak = Math.max(peak, Y(i / 1000));
    return peak;
  };

  /**
   * The one curve DEC-50 licenses to go past its endpoint and come back.
   *
   * Named here rather than discovered, and that is the point: « which curves may
   * bounce » is a decision, so it is written down once and every *other* curve in
   * `:root` is held to the opposite. A second overshoot appearing in the token
   * file fails the test below until somebody amends this line, which is the
   * `check-platform.mjs` shape — an allowance is a declaration, never an omission.
   */
  const OVERSHOOT = "--ease-overshoot";

  test(`${OVERSHOOT} is declared, because a rule that cannot be broken is not a rule`, () => {
    /*
     * The allowance has to name a token that exists. Deleting the overshoot and
     * leaving this list behind would turn the assertion below into a statement
     * about nothing — an allowance whose subject has gone, which is exactly the
     * rot `check-platform.mjs` refuses.
     */
    expect(easings, `${OVERSHOOT} must be declared in :root`).toContain(OVERSHOOT);
  });

  test.each(easings.filter((name) => name !== OVERSHOOT))(
    "%s does not overshoot — VISION.md §6 says nothing bounces",
    (name) => {
      /*
       * **§6's clause, still enforced everywhere it still means what it said.**
       *
       * DEC-50 moved « nothing bounces » for exactly one surface — the widget's
       * arrival, drawn over another application's video call once or twice a day —
       * and for exactly one carrier, `scale`. Every other curve in this file is
       * spent on a row, a pane or a hover tint, where the vocabulary is « opacity
       * and 2–4px translate only » and an overshoot is worth 0.01px to 0.39px,
       * measured. A bounce on those is not a judgement anyone would make; it is a
       * curve that drifted.
       */
      expect(peakProgress(bezier(rootTokens.get(name) ?? "")!), name).toBeLessThanOrEqual(1.0001);
    },
  );

  test(`${OVERSHOOT} exceeds 1 somewhere in its span, and comes back`, () => {
    /*
     * **DEC-50's first bound, and it is a shape rather than a string** — the
     * `--ease-in` lesson, applied to the token declared in the same round it was
     * learned in. That curve was pinned by nothing but its name, and redefining it
     * to `cubic-bezier(0.22, 1, 0.36, 0.99)` restored the blink it exists to end
     * while every check in the repo stayed green, because `shot.mjs --motion`
     * builds its allowed set from `:root` and therefore honours whatever is
     * declared. The same hole is open here in the other direction: respell this
     * token as an ordinary ease-out and the arrival silently stops being an
     * arrival — 1.54px of settle on the pill and 2.18px on the panel become zero,
     * on the one surface the decision was taken for, with nothing anywhere to say
     * so.
     *
     * Measured on the shipped renderer: peak 1.0800, above 1 from 39ms to 145ms of
     * the 150, widest painted pill 241.75px against a resting 240.28.
     *
     * **Bounded at the other end too.** DEC-50 says « may overshoot once,
     * bounded ». 1.5 was chosen against `y1` swept from 1.2 to 1.8 and
     * photographed: 1.2 and 1.3 are worth 0.24px and 0.57px on the pill, which is
     * the sub-pixel territory this whole decision exists to escape, and 1.8 is
     * 3.4px, which over a client's face reads as a bounce rather than a settle.
     * The ceiling is deliberately above the shipped value and well under it — this
     * is the boundary of « bounded », not a second copy of the choice.
     */
    const curve = bezier(rootTokens.get(OVERSHOOT) ?? "");
    expect(curve, `${OVERSHOOT} must be a cubic-bezier`).not.toBeNull();
    const peak = peakProgress(curve!);
    expect(peak, "an overshoot that never exceeds 1 is not an overshoot").toBeGreaterThan(1.001);
    expect(peak, "bounded: past 1.15 a 340px card moves 5px and it reads as a bounce").toBeLessThan(
      1.15,
    );
    // It comes back: a curve that *ends* past its endpoint would leave the card
    // permanently larger than the box the main process sized the window to.
    expect(curve![3], `${OVERSHOOT} must land on its endpoint`).toBe(1);
  });

  test(`${OVERSHOOT} is --ease-out with one control point lifted`, () => {
    /*
     * The same property `--ease-in` is held to, for the same reason: there is one
     * piece of taste in this file and every other curve is a derivation of it, so
     * retuning `--ease-out` retunes the family rather than opening a gap between
     * three independent opinions. The lift is `y1`; the abscissae are the taste.
     */
    const out = bezier(rootTokens.get("--ease-out") ?? "")!;
    const over = bezier(rootTokens.get(OVERSHOOT) ?? "")!;
    expect([over[0], over[2], over[3]], "same shape, one control point lifted past 1").toEqual([
      out[0],
      out[2],
      out[3],
    ]);
    expect(over[1], "and the lift is what makes it overshoot").toBeGreaterThan(out[1]);
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

/*
 * ── every duration and curve Tailwind names is a token, and the ladder's rungs
 *    are the ones the product spends ──────────────────────────────────────────
 *
 * `tailwind.config.js`'s own header says « Every entry below is a `var()`
 * reference and never a literal — a literal here would be a value outside both
 * loops », and nothing had ever asked that of the motion scales. It was true of
 * the colours because `check-tokens.mjs` greps for hexes; a `150ms` typed into
 * `transitionDuration` is not a hex and no check in the repo could see it.
 *
 * And the mapping itself is load-bearing in a way a screenshot cannot show.
 * `transition` is written on 307 elements — measured, across six stages — and
 * what it resolves to is decided by one word in that file. `DEFAULT` was
 * `--motion` and `fast` was `--motion-fast`, and `duration-fast` had **zero**
 * occurrences under `src/`: the fast rung was declared, mapped, and drawn by
 * nothing, so the ladder `tokens.css` documents as two rungs shipped as one.
 */
describe("the motion scales are tokens, and the ladder reaches the product", () => {
  const config = read("../../tailwind.config.js");
  const rootTokens = block(read("./tokens.css"), ROOT_BLOCK, ":root");

  /** `name: { … }` → Record, the same parser the colour scales above use. */
  const scale = (name: string): Record<string, string> => {
    const body = new RegExp(`${name}: \\{([^}]*)\\}`).exec(config)?.[1];
    if (!body) throw new Error(`${name} absent de tailwind.config.js`);
    return Object.fromEntries(
      [...body.matchAll(/([A-Za-z-]+|'[^']+'):\s*'([^']+)'/g)].map((m) => [
        m[1].replace(/'/g, ""),
        m[2],
      ]),
    );
  };

  const durations = scale("transitionDuration");
  const curves = scale("transitionTimingFunction");
  const animations = scale("animation");

  test("the scales still hold entries worth checking", () => {
    // Guards the parser: a reformat of `tailwind.config.js` that stopped it
    // matching would turn every loop below into a loop over nothing.
    expect(Object.keys(durations).length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(curves).length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(animations).length).toBeGreaterThanOrEqual(2);
  });

  test("no motion value in the config is a literal", () => {
    const scales: [string, Record<string, string>][] = [
      ["transitionDuration", durations],
      ["transitionTimingFunction", curves],
      ["animation", animations],
    ];
    for (const [where, entries] of scales) {
      for (const [name, value] of Object.entries(entries)) {
        const referenced = [...value.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
        expect(
          referenced.length,
          `${where}.${name} ne cite aucun jeton : « ${value} »`,
        ).toBeGreaterThan(0);
        for (const token of referenced) {
          expect(rootTokens.has(token), `${where}.${name} cite ${token}, absent de :root`).toBe(
            true,
          );
        }
        /*
         * A bare value beside the `var()` is the literal this test is for —
         * `150ms`, `0.15s`, a hand-typed `cubic-bezier(…)`, a CSS keyword easing.
         * What is allowed to remain is a keyframe name.
         */
        const stripped = value.replace(/var\(--[\w-]+\)/g, "").trim();
        expect(stripped, `${where}.${name} porte une valeur en dur : « ${value} »`).not.toMatch(
          /\d|cubic-bezier|\bease\b|\blinear\b|\bsteps\b/,
        );
      }
    }
  });

  test("`transition` means the fast rung — the one the pointer waits on", () => {
    /*
     * The 307 hover tints. Pointing `DEFAULT` back at `--motion` puts every one
     * of them back to 150ms and leaves `--motion-fast` drawing nothing, which is
     * the state this round found the ladder in.
     */
    expect(durations.DEFAULT).toBe("var(--motion-fast)");
  });

  test("and every type rung is drawn by something", () => {
    /*
     * **The same acceptance line, asked of the scale that just grew.** US-3's
     * rule is that a token nothing draws with is a dead declaration, and the
     * document ladder (`--type-prose / subhead / heading / title`) was added in
     * one commit with four consumers — so it starts honest and this is what
     * keeps it that way. A fifth rung added « for completeness » fails here on
     * the commit that adds it.
     *
     * Config *and* stylesheets, for the reason the motion version gives: the
     * notepad reads three of these straight out of `index.css`
     * (`.notepad .ProseMirror h1/h2/h3`) and is not a `fontSize` entry.
     *
     * The interface rungs are in scope too. They were all spent when this was
     * written; if one ever stops being, that is worth knowing rather than
     * grandfathering.
     */
    const spenders = config + read("./index.css");
    const rungs = [...rootTokens.keys()].filter((name) => name.startsWith("--type-"));
    expect(rungs.length, "the type ladder still has rungs to check").toBeGreaterThanOrEqual(9);
    const unspent = rungs.filter((name) => !new RegExp(`var\\(${name}\\)`).test(spenders));
    expect(unspent, "type rungs declared and drawn by nothing").toEqual([]);
  });

  test("and every rung is reachable from somewhere", () => {
    /*
     * **The acceptance line US-3 is built on: a token nothing draws with is a
     * dead declaration.** Asked of the whole ladder rather than of a list, and
     * asked of the *stylesheets* as well as of the config, because `--motion`'s
     * three consumers are all CSS rules (`animate-rise-in`, `animate-fade-in`,
     * `.widget-leaving`) and not one of them is a `transitionDuration` entry.
     */
    const spenders = config + read("./index.css");
    const rungs = [...rootTokens.keys()].filter((name) => name.startsWith("--motion"));
    const unspent = rungs.filter((name) => !new RegExp(`var\\(${name}\\)`).test(spenders));
    expect(unspent, "rungs declared and drawn by nothing").toEqual([]);
  });
});

/**
 * **The ink ramp is three steps, on every ground the product paints on.**
 *
 * `--text-strong` / `--text-body` / `--text-muted` are three levels and the
 * screens spend them as three: a title, prose, a meta line. The overlay
 * (`.widget-surface`, DEC-49) re-points all three for a dark ground, and for six
 * rounds it pointed the first two at the **same** value — so on the one window
 * drawn over a client's video call, the card's title, the sentence the client
 * had just spoken, the rep's own note and the elapsed clock were all
 * `rgb(243,247,250)`. Measured on the shipped panel with every text run counted
 * (`scratch/r19-type.mjs`): 23 runs, two inks.
 *
 * Nothing could see it. `--contrast` asks whether ink clears its ground and two
 * identical inks both do; `check:tokens` greps for hex literals and dead `/NN`
 * modifiers; the palette block below holds each token against a *surface* and
 * never against its own neighbour. A collapse inside a ramp is invisible to
 * every check that reads one token at a time.
 *
 * Three claims here, and the second is what the first cannot say on its own:
 *
 *  · the three are **distinct** in every scope that declares them;
 *  · they are **ordered** — each further from the ground than the last, so the
 *    ramp is a ramp and not three arbitrary greys;
 *  · and each still clears **4.5:1** on both of that scope's grounds, because a
 *    step bought by weakening the middle rung below AA is not a step.
 *
 * Driven on both scopes rather than on the widget alone: the rule's subject is
 * « the ink ramp », and a fixture that only knew about the surface that happened
 * to be broken is this file's own recurring defect.
 */
describe("the ink ramp is three steps everywhere it is declared", () => {
  const tokens = declarations(read("./tokens.css"));
  const index = read("./index.css");

  const WIDGET_BLOCK = /\.widget-surface\s*\{([\s\S]*?)\n\}/;
  const widget = block(index, WIDGET_BLOCK, ".widget-surface");

  /** `var(--x)` → the hex `tokens.css` declares for `--x`. */
  const resolve = (value: string): string => {
    const named = /^var\((--[\w-]+)\)$/.exec(value.trim());
    const hex = named ? tokens.get(named[1]) : value.trim();
    expect(hex, `${value} must resolve to a hex in tokens.css`).toMatch(/^#[0-9a-f]{6}$/i);
    return hex!;
  };

  const RAMP = ["--text-strong", "--text-body", "--text-muted"] as const;

  const scopes = {
    ":root": {
      ink: RAMP.map((name) => resolve(tokens.get(name) ?? "")),
      grounds: ["--bg-card", "--bg-subtle"].map((name) => resolve(tokens.get(name) ?? "")),
    },
    ".widget-surface": {
      ink: RAMP.map((name) => resolve(widget.get(name) ?? "")),
      grounds: ["--widget-bg", "--widget-soft"].map((name) => resolve(tokens.get(name) ?? "")),
    },
  };

  for (const [where, { ink, grounds }] of Object.entries(scopes)) {
    test(`${where} declares three different inks`, () => {
      expect(new Set(ink).size, `${where}: ${RAMP.join(" / ")} = ${ink.join(" / ")}`).toBe(3);
    });

    test(`${where} orders them, strong furthest from the ground`, () => {
      // Measured against the scope's own card, because « furthest » has no
      // meaning without a ground — on paper strong is the darkest and on the
      // overlay it is the lightest, and the ramp has to read the same way on both.
      const [card] = grounds;
      const steps = ink.map((value) => contrast(value, card));
      expect(steps[0], `strong ${steps[0].toFixed(2)} vs body ${steps[1].toFixed(2)}`).toBeGreaterThan(steps[1]);
      expect(steps[1], `body ${steps[1].toFixed(2)} vs muted ${steps[2].toFixed(2)}`).toBeGreaterThan(steps[2]);
    });

    for (const ground of grounds) {
      test(`${where} keeps all three past AA on ${ground}`, () => {
        for (const [at, value] of ink.entries()) {
          expect(contrast(value, ground), `${RAMP[at]} ${value} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
