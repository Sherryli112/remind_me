import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { MantineProvider, mantineHtmlProps } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import './globals.css';
import { theme } from './theme';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'RemindMe 提醒管理工具',
  description: '本地部署的可自訂提醒管理介面',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" {...mantineHtmlProps} className={`${geistSans.variable} ${geistMono.variable}`}>
      <head />
      <body>
        <MantineProvider theme={theme} defaultColorScheme="light">
          <ModalsProvider>{children}</ModalsProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
