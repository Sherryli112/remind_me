// API base URL 在「建置時」決定：release build 會把 NEXT_PUBLIC_API_BASE_URL 設成雲端網址，
// 開發時沒設就打本機後端。Rust 端（scheduler.rs）用 REMINDME_API_BASE_URL 指向同一個網址。
import {
  clearRustSession,
  clearStoredAuth,
  getAccessToken,
  getDeviceId,
  refreshAccessToken,
} from './auth';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export function getApiBase(): string {
  return API_BASE;
}

// 這些端點本身就是用來取得/撤銷 token 的，401 代表帳密或 refresh token 錯誤，
// 不能再拿去觸發 refresh 流程（會變成無限遞迴或吞掉真正的錯誤）。
// /auth/me 需要登入，跟一般 API 一樣走 refresh 流程。
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

function isPublicAuthPath(path: string): boolean {
  const pathname = path.split('?')[0];
  return PUBLIC_AUTH_PATHS.includes(pathname);
}

/** 彈窗（popup / popup-manager）session 失效時只靜默失敗，導頁只在主視窗做。 */
function isPopupWindow(): boolean {
  try {
    return typeof window !== 'undefined' && window.location.pathname.startsWith('/popup');
  } catch {
    return false;
  }
}

const POPUP_TOKEN_WAIT_MS = 5000;
const POPUP_TOKEN_POLL_MS = 250;

/** 彈窗用：通知主視窗 refresh，最多等 5 秒看 localStorage 有沒有出現新的 access token。 */
async function requestTokenFromMainWindow(staleToken: string | null): Promise<string | null> {
  try {
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo('main', 'session-expired');
  } catch {
    // 不在 Tauri 裡（純瀏覽器開發）或主視窗不存在，只能單純等看看
  }
  const deadline = Date.now() + POPUP_TOKEN_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POPUP_TOKEN_POLL_MS));
    const token = getAccessToken();
    if (!token) return null; // 主視窗判定 session 失效、已清掉 token
    if (token !== staleToken) return token;
  }
  return null;
}

let redirecting = false;

async function handleSessionDead(): Promise<void> {
  if (isPopupWindow()) return;
  clearStoredAuth();
  await clearRustSession();
  if (redirecting || typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  redirecting = true;
  window.location.replace('/login');
}

function buildInit(init: RequestInit | undefined, token: string | null): RequestInit {
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('X-Device-Id')) headers.set('X-Device-Id', getDeviceId());
  return { ...init, headers };
}

/**
 * 呼叫雲端 API：自動帶上 Authorization 與 X-Device-Id。
 * 收到 401 時 refresh 一次（同一個視窗內 single-flight）並重試原請求；
 * refresh 被拒絕代表 session 已失效 → 清掉 token、主視窗導向 /login，回傳原本的 401 回應。
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const usedToken = getAccessToken();
  const response = await fetch(url, buildInit(init, usedToken));
  if (response.status !== 401 || isPublicAuthPath(path)) return response;

  // 等待期間別的視窗可能已經 refresh 過了，storage 裡的 token 比剛才用的新就直接重試
  const latest = getAccessToken();
  let retryToken: string | null = null;
  if (latest && latest !== usedToken) {
    retryToken = latest;
  } else if (isPopupWindow()) {
    // /auth/refresh 每個 IP 每分鐘只能打 10 次，single-flight 又只在同一個視窗內有效，
    // 所以彈窗不自己 refresh：請主視窗 refresh（它收到 session-expired 會走自己的
    // single-flight），然後等新 token 出現在共用的 localStorage 裡。
    retryToken = await requestTokenFromMainWindow(usedToken);
    if (!retryToken) return response;
  } else {
    const result = await refreshAccessToken();
    if (result.ok) {
      retryToken = result.accessToken;
    } else {
      if (result.reason === 'invalid') await handleSessionDead();
      return response;
    }
  }

  const retried = await fetch(url, buildInit(init, retryToken));
  if (retried.status === 401) {
    // 剛拿到的新 token 還是被拒絕（例如帳號已刪除），視同 session 失效
    await handleSessionDead();
  }
  return retried;
}
