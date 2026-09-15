// frontend/src/app/popup-manager/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BellRing, CalendarClock, ChevronDown, ChevronsDown, ChevronsUp,
  Clock, Sparkles,
} from 'lucide-react';
import { calcWindowHeight, CARD_HEIGHT, CARD_WIDTH, INNER_PADDING } from './height';
import { apiFetch } from '../../lib/apiBase';

// ── Types ──────────────────────────────────────────────────────────────
type DueReminder = {
  id: string;
  title: string;
  content: string;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
  corner: string;
  size: 'small' | 'medium' | 'large';
  targetScreenId: string | null;
};

type DisplaySetting = {
  size: 'small' | 'medium' | 'large';
  theme: 'light' | 'dark';
  showContent: boolean;
  mascotIcon: 'bell_ring' | 'sparkles' | 'calendar_clock';
  corner: string;
  targetScreenId: string | null;
};

// ── Icon sizes ─────────────────────────────────────────────────────────
const ICON_SZ    = { small: 14, medium: 14, large: 15 } as const;
const TEXT_SZ    = { small: 12, medium: 12, large: 13 } as const;
const CONTENT_SZ = { small: 11, medium: 11, large: 12 } as const;
const PADDING    = { small: '12px 10px', medium: '10px 12px', large: '11px 14px' } as const;

// ── Sub-components ─────────────────────────────────────────────────────

function MascotIcon({ icon, size }: { icon: string; size: number }) {
  const p = { size, strokeWidth: 1.5 };
  if (icon === 'sparkles') return <Sparkles {...p} />;
  if (icon === 'calendar_clock') return <CalendarClock {...p} />;
  return <BellRing {...p} />;
}

function ArrowIndicator({ corner, onClick }: { corner: string; onClick: () => void }) {
  const isTop = corner.startsWith('top');
  const Icon = isTop ? ChevronsDown : ChevronsUp;
  // 故意不跟著深/淺主題變色——之前用「跟卡片同色系的深色底」在暗色主題下會
  // 跟旁邊的卡片背景幾乎融在一起，反而不明顯。改用飽和度高、跟主題無關的
  // 靛藍色底（跟「延後」按鈕同一色系）+ 白色箭頭，兩種主題下對比度都夠。
  const bg  = 'rgba(99,102,241,0.95)';
  const col = '#ffffff';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        justifyContent: 'center',
        cursor: 'pointer',
        lineHeight: 0,
        position: 'relative',
        zIndex: 10,
        // Overlap card edge by ~10px
        marginBottom: isTop ? 0 : -10,
        marginTop:    isTop ? -10 : 0,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 22,
          borderRadius: 11,
          background: bg,
          color: col,
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
          animation: 'arrow-bob 1.5s ease-in-out infinite',
        }}
      >
        <Icon size={18} strokeWidth={3} />
      </span>
    </div>
  );
}

function CollapsedCard({
  reminder,
  display,
  onExpand,
}: {
  reminder: DueReminder;
  display: DisplaySetting;
  onExpand: () => void;
}) {
  const isDark = display.theme === 'dark';
  const sz = display.size;
  return (
    <div
      onClick={onExpand}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        height: 36,
        borderRadius: 10,
        background: isDark ? 'rgb(30,26,56)' : 'rgb(220,225,248)',
        cursor: 'pointer',
        userSelect: 'none',
        boxSizing: 'border-box',
        flexShrink: 0,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        transform: 'translateZ(0)',
      }}
    >
      <span style={{
        color: isDark ? 'rgba(165,180,252,0.88)' : 'rgba(99,102,241,0.78)',
        lineHeight: 1, flexShrink: 0,
      }}>
        <MascotIcon icon={display.mascotIcon} size={ICON_SZ[sz]} />
      </span>
      <span style={{
        fontSize: TEXT_SZ[sz],
        fontWeight: 600,
        color: isDark ? 'rgba(235,235,255,0.9)' : 'rgba(28,24,72,0.85)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {reminder.title}
      </span>
    </div>
  );
}

function ExpandedCard({
  reminder,
  display,
  onClose,
  onSnooze,
}: {
  reminder: DueReminder;
  display: DisplaySetting;
  onClose: () => void;
  onSnooze: () => void;
}) {
  const [progress, setProgress] = useState(100);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!reminder.autoCloseEnabled) return;
    const total = reminder.autoCloseSeconds * 1000;
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.max(0, 100 - (elapsed / total) * 100));
      if (elapsed >= total) {
        clearInterval(timerRef.current!);
        onCloseRef.current();
      }
    }, 200);
    return () => clearInterval(timerRef.current!);
  }, [reminder.id, reminder.autoCloseEnabled, reminder.autoCloseSeconds]);

  const sz    = display.size;
  const isDark = display.theme === 'dark';
  const fs    = TEXT_SZ[sz];
  const fsc   = CONTENT_SZ[sz];
  const isize = ICON_SZ[sz];

  const bg = isDark ? 'rgb(18,14,48)' : 'rgb(235,239,255)';
  const textCol = isDark ? 'rgba(235,235,255,0.95)' : 'rgba(28,24,72,0.92)';
  const dimCol  = isDark ? 'rgba(155,155,210,0.8)'  : 'rgba(99,102,241,0.68)';
  const iconCol = isDark ? 'rgba(165,180,252,0.88)' : 'rgba(99,102,241,0.78)';
  const btnBg   = isDark ? 'rgba(99,102,241,0.8)'   : 'rgba(99,102,241,0.88)';
  const snoozeB = isDark ? 'rgba(129,140,248,0.3)'  : 'rgba(199,210,254,0.8)';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        boxSizing: 'border-box',
        // 固定高度（不是量內容量出來的）——這樣 footer 的 marginTop:'auto' 才有多餘
        // 空間可以把按鈕推到底部，文字貼頂、按鈕貼底，「小/中/大」才是真正固定的
        // 卡片尺寸，不會因為有沒有內容說明文字而忽大忽小。
        height: CARD_HEIGHT[sz],
        padding: PADDING[sz],
        background: bg,
        borderRadius: 13,
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        userSelect: 'none',
        cursor: 'default',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        flexShrink: 0,
        transform: 'translateZ(0)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: iconCol, lineHeight: 1 }}>
          <MascotIcon icon={display.mascotIcon} size={isize} />
        </span>
        <span style={{
          flex: 1, minWidth: 0, fontSize: fs, fontWeight: 700, color: textCol,
          lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {reminder.title}
        </span>
      </div>

      {display.showContent && reminder.content && (
        <div style={{
          fontSize: fsc, color: dimCol, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {reminder.content}
        </div>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {reminder.autoCloseEnabled && (
          <div style={{ height: 2, borderRadius: 2, background: isDark ? 'rgba(129,140,248,0.18)' : 'rgba(199,210,254,0.55)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: isDark ? 'rgba(129,140,248,0.85)' : 'rgba(99,102,241,0.65)', transition: 'width 0.2s linear' }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={onSnooze} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: fsc, padding: '2px 7px',
            border: `1px solid ${snoozeB}`, borderRadius: 5,
            background: 'transparent', color: dimCol, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            <Clock size={fsc - 1} />
            延後 {Math.round(reminder.snoozeDefaultSeconds / 60)} 分
          </button>
          <button onClick={onClose} style={{
            fontSize: fsc, padding: '2px 9px', border: 'none',
            borderRadius: 5, background: btnBg, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

function ScrollHint() {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      height: 56, pointerEvents: 'none',
      background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.35))',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      paddingBottom: 4,
    }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          opacity: hovered ? 1 : 0.45, transition: 'opacity 0.2s',
          pointerEvents: 'auto', cursor: 'default', color: 'white',
        }}
      >
        <ChevronDown size={16} strokeWidth={2} style={{ animation: 'arrow-bob 1.5s ease-in-out infinite' }} />
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
          捲動查看更多
        </span>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────
export default function PopupManagerPage() {
  const [reminders, setReminders]   = useState<DueReminder[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [display, setDisplay]       = useState<DisplaySetting | null>(null);
  const [isOverflow, setIsOverflow] = useState(false);
  // Prevents hide_popup from firing before get_pending_reminders resolves
  const [initialLoaded, setInitialLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const collapsedRef = useRef<HTMLDivElement>(null);
  // 記錄每則提醒「第一次出現在畫面上」的時間——同一批一起跳出來的提醒，使用者
  // 依序點延後時，點擊的時間點難免會差個幾秒。用「第一次出現的時間」當基準去算
  // 延後目標時間（而不是用「點擊當下」），同一批延後同樣秒數的提醒才會同時重新出現。
  const firstShownAtRef = useRef<Map<string, number>>(new Map());

  // Fetch display settings once on mount, and again whenever the main window
  // saves a change — this window is created once and stays alive/hidden across
  // the app's lifetime, so it otherwise never learns about later setting changes.
  useEffect(() => {
    const fetchDisplay = () =>
      apiFetch('/display-settings/current')
        .then((r) => r.json() as Promise<DisplaySetting>)
        .then(setDisplay)
        .catch(() => {});
    void fetchDisplay();

    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('display-settings-changed', () => void fetchDisplay()))
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Subscribe to reminders-updated Tauri event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<DueReminder[]>('reminders-updated', (e) => {
          const incoming = e.payload;
          setReminders((prev) => {
            // incoming 只是「這次輪詢新到期的」，不是「目前全部待處理的」——
            // 要合併，不能整批取代，不然使用者還沒延後/關閉的舊提醒會被蓋掉。
            const freshlyAdded = incoming.filter((r) => !prev.some((p) => p.id === r.id));
            const now = Date.now();
            freshlyAdded.forEach((r) => firstShownAtRef.current.set(r.id, now));
            const merged = [...prev, ...freshlyAdded];
            // Only reset UI state when transitioning from no reminders to some
            const wasEmpty = prev.length === 0;
            if (wasEmpty) {
              setExpandedId(merged[0]?.id ?? null);
              setIsExpanded(false);
            } else {
              // Preserve expandedId if the card still exists; otherwise fall back to first
              setExpandedId((cur) =>
                merged.find((r) => r.id === cur) ? cur : (merged[0]?.id ?? null)
              );
              // Don't touch isExpanded — preserve whatever the user set
            }
            return merged;
          });
        })
      )
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Fetch initial pending reminders on mount (handles first-load race condition).
  // Sets initialLoaded when done so the resize effect can safely call hide_popup.
  useEffect(() => {
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<DueReminder[]>('get_pending_reminders'))
      .then((pending) => {
        if (pending.length > 0) {
          const now = Date.now();
          pending.forEach((r) => firstShownAtRef.current.set(r.id, now));
          setReminders(pending);
          setExpandedId(pending[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setInitialLoaded(true));
  }, []);

  // Resize + reposition window on state change
  useEffect(() => {
    if (!display || !initialLoaded) return;
    const { size, corner, targetScreenId } = display;
    const count = reminders.length;

    import('@tauri-apps/api/core').then(({ invoke }) => {
      if (count === 0) {
        invoke('hide_popup').catch(() => {});
        return;
      }
      const w = CARD_WIDTH[size];
      // 收合狀態下用實際渲染出來的內容高度，不要用 CARD_HEIGHT 常數假設一個固定值——
      // 內容是否為空、autoCloseEnabled 是否顯示進度條都會讓卡片實際高度跟假設值不一樣，
      // 視窗留白的部分因為整頁背景透明，會直接露出桌面（例如 Windows 啟用浮水印）。
      // 展開狀態（多筆提醒可捲動）維持用公式計算＋螢幕高度上限，測量會被自身當下視窗高度
      // 限制住（inner scroll 有 maxHeight: 100vh），沒有意義。
      const measured = !isExpanded ? collapsedRef.current?.getBoundingClientRect().height : undefined;
      const h = measured
        ? Math.min(measured + INNER_PADDING, window.screen.availHeight)
        : calcWindowHeight(count, isExpanded, size, window.screen.availHeight);
      // 視窗建立後預設是隱藏的，故意等這裡 resize 完才 show——避免使用者看到
      // resize 前那個尺寸不對的過渡狀態（tauri-apps/tauri#10318 的透明視窗殘影）。
      // 對已經顯示中的視窗而言 show() 是無害的重複呼叫。
      invoke('resize_popup', { width: w, height: h, corner, targetScreenId })
        .then(() => invoke('show_popup'))
        .catch(() => {});
    }).catch(() => {});
  }, [reminders, isExpanded, display, initialLoaded]);

  // Detect scroll overflow
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setIsOverflow(el.scrollHeight > el.clientHeight + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reminders, isExpanded]);

  // Compute derived state before early return (needed for hook below)
  const activeId = expandedId ?? reminders[0]?.id ?? null;
  const expandedReminder = activeId ? (reminders.find((r) => r.id === activeId) ?? reminders[0]) : null;
  const collapsedReminders = expandedReminder
    ? reminders.filter((r) => r.id !== expandedReminder.id)
    : [];

  function removeReminder(id: string) {
    firstShownAtRef.current.delete(id);
    setReminders((prev) => {
      const next = prev.filter((r) => r.id !== id);
      if (next.length > 0) {
        setExpandedId((cur) =>
          next.find((r) => r.id === cur) ? cur : next[0].id
        );
      }
      // 只有剩 0 或 1 張時才收合——展開狀態下延後/關閉其中一張，如果還有
      // 2 張以上剩下，應該維持展開，不然使用者每次延後都要重新展開一次。
      if (next.length < 2) setIsExpanded(false);
      return next;
    });
    // 讓 Rust 端的 pending 狀態也知道這則已經處理掉了，避免視窗重新載入時
    // get_pending_reminders 又把已經延後/關閉過的提醒重新生出來一次。
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('acknowledge_reminder', { id }))
      .catch(() => {});
  }

  function handleClose(id: string) {
    removeReminder(id);
  }

  async function handleSnooze(id: string, seconds: number) {
    try {
      // 用「這則提醒第一次出現的時間」當基準扣掉已經經過的秒數，而不是直接送
      // 使用者點擊當下的完整秒數——同一批一起跳出來的提醒，不管使用者依序點
      // 延後點得多快/多慢，只要延後秒數一樣，就會在同一個時間點一起重新出現。
      const firstShownAt = firstShownAtRef.current.get(id);
      const elapsedSeconds = firstShownAt ? Math.floor((Date.now() - firstShownAt) / 1000) : 0;
      const adjustedSeconds = Math.max(1, seconds - elapsedSeconds);
      await apiFetch(`/reminders/${id}/snooze`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: adjustedSeconds }),
      });
      // 延後會改到後端資料（下次提醒時間），主視窗的清單是另一個獨立的視窗/JS
      // context，不會自動知道這裡發生了什麼，用 Tauri 事件通知它重新抓一次。
      import('@tauri-apps/api/event').then(({ emit }) => emit('reminder-mutated')).catch(() => {});
    } catch {}
    removeReminder(id);
  }

  // Auto-close collapsed cards that have autoCloseEnabled
  // Must be before the early return to satisfy Rules of Hooks
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    collapsedReminders.forEach((r) => {
      if (!r.autoCloseEnabled) return;
      const timer = setTimeout(() => handleClose(r.id), r.autoCloseSeconds * 1000);
      timers.push(timer);
    });
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedReminders.map((r) => r.id).join(',')]);

  if (!display || reminders.length === 0) return null;

  const isTop = display.corner.startsWith('top');
  const showArrow = reminders.length > 1 && !isExpanded;

  // Card order: priority (expanded) first — justifyContent handles corner alignment
  const cardList = [expandedReminder!, ...collapsedReminders];

  // Resize window to expanded height FIRST, then reveal the panel.
  // This ensures collapsed cards are within window bounds before they become clickable.
  async function handleExpandClick() {
    if (display) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const h = calcWindowHeight(reminders.length, true, display.size, window.screen.availHeight);
        await invoke('resize_popup', {
          width: CARD_WIDTH[display.size],
          height: h,
          corner: display.corner,
          targetScreenId: display.targetScreenId,
        });
      } catch {}
    }
    setIsExpanded(true);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      justifyContent: isTop ? 'flex-start' : 'flex-end',
    }}>
      {/* ── Collapsed view ── */}
      {!isExpanded && (
        <div ref={collapsedRef} style={{ display: 'flex', flexDirection: 'column' }}>
          {showArrow && !isTop && (
            <ArrowIndicator corner={display.corner} onClick={() => void handleExpandClick()} />
          )}
          <ExpandedCard
            reminder={expandedReminder!}
            display={display}
            onClose={() => handleClose(expandedReminder!.id)}
            onSnooze={() => handleSnooze(expandedReminder!.id, expandedReminder!.snoozeDefaultSeconds)}
          />
          {showArrow && isTop && (
            <ArrowIndicator corner={display.corner} onClick={() => void handleExpandClick()} />
          )}
        </div>
      )}

      {/* ── Expanded panel ── */}
      {isExpanded && (
        <div style={{ position: 'relative' }}>
          <div
            ref={scrollRef}
            onScroll={(event) => {
              // 使用者捲到（接近）底部之後，該看到的內容都看到了，提示就不用再擋著畫面
              const el = event.currentTarget;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) setIsOverflow(false);
            }}
            style={{
              display: 'flex', flexDirection: 'column', gap: 6,
              overflowY: 'scroll', scrollbarWidth: 'none',
              maxHeight: `calc(100vh - 8px)`,
              padding: '4px 0',
            }}
          >
            {cardList.map((r) =>
              r.id === expandedReminder!.id ? (
                <ExpandedCard
                  key={r.id}
                  reminder={r}
                  display={display}
                  onClose={() => handleClose(r.id)}
                  onSnooze={() => handleSnooze(r.id, r.snoozeDefaultSeconds)}
                />
              ) : (
                <CollapsedCard
                  key={r.id}
                  reminder={r}
                  display={display}
                  onExpand={() => setExpandedId(r.id)}
                />
              )
            )}
          </div>
          {isOverflow && <ScrollHint />}
        </div>
      )}
    </div>
  );
}
