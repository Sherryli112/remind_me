import { NotFoundException } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { GroupsService } from '../groups/groups.service';
import { ScheduleType } from '../common/enums';

/**
 * 多租戶：所有查詢都要帶 userId；別人的資源一律 404。
 * 用簡單的記憶體 fake 模擬 Prisma 的 where 篩選。
 */
function makePrisma() {
  const reminders = [
    { id: 'rA', userId: 'A', title: 't', recurrenceRules: [], group: null },
    { id: 'rB', userId: 'B', title: 't', recurrenceRules: [], group: null },
  ];
  const groups = [
    { id: 'gA', userId: 'A', name: '工作' },
    { id: 'gB', userId: 'B', name: '工作' },
  ];
  const match = (
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'in' in (v as object)
        ? (v as { in: unknown[] }).in.includes(row[k])
        : row[k] === v,
    );
  return {
    reminders,
    groups,
    reminder: {
      findMany: jest.fn(async ({ where }: any) =>
        reminders.filter((r) => match(r, where)),
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          reminders.find((r) => match(r, where)) ?? null,
      ),
      count: jest.fn(
        async ({ where }: any) =>
          reminders.filter((r) => match(r, where)).length,
      ),
      aggregate: jest.fn(async () => ({ _max: { sortOrder: null } })),
      create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      update: jest.fn(async ({ where }: any) =>
        reminders.find((r) => r.id === where.id),
      ),
      delete: jest.fn(),
    },
    group: {
      findFirst: jest.fn(
        async ({ where }: any) => groups.find((g) => match(g, where)) ?? null,
      ),
      findUnique: jest.fn(async () => null),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
}

const scheduler = {
  resetReminder: jest.fn(),
  forgetReminder: jest.fn(),
  clearFiredSet: jest.fn(),
  snoozeReminder: jest.fn(),
};

describe('RemindersService 多租戶', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: RemindersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrisma();
    svc = new RemindersService(prisma as any, scheduler as any);
  });

  it('findAll 只查自己的提醒', async () => {
    const list = await svc.findAll('A');
    expect(list.map((r: any) => r.id)).toEqual(['rA']);
    expect(prisma.reminder.findMany.mock.calls[0][0].where).toEqual({
      userId: 'A',
    });
  });

  it('讀取別人的提醒 → 404', async () => {
    await expect(svc.findOne('A', 'rB')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.findOne('A', 'rA')).resolves.toMatchObject({ id: 'rA' });
  });

  it('刪除 / 啟用 / 延後別人的提醒 → 404，且不會動到資料', async () => {
    await expect(svc.remove('A', 'rB')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.setEnabled('A', 'rB', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.snooze('A', 'rB', 60)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.update('A', 'rB', { title: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.reminder.delete).not.toHaveBeenCalled();
    expect(prisma.reminder.update).not.toHaveBeenCalled();
    expect(scheduler.snoozeReminder).not.toHaveBeenCalled();
    expect(scheduler.resetReminder).not.toHaveBeenCalled();
  });

  it('reorder 帶入別人的 id → 404', async () => {
    await expect(
      svc.reorder('A', {
        items: [
          { id: 'rA', sortOrder: 0 },
          { id: 'rB', sortOrder: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('create 帶入別人的 groupId → 404；自己的 groupId 可以', async () => {
    const dto = {
      title: 't',
      scheduleType: ScheduleType.ONE_TIME,
      oneTimeAt: new Date().toISOString(),
    };
    await expect(
      svc.create('A', { ...dto, groupId: 'gB' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.reminder.create).not.toHaveBeenCalled();

    await svc.create('A', { ...dto, groupId: 'gA' });
    const data = prisma.reminder.create.mock.calls[0][0].data;
    expect(data.user).toEqual({ connect: { id: 'A' } });
    expect(data.group).toEqual({ connect: { id: 'gA' } });
    expect(prisma.reminder.aggregate.mock.calls[0][0].where).toEqual({
      userId: 'A',
    });
  });

  it('update 帶入別人的 groupId → 404', async () => {
    await expect(
      svc.update('A', 'rA', { groupId: 'gB' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.reminder.update).not.toHaveBeenCalled();
  });

  it('weekDays 直接以 Int[] 寫入（不再序列化成 JSON 字串）', async () => {
    await svc.create('A', {
      title: 't',
      scheduleType: ScheduleType.RECURRING,
      recurrenceRules: [
        { ruleMode: 'weekly_day' as any, weekDays: [1, 3], timeOfDay: '09:00' },
      ],
    });
    const rules =
      prisma.reminder.create.mock.calls[0][0].data.recurrenceRules.create;
    expect(rules[0].weekDays).toEqual([1, 3]);
  });
});

describe('GroupsService 多租戶', () => {
  it('重新命名 / 刪除別人的群組 → 404', async () => {
    const prisma = makePrisma();
    const svc = new GroupsService(prisma as any);
    await expect(svc.rename('A', 'gB', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.remove('A', 'gB')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.group.update).not.toHaveBeenCalled();
    expect(prisma.group.delete).not.toHaveBeenCalled();
  });
});
