'use client';

// 手機瀏覽器（寬度 < 768px）用的外框：頂部標題列 + 底部分頁列 + 全螢幕編輯表單。
// 桌面版（含 Tauri App）不會用到這個元件，版面維持原本的側邊欄。
import type { ReactNode } from 'react';
import { ActionIcon, Box, Group, Menu, Modal, Text, UnstyledButton } from '@mantine/core';
import { BellRing, KeyRound, ListTodo, LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react';

type Props = {
  email: string;
  activeTool: 'display' | 'task';
  statusText: string;
  colorScheme: 'light' | 'dark';
  onToggleColorScheme: () => void;
  onLogout: () => void;
  /** 只在已登入（雲端模式）時傳入；沒傳就不顯示「修改密碼」 */
  onChangePassword?: () => void;
  onSelectTask: () => void;
  onSelectDisplay: () => void;
  notification: ReactNode;
  editorOpen: boolean;
  editorTitle: string;
  onCloseEditor: () => void;
  editor: ReactNode;
  children: ReactNode;
};

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      className="mobile-tab"
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <Text size="xs" fw={active ? 700 : 500} inherit>
        {label}
      </Text>
    </UnstyledButton>
  );
}

export function MobileShell({
  email,
  activeTool,
  statusText,
  colorScheme,
  onToggleColorScheme,
  onLogout,
  onChangePassword,
  onSelectTask,
  onSelectDisplay,
  notification,
  editorOpen,
  editorTitle,
  onCloseEditor,
  editor,
  children,
}: Props) {
  return (
    <>
      {/* main 有 backdrop-filter（會變成 fixed 子元素的 containing block），
          所以通知與底部分頁列都放在 main 外面，才會真的固定在螢幕上 */}
      {notification}

      <Box component="main" className="mobile-main">
        <header className="mobile-header">
          <Group justify="space-between" wrap="nowrap" h="100%" px="md">
            <Group gap={8} wrap="nowrap">
              <BellRing size={20} color="var(--mantine-color-indigo-6)" />
              <Text fw={700} c="indigo.7" size="lg">
                RemindMe
              </Text>
              {statusText ? (
                <Text c="dimmed" size="xs">
                  {statusText}
                </Text>
              ) : null}
            </Group>
            <Menu position="bottom-end" width={240} shadow="md">
              <Menu.Target>
                <ActionIcon variant="subtle" color="indigo" size="xl" aria-label="帳號選單">
                  <UserRound size={20} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>目前登入</Menu.Label>
                <Text size="sm" px="sm" pb="xs" truncate="end">
                  {email}
                </Text>
                <Menu.Divider />
                <Menu.Item
                  py="sm"
                  leftSection={colorScheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                  onClick={onToggleColorScheme}
                >
                  {colorScheme === 'dark' ? '切換為亮色模式' : '切換為暗色模式'}
                </Menu.Item>
                {onChangePassword ? (
                  <Menu.Item py="sm" leftSection={<KeyRound size={16} />} onClick={onChangePassword}>
                    修改密碼
                  </Menu.Item>
                ) : null}
                <Menu.Item py="sm" color="red" leftSection={<LogOut size={16} />} onClick={onLogout}>
                  登出
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </header>

        <Box px="sm" pt="sm" className="mobile-content">
          {children}
        </Box>
      </Box>

      <nav className="mobile-tabbar" aria-label="主選單">
        <TabButton
          label="提醒"
          icon={<ListTodo size={22} />}
          active={activeTool === 'task'}
          onClick={onSelectTask}
        />
        <TabButton
          label="顯示設定"
          icon={<Monitor size={22} />}
          active={activeTool === 'display'}
          onClick={onSelectDisplay}
        />
      </nav>

      {/* 新增 / 編輯提醒：全螢幕 modal。關閉（X、Esc、返回）走 onCloseEditor，
          表單有改過時會先跳「確定要離開嗎？」確認 */}
      <Modal
        opened={editorOpen}
        onClose={onCloseEditor}
        fullScreen
        radius={0}
        title={
          <Text fw={700} size="lg" c="indigo.8">
            {editorTitle}
          </Text>
        }
        closeButtonProps={{ size: 'xl', 'aria-label': '關閉' }}
        transitionProps={{ transition: 'slide-up', duration: 200 }}
      >
        {editor}
      </Modal>
    </>
  );
}
