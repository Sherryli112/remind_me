import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Reminder, RecurrenceRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DisplaySettingsService } from '../display-settings/display-settings.service';

type ReminderWithRules = Reminder & { recurrenceRules: RecurrenceRule[] };

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

@Injectable()
export class SchedulerService {
  private readonly firedSet = new Set<string>();
  private readonly snoozeUntilMap = new Map<string, number>();
  private pendingQueue: DueReminderDto[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly displaySettings: DisplaySettingsService,
  ) {}

  @Cron('*/30 * * * * *')
  async checkDue() {
    const now = new Date();
    const reminders = await this.prisma.reminder.findMany({
      where: { enabled: true },
      include: { recurrenceRules: true },
    });

    const displaySetting = await this.displaySettings.getCurrent();
    const dueReminders: DueReminderDto[] = [];

    for (const reminder of reminders) {
      // Parse weekDays from JSON string to number[] for DB records
      const reminderWithParsedRules = {
        ...reminder,
        recurrenceRules: reminder.recurrenceRules.map((rule) => ({
          ...rule,
          weekDays: typeof rule.weekDays === 'string'
            ? JSON.parse(rule.weekDays as string)
            : rule.weekDays,
        })),
      };

      if (!this.isReminderDue(reminderWithParsedRules as any, now)) continue;

      const windowKey = this.getWindowKey(reminderWithParsedRules as any, now);
      const firedKey = `${reminder.id}-${windowKey}`;
      if (this.firedSet.has(firedKey)) continue;

      const snoozeUntil = this.snoozeUntilMap.get(reminder.id);
      if (snoozeUntil && now.getTime() < snoozeUntil) continue;

      if (reminder.maxOccurrences !== null) {
        if (reminder.fireCount >= reminder.maxOccurrences) continue;
      }

      this.firedSet.add(firedKey);
      dueReminders.push({
        id: reminder.id,
        title: reminder.title,
        content: reminder.content,
        autoCloseEnabled: reminder.autoCloseEnabled,
        autoCloseSeconds: reminder.autoCloseSeconds,
        snoozeDefaultSeconds: reminder.snoozeDefaultSeconds,
        corner: displaySetting.corner,
        size: displaySetting.size,
        targetScreenId: displaySetting.targetScreenId ?? null,
      });
    }

    // 持久化 fireCount，避免重啟後 maxOccurrences 計數歸零
    const limitedFiredIds = dueReminders
      .map((d) => reminders.find((r) => r.id === d.id))
      .filter((r) => r !== undefined && r.maxOccurrences !== null)
      .map((r) => r!.id);
    if (limitedFiredIds.length > 0) {
      await this.prisma.reminder.updateMany({
        where: { id: { in: limitedFiredIds } },
        data: { fireCount: { increment: 1 } },
      });
    }

    this.pendingQueue.push(...dueReminders);
  }

  consumeDue(): DueReminderDto[] {
    const items = [...this.pendingQueue];
    this.pendingQueue = [];
    return items;
  }

  snoozeReminder(id: string, seconds: number) {
    this.snoozeUntilMap.set(id, Date.now() + seconds * 1000);
  }

  resetReminder(id: string) {
    for (const key of [...this.firedSet]) {
      if (key.startsWith(`${id}-`)) this.firedSet.delete(key);
    }
    this.snoozeUntilMap.delete(id);
    void this.prisma.reminder.update({ where: { id }, data: { fireCount: 0 } });
  }

  isReminderDue(reminder: ReminderWithRules, now: Date): boolean {
    if (!reminder.enabled) return false;
    if (reminder.endAt && now > reminder.endAt) return false;

    if (reminder.scheduleType === 'one_time') {
      if (!reminder.oneTimeAt) return false;
      const diff = now.getTime() - reminder.oneTimeAt.getTime();
      return diff >= 0 && diff <= 30000;
    }

    return reminder.recurrenceRules.some((rule) => this.isRuleDue(rule as any, now));
  }

  private isRuleDue(rule: RecurrenceRule & { weekDays: number[] }, now: Date): boolean {
    const withinWindow = (h: number, m: number): boolean => {
      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      const diff = now.getTime() - target.getTime();
      return diff >= 0 && diff <= 30000;
    };

    switch (rule.ruleMode) {
      case 'daily_time': {
        if (!rule.timeOfDay) return false;
        const [h, m] = rule.timeOfDay.split(':').map(Number);
        return withinWindow(h, m);
      }
      case 'weekly_day': {
        if (!rule.timeOfDay || !rule.weekDays?.length) return false;
        if (!rule.weekDays.includes(now.getDay())) return false;
        const [h, m] = rule.timeOfDay.split(':').map(Number);
        return withinWindow(h, m);
      }
      case 'monthly_day': {
        if (!rule.timeOfDay || !rule.monthDay) return false;
        if (now.getDate() !== rule.monthDay) return false;
        const [h, m] = rule.timeOfDay.split(':').map(Number);
        return withinWindow(h, m);
      }
      case 'interval': {
        if (!rule.intervalMinutes) return false;
        const nowMin = now.getHours() * 60 + now.getMinutes();
        if (rule.activeFrom || rule.activeUntil) {
          const fromMin = rule.activeFrom
            ? Number(rule.activeFrom.split(':')[0]) * 60 + Number(rule.activeFrom.split(':')[1])
            : 0;
          const untilMin = rule.activeUntil
            ? Number(rule.activeUntil.split(':')[0]) * 60 + Number(rule.activeUntil.split(':')[1])
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
          if (!rule.weekDays.includes(now.getDay())) return false;
        }
        // 以 activeFrom 為錨點；未設時間窗口則從午夜 0:00 起算
        const anchorMin = rule.activeFrom
          ? Number(rule.activeFrom.split(':')[0]) * 60 + Number(rule.activeFrom.split(':')[1])
          : 0;
        return (nowMin - anchorMin) % rule.intervalMinutes === 0 && now.getSeconds() <= 30;
      }
      default:
        return false;
    }
  }

  private getWindowKey(reminder: ReminderWithRules, now: Date): string {
    if (reminder.scheduleType === 'one_time') return 'one_time';
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return `${dateStr}-${timeStr}`;
  }
}
