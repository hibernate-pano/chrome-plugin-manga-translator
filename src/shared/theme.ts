/**
 * The three themes, and the palette each one paints with.
 *
 * A theme is a palette, not a second set of components. Every surface in the
 * extension is written against the same six names — paper, ink, ink-muted,
 * vermilion, blueprint, rule — so switching a theme swaps the values and
 * leaves the markup alone. `src/index.css` declares the same six as HSL
 * triples for Tailwind; `src/design-tokens.test.ts` reads that file back and
 * asserts it agrees with the table below, so the two cannot drift.
 *
 * The overlays (HUD, reading panel, badges, dialogs) live in shadow roots on
 * somebody else's page, where the page's CSS variables do not reach. They get
 * the palette as `--mt-*` custom properties instead, emitted by
 * `overlayThemeCss()`. Same values, different delivery.
 *
 * `panel` inverts polarity on purpose: `paper` is the dark surface and `ink`
 * is the light type. Components that say `bg-paper text-ink` keep working and
 * simply swap roles, which is why one theme can be dark without a second set
 * of classes.
 */

export const THEME_NAMES = ['proof', 'panel', 'poster'] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

/** What each theme is called in the interface, and where it came from. */
export interface ThemeDescriptor {
  name: ThemeName;
  /** The name shown to the reader. */
  label: string;
  /** One line of provenance, shown next to the picker. */
  origin: string;
  /** Whether the surface is dark. Drives `color-scheme`, nothing else. */
  dark: boolean;
}

export const THEMES: readonly ThemeDescriptor[] = [
  {
    name: 'proof',
    label: '校正紙',
    origin: '纸 · 墨 · 朱红批注',
    dark: false,
  },
  {
    name: 'panel',
    label: '分镜黑',
    origin: '墨底 · 纸白 · 分镜框',
    dark: true,
  },
  {
    name: 'poster',
    label: '巨字海报',
    origin: '纯白 · 纯黑 · 信号红',
    dark: false,
  },
];

export const DEFAULT_THEME: ThemeName = 'proof';

/**
 * The six semantic colours, plus the two that only exist to make a label
 * readable on top of an accent fill.
 *
 * Hex, not HSL: these values are handed to shadow-root CSS strings and to
 * contrast assertions, and both are easier to read in hex. `index.css` holds
 * the HSL form Tailwind needs; a test keeps the two in step.
 */
export interface ThemePalette {
  paper: string;
  ink: string;
  'ink-muted': string;
  vermilion: string;
  blueprint: string;
  rule: string;
  'rule-soft': string;
  /** Text drawn on a vermilion fill. */
  'on-accent': string;
  /** The raised surface behind a control, e.g. a hovered row. */
  secondary: string;
}

export const THEME_PALETTES: Record<ThemeName, ThemePalette> = {
  // 校正紙 — cold paper, ink, a vermilion correction pen, a blue construction
  // line. Vermilion is for actions and errors; blueprint for structure.
  proof: {
    paper: '#E9E9E2',
    ink: '#161616',
    'ink-muted': '#55554F',
    vermilion: '#D33A2C',
    blueprint: '#1F4FA8',
    rule: '#7F7F79',
    'rule-soft': '#C9C9C1',
    'on-accent': '#FFFFFF',
    secondary: '#DCDCD4',
  },
  // 分镜黑 — 服部一成 rules: ink surface, paper type, signal vermilion.
  // The accent keeps black labels: white on #FF3B1F is 3.56:1, black is
  // 5.53:1, so a white label would fail the 4.5:1 the rest of the product
  // holds itself to.
  panel: {
    paper: '#0B0B0B',
    ink: '#F2F0EA',
    'ink-muted': '#A8A69E',
    vermilion: '#FF3B1F',
    blueprint: '#8FB3F0',
    rule: '#8A8880',
    'rule-soft': '#2E2E2C',
    'on-accent': '#0B0B0B',
    secondary: '#252523',
  },
  // 巨字海报 — pure white, pure black, one signal red. No paper tint: the
  // page is a newspaper column and the type carries the structure.
  poster: {
    paper: '#FFFFFF',
    ink: '#000000',
    'ink-muted': '#555555',
    vermilion: '#E2231A',
    blueprint: '#333333',
    rule: '#767676',
    'rule-soft': '#D4D4D4',
    'on-accent': '#FFFFFF',
    secondary: '#F2F2F2',
  },
};

/** Is this value one of the three theme names? */
export function isThemeName(value: unknown): value is ThemeName {
  return (
    typeof value === 'string' &&
    (THEME_NAMES as readonly string[]).includes(value)
  );
}

/**
 * Resolve a stored or requested value into a theme name.
 *
 * Anything unrecognised — a `dark` left by an older build, a null from a
 * fresh profile, a value from a future version — falls back to the default
 * rather than to an unstyled page.
 */
export function resolveThemeName(value: unknown): ThemeName {
  return isThemeName(value) ? value : DEFAULT_THEME;
}

/** The descriptor for a theme name. */
export function themeDescriptor(name: ThemeName): ThemeDescriptor {
  const found = THEMES.find(theme => theme.name === name);
  // THEMES covers THEME_NAMES exhaustively; the fallback keeps the return
  // type honest without a non-null assertion.
  return found ?? { name: DEFAULT_THEME, label: '', origin: '', dark: false };
}

/**
 * The palette as `--mt-*` custom properties, for a shadow root.
 *
 * The overlays used to hard-code `#E9E9E2` and `#161616` in their style
 * strings. Those literals were the reason a theme could not reach them: a
 * shadow root inherits no variables from the page, so the palette has to be
 * written into the sheet. `:host` is the shadow root's own element, so one
 * block covers every rule inside it.
 *
 * Each colour is emitted twice: as a hex value for solid fills, and as
 * space-separated channels (`--mt-ink-rgb`) for the translucent hairlines and
 * offsets the overlays draw. `rgb(var(--mt-ink-rgb) / 18%)` is the same
 * colour at 18% and works on Chrome 110, which `manifest.json` names as the
 * floor — `color-mix()` would have required 111.
 */
export function overlayThemeCss(name: ThemeName): string {
  const palette = THEME_PALETTES[name];
  const declarations = Object.entries(palette)
    .map(([token, value]) => {
      const channels = hexChannels(value);
      const rgb = channels ? `\n    --mt-${token}-rgb: ${channels};` : '';
      return `--mt-${token}: ${value};${rgb}`;
    })
    .join('\n    ');
  return `:host {
    color-scheme: ${themeDescriptor(name).dark ? 'dark' : 'light'};
    ${declarations}
  }`;
}

/**
 * `#RRGGBB` to `R G B`, for the `rgb(... / alpha)` form.
 *
 * Returns null for anything that is not a six-digit hex: a palette entry that
 * is already an `rgb()` string keeps working as a solid colour and simply
 * gets no alpha variant.
 */
export function hexChannels(value: string): string | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const digits = match[1] ?? '';
  const parts = [0, 2, 4].map(offset =>
    Number.parseInt(digits.slice(offset, offset + 2), 16)
  );
  return parts.join(' ');
}
