import type { Metadata, Viewport } from 'next';
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
  description: '雲端同步的可自訂提醒管理工具',
  // 手機「加入主畫面」用（manifest 由 app/manifest.ts 產生）
  applicationName: 'RemindMe',
  icons: {
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'RemindMe',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  // Next 只輸出標準的 mobile-web-app-capable；iOS 16.4 以前要這個舊名稱才會以 standalone 開啟
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

// width=device-width, initial-scale=1 是 Next 預設會帶的；這裡只補瀏覽器工具列的顏色
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2ff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
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
