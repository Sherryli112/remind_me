import { DEVICE_ONLINE_WINDOW_MS, SchedulerService } from './scheduler.service';

type RecurrenceRule = {
  ruleMode: string;
  monthDay?: number | null;
  weekDays: number[];
  timeOfDay?: string | null;
  intervalMinutes?: number | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
};

const TPE = 'Asia/Taipei';

/** 台灣牆上時間（UTC+8，無日光節約）→ 絕對時間。月份為 1–12。 */
function tpe(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s = 0,
): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 8, mi, s));
}

/** UTC 牆上時間 → 絕對時間。月份為 1–12。 */
function utc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s = 0,
): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

function makeReminder(
  overrides: Partial<{
    enabled: boolean;
    scheduleType: string;
    oneTimeAt: Date | null;
    endAt: Date | null;
    maxOccurrences: number | null;
    recurrenceRules: RecurrenceRule[];
  }> = {},
) {
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

describe('測試環境', () => {
  it('以 TZ=UTC 執行（模擬雲端主機）', () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0);
  });
});

describe('SchedulerService.isReminderDue', () => {
  const svc = new SchedulerService(null as any);

  describe('one_time', () => {
    it('triggers when oneTimeAt is within past 30s', () => {
      const now = tpe(2026, 5, 20, 10, 0, 15);
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: tpe(2026, 5, 20, 10, 0, 0),
      });
      expect(svc.isReminderDue(reminder as any, now, TPE)).toBe(true);
    });

    it('does not trigger if oneTimeAt is in the future', () => {
      const now = tpe(2026, 5, 20, 10, 0, 0);
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: tpe(2026, 5, 20, 10, 1, 0),
      });
      expect(svc.isReminderDue(reminder as any, now, TPE)).toBe(false);
    });

    it('does not trigger if oneTimeAt was > 30s ago', () => {
      const now = tpe(2026, 5, 20, 10, 1, 0);
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: tpe(2026, 5, 20, 10, 0, 0),
      });
      expect(svc.isReminderDue(reminder as any, now, TPE)).toBe(false);
    });

    it('oneTimeAt 是絕對時間，與使用者時區無關', () => {
      const at = utc(2026, 5, 20, 3, 0, 0);
      const now = utc(2026, 5, 20, 3, 0, 5);
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: at,
      });
      expect(svc.isReminderDue(reminder as any, now, TPE)).toBe(true);
      expect(svc.isReminderDue(reminder as any, now, 'America/New_York')).toBe(
        true,
      );
    });
  });

  describe('daily_time', () => {
    it('triggers at the correct time today', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          { ruleMode: 'daily_time', timeOfDay: '10:00', weekDays: [] },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 10, 0, 10), TPE),
      ).toBe(true);
    });

    it('does not trigger 31s after the time', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          { ruleMode: 'daily_time', timeOfDay: '10:00', weekDays: [] },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 10, 0, 31), TPE),
      ).toBe(false);
    });
  });

  describe('weekly_day', () => {
    it('triggers on matching weekday and time', () => {
      // 2026-05-20 is a Wednesday = weekDay 3
      const reminder = makeReminder({
        recurrenceRules: [
          { ruleMode: 'weekly_day', weekDays: [3], timeOfDay: '14:30' },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 14, 30, 5), TPE),
      ).toBe(true);
    });

    it('does not trigger on wrong weekday', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          { ruleMode: 'weekly_day', weekDays: [1], timeOfDay: '14:30' },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 14, 30, 5), TPE),
      ).toBe(false);
    });
  });

  describe('monthly_day', () => {
    it('triggers on matching day of month and time', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'monthly_day',
            monthDay: 20,
            timeOfDay: '09:00',
            weekDays: [],
          },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 9, 0, 5), TPE),
      ).toBe(true);
    });

    it('does not trigger on wrong day of month', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'monthly_day',
            monthDay: 15,
            timeOfDay: '09:00',
            weekDays: [],
          },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 9, 0, 5), TPE),
      ).toBe(false);
    });
  });

  describe('interval', () => {
    it('triggers when minutes align with interval and within 30s', () => {
      // 10:00:10 — minutesSinceMidnight=600, 600 % 30 === 0, seconds=10 ≤ 30
      const reminder = makeReminder({
        recurrenceRules: [
          { ruleMode: 'interval', intervalMinutes: 30, weekDays: [] },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 10, 0, 10), TPE),
      ).toBe(true);
    });

    it('does not trigger mid-interval', () => {
      // 10:15:05 — 615 % 30 = 15 ≠ 0
      const reminder = makeReminder({
        recurrenceRules: [
          { ruleMode: 'interval', intervalMinutes: 30, weekDays: [] },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 10, 15, 5), TPE),
      ).toBe(false);
    });

    it('respects activeFrom/activeUntil window', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'interval',
            intervalMinutes: 60,
            weekDays: [],
            activeFrom: '09:00',
            activeUntil: '17:00',
          },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 8, 0, 5), TPE),
      ).toBe(false);
    });

    it('anchors interval to activeFrom — triggers at 10:30 with activeFrom 09:30 and 60-min interval', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'interval',
            intervalMinutes: 60,
            weekDays: [],
            activeFrom: '09:30',
            activeUntil: '18:00',
          },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 10, 30, 5), TPE),
      ).toBe(true);
    });

    it('anchors interval to activeFrom — does not trigger at 10:00 with activeFrom 09:30 and 60-min interval', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'interval',
            intervalMinutes: 60,
            weekDays: [],
            activeFrom: '09:30',
            activeUntil: '18:00',
          },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 10, 0, 5), TPE),
      ).toBe(false);
    });

    it('only activeFrom set — triggers inside window, not before', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'interval',
            intervalMinutes: 60,
            weekDays: [],
            activeFrom: '09:00',
            activeUntil: null,
          },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 10, 0, 5), TPE),
      ).toBe(true);
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 8, 0, 5), TPE),
      ).toBe(false);
    });

    it('overnight window — triggers inside window at midnight', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'interval',
            intervalMinutes: 60,
            weekDays: [],
            activeFrom: '23:30',
            activeUntil: '01:00',
          },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 0, 30, 5), TPE),
      ).toBe(true);
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 12, 0, 5), TPE),
      ).toBe(false);
    });
  });

  describe('endAt / enabled', () => {
    it('does not trigger if disabled', () => {
      const reminder = makeReminder({
        enabled: false,
        scheduleType: 'one_time',
        oneTimeAt: tpe(2026, 5, 20, 10, 0, 0),
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 10, 0, 10), TPE),
      ).toBe(false);
    });

    it('does not trigger if past endAt', () => {
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: tpe(2026, 5, 20, 10, 0, 0),
        endAt: tpe(2026, 5, 19, 0, 0, 0),
      });
      expect(
        svc.isReminderDue(reminder as any, tpe(2026, 5, 20, 10, 0, 10), TPE),
      ).toBe(false);
    });
  });

  describe('使用者時區（伺服器跑在 UTC）', () => {
    it('Asia/Taipei 每日 09:00：在 01:00Z 觸發、09:00Z 不觸發', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          { ruleMode: 'daily_time', timeOfDay: '09:00', weekDays: [] },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, utc(2026, 5, 20, 1, 0, 5), TPE),
      ).toBe(true);
      expect(
        svc.isReminderDue(reminder as any, utc(2026, 5, 20, 9, 0, 5), TPE),
      ).toBe(false);
    });

    it('同一條規則，UTC 使用者在 09:00Z 觸發', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          { ruleMode: 'daily_time', timeOfDay: '09:00', weekDays: [] },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, utc(2026, 5, 20, 9, 0, 5), 'UTC'),
      ).toBe(true);
      expect(
        svc.isReminderDue(reminder as any, utc(2026, 5, 20, 1, 0, 5), 'UTC'),
      ).toBe(false);
    });

    it('weekly_day 跨日邊界：台灣週一 07:00 = UTC 週日 23:00', () => {
      // 2026-05-18 是週一；台灣 05-18 07:00 = 2026-05-17T23:00Z（UTC 仍是週日）
      const now = utc(2026, 5, 17, 23, 0, 5);
      const monday = makeReminder({
        recurrenceRules: [
          { ruleMode: 'weekly_day', weekDays: [1], timeOfDay: '07:00' },
        ],
      });
      const sunday = makeReminder({
        recurrenceRules: [
          { ruleMode: 'weekly_day', weekDays: [0], timeOfDay: '07:00' },
        ],
      });
      expect(svc.isReminderDue(monday as any, now, TPE)).toBe(true);
      expect(svc.isReminderDue(sunday as any, now, TPE)).toBe(false);
    });

    it('weekly_day 跨日邊界：台灣週日 23:00 之後不會被當成週一', () => {
      // 台灣週日 2026-05-17 23:30 = 15:30Z（UTC 也是週日）；設定週一 23:30 不應觸發
      const now = utc(2026, 5, 17, 15, 30, 5);
      const monday = makeReminder({
        recurrenceRules: [
          { ruleMode: 'weekly_day', weekDays: [1], timeOfDay: '23:30' },
        ],
      });
      const sunday = makeReminder({
        recurrenceRules: [
          { ruleMode: 'weekly_day', weekDays: [0], timeOfDay: '23:30' },
        ],
      });
      expect(svc.isReminderDue(monday as any, now, TPE)).toBe(false);
      expect(svc.isReminderDue(sunday as any, now, TPE)).toBe(true);
    });

    it('monthly_day 跨日邊界：台灣 6/1 07:00 = UTC 5/31 23:00', () => {
      const now = utc(2026, 5, 31, 23, 0, 5);
      const first = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'monthly_day',
            monthDay: 1,
            timeOfDay: '07:00',
            weekDays: [],
          },
        ],
      });
      const last = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'monthly_day',
            monthDay: 31,
            timeOfDay: '07:00',
            weekDays: [],
          },
        ],
      });
      expect(svc.isReminderDue(first as any, now, TPE)).toBe(true);
      expect(svc.isReminderDue(last as any, now, TPE)).toBe(false);
    });

    it('interval 的星期過濾與時段都用使用者時區', () => {
      // 台灣週一 2026-05-18 07:00 = 2026-05-17T23:00Z
      const reminder = makeReminder({
        recurrenceRules: [
          {
            ruleMode: 'interval',
            intervalMinutes: 60,
            weekDays: [1],
            activeFrom: '07:00',
            activeUntil: '18:00',
          },
        ],
      });
      expect(
        svc.isReminderDue(reminder as any, utc(2026, 5, 17, 23, 0, 5), TPE),
      ).toBe(true);
      // 同一個 UTC 時間對 UTC 使用者來說是週日 23:00，不在週一、也不在時段內
      expect(
        svc.isReminderDue(reminder as any, utc(2026, 5, 17, 23, 0, 5), 'UTC'),
      ).toBe(false);
    });

    it('負時差時區：America/New_York（夏令 UTC-4）每日 21:00 = 隔天 01:00Z', () => {
      const reminder = makeReminder({
        recurrenceRules: [
          { ruleMode: 'daily_time', timeOfDay: '21:00', weekDays: [] },
        ],
      });
      expect(
        svc.isReminderDue(
          reminder as any,
          utc(2026, 7, 2, 1, 0, 5),
          'America/New_York',
        ),
      ).toBe(true);
      expect(
        svc.isReminderDue(
          reminder as any,
          utc(2026, 7, 1, 21, 0, 5),
          'America/New_York',
        ),
      ).toBe(false);
    });
  });
});

// ─── 多使用者 / 多裝置佇列 ────────────────────────────────────────────────

interface FakeReminder {
  id: string;
  userId: string;
  title: string;
  content: string;
  enabled: boolean;
  scheduleType: string;
  oneTimeAt: Date | null;
  endAt: Date | null;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
  maxOccurrences: number | null;
  fireCount: number;
  recurrenceRules: RecurrenceRule[];
  user: {
    timezone: string;
    displaySetting: {
      corner: string;
      size: string;
      targetScreenId: string | null;
    } | null;
  };
}

function fakeReminder(
  id: string,
  userId: string,
  overrides: Partial<FakeReminder> = {},
): FakeReminder {
  return {
    id,
    userId,
    title: `title-${id}`,
    content: '',
    enabled: true,
    scheduleType: 'recurring',
    oneTimeAt: null,
    endAt: null,
    autoCloseEnabled: false,
    autoCloseSeconds: 60,
    snoozeDefaultSeconds: 300,
    maxOccurrences: null,
    fireCount: 0,
    recurrenceRules: [
      { ruleMode: 'daily_time', timeOfDay: '09:00', weekDays: [] },
    ],
    user: { timezone: TPE, displaySetting: null },
    ...overrides,
  };
}

function makePrisma(reminders: FakeReminder[]) {
  return {
    reminder: {
      findMany: jest.fn(
        async (args: {
          where: { enabled: boolean; userId: { in: string[] } };
        }) =>
          reminders.filter(
            (r) => r.enabled && args.where.userId.in.includes(r.userId),
          ),
      ),
      updateMany: jest.fn(async (args: { where: { id: { in: string[] } } }) => {
        for (const r of reminders)
          if (args.where.id.in.includes(r.id)) r.fireCount += 1;
        return { count: args.where.id.in.length };
      }),
    },
  };
}

describe('SchedulerService 多使用者 / 多裝置佇列', () => {
  // 台灣 2026-05-20 09:00:05 = 01:00:05Z
  const fireAt = tpe(2026, 5, 20, 9, 0, 5);
  const pollAt = fireAt.getTime() - 10_000;

  it('同一個使用者的兩台裝置都收到，取走後就清空', async () => {
    const prisma = makePrisma([fakeReminder('r1', 'userA')]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue('userA', 'dev-1', pollAt);
    svc.consumeDue('userA', 'dev-2', pollAt);

    await svc.checkDue(fireAt);

    expect(
      svc.consumeDue('userA', 'dev-1', fireAt.getTime()).map((d) => d.id),
    ).toEqual(['r1']);
    expect(
      svc.consumeDue('userA', 'dev-2', fireAt.getTime()).map((d) => d.id),
    ).toEqual(['r1']);
    expect(svc.consumeDue('userA', 'dev-1', fireAt.getTime())).toEqual([]);
  });

  it('別的使用者收不到', async () => {
    const prisma = makePrisma([fakeReminder('r1', 'userA')]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue('userA', 'dev-a', pollAt);
    svc.consumeDue('userB', 'dev-b', pollAt);

    await svc.checkDue(fireAt);

    expect(svc.consumeDue('userB', 'dev-b', fireAt.getTime())).toEqual([]);
    expect(
      svc.consumeDue('userA', 'dev-a', fireAt.getTime()).map((d) => d.id),
    ).toEqual(['r1']);
  });

  it('同一個 deviceId 字串在不同使用者之間不會混用佇列', async () => {
    const prisma = makePrisma([fakeReminder('r1', 'userA')]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue('userA', 'same-device', pollAt);
    svc.consumeDue('userB', 'same-device', pollAt);

    await svc.checkDue(fireAt);

    expect(svc.consumeDue('userB', 'same-device', fireAt.getTime())).toEqual(
      [],
    );
    expect(
      svc.consumeDue('userA', 'same-device', fireAt.getTime()),
    ).toHaveLength(1);
  });

  it('超過 2 分鐘沒輪詢的裝置收不到，最近輪詢過的裝置收得到', async () => {
    const prisma = makePrisma([fakeReminder('r1', 'userA')]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue(
      'userA',
      'stale',
      fireAt.getTime() - DEVICE_ONLINE_WINDOW_MS - 1_000,
    );
    svc.consumeDue('userA', 'fresh', fireAt.getTime() - 60_000);

    await svc.checkDue(fireAt);

    expect(svc.consumeDue('userA', 'stale', fireAt.getTime())).toEqual([]);
    expect(
      svc.consumeDue('userA', 'fresh', fireAt.getTime()).map((d) => d.id),
    ).toEqual(['r1']);
  });

  it('沒有任何裝置在線時不查資料庫，也不消耗 maxOccurrences', async () => {
    const reminder = fakeReminder('r1', 'userA', { maxOccurrences: 3 });
    const prisma = makePrisma([reminder]);
    const svc = new SchedulerService(prisma as any);

    await svc.checkDue(fireAt);

    expect(prisma.reminder.findMany).not.toHaveBeenCalled();
    expect(reminder.fireCount).toBe(0);
  });

  it('只查在線使用者的提醒，且一次查完（include 時區與顯示設定）', async () => {
    const prisma = makePrisma([
      fakeReminder('r1', 'userA'),
      fakeReminder('r2', 'userB'),
    ]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue('userA', 'dev', pollAt);

    await svc.checkDue(fireAt);

    expect(prisma.reminder.findMany).toHaveBeenCalledTimes(1);
    const args = prisma.reminder.findMany.mock.calls[0][0] as any;
    expect(args.where.userId.in).toEqual(['userA']);
    expect(args.include.user.select.timezone).toBe(true);
    expect(args.include.user.select.displaySetting).toBeDefined();
  });

  it('同一個觸發視窗內連續掃描只會推一次', async () => {
    const prisma = makePrisma([fakeReminder('r1', 'userA')]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue('userA', 'dev', pollAt);

    await svc.checkDue(fireAt);
    await svc.checkDue(new Date(fireAt.getTime() + 3_000));
    await svc.checkDue(new Date(fireAt.getTime() + 6_000));

    expect(
      svc.consumeDue('userA', 'dev', fireAt.getTime() + 6_000),
    ).toHaveLength(1);
  });

  it('依各自使用者的時區觸發', async () => {
    const prisma = makePrisma([
      fakeReminder('tpe', 'userA'),
      fakeReminder('utc', 'userB', {
        user: { timezone: 'UTC', displaySetting: null },
      }),
    ]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue('userA', 'dev', pollAt);
    svc.consumeDue('userB', 'dev', pollAt);

    await svc.checkDue(fireAt); // 01:00:05Z = 台灣 09:00:05

    expect(
      svc.consumeDue('userA', 'dev', fireAt.getTime()).map((d) => d.id),
    ).toEqual(['tpe']);
    expect(svc.consumeDue('userB', 'dev', fireAt.getTime())).toEqual([]);
  });

  it('corner / size / targetScreenId 取自該使用者的顯示設定，沒有設定時用預設值', async () => {
    const prisma = makePrisma([
      fakeReminder('r1', 'userA', {
        user: {
          timezone: TPE,
          displaySetting: {
            corner: 'top_left',
            size: 'large',
            targetScreenId: 'screen-2',
          },
        },
      }),
      fakeReminder('r2', 'userB'),
    ]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue('userA', 'dev', pollAt);
    svc.consumeDue('userB', 'dev', pollAt);

    await svc.checkDue(fireAt);

    expect(svc.consumeDue('userA', 'dev', fireAt.getTime())[0]).toMatchObject({
      id: 'r1',
      corner: 'top_left',
      size: 'large',
      targetScreenId: 'screen-2',
    });
    expect(svc.consumeDue('userB', 'dev', fireAt.getTime())[0]).toMatchObject({
      id: 'r2',
      corner: 'bottom_right',
      size: 'medium',
      targetScreenId: null,
    });
  });

  it('DueReminderDto 形狀不變', async () => {
    const prisma = makePrisma([fakeReminder('r1', 'userA')]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue('userA', 'dev', pollAt);
    await svc.checkDue(fireAt);
    const [dto] = svc.consumeDue('userA', 'dev', fireAt.getTime());
    expect(Object.keys(dto).sort()).toEqual(
      [
        'id',
        'title',
        'content',
        'autoCloseEnabled',
        'autoCloseSeconds',
        'snoozeDefaultSeconds',
        'corner',
        'size',
        'targetScreenId',
      ].sort(),
    );
  });

  it('maxOccurrences 會持久化 fireCount，達上限後不再觸發', async () => {
    const reminder = fakeReminder('r1', 'userA', { maxOccurrences: 1 });
    const prisma = makePrisma([reminder]);
    const svc = new SchedulerService(prisma as any);
    svc.consumeDue('userA', 'dev', pollAt);

    await svc.checkDue(fireAt);
    expect(reminder.fireCount).toBe(1);
    expect(svc.consumeDue('userA', 'dev', fireAt.getTime())).toHaveLength(1);

    // 隔天同一時間：已達上限
    const nextDay = new Date(fireAt.getTime() + 24 * 60 * 60 * 1000);
    svc.consumeDue('userA', 'dev', nextDay.getTime() - 10_000);
    await svc.checkDue(nextDay);
    expect(svc.consumeDue('userA', 'dev', nextDay.getTime())).toEqual([]);
  });

  it('延後到期時不論排程都會再推一次', async () => {
    const prisma = makePrisma([fakeReminder('r1', 'userA')]);
    const svc = new SchedulerService(prisma as any);
    const realNow = Date.now;
    try {
      Date.now = () => fireAt.getTime();
      svc.snoozeReminder('r1', 60);
    } finally {
      Date.now = realNow;
    }
    const later = new Date(fireAt.getTime() + 61_000);
    svc.consumeDue('userA', 'dev', later.getTime() - 1_000);

    await svc.checkDue(later);

    expect(
      svc.consumeDue('userA', 'dev', later.getTime()).map((d) => d.id),
    ).toEqual(['r1']);
  });
});
