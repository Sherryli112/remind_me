import { loginConfirmText, logoutConfirmText } from './modeText';

describe('登入 / 登出確認對話框文字', () => {
  it('登入前提示本機提醒數量、會保留、不合併', () => {
    expect(loginConfirmText(3)).toBe('登入後會顯示雲端帳號的提醒；這台電腦上的 3 則本機提醒會保留，登出後回來。');
    expect(loginConfirmText(0)).toContain('0 則本機提醒');
  });

  it('桌面 App 登出會說明回到本機提醒；網頁版只確認 email', () => {
    expect(logoutConfirmText('a@b.com', true)).toContain('回到這台電腦上的本機提醒');
    expect(logoutConfirmText('a@b.com', false)).toBe('確定要登出 a@b.com 嗎？');
  });
});
