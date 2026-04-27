'use client';

import { createPortal } from 'react-dom';
import { DisplaySetting } from './DisplayPanel';
import { FormState } from './TaskForm';

type Props = {
  displaySetting: DisplaySetting | null;
  form: FormState;
  visible: boolean;
};

const sizeMap: Record<DisplaySetting['size'], { width: number; minHeight: number }> = {
  small: { width: 280, minHeight: 100 },
  medium: { width: 340, minHeight: 130 },
  large: { width: 420, minHeight: 170 },
};

const cornerPositionMap: Record<
  DisplaySetting['corner'],
  { top?: number; right?: number; bottom?: number; left?: number }
> = {
  top_left: { top: 18, left: 18 },
  top_right: { top: 18, right: 18 },
  bottom_left: { bottom: 18, left: 18 },
  bottom_right: { bottom: 18, right: 18 },
};

export function DesktopPopupPreview({ displaySetting, form, visible }: Props) {
  if (!displaySetting || !visible || typeof window === 'undefined') {
    return null;
  }

  const size = sizeMap[displaySetting.size];
  const position = cornerPositionMap[displaySetting.corner];
  const isDark = displaySetting.theme === 'dark';

  return createPortal(
    <div
      style={{
        position: 'fixed',
        zIndex: 9999,
        width: size.width,
        minHeight: size.minHeight,
        ...position,
        borderRadius: 14,
        border: isDark ? '1px solid #374151' : '1px solid #cbd5e1',
        background: isDark ? '#0f172a' : '#ffffff',
        color: isDark ? '#f8fafc' : '#0f172a',
        boxShadow: isDark
          ? '0 14px 30px rgba(15, 23, 42, 0.55)'
          : '0 14px 30px rgba(15, 23, 42, 0.22)',
        padding: 12,
        opacity: 0.62,
        transition: 'opacity 0.2s ease',
        pointerEvents: 'auto',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.opacity = '0.95';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.opacity = '0.62';
      }}
    >
      <button
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: isDark ? '1px solid #475569' : '1px solid #cbd5e1',
          background: isDark ? '#1e293b' : '#f8fafc',
          color: isDark ? '#cbd5e1' : '#334155',
          fontSize: 12,
          cursor: 'pointer',
        }}
        title="稍後提醒"
      >
        ×
      </button>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>
        {form.title || '提醒標題預覽'}
      </p>
      {displaySetting.showContent ? (
        <p
          style={{
            margin: '8px 0 0',
            color: isDark ? '#cbd5e1' : '#475569',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {form.content || '提醒內容預覽（會依顯示設定呈現）'}
        </p>
      ) : (
        <p
          style={{
            margin: '8px 0 0',
            color: isDark ? '#94a3b8' : '#64748b',
            fontSize: 13,
          }}
        >
          內容已隱藏
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          style={{
            flex: 1,
            borderRadius: 10,
            border: isDark ? '1px solid #334155' : '1px solid #cbd5e1',
            background: isDark ? '#1e293b' : '#f8fafc',
            color: isDark ? '#cbd5e1' : '#334155',
            padding: '6px 8px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          稍後提醒
        </button>
        <button
          style={{
            flex: 1,
            borderRadius: 10,
            border: '1px solid transparent',
            background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
            color: '#fff',
            padding: '6px 8px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          關閉提醒
        </button>
      </div>
    </div>,
    document.body,
  );
}
