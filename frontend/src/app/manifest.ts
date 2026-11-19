import type { MetadataRoute } from 'next';

// 靜態匯出時會產生 /manifest.webmanifest。讓手機瀏覽器可以「加入主畫面」，
// 以全螢幕（standalone）方式開啟網頁版。不註冊 service worker（不做離線、也不推播）。
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RemindMe 提醒管理工具',
    short_name: 'RemindMe',
    description: '雲端同步的可自訂提醒管理工具',
    lang: 'zh-Hant',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#eef2ff',
    theme_color: '#eef2ff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
