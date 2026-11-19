import type { AuthError } from '../../lib/auth';

export type AuthFormErrors = {
  email?: string;
  password?: string;
  confirmPassword?: string;
};

// 跟後端一致的寬鬆檢查即可，真正的驗證以後端 IsEmail 為準
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt 只看前 72 bytes，後端限制 8–72 字元；中文等多位元組字元也要確保不超過 72 bytes
export const PASSWORD_MAX_BYTES = 72;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateAuthForm(
  mode: 'login' | 'register',
  email: string,
  password: string,
  confirmPassword: string,
): AuthFormErrors {
  const errors: AuthFormErrors = {};
  const trimmed = email.trim();
  if (!trimmed) errors.email = '請輸入 Email';
  else if (!EMAIL_PATTERN.test(trimmed)) errors.email = 'Email 格式不正確';

  if (!password) {
    errors.password = '請輸入密碼';
  } else if (mode === 'register') {
    if (password.length < PASSWORD_MIN_LENGTH) errors.password = `密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元`;
    else if (utf8Length(password) > PASSWORD_MAX_BYTES) errors.password = '密碼太長了（最多 72 個英數字元）';
    if (password !== confirmPassword) errors.confirmPassword = '兩次輸入的密碼不一致';
  }
  return errors;
}

export function describeAuthError(err: AuthError, mode: 'login' | 'register'): string {
  switch (err.code) {
    case 'EMAIL_TAKEN':
      return '這個 Email 已經註冊過了，請直接登入。';
    case 'INVALID_CREDENTIALS':
      return 'Email 或密碼錯誤。';
    default:
      break;
  }
  if (err.status === 400) {
    // class-validator 的錯誤訊息是英文，依欄位轉成中文
    const text = err.details.join(' ').toLowerCase();
    if (text.includes('email')) return 'Email 格式不正確。';
    if (text.includes('password')) return '密碼長度需為 8–72 個字元。';
    if (text.includes('timezone')) return '無法辨識電腦的時區設定，請稍後再試。';
    return '輸入的資料格式不正確，請檢查後再試一次。';
  }
  if (err.status === 401) return mode === 'login' ? 'Email 或密碼錯誤。' : '註冊失敗，請稍後再試。';
  if (err.status === 429) return '嘗試次數過多，請稍候一分鐘再試。';
  if (err.status >= 500) return '伺服器暫時無法使用，請稍後再試。';
  return `${mode === 'login' ? '登入' : '註冊'}失敗（錯誤代碼 ${err.code ?? err.status}）。`;
}
