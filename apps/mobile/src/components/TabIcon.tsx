import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type TabName = 'today' | 'meals' | 'ideas' | 'progress' | 'you';

/**
 * Hand-drawn tab glyphs.
 *
 * Drawn rather than pulled from an icon set so they share the ticket language:
 * flat 1.75px strokes, square caps, no filled shapes. An off-the-shelf icon font
 * would bring its own rounded-cap personality and quietly undo the rest of the
 * system.
 *
 * Each glyph is a literal object from the product's world — a day rail, a plate,
 * a sprig, a rising trend, a person — rather than an abstract symbol.
 */
export function TabIcon({ name, color, focused }: { name: TabName; color: string; focused: boolean }) {
  const sw = focused ? 2.1 : 1.75;
  const common = {
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
    fill: 'none',
  };

  switch (name) {
    case 'today':
      // The day rail, with entry pips — a miniature of the journal's signature.
      return (
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Path d="M7 3.5V20.5" {...common} />
          <Circle cx={7} cy={7.5} r={2.4} {...common} fill={focused ? color : 'none'} />
          <Circle cx={7} cy={13} r={2.4} {...common} fill={focused ? color : 'none'} />
          <Path d="M13 7.5H20" {...common} />
          <Path d="M13 13H18" {...common} />
          <Path d="M13 18.5H20" {...common} />
        </Svg>
      );

    case 'meals':
      // A plate with cutlery.
      return (
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Circle cx={11} cy={12} r={7.5} {...common} />
          <Circle cx={11} cy={12} r={3.6} {...common} fill={focused ? color : 'none'} />
          <Path d="M20.5 4.5V19.5" {...common} />
        </Svg>
      );

    case 'ideas':
      // A sprig — new growth, what to cook next.
      return (
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Path d="M12 21V8" {...common} />
          <Path d="M12 12C12 12 7.5 11.5 7.5 7C11 7 12 12 12 12Z" {...common} fill={focused ? color : 'none'} />
          <Path d="M12 9.5C12 9.5 16.5 9 16.5 4.5C13 4.5 12 9.5 12 9.5Z" {...common} fill={focused ? color : 'none'} />
        </Svg>
      );

    case 'progress':
      // A rising trend across a baseline.
      return (
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Path d="M3.5 20.5H20.5" {...common} />
          <Path d="M4 16L9.5 10.5L13.5 14L20 6.5" {...common} />
          <Rect x={17.5} y={4} width={5} height={5} {...common} fill={focused ? color : 'none'} />
        </Svg>
      );

    case 'you':
      return (
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Circle cx={12} cy={8} r={4} {...common} fill={focused ? color : 'none'} />
          <Path d="M4.5 20.5C4.5 16.6 7.9 14 12 14C16.1 14 19.5 16.6 19.5 20.5" {...common} />
        </Svg>
      );
  }
}
