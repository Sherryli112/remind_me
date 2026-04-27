'use client';

import styles from './DisplayPanel.module.css';

export type DisplaySetting = {
  id: string;
  size: 'small' | 'medium' | 'large';
  theme: 'light' | 'dark';
  corner: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  showContent: boolean;
  targetScreenId: string | null;
  mascotMode: 'system' | 'custom';
};

type Props = {
  displaySetting: DisplaySetting | null;
  onChange: (next: DisplaySetting) => void;
  onSave: () => void;
};

export function DisplayPanel({ displaySetting, onChange, onSave }: Props) {
  return (
    <section className={styles.card}>
      <h2 className={styles.title}>顯示工具</h2>
      {!displaySetting ? (
        <p>尚未載入，請按上方「載入資料」</p>
      ) : (
        <div className={styles.grid}>
          <label>
            尺寸
            <select
              value={displaySetting.size}
              onChange={(event) =>
                onChange({
                  ...displaySetting,
                  size: event.target.value as DisplaySetting['size'],
                })
              }
              style={{ marginTop: 4 }}
            >
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
            </select>
          </label>
          <label>
            主題
            <select
              value={displaySetting.theme}
              onChange={(event) =>
                onChange({
                  ...displaySetting,
                  theme: event.target.value as DisplaySetting['theme'],
                })
              }
              style={{ marginTop: 4 }}
            >
              <option value="light">亮色</option>
              <option value="dark">暗色</option>
            </select>
          </label>
          <label>
            角落
            <select
              value={displaySetting.corner}
              onChange={(event) =>
                onChange({
                  ...displaySetting,
                  corner: event.target.value as DisplaySetting['corner'],
                })
              }
              style={{ marginTop: 4 }}
            >
              <option value="top_left">左上</option>
              <option value="top_right">右上</option>
              <option value="bottom_left">左下</option>
              <option value="bottom_right">右下</option>
            </select>
          </label>
          <label>
            目標螢幕 ID
            <input
              value={displaySetting.targetScreenId ?? ''}
              onChange={(event) =>
                onChange({
                  ...displaySetting,
                  targetScreenId: event.target.value,
                })
              }
              style={{ marginTop: 4 }}
            />
          </label>
          <div className={styles.contentToggle}>
            <label className={styles.contentToggleLabel}>
              <input
                type="checkbox"
                checked={displaySetting.showContent}
                onChange={(event) =>
                  onChange({
                    ...displaySetting,
                    showContent: event.target.checked,
                  })
                }
              />
              在提醒彈窗中顯示「內容文字」
            </label>
            <p className={styles.contentToggleHint}>
              勾選：顯示標題 + 內容；取消勾選：只顯示標題。
            </p>
          </div>
          <button onClick={onSave} className={styles.saveButton}>
            儲存顯示設定
          </button>
          <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
            預覽彈窗會直接顯示在瀏覽器視窗角落（模擬實際桌面彈窗位置與尺寸）。
          </p>
        </div>
      )}
    </section>
  );
}
