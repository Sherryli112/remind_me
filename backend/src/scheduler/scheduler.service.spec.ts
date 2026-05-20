import { SchedulerService } from './scheduler.service';

type RecurrenceRule = {
  ruleMode: string;
  monthDay?: number | null;
  weekDays: number[];
  timeOfDay?: string | null;
  intervalMinutes?: number | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
};

function makeReminder(overrides: Partial<{
  enabled: boolean;
  scheduleType: string;
  oneTimeAt: Date | null;
  endAt: Date | null;
  maxOccurrences: number | null;
  recurrenceRules: RecurrenceRule[];
}> = {}) {
  return {
    id: 'test-id',
    enabled: true,
    scheduleType: 'recurring',
    oneTimeAt: null,
    endAt: null,
    maxOccurrences: null,
    recurrenceRules: [],
    ...overrides,
  };
}

describe('SchedulerService.isReminderDue', () => {
  const svc = new SchedulerService(null as any, null as any);

  describe('one_time', () => {
    it('triggers when oneTimeAt is within past 30s', () => {
      const now = new Date(2026, 4, 20, 10, 0, 15);
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: new Date(2026, 4, 20, 10, 0, 0),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger if oneTimeAt is in the future', () => {
      const now = new Date(2026, 4, 20, 10, 0, 0);
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: new Date(2026, 4, 20, 10, 1, 0),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });

    it('does not trigger if oneTimeAt was > 30s ago', () => {
      const now = new Date(2026, 4, 20, 10, 1, 0);
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: new Date(2026, 4, 20, 10, 0, 0),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('daily_time', () => {
    it('triggers at the correct time today', () => {
      const now = new Date(2026, 4, 20, 10, 0, 10);
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'daily_time', timeOfDay: '10:00', weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger 31s after the time', () => {
      const now = new Date(2026, 4, 20, 10, 0, 31);
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'daily_time', timeOfDay: '10:00', weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('weekly_day', () => {
    it('triggers on matching weekday and time', () => {
      // 2026-05-20 is a Wednesday = weekDay 3
      const now = new Date(2026, 4, 20, 14, 30, 5);
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'weekly_day', weekDays: [3], timeOfDay: '14:30' }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger on wrong weekday', () => {
      const now = new Date(2026, 4, 20, 14, 30, 5); // Wednesday
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'weekly_day', weekDays: [1], timeOfDay: '14:30' }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('monthly_day', () => {
    it('triggers on matching day of month and time', () => {
      const now = new Date(2026, 4, 20, 9, 0, 5);
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'monthly_day', monthDay: 20, timeOfDay: '09:00', weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger on wrong day of month', () => {
      const now = new Date(2026, 4, 20, 9, 0, 5);
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'monthly_day', monthDay: 15, timeOfDay: '09:00', weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('interval', () => {
    it('triggers when minutes align with interval and within 30s', () => {
      // 10:00:10 — minutesSinceMidnight=600, 600 % 30 === 0, seconds=10 ≤ 30
      const now = new Date(2026, 4, 20, 10, 0, 10);
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'interval', intervalMinutes: 30, weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger mid-interval', () => {
      // 10:15:05 — 615 % 30 = 15 ≠ 0
      const now = new Date(2026, 4, 20, 10, 15, 5);
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'interval', intervalMinutes: 30, weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });

    it('respects activeFrom/activeUntil window', () => {
      // 08:00:05 — outside 09:00~17:00
      const now = new Date(2026, 4, 20, 8, 0, 5);
      const reminder = makeReminder({
        recurrenceRules: [{
          ruleMode: 'interval', intervalMinutes: 60, weekDays: [],
          activeFrom: '09:00', activeUntil: '17:00',
        }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('endAt / enabled', () => {
    it('does not trigger if disabled', () => {
      const now = new Date(2026, 4, 20, 10, 0, 10);
      const reminder = makeReminder({
        enabled: false,
        scheduleType: 'one_time',
        oneTimeAt: new Date(2026, 4, 20, 10, 0, 0),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });

    it('does not trigger if past endAt', () => {
      const now = new Date(2026, 4, 20, 10, 0, 10);
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: new Date(2026, 4, 20, 10, 0, 0),
        endAt: new Date(2026, 4, 19, 0, 0, 0),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });
});
