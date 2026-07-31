/**
 * Daylish design tokens — "Celeste".
 *
 * The palette is built from two colours: the light blue of the Argentine flag
 * and a pale butter yellow. Both read as fresh air and daylight rather than as
 * diet-app clinical or wellness-app earthy, which is the register the product
 * wants — Daylish is about eating well all day, not about restriction.
 *
 * Celeste carries the chrome. Butter appears sparingly, as a wash behind
 * something worth noticing. Sun is the single saturated accent and is spent once
 * per screen at most, on the thing you actually want tapped.
 *
 * Three rules here are product requirements, not taste:
 *
 * 1. **No alarm colour for nutrition state.** Going over a target is neutral
 *    information, so no red "over budget" token exists. `destructive` is only
 *    for irreversible actions.
 *
 * 2. **Celeste is never a data colour.** The brand blue is chrome. If a chart
 *    series were also blue, users could not tell the app's furniture from its
 *    data — which is why the macro palette below has no blue in it at all.
 *
 * 3. **Blue at full tint is not a text colour.** Celeste on white is about
 *    2.3:1. Anything carrying words uses `celesteInk` or darker.
 */

/**
 * Macro series colours — coral, violet, teal.
 *
 * Chosen by running the palette validator, not by eye, and deliberately
 * blue-free so the brand never competes with the data:
 *
 *   light  worst CVD ΔE 9.9 · worst normal-vision ΔE 24.8 · contrast all ≥ 3:1
 *   dark   worst CVD ΔE 10.9 · worst normal-vision ΔE 23.4 · contrast all ≥ 3:1
 *
 * This trio passes every check outright in both modes — including contrast,
 * which the previous blue/orange/aqua set only cleared with a labels-required
 * warning. Two warm hues were tried first and failed hard (ΔE 12.7 normal
 * vision): warm pairs cannot separate, least of all on a dark surface.
 *
 * Hue identity survives the light/dark switch, so protein is coral in both.
 */
const macroLight = { protein: '#e0543a', carbs: '#7a53c9', fat: '#12907a' } as const;
const macroDark = { protein: '#e8674a', carbs: '#9b7ae0', fat: '#17a88e' } as const;

export interface Palette {
  /** App background — daylight, a whisper of blue. */
  background: string;
  /** Cards and sheets. */
  surface: string;
  /** Recessed fills: inputs, tracks, pressed states. */
  surfaceSunken: string;
  /** A celeste wash, for tinted panels. */
  surfaceTinted: string;
  /** A butter wash — used sparingly, behind something worth noticing. */
  surfaceWarm: string;
  hairline: string;

  ink: string;
  inkSecondary: string;
  inkMuted: string;
  onDark: string;

  /** The flag blue. Fills, illustration, chrome — never text. */
  celeste: string;
  celesteSoft: string;
  /** Text-safe blue. Anything blue carrying words uses this. */
  celesteInk: string;
  /** Pale butter, for washes. */
  butter: string;
  /** The one saturated accent. Primary action and streaks only. */
  sun: string;

  ringTrack: string;
  ringFill: string;

  macro: { protein: string; carbs: string; fat: string };

  positive: string;
  /** Irreversible actions only. */
  destructive: string;
  estimate: string;
}

export const lightPalette: Palette = {
  background: '#F5FAFE',
  surface: '#FFFFFF',
  surfaceSunken: '#E8F1F9',
  surfaceTinted: '#E3F0FB',
  surfaceWarm: '#FEF8E0',
  hairline: '#D3E4F1',

  ink: '#16232E',
  inkSecondary: '#4A5C6B',
  inkMuted: '#7E909E',
  onDark: '#FFFFFF',

  celeste: '#74ACDF',
  celesteSoft: '#DCEBF8',
  celesteInk: '#2B6CA3',
  butter: '#FBEFC0',
  sun: '#F6B40E',

  ringTrack: '#DFEBF5',
  ringFill: '#74ACDF',

  macro: macroLight,

  positive: '#12907a',
  destructive: '#C0392B',
  estimate: '#7E909E',
};

/**
 * Dark mode is a supporting act, not the identity — the brief asked for a light
 * theme. It exists because iOS users toggle the OS setting and an app that
 * ignores it reads as broken. Steps are selected for the dark surface rather
 * than flipped from light.
 */
export const darkPalette: Palette = {
  background: '#131A21',
  surface: '#1B242D',
  surfaceSunken: '#24303B',
  surfaceTinted: '#1E2E3D',
  surfaceWarm: '#2C2819',
  hairline: '#2F3D49',

  ink: '#E9F1F7',
  inkSecondary: '#AFC0CE',
  inkMuted: '#7E909E',
  onDark: '#FFFFFF',

  celeste: '#74ACDF',
  celesteSoft: '#22344A',
  celesteInk: '#8FC0EC',
  butter: '#3A331C',
  sun: '#F6B40E',

  ringTrack: '#26323D',
  ringFill: '#74ACDF',

  macro: macroDark,

  positive: '#17a88e',
  destructive: '#E07A6C',
  estimate: '#7E909E',
};

/** 4pt base. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Softer than the previous ticket direction — this palette wants air, not edges. */
export const radii = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/**
 * Type roles.
 *
 * `displayWide` is Archivo Black — wide and heavy, used only for numbers and
 * short headings so it stays an event against otherwise light, airy pages.
 * `body` is Figtree, a warm geometric sans that reads well small.
 */
export const fonts = {
  display: 'Archivo_700Bold',
  displayWide: 'ArchivoBlack_400Regular',
  body: 'Figtree_400Regular',
  bodyMedium: 'Figtree_500Medium',
  bodySemi: 'Figtree_600SemiBold',
  numeric: 'Archivo_600SemiBold',
} as const;

export const typography = {
  hero: { fontSize: 54, lineHeight: 56, font: fonts.displayWide, letterSpacing: -1.6 },
  display: { fontSize: 30, lineHeight: 35, font: fonts.displayWide, letterSpacing: -0.7 },
  title: { fontSize: 22, lineHeight: 27, font: fonts.display, letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 22, font: fonts.bodySemi, letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 23, font: fonts.body, letterSpacing: 0 },
  bodyStrong: { fontSize: 16, lineHeight: 23, font: fonts.bodyMedium, letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 18, font: fonts.body, letterSpacing: 0 },
  captionStrong: { fontSize: 13, lineHeight: 18, font: fonts.bodySemi, letterSpacing: 0 },
  eyebrow: { fontSize: 11, lineHeight: 14, font: fonts.bodySemi, letterSpacing: 1.3 },
  numeric: { fontSize: 26, lineHeight: 30, font: fonts.numeric, letterSpacing: -0.5 },
  numericSmall: { fontSize: 15, lineHeight: 19, font: fonts.numeric, letterSpacing: -0.2 },
} as const;

export type TypographyVariant = keyof typeof typography;

/** Minimum tap target, per Apple's HIG. Logging controls never go below this. */
export const MIN_TAP_TARGET = 44;

/** Card top-rule weight. Thinner here than in the ticket direction — this palette is lighter. */
export const RULE_WEIGHT = 3;
