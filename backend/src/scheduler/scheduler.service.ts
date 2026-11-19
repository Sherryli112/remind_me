import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Reminder, RecurrenceRule } from '@prisma/client';
import {
  DEFAULT_TIMEZONE,
  getZonedParts,
  ZonedParts,
} from '../common/timezone';
import { PrismaService } from '../prisma/prisma.service';

type ReminderWithRules = Pick<
  Reminder,
  'enabled' | 'endAt' | 'scheduleType' | 'oneTimeAt'
> & {
  recurrenceRules: Array<
    Pick<
      RecurrenceRule,
      | 'ruleMode'
      | 'timeOfDay'
      | 'weekDays'
      | 'monthDay'
      | 'intervalMinutes'
      | 'activeFrom'
      | 'activeUntil'
    >
  >;
};

export interface DueReminderDto {
  id: string;
  title: string;
  content: string;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
  corner: string;
  size: string;
  targetScreenId: string | null;
}

/** 裝置最近一次輪詢 /scheduler/due 在這段時間內，才視為「在線」並會收到新觸發的提醒。 */
export const DEVICE_ONLINE_WINDOW_MS = 2 * 60 * 1000;
/** firedSet 的紀錄只需要撐過觸發視窗（30 秒），保留 5 分鐘後清掉，避免記憶體無限成長。 */
const FIRED_KEY_RETENTION_MS = 5 * 60 * 1000;
/** 觸發視窗：排定時間後 30 秒內都算到期（Cron 每 3 秒掃一次）。 */
const DUE_WINDOW_MS = 30_000;

// 與 Prisma schema 的 DisplaySetting 預設值一致；使用者還沒建立 DisplaySetting 時使用
const DEFAULT_DISPLAY = {
  corner: 'bottom_right',
  size: 'medium',
  targetScreenId: null as string | null,
};

function parseHHmm(value: string): [number, number] {
  const [h, m] = value.split(':').map(Number);
  return [h, m];
}

/**
 * 記憶體狀態（本階段接受的限制）：
 * - firedSet / snoozeUntilMap / 裝置佇列都在記憶體，後端重啟會遺失延後狀態；fireCount 已持久化。
 * - 只能跑單一後端實例。
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  /** key: `${reminderId}-${windowKey}`，value: 觸發時間（ms） */
  private readonly firedSet = new Map<string, number>();
  private readonly snoozeUntilMap = new Map<string, number>();
  /** userId → (deviceId → 最近一次輪詢時間 ms) */
  private readonly devices = new Map<string, Map<string, number>>();
  /** `${userId}:${deviceId}` → 待取走的提醒 */
  private readonly queues = new Map<string, DueReminderDto[]>();
  private scanning = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/3 * * * * *')
  async handleCron() {
    if (this.scanning) return; // 上一輪還沒跑完就跳過，避免重疊掃描
    this.scanning = true;
    try {
      await this.checkDue();
    } catch (e) {
      this.logger.error(
        `checkDue 失敗：${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.scanning = false;
    }
  }

  async checkDue(now: Date = new Date()) {
    const nowMs = now.getTime();
    this.pruneState(nowMs);

    // 只掃描「有裝置在線」的使用者：沒有裝置在線時觸發也沒人收得到，
    // 也不該消耗 maxOccurrences 的次數（等同舊版「桌面 App 沒開就不會跳提醒」）。
    const onlineUserIds = [...this.devices.keys()];
    if (onlineUserIds.length === 0) return;

    // 一次查完：提醒 + 規則 + 使用者時區 + 使用者顯示設定，避免 N+1
    const reminders = await this.prisma.reminder.findMany({
      where: { enabled: true, userId: { in: onlineUserIds } },
      include: {
        recurrenceRules: true,
        user: {
          select: {
            timezone: true,
            displaySetting: {
              select: { corner: true, size: true, targetScreenId: true },
            },
          },
        },
      },
    });

    const fired: Array<{ userId: string; dto: DueReminderDto }> = [];
    // 因延後到期而觸發的不算新的一次，不計入 maxOccurrences
    const countedIds: string[] = [];

    for (const reminder of reminders) {
      const timeZone = reminder.user?.timezone || DEFAULT_TIMEZONE;
      const snoozeUntil = this.snoozeUntilMap.get(reminder.id);
      const snoozeExpired = snoozeUntil !== undefined && nowMs >= snoozeUntil;

      if (snoozeExpired) {
        // 延後時間到：不看排程，清掉延後狀態與舊的 firedSet，讓它不論排程視窗都能再跳一次
        this.snoozeUntilMap.delete(reminder.id);
        this.clearFiredSet(reminder.id);
      } else {
        if (!this.isReminderDue(reminder, now, timeZone)) continue;
        if (snoozeUntil !== undefined) continue;
      }

      const firedKey = `${reminder.id}-${this.getWindowKey(reminder, now, timeZone)}`;
      if (this.firedSet.has(firedKey)) continue;

      if (
        reminder.maxOccurrences !== null &&
        reminder.fireCount >= reminder.maxOccurrences
      )
        continue;

      this.firedSet.set(firedKey, nowMs);
      if (reminder.maxOccurrences !== null && !snoozeExpired)
        countedIds.push(reminder.id);

      const display = reminder.user?.displaySetting ?? DEFAULT_DISPLAY;
      fired.push({
        userId: reminder.userId,
        dto: {
          id: reminder.id,
          title: reminder.title,
          content: reminder.content,
          autoCloseEnabled: reminder.autoCloseEnabled,
          autoCloseSeconds: reminder.autoCloseSeconds,
          snoozeDefaultSeconds: reminder.snoozeDefaultSeconds,
          corner: display.corner,
          size: display.size,
          targetScreenId: display.targetScreenId ?? null,
        },
      });
    }

    // 持久化 fireCount，避免重啟後 maxOccurrences 計數歸零
    if (countedIds.length > 0) {
      await this.prisma.reminder.updateMany({
        where: { id: { in: countedIds } },
        data: { fireCount: { increment: 1 } },
      });
    }

    for (const { userId, dto } of fired) {
      this.enqueueForUser(userId, dto, nowMs);
    }
  }

  /**
   * 裝置輪詢：記錄在線時間，回傳並清空「該使用者、該裝置」的佇列。
   * 第一次輪詢的裝置從這一刻起才開始收提醒。
   */
  consumeDue(
    userId: string,
    deviceId: string,
    now: number = Date.now(),
  ): DueReminderDto[] {
    let userDevices = this.devices.get(userId);
    if (!userDevices) {
      userDevices = new Map();
      this.devices.set(userId, userDevices);
    }
    userDevices.set(deviceId, now);

    const key = this.queueKey(userId, deviceId);
    const items = this.queues.get(key) ?? [];
    this.queues.set(key, []);
    return items;
  }

  snoozeReminder(id: string, seconds: number) {
    this.snoozeUntilMap.set(id, Date.now() + seconds * 1000);
  }

  clearFiredSet(id: string) {
    const prefix = `${id}-`;
    for (const key of [...this.firedSet.keys()]) {
      if (key.startsWith(prefix)) this.firedSet.delete(key);
    }
  }

  /** 提醒被刪除時清掉記憶體狀態（呼叫端須先確認提醒屬於目前使用者）。 */
  forgetReminder(id: string) {
    this.clearFiredSet(id);
    this.snoozeUntilMap.delete(id);
  }

  /** 提醒內容被修改時重置觸發狀態與 fireCount（呼叫端須先確認提醒屬於目前使用者）。 */
  async resetReminder(id: string) {
    this.forgetReminder(id);
    await this.prisma.reminder.updateMany({
      where: { id },
      data: { fireCount: 0 },
    });
  }

  /** 以使用者時區的牆上時間判斷是否到期；`oneTimeAt` 是絕對時間，與時區無關。 */
  isReminderDue(
    reminder: ReminderWithRules,
    now: Date,
    timeZone: string = DEFAULT_TIMEZONE,
  ): boolean {
    if (!reminder.enabled) return false;
    if (reminder.endAt && now > reminder.endAt) return false;

    if (reminder.scheduleType === 'one_time') {
      if (!reminder.oneTimeAt) return false;
      const diff = now.getTime() - reminder.oneTimeAt.getTime();
      return diff >= 0 && diff <= DUE_WINDOW_MS;
    }

    const parts = getZonedParts(now, timeZone);
    const msIntoMinute = parts.second * 1000 + now.getUTCMilliseconds();
    return reminder.recurrenceRules.some((rule) =>
      this.isRuleDue(rule, parts, msIntoMinute),
    );
  }

  private isRuleDue(
    rule: ReminderWithRules['recurrenceRules'][number],
    parts: ZonedParts,
    msIntoMinute: number,
  ): boolean {
    const withinWindow = (h: number, m: number): boolean =>
      parts.hour === h && parts.minute === m && msIntoMinute <= DUE_WINDOW_MS;

    switch (rule.ruleMode) {
      case 'daily_time': {
        if (!rule.timeOfDay) return false;
        return withinWindow(...parseHHmm(rule.timeOfDay));
      }
      case 'weekly_day': {
        if (!rule.timeOfDay || !rule.weekDays?.length) return false;
        if (!rule.weekDays.includes(parts.weekDay)) return false;
        return withinWindow(...parseHHmm(rule.timeOfDay));
      }
      case 'monthly_day': {
        if (!rule.timeOfDay || !rule.monthDay) return false;
        if (parts.day !== rule.monthDay) return false;
        return withinWindow(...parseHHmm(rule.timeOfDay));
      }
      case 'interval': {
        if (!rule.intervalMinutes) return false;
        const nowMin = parts.hour * 60 + parts.minute;
        if (rule.activeFrom || rule.activeUntil) {
          const fromMin = rule.activeFrom
            ? parseHHmm(rule.activeFrom)[0] * 60 + parseHHmm(rule.activeFrom)[1]
            : 0;
          const untilMin = rule.activeUntil
            ? parseHHmm(rule.activeUntil)[0] * 60 +
              parseHHmm(rule.activeUntil)[1]
            : 24 * 60 - 1;
          if (fromMin <= untilMin) {
            // 一般時間窗口
            if (nowMin < fromMin || nowMin > untilMin) return false;
          } else {
            // 跨午夜窗口（例如 23:30–01:00）：封鎖中間的空隙
            if (nowMin > untilMin && nowMin < fromMin) return false;
          }
        }
        if (rule.weekDays?.length) {
          if (!rule.weekDays.includes(parts.weekDay)) return false;
        }
        // 以 activeFrom 為錨點；未設時間窗口則從午夜 0:00 起算
        const anchorMin = rule.activeFrom
          ? parseHHmm(rule.activeFrom)[0] * 60 + parseHHmm(rule.activeFrom)[1]
          : 0;
        return (
          (nowMin - anchorMin) % rule.intervalMinutes === 0 &&
          parts.second <= 30
        );
      }
      default:
        return false;
    }
  }

  private getWindowKey(
    reminder: Pick<Reminder, 'scheduleType'>,
    now: Date,
    timeZone: string,
  ): string {
    if (reminder.scheduleType === 'one_time') return 'one_time';
    const p = getZonedParts(now, timeZone);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${p.year}-${pad(p.month)}-${pad(p.day)}-${pad(p.hour)}:${pad(p.minute)}`;
  }

  private enqueueForUser(userId: string, dto: DueReminderDto, nowMs: number) {
    const userDevices = this.devices.get(userId);
    if (!userDevices) return;
    for (const [deviceId, lastSeen] of userDevices) {
      if (nowMs - lastSeen > DEVICE_ONLINE_WINDOW_MS) continue;
      const key = this.queueKey(userId, deviceId);
      const queue = this.queues.get(key);
      if (queue) queue.push(dto);
      else this.queues.set(key, [dto]);
    }
  }

  /** 清掉超過 2 分鐘沒輪詢的裝置（連同佇列）與過期的 firedSet 紀錄。 */
  private pruneState(nowMs: number) {
    for (const [userId, userDevices] of this.devices) {
      for (const [deviceId, lastSeen] of userDevices) {
        if (nowMs - lastSeen > DEVICE_ONLINE_WINDOW_MS) {
          userDevices.delete(deviceId);
          this.queues.delete(this.queueKey(userId, deviceId));
        }
      }
      if (userDevices.size === 0) this.devices.delete(userId);
    }
    for (const [key, firedAt] of this.firedSet) {
      if (nowMs - firedAt > FIRED_KEY_RETENTION_MS) this.firedSet.delete(key);
    }
  }

  private queueKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }
}
