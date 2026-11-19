'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Group,
  Paper,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { AlertCircle, BellRing } from 'lucide-react';
import { AuthError, getStoredAuth, login, register } from '../../lib/auth';
import { describeAuthError, validateAuthForm } from './validation';

type Mode = 'login' | 'register';

function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checked, setChecked] = useState(false);

  // 已經登入就直接回主頁（例如使用者手動開了 /login）
  useEffect(() => {
    if (getStoredAuth()) {
      router.replace('/');
    } else {
      // 同主頁：localStorage 只能在 mount 後讀，靜態預渲染時沒有
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecked(true);
    }
  }, [router]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setFieldErrors({});
    setConfirmPassword('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const errors = validateAuthForm(mode, email, password, confirmPassword);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (mode === 'login') {
        await login(normalizedEmail, password);
      } else {
        await register(normalizedEmail, password, detectTimezone());
      }
      router.replace('/');
    } catch (err) {
      setError(err instanceof AuthError ? describeAuthError(err, mode) : '無法連線到伺服器，請確認網路連線後再試一次。');
      setSubmitting(false);
    }
  }

  if (!checked) return null;

  return (
    <Box
      component="main"
      mih="100vh"
      p="md"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Paper className="surface-strong" radius="lg" p="xl" w="100%" maw={400}>
        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <Stack gap="md">
            <Stack gap={4} align="center">
              <Group gap={8} wrap="nowrap">
                <BellRing size={24} color="var(--mantine-color-indigo-6)" />
                <Text fw={700} c="indigo.7" size="xl">
                  RemindMe
                </Text>
              </Group>
              <Text c="dimmed" size="sm">
                {mode === 'login' ? '登入以同步你的提醒' : '建立帳號，資料會儲存在雲端'}
              </Text>
            </Stack>

            <SegmentedControl
              fullWidth
              value={mode}
              onChange={(value) => switchMode(value as Mode)}
              data={[
                { label: '登入', value: 'login' },
                { label: '註冊', value: 'register' },
              ]}
            />

            {error ? (
              <Alert color="red" variant="light" icon={<AlertCircle size={16} />}>
                {error}
              </Alert>
            ) : null}

            <TextInput
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              error={fieldErrors.email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              autoFocus
            />
            <PasswordInput
              label="密碼"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? '8–72 個字元' : undefined}
              value={password}
              error={fieldErrors.password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            {mode === 'register' ? (
              <PasswordInput
                label="確認密碼"
                autoComplete="new-password"
                value={confirmPassword}
                error={fieldErrors.confirmPassword}
                onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              />
            ) : null}

            <Button type="submit" fullWidth loading={submitting} mt="xs">
              {mode === 'login' ? '登入' : '註冊並登入'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
