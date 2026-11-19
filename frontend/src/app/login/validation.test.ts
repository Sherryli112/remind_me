import { AuthError } from '../../lib/auth';
import { describeAuthError, validateAuthForm } from './validation';

describe('validateAuthForm', () => {
  it('登入只檢查必填與 email 格式', () => {
    expect(validateAuthForm('login', '', '', '')).toEqual({ email: '請輸入 Email', password: '請輸入密碼' });
    expect(validateAuthForm('login', 'not-an-email', 'x', '')).toEqual({ email: 'Email 格式不正確' });
    expect(validateAuthForm('login', ' a@b.com ', 'short', '')).toEqual({});
  });

  it('註冊檢查密碼長度（8–72 bytes）與確認密碼', () => {
    expect(validateAuthForm('register', 'a@b.com', 'short', 'short').password).toMatch('至少');
    expect(validateAuthForm('register', 'a@b.com', 'a'.repeat(73), 'a'.repeat(73)).password).toMatch('太長');
    // 25 個中文字 = 75 bytes，超過 bcrypt 上限
    expect(validateAuthForm('register', 'a@b.com', '密'.repeat(25), '密'.repeat(25)).password).toMatch('太長');
    expect(validateAuthForm('register', 'a@b.com', 'password123', 'password124').confirmPassword).toBeDefined();
    expect(validateAuthForm('register', 'a@b.com', 'password123', 'password123')).toEqual({});
  });
});

describe('describeAuthError', () => {
  it('對應規格裡的錯誤代碼', () => {
    expect(describeAuthError(new AuthError(409, 'EMAIL_TAKEN'), 'register')).toMatch('已經註冊');
    expect(describeAuthError(new AuthError(401, 'INVALID_CREDENTIALS'), 'login')).toMatch('Email 或密碼錯誤');
  });

  it('class-validator 的 400 錯誤轉成中文', () => {
    expect(describeAuthError(new AuthError(400, null, ['email must be an email']), 'register')).toMatch('Email 格式');
    expect(
      describeAuthError(new AuthError(400, null, ['password must be longer than or equal to 8 characters']), 'register'),
    ).toMatch('8–72');
    expect(describeAuthError(new AuthError(429, null), 'login')).toMatch('次數過多');
  });
});
