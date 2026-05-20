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
}

@Injectable()
export class SchedulerService {
  private readonly firedSet = new Set<string>();
  private readonly fireCountMap = new Map<string, number>();
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
        const count = this.fireCountMap.get(reminder.id) ?? 0;
        if (count >= reminder.maxOccurrences) continue;
        this.fireCountMap.set(reminder.id, count + 1);
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
      target.setUTCHours(h, m, 0, 0);
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
        if (!rule.weekDays.includes(now.getUTCDay())) return false;
        const [h, m] = rule.timeOfDay.split(':').map(Number);
        return withinWindow(h, m);
      }
      case 'monthly_day': {
        if (!rule.timeOfDay || !rule.monthDay) return false;
        if (now.getUTCDate() !== rule.monthDay) return false;
        const [h, m] = rule.timeOfDay.split(':').map(Number);
        return withinWindow(h, m);
      }
      case 'interval': {
        if (!rule.intervalMinutes) return false;
        if (rule.activeFrom && rule.activeUntil) {
          const [fh, fm] = rule.activeFrom.split(':').map(Number);
          const [uh, um] = rule.activeUntil.split(':').map(Number);
          const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
          if (nowMin < fh * 60 + fm || nowMin > uh * 60 + um) return false;
        }
        if (rule.weekDays?.length) {
          if (!rule.weekDays.includes(now.getUTCDay())) return false;
        }
        const minutesSinceMidnight = now.getUTCHours() * 60 + now.getUTCMinutes();
        return minutesSinceMidnight % rule.intervalMinutes === 0 && now.getUTCSeconds() <= 30;
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
