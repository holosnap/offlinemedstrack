import { useColorScheme } from 'react-native';

export interface Palette {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  danger: string;
  onDanger: string;
  warningBackground: string;
  warningText: string;
  infoBackground: string;
  infoText: string;
}

// All text/background pairs meet WCAG AA (4.5:1); borders on inputs meet 3:1.
const light: Palette = {
  background: '#F4F6F8',
  surface: '#FFFFFF',
  text: '#111827',
  textMuted: '#4B5563',
  border: '#6B7280',
  primary: '#0B5FCC',
  onPrimary: '#FFFFFF',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  warningBackground: '#FFE9B8',
  warningText: '#6B3A00',
  infoBackground: '#E1E8F2',
  infoText: '#1F2A44',
};

const dark: Palette = {
  background: '#0F1115',
  surface: '#1B1E24',
  text: '#F3F4F6',
  textMuted: '#B6BDC9',
  border: '#8B93A1',
  primary: '#8DBBFF',
  onPrimary: '#0B1F3D',
  danger: '#FF9C94',
  onDanger: '#3A0A06',
  warningBackground: '#4A3300',
  warningText: '#FFE2A3',
  infoBackground: '#2A3242',
  infoText: '#DCE4F2',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = 12;
/** Minimum height of anything tappable (above the 44–48dp platform guidance). */
export const minTouchTarget = 56;

export const fontSize = { caption: 16, body: 18, label: 18, heading: 22, title: 28 } as const;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
