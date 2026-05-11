'use client';

import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'indigo',
  primaryShade: { light: 6, dark: 4 },
  defaultRadius: 'lg',
  fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
  fontFamilyMonospace: 'var(--font-geist-mono), ui-monospace, monospace',
  headings: {
    fontWeight: '700',
  },
  cursorType: 'pointer',
  radius: {
    xs: '6px',
    sm: '10px',
    md: '14px',
    lg: '18px',
    xl: '24px',
  },
  shadows: {
    xs: '0 1px 2px rgba(15, 23, 42, 0.05)',
    sm: '0 4px 12px rgba(15, 23, 42, 0.08)',
    md: '0 8px 24px rgba(15, 23, 42, 0.10)',
    lg: '0 16px 40px rgba(15, 23, 42, 0.14)',
    xl: '0 24px 60px rgba(15, 23, 42, 0.18)',
  },
});
