// 執行環境偵測：同一份前端同時跑在 Tauri 桌面 App 與手機/桌機瀏覽器（雲端網頁版）。
//
// 只在 Tauri 裡才能用的功能（invoke、Tauri 事件、視窗/螢幕 API、彈窗）一律先問 isTauri()，
// 瀏覽器模式下完全不呼叫，避免在 console 留下錯誤或卡住。
// `@tauri-apps/api/core` 本身只是定義函式、import 時沒有副作用，瀏覽器裡 import 是安全的；
// 它的 isTauri() 讀的是 Tauri 在頁面腳本執行前注入的 `window.isTauri`。
import { isTauri as tauriIsTauri } from '@tauri-apps/api/core';

export function isTauri(): boolean {
  try {
    return tauriIsTauri();
  } catch {
    return false;
  }
}

/**
 * 只有桌面 App 才有意義的頁面（/popup、/popup-manager）在瀏覽器裡要導去哪裡；
 * 在 Tauri 裡回傳 null（不導頁）。
 */
export function desktopOnlyRedirectTarget(): string | null {
  return isTauri() ? null : '/';
}

/** 手機排版的斷點：寬度 < 768px（Mantine 的 sm 斷點）改成單欄、手指操作的版面。 */
export const MOBILE_MEDIA_QUERY = '(max-width: 767.98px)';
