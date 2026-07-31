import { useState } from 'react';
import { Image, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import {
  ILLUSTRATIONS,
  ILLUSTRATION_SOURCES,
  type IllustrationName,
  type Motif,
} from '@/illustrations/registry.ts';
import { useTheme } from '@/theme/index.tsx';

export interface IllustrationProps {
  name: IllustrationName;
  /** Height in points. Width follows the slot's aspect ratio, capped by the container. */
  height?: number;
  style?: ViewStyle;
}

/**
 * Renders an illustration slot.
 *
 * If a real asset is registered it is drawn; otherwise a procedural motif in the
 * palette stands in. The fallback is not a grey box with an icon — it is a
 * composed shape in celeste and butter, so a screen reads as finished before any
 * art exists and simply gets richer when the art arrives.
 *
 * The alt text comes from the registry and is applied either way, so screen
 * reader output does not depend on whether an image has been supplied.
 */
export function Illustration({ name, height = 132, style }: IllustrationProps) {
  const meta = ILLUSTRATIONS[name];
  const source = ILLUSTRATION_SOURCES[name];
  const [failed, setFailed] = useState(false);

  const width = height * meta.aspect;

  if (source && !failed) {
    return (
      <View style={[{ height, alignItems: 'center', justifyContent: 'center' }, style]}>
        <Image
          source={source}
          accessible
          accessibilityRole="image"
          accessibilityLabel={meta.alt}
          resizeMode="contain"
          onError={() => setFailed(true)}
          style={{ height, width, maxWidth: '100%' }}
        />
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={meta.alt}
      style={[{ height, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Motifs motif={meta.motif} height={height} width={width} />
    </View>
  );
}

/**
 * The procedural placeholders.
 *
 * Each is a handful of shapes built from the two brand colours. They lean
 * abstract on purpose: a crude literal drawing of a plate would read as unfinished
 * art, where a composition of circles and arcs reads as pattern.
 */
function Motifs({ motif, height, width }: { motif: Motif; height: number; width: number }) {
  const theme = useTheme();
  const { celeste, celesteSoft, butter, sun } = theme.palette;

  const w = width;
  const h = height;
  const cx = w / 2;
  const cy = h / 2;

  switch (motif) {
    case 'plate':
      return (
        <Svg width={w} height={h}>
          <Circle cx={cx} cy={cy} r={h * 0.42} fill={celesteSoft} />
          <Circle cx={cx} cy={cy} r={h * 0.42} stroke={celeste} strokeWidth={2.5} fill="none" />
          <Circle cx={cx} cy={cy} r={h * 0.24} stroke={celeste} strokeWidth={2} fill="none" />
          <Circle cx={cx} cy={cy} r={h * 0.1} fill={butter} />
        </Svg>
      );

    case 'sun':
      return (
        <Svg width={w} height={h}>
          <Circle cx={cx} cy={cy} r={h * 0.28} fill={butter} />
          <Circle cx={cx} cy={cy} r={h * 0.28} stroke={sun} strokeWidth={2.5} fill="none" />
          {Array.from({ length: 12 }, (_, i) => {
            const angle = (i / 12) * Math.PI * 2;
            const inner = h * 0.34;
            const outer = h * 0.44;
            return (
              <Path
                key={i}
                d={`M ${cx + Math.cos(angle) * inner} ${cy + Math.sin(angle) * inner} L ${cx + Math.cos(angle) * outer} ${cy + Math.sin(angle) * outer}`}
                stroke={celeste}
                strokeWidth={3}
                strokeLinecap="round"
              />
            );
          })}
        </Svg>
      );

    case 'ribbon':
      return (
        <Svg width={w} height={h}>
          <Path
            d={`M ${w * 0.1} ${h * 0.7} C ${w * 0.3} ${h * 0.2}, ${w * 0.45} ${h * 0.9}, ${w * 0.62} ${h * 0.4} S ${w * 0.85} ${h * 0.25}, ${w * 0.92} ${h * 0.5}`}
            stroke={celeste}
            strokeWidth={5}
            strokeLinecap="round"
            fill="none"
          />
          <Circle cx={w * 0.62} cy={h * 0.4} r={9} fill={butter} stroke={sun} strokeWidth={2} />
        </Svg>
      );

    case 'basket':
      return (
        <Svg width={w} height={h}>
          <Path
            d={`M ${cx - h * 0.36} ${cy - h * 0.06} H ${cx + h * 0.36} L ${cx + h * 0.26} ${cy + h * 0.34} H ${cx - h * 0.26} Z`}
            fill={celesteSoft}
            stroke={celeste}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <Path
            d={`M ${cx - h * 0.2} ${cy - h * 0.06} A ${h * 0.2} ${h * 0.2} 0 0 1 ${cx + h * 0.2} ${cy - h * 0.06}`}
            stroke={celeste}
            strokeWidth={2.5}
            fill="none"
          />
          <Circle cx={cx - h * 0.1} cy={cy + h * 0.12} r={h * 0.07} fill={butter} />
          <Circle cx={cx + h * 0.09} cy={cy + h * 0.14} r={h * 0.05} fill={sun} opacity={0.55} />
        </Svg>
      );

    case 'steam':
      return (
        <Svg width={w} height={h}>
          <Ellipse cx={cx} cy={cy + h * 0.24} rx={h * 0.36} ry={h * 0.1} fill={celesteSoft} />
          <Path
            d={`M ${cx - h * 0.3} ${cy + h * 0.2} H ${cx + h * 0.3}`}
            stroke={celeste}
            strokeWidth={3}
            strokeLinecap="round"
          />
          {[-0.16, 0, 0.16].map((offset, i) => (
            <Path
              key={i}
              d={`M ${cx + w * offset * 0.4} ${cy + h * 0.06} c -10 -14, 10 -22, 0 -36`}
              stroke={i === 1 ? sun : celeste}
              strokeWidth={3}
              strokeLinecap="round"
              fill="none"
              opacity={i === 1 ? 0.9 : 0.6}
            />
          ))}
        </Svg>
      );

    case 'leaf':
      return (
        <Svg width={w} height={h}>
          <G>
            <Path
              d={`M ${cx} ${cy + h * 0.34} C ${cx - h * 0.34} ${cy + h * 0.1}, ${cx - h * 0.28} ${cy - h * 0.3}, ${cx} ${cy - h * 0.36} C ${cx + h * 0.28} ${cy - h * 0.3}, ${cx + h * 0.34} ${cy + h * 0.1}, ${cx} ${cy + h * 0.34} Z`}
              fill={celesteSoft}
              stroke={celeste}
              strokeWidth={2.5}
            />
            <Path
              d={`M ${cx} ${cy + h * 0.3} V ${cy - h * 0.3}`}
              stroke={celeste}
              strokeWidth={2}
            />
            <Circle cx={cx} cy={cy - h * 0.02} r={h * 0.07} fill={butter} />
          </G>
        </Svg>
      );

    case 'chart':
      return (
        <Svg width={w} height={h}>
          <Rect
            x={w * 0.1}
            y={cy + h * 0.28}
            width={w * 0.8}
            height={2.5}
            fill={celeste}
            opacity={0.4}
          />
          {[0.24, 0.4, 0.3, 0.52, 0.44, 0.62].map((value, i) => (
            <Rect
              key={i}
              x={w * 0.14 + i * (w * 0.13)}
              y={cy + h * 0.28 - h * value}
              width={w * 0.075}
              height={h * value}
              rx={4}
              fill={i === 5 ? butter : celesteSoft}
              stroke={i === 5 ? sun : celeste}
              strokeWidth={2}
            />
          ))}
        </Svg>
      );
  }
}
