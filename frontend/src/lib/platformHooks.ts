'use client';

// React hooks 版的環境偵測。用 useSyncExternalStore 而不是 useState + useEffect：
// 靜態匯出時預渲染一律拿 server snapshot（false），hydration 完 React 會立刻用
// client snapshot 重新渲染，不會有 hydration mismatch，也不用多等一個 effect。
import { useSyncExternalStore } from 'react';
import { isTauri, MOBILE_MEDIA_QUERY } from './platform';

const noopSubscribe = () => () => {};
const serverFalse = () => false;

/** 是否在 Tauri 桌面 App 裡（執行期間不會變）。 */
export function useIsTauri(): boolean {
  return useSyncExternalStore(noopSubscribe, isTauri, serverFalse);
}

function subscribeMobile(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getMobileSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/** 視窗寬度是否 < 768px（手機排版）。桌面 App 視窗最小 860，永遠是 false。 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, getMobileSnapshot, serverFalse);
}
