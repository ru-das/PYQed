import { useColorScheme } from 'react-native';

// AGENTS.md §10 — Design language
export const Colors = {
  light: {
    background: '#F7F5F0',
    surface: '#FFFFFF',
    text: '#1C1B1A',
    textSecondary: '#6B6966',
    card: '#FFFFFF',
    border: '#E5E3DE',
    accent: '#4F46E5', // indigo
    accentText: '#FFFFFF',
    amber: '#D97706', // priority badge
    amberBg: '#FEF3C7',
    red: '#DC2626', // warnings
    redBg: '#FEE2E2',
    success: '#16A34A',
    successBg: '#DCFCE7',
    chip: '#EBE8E1',
  },
  dark: {
    background: '#121212',
    surface: '#1E1E1E',
    text: '#EDEBE6',
    textSecondary: '#9C9A95',
    card: '#1E1E1E',
    border: '#2E2E2E',
    accent: '#6366F1', // indigo for dark mode
    accentText: '#FFFFFF',
    amber: '#F59E0B',
    amberBg: '#78350F',
    red: '#EF4444',
    redBg: '#7F1D1D',
    success: '#22C55E',
    successBg: '#14532D',
    chip: '#2A2A2A',
  },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const FontSize = {
  h1: 28,
  h2: 22,
  h3: 17,
  body: 16,
  caption: 13,
  tiny: 11,
} as const;

export const BorderRadius = {
  card: 18,
  button: 12,
  chip: 8,
  input: 10,
} as const;

export type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  card: string;
  border: string;
  accent: string;
  accentText: string;
  amber: string;
  amberBg: string;
  red: string;
  redBg: string;
  success: string;
  successBg: string;
  chip: string;
};

/**
 * Hook to get theme colors following the device's system setting (light/dark).
 */
export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? Colors.dark : Colors.light;
}
