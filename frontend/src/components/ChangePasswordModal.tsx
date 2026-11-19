'use client';

// 修改密碼對話框：桌面版側邊欄與手機版帳號選單共用。只在雲端模式（已登入）顯示入口。
import { useState } from 'react';
import { Alert, Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import {
  changePassword,
  describeChangePasswordError,
  validateChangePasswordForm,
  type ChangePasswordErrors,
} from '../lib/account';

type Props = {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
  fullScreen?: boolean;
};

export function ChangePasswordModal({ opened, onClose, onSuccess, fullScreen }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<ChangePasswordErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrors({});
    setSubmitError(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validateChangePasswordForm(currentPassword, newPassword, confirmPassword);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      reset();
      onSuccess();
    } catch (err) {
      setSubmitError(describeChangePasswordError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      fullScreen={fullScreen}
      radius={fullScreen ? 0 : 'lg'}
      centered
      title={
        <Text fw={700} size="lg" c="indigo.8">
          修改密碼
        </Text>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            修改後，其他裝置會被登出，需要用新密碼重新登入；這台裝置會維持登入。
          </Text>
          <PasswordInput
            label="目前的密碼"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            error={errors.currentPassword}
            disabled={submitting}
            data-autofocus
          />
          <PasswordInput
            label="新密碼"
            description="8–72 個字元"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            error={errors.newPassword}
            disabled={submitting}
          />
          <PasswordInput
            label="再輸入一次新密碼"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            error={errors.confirmPassword}
            disabled={submitting}
          />
          {submitError ? (
            <Alert color="red" variant="light">
              {submitError}
            </Alert>
          ) : null}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={handleClose} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" color="indigo" loading={submitting}>
              修改密碼
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
