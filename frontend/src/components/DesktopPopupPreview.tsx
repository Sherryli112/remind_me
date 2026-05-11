'use client';

import { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { DisplaySetting } from './DisplayPanel';
import { FormState } from './TaskForm';

type Props = {
  displaySetting: DisplaySetting | null;
  form: FormState;
  visible: boolean;
};

type SizeKey = DisplaySetting['size'];

// 各尺寸：寬度 + 字體 + minHeight（標題＋按鈕 base / 有內容時加高）
const sizeMap: Record<
  SizeKey,
  {
    width: number;
    titleSize: string;
    contentSize: string;
    buttonSize: 'xs' | 'sm' | 'md';
    minHeightBase: number;
    minHeightContent: number;
  }
> = {
  small: {
    width: 260,
    titleSize: 'sm',
    contentSize: 'xs',
    buttonSize: 'xs',
    minHeightBase: 78,
    minHeightContent: 108,
  },
  medium: {
    width: 340,
    titleSize: 'md',
    contentSize: 'sm',
    buttonSize: 'sm',
    minHeightBase: 96,
    minHeightContent: 140,
  },
  large: {
    width: 420,
    titleSize: 'lg',
    contentSize: 'md',
    buttonSize: 'sm',
    minHeightBase: 116,
    minHeightContent: 178,
  },
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

const darkPaperStyle: CSSProperties = {
  background:
    'linear-gradient(135deg, rgba(15, 23, 42, 0.78) 0%, rgba(30, 27, 75, 0.66) 100%)',
  color: '#f8fafc',
  border: '1px solid rgba(99, 102, 241, 0.32)',
  backdropFilter: 'blur(48px) saturate(220%)',
  WebkitBackdropFilter: 'blur(48px) saturate(220%)',
  boxShadow:
    'inset 0 1px 0 0 rgba(255, 255, 255, 0.08), 0 18px 44px rgba(15, 23, 42, 0.45)',
};

export function DesktopPopupPreview({ displaySetting, form, visible }: Props) {
  if (!displaySetting || !visible || typeof window === 'undefined') {
    return null;
  }

  const size = sizeMap[displaySetting.size];
  const position = cornerPositionMap[displaySetting.corner];
  const isDark = displaySetting.theme === 'dark';
  const minHeight = displaySetting.showContent ? size.minHeightContent : size.minHeightBase;

  const paperStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    width: size.width,
    minHeight,
    ...position,
    opacity: 0.78,
    // 預覽純視覺；不接收任何點擊事件，避免擋住 DisplayPanel 的儲存按鈕等元素
    pointerEvents: 'none',
    // 撐成 flex column 讓內部 Stack 能 fill 高度，按鈕用 mt="auto" 鎖到底
    display: 'flex',
    flexDirection: 'column',
    ...(isDark ? darkPaperStyle : {}),
  };

  return createPortal(
    <Paper
      className={isDark ? undefined : 'surface-strong'}
      radius="lg"
      p="sm"
      style={paperStyle}
    >
      <Stack gap={6} style={{ flex: 1, width: '100%' }}>
        <Text fw={700} size={size.titleSize} c={isDark ? 'gray.0' : 'dark.7'}>
          {form.title || '提醒標題預覽'}
        </Text>
        {displaySetting.showContent ? (
          <Text
            size={size.contentSize}
            c={isDark ? 'gray.3' : 'gray.7'}
            style={{ lineHeight: 1.5 }}
            lineClamp={3}
          >
            {form.content || '提醒內容預覽（會依顯示設定呈現）'}
          </Text>
        ) : null}
        <Group gap="xs" wrap="nowrap" mt="auto">
          <Button
            variant="default"
            size={size.buttonSize}
            radius="md"
            fullWidth
            style={
              isDark
                ? {
                    background: 'rgba(30, 41, 59, 0.7)',
                    borderColor: 'rgba(99, 102, 241, 0.35)',
                    color: '#e2e8f0',
                  }
                : undefined
            }
          >
            稍後提醒
          </Button>
          <Button variant="filled" color="indigo" size="xs" radius="md" fullWidth>
            關閉提醒
          </Button>
        </Group>
      </Stack>
    </Paper>,
    document.body,
  );
}
