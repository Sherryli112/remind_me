// 帳號 session 管理：token / user / 裝置 ID 的存取，以及 login / register / logout / refresh。
//
// Token 存在 webview 的 localStorage（key `remindme.auth`）。主視窗與彈窗是同一個 origin，
// 所以會共用同一份 token——任何一個視窗 refresh 成功，其他視窗下一次發請求就會讀到新的。
// 所有 localStorage 存取都包 try/catch：隱私模式、儲存空間被封鎖時不能讓整個 App 掛掉。
import { getApiBase } from './apiBase';
import { isTauri } from './platform';

export const AUTH_STORAGE_KEY = 'remindme.auth';
export const DEVICE_ID_STORAGE_KEY = 'remindme.deviceId';

export type AuthUser = {
  id: string;
  email: string;
  timezone: string;
};

export type StoredAuth = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

/** 後端回傳的錯誤（含 409/401 的 code 慣例），供登入頁顯示對應的中文訊息。 */
export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    public readonly details: string[] = [],
  ) {
    super(code ?? `HTTP_${status}`);
    this.name = 'AuthError';
  }
}

// ── localStorage ────────────────────────────────────────────────────────────

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isStoredAuth(value: unknown): value is StoredAuth {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const user = v.user as Record<string, unknown> | undefined;
  return (
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof user === 'object' &&
    user !== null &&
    typeof user.id === 'string' &&
    typeof user.email === 'string'
  );
}

export function getStoredAuth(): StoredAuth | null {
  try {
    const raw = storage()?.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredAuth(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: StoredAuth): void {
  try {
    storage()?.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // 寫不進去就只能這次 session 有效，不影響當下操作
  }
}

export function clearStoredAuth(): void {
  try {
    storage()?.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getAccessToken(): string | null {
  return getStoredAuth()?.accessToken ?? null;
}

function generateUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  // crypto.randomUUID 只在 secure context 可用；理論上 Tauri webview 一定有，保險起見留 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// localStorage 不能用時，至少讓同一個視窗內的裝置 ID 保持一致
let memoryDeviceId: string | null = null;

export function getDeviceId(): string {
  try {
    const existing = storage()?.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    // ignore
  }
  const id = memoryDeviceId ?? generateUuid();
  memoryDeviceId = id;
  try {
    storage()?.setItem(DEVICE_ID_STORAGE_KEY, id);
  } catch {
    // ignore
  }
  return id;
}

// ── Tauri session 同步 ──────────────────────────────────────────────────────

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** 在 Tauri 環境下回傳 invoke；瀏覽器（雲端網頁版、next dev）回傳 null，完全不呼叫 Rust。 */
export async function getTauriInvoke(): Promise<InvokeFn | null> {
  if (!isTauri()) return null;
  try {
    const mod = await import('@tauri-apps/api/core');
    return mod.invoke as InvokeFn;
  } catch {
    return null;
  }
}

/** 把目前的 access token 交給 Rust 輪詢器（scheduler.rs）使用。 */
export async function syncSessionToRust(): Promise<void> {
  const auth = getStoredAuth();
  const invoke = await getTauriInvoke();
  if (!invoke) return;
  try {
    if (auth) {
      await invoke('set_session', { accessToken: auth.accessToken, deviceId: getDeviceId() });
    } else {
      await invoke('clear_session');
    }
  } catch {
    // Rust 端暫時呼叫失敗不影響前端操作
  }
}

export async function clearRustSession(): Promise<void> {
  const invoke = await getTauriInvoke();
  if (!invoke) return;
  try {
    await invoke('clear_session');
  } catch {
    // ignore
  }
}

// ── API 呼叫 ────────────────────────────────────────────────────────────────

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function toAuthError(status: number, data: unknown): AuthError {
  const obj = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const code = typeof obj.code === 'string' ? obj.code : null;
  // class-validator 的錯誤是 { message: string[] }；自訂錯誤則是 { code, message: string }
  const details = Array.isArray(obj.message)
    ? obj.message.filter((m): m is string => typeof m === 'string')
    : typeof obj.message === 'string'
      ? [obj.message]
      : [];
  return new AuthError(status, code, details);
}

async function postAuth(path: string, body: unknown): Promise<Response> {
  return fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type AuthResponse = StoredAuth;

function isAuthResponse(data: unknown): data is AuthResponse {
  return isStoredAuth(data);
}

async function handleAuthResponse(res: Response): Promise<AuthUser> {
  const data = await readJson(res);
  if (!res.ok) throw toAuthError(res.status, data);
  if (!isAuthResponse(data)) throw new AuthError(res.status, 'INVALID_RESPONSE');
  setStoredAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
  await syncSessionToRust();
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await postAuth('/auth/login', { email, password });
  return handleAuthResponse(res);
}

export async function register(email: string, password: string, timezone?: string): Promise<AuthUser> {
  const res = await postAuth('/auth/register', timezone ? { email, password, timezone } : { email, password });
  return handleAuthResponse(res);
}

/** 登出：撤銷 refresh token（失敗也照樣清本機狀態）、清 token、通知 Rust 停止輪詢。 */
export async function logout(): Promise<void> {
  const auth = getStoredAuth();
  clearStoredAuth();
  await clearRustSession();
  if (auth) {
    try {
      await postAuth('/auth/logout', { refreshToken: auth.refreshToken });
    } catch {
      // 網路不通時 refresh token 會留在後端直到過期，可接受
    }
  }
}

export type RefreshResult =
  | { ok: true; accessToken: string }
  // invalid：refresh token 被後端拒絕（無效/過期/撤銷），session 已經死了
  // network：網路錯誤或伺服器暫時異常，session 可能還活著，不應該清 token
  | { ok: false; reason: 'invalid' | 'network' };

let refreshInFlight: Promise<RefreshResult> | null = null;

async function doRefresh(): Promise<RefreshResult> {
  const auth = getStoredAuth();
  if (!auth) return { ok: false, reason: 'invalid' };
  let res: Response;
  try {
    res = await postAuth('/auth/refresh', { refreshToken: auth.refreshToken });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { ok: false, reason: 'invalid' };
  }
  if (!res.ok) return { ok: false, reason: 'network' };
  const data = (await readJson(res)) as { accessToken?: unknown } | null;
  if (!data || typeof data.accessToken !== 'string') return { ok: false, reason: 'network' };

  // 重新讀一次 storage：等待期間使用者可能已經在別的視窗登出或換帳號
  const latest = getStoredAuth();
  if (!latest || latest.refreshToken !== auth.refreshToken) {
    return { ok: false, reason: 'invalid' };
  }
  setStoredAuth({ ...latest, accessToken: data.accessToken });
  await syncSessionToRust();
  return { ok: true, accessToken: data.accessToken };
}

/** 用 refresh token 換新的 access token。同一個視窗內同時只會有一個 refresh 請求在飛。 */
export function refreshAccessToken(): Promise<RefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
