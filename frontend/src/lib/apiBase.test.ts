/**
 * apiFetch / auth 的單元測試（jest testEnvironment 是 node，localStorage / window / fetch 都手動 mock）。
 */

const invokeMock = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(undefined));
// 預設在 Tauri 裡（桌面 App）；網頁版的測試把它改成 false
let mockIsTauri = true;
// 彈窗請主視窗 refresh 用的事件；個別測試會換掉實作來模擬主視窗的反應
const emitToMock = jest.fn<Promise<void>, unknown[]>(() => Promise.resolve());
jest.mock('@tauri-apps/api/event', () => ({
  emitTo: (...args: unknown[]) => emitToMock(...args),
}));
jest.mock('@tauri-apps/api/core', () => ({
  isTauri: () => mockIsTauri,
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

type FetchCall = { url: string; init: RequestInit };

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

let calls: FetchCall[];
let replaceMock: jest.Mock;

function setPath(pathname: string) {
  g.window.location.pathname = pathname;
}

function seedAuth(accessToken = 'old-access', refreshToken = 'refresh-1') {
  g.localStorage.setItem(
    'remindme.auth',
    JSON.stringify({ accessToken, refreshToken, user: { id: 'u1', email: 'a@b.com', timezone: 'Asia/Taipei' } }),
  );
}

function authHeader(call: FetchCall): string | null {
  return new Headers(call.init.headers).get('Authorization');
}

// 每個測試重新載入模組（beforeEach 裡 resetModules），讓 single-flight 與 redirecting
// 這類模組層級狀態歸零
async function loadModules() {
  const api = await import('./apiBase');
  const auth = await import('./auth');
  return { api, auth };
}

// apiBase 在載入時讀 NEXT_PUBLIC_API_BASE_URL；測試固定用預設的 localhost，不受外部環境（例如 CI 的 build 變數）影響
const originalApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  jest.resetModules();
  calls = [];
  replaceMock = jest.fn();
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.resolve(undefined));
  mockIsTauri = true;
  emitToMock.mockReset();
  emitToMock.mockImplementation(() => Promise.resolve());
  g.localStorage = new MemoryStorage();
  g.window = { location: { pathname: '/', replace: replaceMock } };
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).localStorage;
  if (originalApiBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
  else process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBase;
});

/** 依照 URL 決定回應；handler 可以回傳 Promise 來模擬慢請求 */
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  g.fetch = jest.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  });
}

describe('getDeviceId', () => {
  it('第一次產生 UUID 並存起來，之後都回傳同一個', async () => {
    const { auth } = await loadModules();
    const id = auth.getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(g.localStorage.getItem('remindme.deviceId')).toBe(id);
    expect(auth.getDeviceId()).toBe(id);
  });

  it('localStorage 丟例外時不會壞掉', async () => {
    const { auth } = await loadModules();
    g.localStorage.getItem = () => {
      throw new Error('blocked');
    };
    g.localStorage.setItem = () => {
      throw new Error('blocked');
    };
    const id = auth.getDeviceId();
    expect(auth.getDeviceId()).toBe(id);
    expect(auth.getStoredAuth()).toBeNull();
  });
});

describe('apiFetch', () => {
  it('自動帶上 Authorization 與 X-Device-Id', async () => {
    seedAuth();
    mockFetch(() => jsonResponse(200, []));
    const { api, auth } = await loadModules();
    const res = await api.apiFetch('/reminders', { headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(200);
    const headers = new Headers(calls[0].init.headers);
    expect(calls[0].url).toBe('http://localhost:3000/reminders');
    expect(headers.get('Authorization')).toBe('Bearer old-access');
    expect(headers.get('X-Device-Id')).toBe(auth.getDeviceId());
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('401 時 refresh 一次並用新 token 重試，並把新 token 交給 Rust', async () => {
    seedAuth();
    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) return jsonResponse(200, { accessToken: 'new-access' });
      const auth = new Headers(init.headers).get('Authorization');
      return auth === 'Bearer new-access' ? jsonResponse(200, { ok: true }) : jsonResponse(401, {});
    });
    const { api, auth } = await loadModules();
    const res = await api.apiFetch('/reminders');
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url.replace('http://localhost:3000', ''))).toEqual([
      '/reminders',
      '/auth/refresh',
      '/reminders',
    ]);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ refreshToken: 'refresh-1' });
    expect(auth.getStoredAuth()?.accessToken).toBe('new-access');
    expect(auth.getStoredAuth()?.refreshToken).toBe('refresh-1');
    expect(invokeMock).toHaveBeenCalledWith('set_session', {
      accessToken: 'new-access',
      deviceId: auth.getDeviceId(),
    });
  });

  it('同時多個 401 只會發一次 refresh（single-flight）', async () => {
    seedAuth();
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    mockFetch(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        await refreshGate;
        return jsonResponse(200, { accessToken: 'new-access' });
      }
      return authHeader({ url, init }) === 'Bearer new-access' ? jsonResponse(200, {}) : jsonResponse(401, {});
    });
    const { api } = await loadModules();
    const pending = Promise.all([api.apiFetch('/reminders'), api.apiFetch('/groups'), api.apiFetch('/display-settings/current')]);
    await new Promise((r) => setTimeout(r, 0));
    releaseRefresh();
    const results = await pending;
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('別的視窗已經 refresh 過時，直接用 storage 裡較新的 token 重試', async () => {
    seedAuth();
    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) throw new Error('should not refresh');
      if (authHeader({ url, init }) === 'Bearer old-access') {
        seedAuth('other-window-access'); // 模擬等待期間另一個視窗寫入新 token
        return jsonResponse(401, {});
      }
      return jsonResponse(200, {});
    });
    const { api } = await loadModules();
    const res = await api.apiFetch('/reminders');
    expect(res.status).toBe(200);
    expect(authHeader(calls[1])).toBe('Bearer other-window-access');
  });

  it('網頁版 refresh 被拒絕：清掉 token、導向 /login', async () => {
    mockIsTauri = false;
    seedAuth();
    mockFetch((url) =>
      url.endsWith('/auth/refresh')
        ? jsonResponse(401, { code: 'INVALID_REFRESH_TOKEN' })
        : jsonResponse(401, {}),
    );
    const { api, auth } = await loadModules();
    const res = await api.apiFetch('/reminders');
    expect(res.status).toBe(401);
    expect(auth.getStoredAuth()).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('桌面 App refresh 被拒絕：清掉 token、通知 Rust 切回本機模式、不導頁，並留下「登入已過期」提示', async () => {
    seedAuth();
    mockFetch((url) =>
      url.endsWith('/auth/refresh')
        ? jsonResponse(401, { code: 'INVALID_REFRESH_TOKEN' })
        : jsonResponse(401, {}),
    );
    const { api, auth } = await loadModules();
    const res = await api.apiFetch('/reminders');
    expect(res.status).toBe(401);
    expect(auth.getStoredAuth()).toBeNull();
    expect(auth.getMode()).toBe('local');
    expect(invokeMock).toHaveBeenCalledWith('clear_session');
    expect(replaceMock).not.toHaveBeenCalled();
    expect(auth.consumeSessionExpiredNotice()).toBe(true);
    expect(auth.consumeSessionExpiredNotice()).toBe(false);
  });

  it('彈窗收到 401 不自己 refresh，而是請主視窗 refresh 後用新 token 重試', async () => {
    seedAuth();
    setPath('/popup-manager');
    emitToMock.mockImplementation(async () => {
      // 模擬主視窗收到 session-expired 後 refresh 成功、寫入共用的 localStorage
      setTimeout(() => seedAuth('main-window-access'), 10);
    });
    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) throw new Error('popup should not refresh');
      return authHeader({ url, init }) === 'Bearer main-window-access' ? jsonResponse(200, {}) : jsonResponse(401, {});
    });
    const { api } = await loadModules();
    const res = await api.apiFetch('/display-settings/current');
    expect(res.status).toBe(200);
    expect(emitToMock).toHaveBeenCalledWith('main', 'session-expired');
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(0);
    expect(authHeader(calls[1])).toBe('Bearer main-window-access');
  });

  it('彈窗：主視窗判定 session 失效時只靜默失敗，不導頁', async () => {
    seedAuth();
    setPath('/popup');
    emitToMock.mockImplementation(async () => {
      setTimeout(() => g.localStorage.removeItem('remindme.auth'), 10);
    });
    mockFetch(() => jsonResponse(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' }));
    const { api } = await loadModules();
    const res = await api.apiFetch('/reminders/r1');
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith('clear_session');
  });

  it('refresh 遇到網路錯誤時不清 token、不導頁', async () => {
    seedAuth();
    mockFetch((url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('Failed to fetch');
      return jsonResponse(401, {});
    });
    const { api, auth } = await loadModules();
    const res = await api.apiFetch('/reminders');
    expect(res.status).toBe(401);
    expect(auth.getStoredAuth()?.accessToken).toBe('old-access');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('公開的 /auth/* 端點回 401 不會觸發 refresh', async () => {
    seedAuth();
    mockFetch(() => jsonResponse(401, { code: 'INVALID_CREDENTIALS' }));
    const { api } = await loadModules();
    const res = await api.apiFetch('/auth/login', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe('login / register / logout', () => {
  it('login 成功後存 token 並呼叫 set_session', async () => {
    mockFetch(() =>
      jsonResponse(200, {
        accessToken: 'a1',
        refreshToken: 'r1',
        user: { id: 'u1', email: 'a@b.com', timezone: 'Asia/Taipei' },
      }),
    );
    const { auth } = await loadModules();
    const user = await auth.login('a@b.com', 'password123');
    expect(user.email).toBe('a@b.com');
    expect(auth.getStoredAuth()).toMatchObject({ accessToken: 'a1', refreshToken: 'r1' });
    expect(invokeMock).toHaveBeenCalledWith('set_session', { accessToken: 'a1', deviceId: auth.getDeviceId() });
  });

  it('login 失敗時丟出帶 code 的 AuthError', async () => {
    mockFetch(() => jsonResponse(401, { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }));
    const { auth } = await loadModules();
    await expect(auth.login('a@b.com', 'wrong-pass')).rejects.toMatchObject({
      name: 'AuthError',
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(auth.getStoredAuth()).toBeNull();
  });

  it('register 帶上時區', async () => {
    mockFetch(() =>
      jsonResponse(201, {
        accessToken: 'a1',
        refreshToken: 'r1',
        user: { id: 'u1', email: 'a@b.com', timezone: 'Asia/Taipei' },
      }),
    );
    const { auth } = await loadModules();
    await auth.register('a@b.com', 'password123', 'Asia/Taipei');
    expect(calls[0].url).toBe('http://localhost:3000/auth/register');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      email: 'a@b.com',
      password: 'password123',
      timezone: 'Asia/Taipei',
    });
  });

  it('logout 撤銷 refresh token、清 token、呼叫 clear_session；網路失敗也照樣清', async () => {
    seedAuth();
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const { auth } = await loadModules();
    await auth.logout();
    expect(calls[0].url).toBe('http://localhost:3000/auth/logout');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ refreshToken: 'refresh-1' });
    expect(auth.getStoredAuth()).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith('clear_session');
  });
});

describe('模式（getMode）', () => {
  it('桌面 App 沒有登入是本機模式，登入後是雲端模式', async () => {
    const { auth } = await loadModules();
    expect(auth.getMode()).toBe('local');
    seedAuth();
    expect(auth.getMode()).toBe('cloud');
  });

  it('網頁版沒有本機模式：沒有登入也是雲端模式', async () => {
    mockIsTauri = false;
    const { auth } = await loadModules();
    expect(auth.getMode()).toBe('cloud');
  });

  it('logout 會清掉還沒顯示的「登入已過期」提示', async () => {
    seedAuth();
    mockFetch(() => jsonResponse(204, undefined));
    const { auth } = await loadModules();
    await auth.expireSession();
    seedAuth();
    await auth.logout();
    expect(auth.consumeSessionExpiredNotice()).toBe(false);
  });
});

describe('apiFetch 本機模式（Rust local_api）', () => {
  function mockLocalApi(result: { status: number; body: unknown } | Error) {
    invokeMock.mockImplementation((cmd: unknown) => {
      if (cmd !== 'local_api') return Promise.resolve(undefined);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    });
  }

  it('GET 交給 local_api，不發 HTTP，回應包成 Response', async () => {
    mockFetch(() => {
      throw new Error('本機模式不該發 HTTP');
    });
    mockLocalApi({ status: 200, body: [{ id: 'r1', title: 't' }] });
    const { api } = await loadModules();
    const res = await api.apiFetch('/reminders', { cache: 'no-store' });
    expect(invokeMock).toHaveBeenCalledWith('local_api', { method: 'GET', path: '/reminders', body: null });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'r1', title: 't' }]);
    expect(calls).toHaveLength(0);
  });

  it('帶上 method 與 JSON body；錯誤狀態碼與 body 原樣回傳', async () => {
    mockFetch(() => jsonResponse(500, {}));
    const conflict = { code: 'SHORT_MONTH_CONFIRMATION_REQUIRED', message: '若遇到沒有該日期的月份…' };
    mockLocalApi({ status: 409, body: conflict });
    const { api } = await loadModules();
    const payload = JSON.stringify({ title: 't', scheduleType: 'recurring' });
    const res = await api.apiFetch('/reminders/r1', {
      method: 'patch',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(invokeMock).toHaveBeenCalledWith('local_api', { method: 'PATCH', path: '/reminders/r1', body: payload });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(conflict);
    expect(calls).toHaveLength(0);
  });

  it('彈窗視窗也走 local_api（延後）', async () => {
    setPath('/popup-manager');
    mockFetch(() => jsonResponse(500, {}));
    mockLocalApi({ status: 200, body: { success: true } });
    const { api } = await loadModules();
    const res = await api.apiFetch('/reminders/r1/snooze', { method: 'PATCH', body: '{"seconds":60}' });
    expect(res.status).toBe(200);
    expect(invokeMock).toHaveBeenCalledWith('local_api', {
      method: 'PATCH',
      path: '/reminders/r1/snooze',
      body: '{"seconds":60}',
    });
  });

  it('invoke 失敗時回 500，不丟例外', async () => {
    mockLocalApi(new Error('boom'));
    const { api } = await loadModules();
    const res = await api.apiFetch('/groups');
    expect(res.status).toBe(500);
  });

  it('/auth/* 就算在本機模式也打雲端', async () => {
    mockFetch(() => jsonResponse(401, { code: 'INVALID_CREDENTIALS' }));
    const { api } = await loadModules();
    const res = await api.apiFetch('/auth/login', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(calls[0].url).toBe('http://localhost:3000/auth/login');
    expect(invokeMock).not.toHaveBeenCalledWith('local_api', expect.anything());
  });

  it('登入後就改走雲端 HTTP', async () => {
    mockFetch(() => jsonResponse(200, []));
    const { api } = await loadModules();
    seedAuth();
    const res = await api.apiFetch('/reminders');
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe('http://localhost:3000/reminders');
    expect(invokeMock).not.toHaveBeenCalledWith('local_api', expect.anything());
  });

  it('網頁版沒有登入也不會呼叫 local_api', async () => {
    mockIsTauri = false;
    mockFetch(() => jsonResponse(401, {}));
    const { api } = await loadModules();
    await api.apiFetch('/reminders');
    expect(calls[0].url).toBe('http://localhost:3000/reminders');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
