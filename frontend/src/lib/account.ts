// 帳號相關操作（目前只有修改密碼）。只在雲端模式（已登入）使用；/auth/* 一律打雲端。
import { apiFetch } from './apiBase';
import { AuthError, setStoredAuth, syncSessionToRust, type StoredAuth } from './auth';

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt 只看前 72 bytes，後端限制 8–72 字元且 UTF-8 不超過 72 bytes
export const PASSWORD_MAX_BYTES = 72;

export type ChangePasswordErrors = {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateChangePasswordForm(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): ChangePasswordErrors {
  const errors: ChangePasswordErrors = {};
  if (!currentPassword) errors.currentPassword = '請輸入目前的密碼';
  if (!newPassword) errors.newPassword = '請輸入新密碼';
  else if ([...newPassword].length < PASSWORD_MIN_LENGTH) errors.newPassword = `新密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元`;
  else if (utf8Length(newPassword) > PASSWORD_MAX_BYTES) errors.newPassword = '新密碼太長了（最多 72 個英數字元）';
  else if (newPassword === currentPassword) errors.newPassword = '新密碼不能跟目前的密碼一樣';
  if (newPassword && newPassword !== confirmPassword) errors.confirmPassword = '兩次輸入的新密碼不一致';
  return errors;
}

function isStoredAuth(value: unknown): value is StoredAuth {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const user = v.user as Record<string, unknown> | null | undefined;
  return (
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof user === 'object' &&
    user !== null &&
    typeof user.id === 'string' &&
    typeof user.email === 'string'
  );
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 修改密碼。成功後後端會讓其他裝置登出，並回傳這台裝置的新 token：
 * 存進 localStorage 並交給 Rust 輪詢器（同一個帳號，不會切換模式）。
 * 失敗丟 AuthError（status + code），用 describeChangePasswordError 轉成中文。
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await apiFetch('/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await readJson(res);
  if (!res.ok) {
    const obj = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
    const details = Array.isArray(obj.message)
      ? obj.message.filter((m): m is string => typeof m === 'string')
      : typeof obj.message === 'string'
        ? [obj.message]
        : [];
    throw new AuthError(res.status, typeof obj.code === 'string' ? obj.code : null, details);
  }
  if (!isStoredAuth(data)) throw new AuthError(res.status, 'INVALID_RESPONSE');
  setStoredAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
  await syncSessionToRust();
}

export function describeChangePasswordError(err: unknown): string {
  if (!(err instanceof AuthError)) return '無法連線到伺服器，請確認網路後再試一次。';
  if (err.code === 'INVALID_CURRENT_PASSWORD') return '目前的密碼不正確。';
  if (err.status === 400) return '新密碼長度需為 8–72 個字元。';
  if (err.status === 401) return '登入已過期，請重新登入後再試。';
  if (err.status === 429) return '嘗試次數過多，請稍候一分鐘再試。';
  if (err.status >= 500) return '伺服器暫時無法使用，請稍後再試。';
  return '修改密碼失敗，請稍後再試。';
}
