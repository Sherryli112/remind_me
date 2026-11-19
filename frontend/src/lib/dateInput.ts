/**
 * 表單的日期時間欄位是沒有時區的本地時間字串（例如 "2026-06-01T18:30"）。
 * 送給 API 前要轉成帶時區的 ISO 字串：雲端後端跑在 UTC，直接送原字串會被當成 UTC 解析而差好幾小時。
 * 空字串回 null（代表不限制）；無法解析的字串原樣送出，交給後端驗證回 400。
 */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
