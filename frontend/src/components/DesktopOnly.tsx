'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { desktopOnlyRedirectTarget } from '../lib/platform';
import { useIsTauri } from '../lib/platformHooks';

/**
 * 只在 Tauri 桌面 App 裡渲染 children（/popup、/popup-manager 用）。
 * 在瀏覽器開啟時不渲染任何內容（children 的 effect 也不會跑，所以不會呼叫 invoke），
 * 並導回首頁。
 */
export function DesktopOnly({ children }: { children: React.ReactNode }) {
  const tauri = useIsTauri();
  const router = useRouter();

  useEffect(() => {
    const target = desktopOnlyRedirectTarget();
    if (target) router.replace(target);
  }, [router]);

  return tauri ? <>{children}</> : null;
}
