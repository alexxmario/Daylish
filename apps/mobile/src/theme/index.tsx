import { createContext, useContext, useMemo, type ReactNode } from 'react';

// `darkPalette` is intentionally not imported here — see the note below. It is
// still re-exported through `export *`, so it stays reachable and type-checked.
import { fonts, lightPalette, radii, spacing, typography, type Palette } from './tokens.ts';

export * from './tokens.ts';

export interface Theme {
  palette: Palette;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  fonts: typeof fonts;
  isDark: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Daylish is a light-themed app.
 *
 * This is a product decision rather than a missing feature. The whole palette is
 * built from daylight — celeste and butter on a pale blue paper — and the name
 * itself is about the shape of a day. Rendering that identity dark half the time,
 * depending on a setting the user changed for other reasons, would make the app
 * two different products with one codebase.
 *
 * `darkPalette` is kept and stays validated (its macro colours clear every
 * contrast and colour-vision check against the dark surface). It is simply not
 * wired up. To offer dark mode later, three things change together:
 *
 *   1. here — read `useColorScheme()` or a stored preference and pick a palette;
 *   2. `userInterfaceStyle` in `app.json`;
 *   3. the `StatusBar` style in the root layout.
 *
 * All three pin the native chrome to light today, so keyboards, alerts and
 * sheets match the app rather than arriving dark on a pale screen.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useMemo<Theme>(
    () => ({
      palette: lightPalette,
      spacing,
      radii,
      typography,
      fonts,
      isDark: false,
    }),
    [],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside a ThemeProvider');
  return theme;
}
