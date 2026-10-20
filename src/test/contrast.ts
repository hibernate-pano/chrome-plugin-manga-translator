/**
 * Test helpers for asserting styles.
 *
 * The overlays (HUD, reading panel) build their CSS as a string inside a
 * shadow root, so a test cannot ask the browser for a computed colour the
 * way it can for a real element. Instead these helpers read the declaration
 * out of the stylesheet and do the maths the browser would do: composite the
 * translucent layers, then apply the WCAG relative-luminance formula.
 *
 * That way a test asserts the thing that actually matters — "this text is
 * readable on this surface" — instead of pinning a literal colour string
 * that somebody can weaken without the test noticing.
 */

export type Rgb = [number, number, number];

/** A white manga page: the lightest backdrop the overlays can sit on. */
export const WHITE_PAGE: Rgb = [255, 255, 255];

interface ParsedColor {
  rgb: Rgb;
  alpha: number;
}

/** Parse `rgb(...)` / `rgba(...)` / `#rgb` / `#rrggbb` into channels and alpha. */
export function parseColor(value: string): ParsedColor {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1] ?? '';
    const expanded =
      digits.length === 3
        ? digits
            .split('')
            .map(digit => digit + digit)
            .join('')
        : digits;
    return {
      rgb: [
        Number.parseInt(expanded.slice(0, 2), 16),
        Number.parseInt(expanded.slice(2, 4), 16),
        Number.parseInt(expanded.slice(4, 6), 16),
      ],
      alpha: 1,
    };
  }

  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) {
    throw new Error(`无法解析颜色: ${value}`);
  }
  const parts = (match[1] ?? '')
    .split(',')
    .map(part => Number.parseFloat(part.trim()));
  return {
    rgb: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0],
    alpha: parts[3] ?? 1,
  };
}

/** Composite a translucent colour over an opaque backdrop. */
function composite(color: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return [
    color[0] * alpha + backdrop[0] * (1 - alpha),
    color[1] * alpha + backdrop[1] * (1 - alpha),
    color[2] * alpha + backdrop[2] * (1 - alpha),
  ];
}

/** WCAG 2.x relative luminance. */
function relativeLuminance(color: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(color[0]) +
    0.7152 * channel(color[1]) +
    0.0722 * channel(color[2])
  );
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The contrast of a translucent text colour against an opaque surface.
 *
 * The text is composited over the surface first — the browser does the
 * same thing before it measures the two pixels.
 */
export function textContrast(text: string, surface: Rgb): number {
  const { rgb, alpha } = parseColor(text);
  return contrastRatio(composite(rgb, alpha, surface), surface);
}

/**
 * The surface a translucent background paints, once it is composited over
 * the page behind it.
 */
export function surfaceColor(background: string, backdrop: Rgb): Rgb {
  const { rgb, alpha } = parseColor(background);
  return composite(rgb, alpha, backdrop);
}

/** The body of the rule that targets `selector`, or '' when there is none. */
export function cssBlock(css: string, selector: string): string {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const chunk of cleaned.split('}')) {
    const open = chunk.lastIndexOf('{');
    if (open === -1) {
      continue;
    }
    // Only the selector list matters: `@layer base {` and `@media ... {`
    // wrap the rule, and a rule such as `#root.collapsed #empty` is a
    // different rule from `#empty` even though it ends with the same word.
    const prelude = chunk.slice(0, open);
    const context = prelude.lastIndexOf('{');
    const selectorList = context === -1 ? prelude : prelude.slice(context + 1);
    const alternatives = selectorList.split(',').map(part => part.trim());
    if (!alternatives.includes(selector)) {
      continue;
    }
    return chunk.slice(open + 1);
  }
  return '';
}

/** The value of one declaration inside a rule body. */
export function cssDeclaration(block: string, property: string): string {
  for (const part of block.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) {
      continue;
    }
    if (part.slice(0, colon).trim() === property) {
      return part.slice(colon + 1).trim();
    }
  }
  return '';
}

/**
 * The `H S% L%` triple the shadcn variables use, as numbers.
 *
 * `hsl(187.9 85.7% 53.3%)` is rgb(34,211,238) — cyan-400 — so a test can
 * compare the declared value against the colour it is supposed to be.
 */
export function parseHslTriple(value: string): {
  h: number;
  s: number;
  l: number;
} {
  const parts = value
    .trim()
    .split(/\s+/)
    .map(part => Number.parseFloat(part));
  return {
    h: parts[0] ?? 0,
    s: (parts[1] ?? 0) / 100,
    l: (parts[2] ?? 0) / 100,
  };
}

/** Convert an hsl triple to rgb. */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hue = ((h % 360) + 360) % 360;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = hue / 60;
  const base: [number, number, number] =
    match < 1
      ? [chroma, second, 0]
      : match < 2
        ? [second, chroma, 0]
        : match < 3
          ? [0, chroma, second]
          : match < 4
            ? [0, second, chroma]
            : match < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const offset = l - chroma / 2;
  return [
    Math.round((base[0] + offset) * 255),
    Math.round((base[1] + offset) * 255),
    Math.round((base[2] + offset) * 255),
  ];
}
