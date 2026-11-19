// 本機 ↔ 雲端模式切換時給使用者看的文字（主畫面的確認對話框用），抽出來方便測試。

/** 本機模式按「登入」前的確認：說清楚登入後只看得到雲端資料、本機提醒保留不合併。 */
export function loginConfirmText(localReminderCount: number): string {
  return `登入後會顯示雲端帳號的提醒；這台電腦上的 ${localReminderCount} 則本機提醒會保留，登出後回來。`;
}

/** 登出確認。桌面 App 登出後回到本機模式；網頁版回到登入頁。 */
export function logoutConfirmText(email: string | undefined, isDesktop: boolean): string {
  return isDesktop
    ? `確定要登出 ${email} 嗎？登出後會回到這台電腦上的本機提醒，雲端帳號的提醒不會在這台電腦跳出。`
    : `確定要登出 ${email} 嗎？`;
}
