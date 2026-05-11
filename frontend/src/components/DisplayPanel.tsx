'use client';

import {
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';

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

const sizeOptions = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
];

const themeOptions = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
];

const cornerOptions = [
  { value: 'top_left', label: '左上' },
  { value: 'top_right', label: '右上' },
  { value: 'bottom_left', label: '左下' },
  { value: 'bottom_right', label: '右下' },
];

export function DisplayPanel({ displaySetting, onChange, onSave }: Props) {
  return (
    <Paper className="surface-strong" radius="lg" p="lg">
      <Stack gap="md">
        <div>
          <Title order={3} fw={700} c="indigo.8">
            顯示工具
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            調整提醒彈窗的尺寸、主題與顯示位置。
          </Text>
        </div>

        {!displaySetting ? (
          <Text c="dimmed">尚未載入，請按上方「載入資料」</Text>
        ) : (
          <>
            <Group grow align="flex-start" wrap="wrap">
              <Select
                label="尺寸"
                data={sizeOptions}
                value={displaySetting.size}
                onChange={(value) =>
                  value
                    ? onChange({
                        ...displaySetting,
                        size: value as DisplaySetting['size'],
                      })
                    : undefined
                }
                allowDeselect={false}
              />
              <Select
                label="主題"
                data={themeOptions}
                value={displaySetting.theme}
                onChange={(value) =>
                  value
                    ? onChange({
                        ...displaySetting,
                        theme: value as DisplaySetting['theme'],
                      })
                    : undefined
                }
                allowDeselect={false}
              />
              <Select
                label="角落"
                data={cornerOptions}
                value={displaySetting.corner}
                onChange={(value) =>
                  value
                    ? onChange({
                        ...displaySetting,
                        corner: value as DisplaySetting['corner'],
                      })
                    : undefined
                }
                allowDeselect={false}
              />
            </Group>

            <TextInput
              label="目標螢幕"
              description="桌面殼層接通後啟用此欄位；屆時將自動列出可用螢幕供選擇"
              placeholder="桌面版啟用後可選"
              value={displaySetting.targetScreenId ?? ''}
              disabled
              readOnly
            />

            <Switch
              size="md"
              labelPosition="left"
              label="在彈窗中顯示內容文字"
              description="勾選：顯示標題 + 內容；取消勾選：只顯示標題。"
              styles={{
                body: { justifyContent: 'space-between', width: '100%' },
                labelWrapper: { flex: 1 },
              }}
              checked={displaySetting.showContent}
              onChange={(event) =>
                onChange({
                  ...displaySetting,
                  showContent: event.currentTarget.checked,
                })
              }
            />

            <Group justify="space-between" align="center">
              <Text size="xs" c="dimmed">
                預覽彈窗會即時顯示在瀏覽器視窗角落，模擬實際桌面位置與尺寸。
              </Text>
              <Button onClick={onSave} radius="md">
                儲存顯示設定
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
