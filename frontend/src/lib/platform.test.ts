/**
 * 瀏覽器模式（不在 Tauri 裡）的行為測試：isTauri 判斷、彈窗頁導回首頁、
 * 以及 auth / apiFetch 在瀏覽器裡完全不呼叫 invoke 與 Tauri 事件。
 * jest testEnvironment 是 node，localStorage / window / fetch 都手動 mock（同 apiBase.test.ts）。
 */
import fs from 'node:fs';
import path from 'node:path';

let tauriFlag: boolean | 'throw' = false;
const invokeMock = jest.fn<Promise<undefined>, unknown[]>(() => Promise.resolve(undefined));
const emitToMock = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());

jest.mock('@tauri-apps/api/core', () => ({
  isTauri: () => {
    if (tauriFlag === 'throw') throw new Error('boom');
    return tauriFlag;
  },
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
jest.mock('@tauri-apps/api/event', () => ({
  emitTo: (...args: unknown[]) => emitToMock(...args),
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
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const g = globalThis as unknown as {
  localStorage: MemoryStorage;
  window: { location: { pathname: string; replace: jest.Mock } };
  fetch: jest.Mock;
};

let replaceMock: jest.Mock;
let fetchedUrls: string[];

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  g.fetch = jest.fn((url: string, init: RequestInit = {}) => {
    fetchedUrls.push(url);
    return Promise.resolve(handler(url, init));
  });
}

function seedAuth(accessToken = 'old-access', refreshToken = 'refresh-1') {
  g.localStorage.setItem(
    'remindme.auth',
    JSON.stringify({ accessToken, refreshToken, user: { id: 'u1', email: 'a@b.com', timezone: 'Asia/Taipei' } }),
  );
}

async function loadModules() {
  const platform = await import('./platform');
  const api = await import('./apiBase');
  const auth = await import('./auth');
  return { platform, api, auth };
}

beforeEach(() => {
  jest.resetModules();
  tauriFlag = false;
  invokeMock.mockClear();
  emitToMock.mockClear();
  fetchedUrls = [];
  replaceMock = jest.fn();
  g.localStorage = new MemoryStorage();
  g.window = { location: { pathname: '/', replace: replaceMock } };
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe('isTauri', () => {
  it('跟著 @tauri-apps/api/core 的 isTauri()', async () => {
    const { platform } = await loadModules();
    tauriFlag = true;
    expect(platform.isTauri()).toBe(true);
    tauriFlag = false;
    expect(platform.isTauri()).toBe(false);
  });

  it('偵測時丟例外就當成不在 Tauri 裡', async () => {
    const { platform } = await loadModules();
    tauriFlag = 'throw';
    expect(platform.isTauri()).toBe(false);
  });
});

describe('desktopOnlyRedirectTarget（/popup、/popup-manager）', () => {
  it('瀏覽器裡導回首頁', async () => {
    const { platform } = await loadModules();
    expect(platform.desktopOnlyRedirectTarget()).toBe('/');
  });

  it('Tauri 裡不導頁', async () => {
    tauriFlag = true;
    const { platform } = await loadModules();
    expect(platform.desktopOnlyRedirectTarget()).toBeNull();
  });
});

describe('MOBILE_MEDIA_QUERY', () => {
  it('跟 globals.css 的手機斷點一致', async () => {
    const { platform } = await loadModules();
    const css = fs.readFileSync(path.join(__dirname, '../app/globals.css'), 'utf8');
    expect(css).toContain(`@media ${platform.MOBILE_MEDIA_QUERY}`);
  });
});

describe('瀏覽器模式不呼叫 Tauri', () => {
  it('getTauriInvoke 回傳 null，sync / clear session 不呼叫 invoke', async () => {
    seedAuth();
    const { auth } = await loadModules();
    expect(await auth.getTauriInvoke()).toBeNull();
    await auth.syncSessionToRust();
    await auth.clearRustSession();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('login / logout 照常存取 token，但不呼叫 set_session / clear_session', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return jsonResponse(200, {
          accessToken: 'a1',
          refreshToken: 'r1',
          user: { id: 'u1', email: 'a@b.com', timezone: 'Asia/Taipei' },
        });
      }
      return jsonResponse(204, undefined);
    });
    const { auth } = await loadModules();
    await auth.login('a@b.com', 'password1234');
    expect(auth.getStoredAuth()?.accessToken).toBe('a1');
    await auth.logout();
    expect(auth.getStoredAuth()).toBeNull();
    expect(fetchedUrls.some((u) => u.endsWith('/auth/logout'))).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('401 → refresh → 重試成功，過程中不呼叫 invoke', async () => {
    seedAuth();
    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) return jsonResponse(200, { accessToken: 'new-access' });
      const authz = new Headers(init.headers).get('Authorization');
      return authz === 'Bearer new-access' ? jsonResponse(200, []) : jsonResponse(401, {});
    });
    const { api, auth } = await loadModules();
    const res = await api.apiFetch('/reminders');
    expect(res.status).toBe(200);
    expect(auth.getAccessToken()).toBe('new-access');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('refresh 被拒絕：清 token、導向 /login，不呼叫 clear_session', async () => {
    seedAuth();
    mockFetch((url) => (url.endsWith('/auth/refresh') ? jsonResponse(401, {}) : jsonResponse(401, {})));
    const { api, auth } = await loadModules();
    const res = await api.apiFetch('/reminders');
    expect(res.status).toBe(401);
    expect(auth.getStoredAuth()).toBeNull();
    expect(replaceMock).toHaveBeenCalledWith('/login');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('彈窗路徑在瀏覽器裡不發 Tauri 事件（emitTo）', async () => {
    jest.useFakeTimers();
    try {
      seedAuth();
      g.window.location.pathname = '/popup';
      mockFetch(() => jsonResponse(401, {}));
      const { api } = await loadModules();
      const pending = api.apiFetch('/reminders/x');
      // 彈窗會等主視窗換 token 最多 5 秒；瀏覽器裡沒有主視窗，等完就放棄
      await jest.advanceTimersByTimeAsync(6000);
      const res = await pending;
      expect(res.status).toBe(401);
      expect(emitToMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Tauri 模式維持原本行為', () => {
  it('login 後把 token 交給 Rust（set_session）', async () => {
    tauriFlag = true;
    mockFetch(() =>
      jsonResponse(200, {
        accessToken: 'a1',
        refreshToken: 'r1',
        user: { id: 'u1', email: 'a@b.com', timezone: 'Asia/Taipei' },
      }),
    );
    const { auth } = await loadModules();
    await auth.login('a@b.com', 'password1234');
    expect(invokeMock).toHaveBeenCalledWith('set_session', expect.objectContaining({ accessToken: 'a1' }));
  });
});
