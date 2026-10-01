import { Text, type TextProps } from 'react-native';

import { fontSize, usePalette } from './theme';

export type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'caption';

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  muted?: boolean;
  color?: string;
}

/** Themed text. Sizes are in sp-scaled points, so they follow the system text-size setting. */
export function AppText({ variant = 'body', muted, color, style, ...rest }: AppTextProps) {
  const palette = usePalette();
  const size = fontSize[variant];
  const bold = variant === 'title' || variant === 'heading' || variant === 'label';
  return (
    <Text
      accessibilityRole={variant === 'title' || variant === 'heading' ? 'header' : undefined}
      {...rest}
      style={[
        {
          fontSize: size,
          lineHeight: Math.round(size * 1.35),
          fontWeight: bold ? '700' : '400',
          color: color ?? (muted ? palette.textMuted : palette.text),
        },
        style,
      ]}
    />
  );
}
