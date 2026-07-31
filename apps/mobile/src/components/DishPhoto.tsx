import { Image, useWindowDimensions, type StyleProp, type ImageStyle } from 'react-native';

import { DISH_PHOTOS } from '@/data/dish-photos.generated.ts';
import { useTheme } from '@/theme/index.tsx';

/**
 * The photograph of a finished dish.
 *
 * This lives in a component rather than as a lookup on the recipe repository
 * for a mechanical reason: `dish-photos.generated.ts` is a map of `require()`
 * calls, because that is the only form Metro can resolve to bundled assets at
 * build time. Node's ESM loader cannot parse `require` at all, so anything that
 * imports the map is unimportable from the runtime smoke test — and that test
 * imports the real recipe repository on purpose. Keeping the map behind a
 * component means the data layer stays loadable under plain Node, which is the
 * same reasoning that keeps the recipe seed in a generated `.ts` rather than a
 * `.json`.
 *
 * The photographs were generated from each recipe's own ingredient list, so
 * this is a reference for cooking against rather than decoration — it should
 * look like what comes out of the pan.
 */
export interface DishPhotoProps {
  /** The recipe title, including any variant suffix. */
  title: string;
  /**
   * `hero` sits at the top of a screen; `thumb` sits beside a line of text in a
   * list. The photographs are square, and a square at full screen width is
   * about 350pt tall — it pushes the title and the nutrition below the fold,
   * which is the wrong order for a screen someone opens to decide whether to
   * cook something. The hero is cropped to 3:2 instead: shallow enough to read
   * as a header, tall enough to still show the plate.
   */
  variant?: 'hero' | 'thumb';
  /**
   * Horizontal padding to escape, for a hero that should run edge to edge.
   *
   * A photograph inset inside the page gutters, floating above the title with a
   * gap all round, reads as pasted on top of the screen rather than as part of
   * it. Running it into the corners is what makes it a header. The caller
   * supplies the number because only the caller knows what its own container is
   * padded by.
   */
  bleed?: number;
  style?: StyleProp<ImageStyle>;
}

/** Wide enough to establish the dish, short enough to keep the facts in view. */
const HERO_ASPECT = 3 / 2;

/** Square, and sized to the two lines of text it sits beside. */
const THUMB_SIZE = 72;

/**
 * Key a title to its photograph.
 *
 * Deliberately *not* `identifyDish`'s `dishKey`, which strips every variant
 * suffix — that would send "Shakshuka, vegan" to the picture of the omnivore
 * one, feta and eggs included. Only the size suffix is dropped: light and
 * hearty are the same food in different amounts and share a photograph, while a
 * diet variant is a different plate and has its own.
 */
export function photoKey(title: string): string {
  return title
    .replace(/,\s*(light|hearty)$/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function DishPhoto({ title, variant = 'hero', bleed, style }: DishPhotoProps) {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const source = DISH_PHOTOS[photoKey(title)];

  // A missing photograph collapses the block. An empty grey rectangle reads as
  // a failed download and invites a pull-to-refresh that will never help.
  if (!source) return null;

  if (variant === 'thumb') {
    return (
      <Image
        source={source}
        style={[
          { backgroundColor: theme.palette.surface },
          { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: theme.radii.sm },
          style,
        ]}
        resizeMode="cover"
        accessible
        accessibilityIgnoresInvertColors
        accessibilityLabel={`${title}, cooked and plated`}
      />
    );
  }

  // Both dimensions in points, computed here rather than left to `aspectRatio`.
  //
  // `aspectRatio` is silently ignored on an <Image> whose width comes from
  // stretching — Yoga falls back to the asset's intrinsic ratio, and since
  // every photograph is square the hero rendered as a 390pt square that filled
  // the screen. The thumbnail never had the bug because it states both
  // dimensions outright, which is the whole lesson: state them.
  const heroWidth = bleed ? screenWidth : screenWidth - theme.spacing.lg * 2;
  const shape: ImageStyle = {
    width: heroWidth,
    height: Math.round(heroWidth / HERO_ASPECT),
    ...(bleed ? { marginHorizontal: -bleed } : { borderRadius: theme.radii.md }),
  };

  return (
    <Image
      source={source}
      style={[{ backgroundColor: theme.palette.surface }, shape, style]}
      // The dish is centred in every photograph, so cropping to a wider frame
      // takes evenly from top and bottom and keeps the plate whole.
      resizeMode="cover"
      accessible
      accessibilityIgnoresInvertColors
      accessibilityLabel={`${title}, cooked and plated`}
    />
  );
}
