// Release 版後端 sidecar 使用動態埠（避免長期佔用 3000），實際位址要在執行期
// 透過 Tauri command 取得；純瀏覽器開發模式（無 Tauri context）才 fallback 到環境變數。
type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

async function resolveApiBase(): Promise<string> {
  let invoke: InvokeFn | null = null;
  try {
    const mod = await import('@tauri-apps/api/core');
    invoke = mod.invoke;
  } catch {
    invoke = null;
  }

  if (!invoke) {
    return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
  }

  for (;;) {
    try {
      return await invoke<string>('get_api_base_url');
    } catch {
      // 後端 sidecar 可能還在啟動中，尚未回報實際 port
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

let cached: Promise<string> | null = null;

export function getApiBase(): Promise<string> {
  if (!cached) cached = resolveApiBase();
  return cached;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await getApiBase();
  return fetch(`${base}${path}`, init);
}
