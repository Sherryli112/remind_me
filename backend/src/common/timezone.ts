import { registerDecorator, ValidationOptions } from 'class-validator';

export const DEFAULT_TIMEZONE = 'Asia/Taipei';

// IANA 名稱的字元集合；用來排除 Intl 也接受的 "+08:00" 這類 offset 字串
const IANA_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/** 回傳正規化後的 IANA 名稱（例如 asia/taipei → Asia/Taipei），不合法時回傳 null。 */
export function normalizeTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tz = value.trim();
  if (!tz || tz.length > 64 || !IANA_NAME_PATTERN.test(tz)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

export function IsIanaTimeZone(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName: propertyName as string,
      options: {
        message: '$property 必須是合法的 IANA 時區名稱（例如 Asia/Taipei）',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => normalizeTimeZone(value) !== null,
      },
    });
  };
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  weekDay: number; // 0=Sunday ... 6=Saturday（與 Date#getDay 相同）
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** 取得某個絕對時間點在指定時區的「牆上時間」各欄位。時區不合法時退回 UTC。 */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = getFormatter(timeZone);
  } catch {
    fmt = getFormatter('UTC');
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekDay: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}
