/**
 * 啟動時驗證環境變數（由 ConfigModule.forRoot({ validate }) 呼叫）。
 * 缺少必要變數時直接丟錯，讓程序在 bootstrap 階段就結束，而不是帶著不安全的設定跑起來。
 */
export const JWT_SECRET_MIN_LENGTH = 32;

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const secret = config.JWT_ACCESS_SECRET;
  if (typeof secret !== 'string' || secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `環境變數 JWT_ACCESS_SECRET 必須存在且至少 ${JWT_SECRET_MIN_LENGTH} 個字元`,
    );
  }

  const ttlDays = config.REFRESH_TOKEN_TTL_DAYS;
  if (ttlDays !== undefined && ttlDays !== '') {
    const n = Number(ttlDays);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error('環境變數 REFRESH_TOKEN_TTL_DAYS 必須是正整數');
    }
  }

  return config;
}

export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3001',
  'http://tauri.localhost',
  'tauri://localhost',
];

export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return DEFAULT_CORS_ORIGINS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
