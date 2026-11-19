/**
 * 修改密碼：表單驗證、錯誤訊息、成功後更新 token（jest testEnvironment 是 node，localStorage / window / fetch 手動 mock）。
 */

// 讓這個檔案成為獨立模組，避免跟 apiBase.test.ts 的頂層變數在型別檢查時撞名
export {};

const invokeMock = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(undefined));
jest.mock('@tauri-apps/api/event', () => ({
  emitTo: () => Promise.resolve(),
}));
jest.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const g = globalThis as unknown as {
  localStorage: MemoryStorage;
  window: { location: { pathname: string; replace: jest.Mock } };
  fetch: jest.Mock;
};

const USER = { id: 'u1', email: 'a@b.com', timezone: 'Asia/Taipei' };
const originalApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  jest.resetModules();
  invokeMock.mockClear();
  g.localStorage = new MemoryStorage();
  g.window = { location: { pathname: '/', replace: jest.fn() } };
  g.localStorage.setItem(
    'remindme.auth',
    JSON.stringify({ accessToken: 'old-access', refreshToken: 'old-refresh', user: USER }),
  );
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).localStorage;
  if (originalApiBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
  else process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBase;
});

describe('validateChangePasswordForm', () => {
  it('檢查必填、長度、跟目前密碼相同、兩次輸入不一致', async () => {
    const { validateChangePasswordForm } = await import('./account');
    expect(validateChangePasswordForm('', '', '')).toEqual({
      currentPassword: '請輸入目前的密碼',
      newPassword: '請輸入新密碼',
    });
    expect(validateChangePasswordForm('old-pass', 'short', 'short').newPassword).toBe('新密碼至少需要 8 個字元');
    expect(validateChangePasswordForm('old-pass', '密'.repeat(25), '密'.repeat(25)).newPassword).toBe(
      '新密碼太長了（最多 72 個英數字元）',
    );
    expect(validateChangePasswordForm('same-pass', 'same-pass', 'same-pass').newPassword).toBe(
      '新密碼不能跟目前的密碼一樣',
    );
    expect(validateChangePasswordForm('old-pass', 'new-password', 'new-passw0rd')).toEqual({
      confirmPassword: '兩次輸入的新密碼不一致',
    });
    expect(validateChangePasswordForm('old-pass', 'new-password', 'new-password')).toEqual({});
  });
});

describe('changePassword', () => {
  it('成功：帶 Bearer 打 /auth/change-password，存新 token 並交給 Rust', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    g.fetch = jest.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh', user: USER }),
      );
    });
    const { changePassword } = await import('./account');

    await changePassword('old-password', 'new-password');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:3000/auth/change-password');
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer old-access');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
    expect(JSON.parse(g.localStorage.getItem('remindme.auth')!)).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      user: USER,
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'set_session',
      expect.objectContaining({ accessToken: 'new-access' }),
    );
  });

  it('目前密碼錯誤：丟 AuthError(400, INVALID_CURRENT_PASSWORD)，token 不變', async () => {
    g.fetch = jest.fn(() =>
      Promise.resolve(jsonResponse(400, { code: 'INVALID_CURRENT_PASSWORD', message: '目前的密碼不正確' })),
    );
    const { changePassword, describeChangePasswordError } = await import('./account');

    const err = await changePassword('wrong', 'new-password').catch((e: unknown) => e);

    expect(err).toMatchObject({ status: 400, code: 'INVALID_CURRENT_PASSWORD' });
    expect(describeChangePasswordError(err)).toBe('目前的密碼不正確。');
    expect(JSON.parse(g.localStorage.getItem('remindme.auth')!).accessToken).toBe('old-access');
  });
});

describe('describeChangePasswordError', () => {
  it('依狀態碼轉成中文', async () => {
    const { describeChangePasswordError } = await import('./account');
    const { AuthError } = await import('./auth');
    expect(describeChangePasswordError(new AuthError(400, null, ['newPassword must be longer']))).toBe(
      '新密碼長度需為 8–72 個字元。',
    );
    expect(describeChangePasswordError(new AuthError(429, null))).toBe('嘗試次數過多，請稍候一分鐘再試。');
    expect(describeChangePasswordError(new AuthError(503, null))).toBe('伺服器暫時無法使用，請稍後再試。');
    expect(describeChangePasswordError(new TypeError('Failed to fetch'))).toBe(
      '無法連線到伺服器，請確認網路後再試一次。',
    );
  });
});
