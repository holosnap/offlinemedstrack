import * as ReactNative from 'react-native';

import type { Palette } from '@/components';

// The palettes are module-private; read them by rendering the hook for each scheme.
import { renderHook } from '@testing-library/react-native';
import { usePalette } from '@/components';

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const paletteFor = async (scheme: 'light' | 'dark'): Promise<Palette> => {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
  const { result } = await renderHook(() => usePalette());
  return result.current;
};

/** Text and background pairs the app actually uses. WCAG AA needs 4.5:1 for text. */
const textPairs = (p: Palette): [string, string, string][] => [
  ['text on background', p.text, p.background],
  ['text on surface', p.text, p.surface],
  ['muted text on background', p.textMuted, p.background],
  ['muted text on surface', p.textMuted, p.surface],
  ['primary text on surface (secondary buttons, links)', p.primary, p.surface],
  ['primary text on background', p.primary, p.background],
  ['on-primary text on primary (primary buttons)', p.onPrimary, p.primary],
  ['on-danger text on danger (danger buttons)', p.onDanger, p.danger],
  ['danger text on background (errors)', p.danger, p.background],
  ['danger text on surface (errors)', p.danger, p.surface],
  ['warning text on warning background (badges)', p.warningText, p.warningBackground],
  ['info text on info background (badges, today)', p.infoText, p.infoBackground],
  ['success text on success background (calendar)', p.successText, p.successBackground],
  ['danger text on danger background (calendar)', p.dangerText, p.dangerBackground],
  ['muted text on calendar neutral days', p.textMuted, p.surface],
  ['on-primary text on selected choice', p.onPrimary, p.primary],
  ['text on selected-choice surface', p.text, p.surface],
];

describe.each(['light', 'dark'] as const)('%s palette contrast (WCAG AA)', (scheme) => {
  afterAll(() => jest.restoreAllMocks());

  it('meets 4.5:1 for every text and background pair in use', async () => {
    const palette = await paletteFor(scheme);
    const failures = textPairs(palette)
      .map(([name, fg, bg]) => ({ name, ratio: contrast(fg, bg) }))
      .filter((r) => r.ratio < 4.5)
      .map((r) => `${r.name}: ${r.ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it('meets 3:1 for borders and selection outlines against their surface', async () => {
    const p = await paletteFor(scheme);
    const pairs: [string, string, string][] = [
      ['input border on surface', p.border, p.surface],
      ['input border on background', p.border, p.background],
      ['selected outline (primary) on surface', p.primary, p.surface],
      ['selected outline (primary) on background', p.primary, p.background],
      ['warning outline on warning background', p.warningText, p.warningBackground],
      ['danger outline on background', p.danger, p.background],
    ];
    const failures = pairs
      .map(([name, fg, bg]) => ({ name, ratio: contrast(fg, bg) }))
      .filter((r) => r.ratio < 3)
      .map((r) => `${r.name}: ${r.ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });
});

it('actually exercises two different palettes', async () => {
  const light = await paletteFor('light');
  const dark = await paletteFor('dark');
  expect(light.background).not.toBe(dark.background);
  jest.restoreAllMocks();
});
