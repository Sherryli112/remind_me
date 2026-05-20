import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RuleMode, ScheduleType } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { ReorderRemindersDto } from './dto/reorder-reminders.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';

/** SQLite stores weekDays as a JSON string; these helpers convert at the boundary. */
function serializeWeekDays(arr: number[] | undefined | null): string {
  return JSON.stringify(arr ?? []);
}

function deserializeWeekDays(raw: string | undefined | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => typeof v === 'number');
  } catch {
    return [];
  }
}

function normalizeRule<T extends { weekDays: string }>(rule: T): Omit<T, 'weekDays'> & { weekDays: number[] } {
  return { ...rule, weekDays: deserializeWeekDays(rule.weekDays) };
}

function normalizeReminder<T extends { recurrenceRules: Array<{ weekDays: string }> }>(
  reminder: T,
): Omit<T, 'recurrenceRules'> & { recurrenceRules: Array<Omit<T['recurrenceRules'][number], 'weekDays'> & { weekDays: number[] }> } {
  return {
    ...reminder,
    recurrenceRules: reminder.recurrenceRules.map(normalizeRule),
  };
}

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerService: SchedulerService,
  ) {}

  async findAll() {
    const reminders = await this.prisma.reminder.findMany({
      include: { recurrenceRules: true, group: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return reminders.map(normalizeReminder);
  }

  async findOne(id: string) {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id },
      include: { recurrenceRules: true, group: true },
    });
    if (!reminder) {
      throw new NotFoundException('提醒不存在');
    }
    return normalizeReminder(reminder);
  }

  async create(dto: CreateReminderDto) {
    this.validateReminderInput(dto);

    const maxSort = await this.prisma.reminder.aggregate({
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({ where: { id: dto.groupId } });
      if (!group) throw new BadRequestException('指定的群組不存在');
    }

    const created = await this.prisma.reminder.create({
      include: { recurrenceRules: true, group: true },
      data: {
        title: dto.title,
        content: dto.content ?? '',
        enabled: dto.enabled ?? true,
        scheduleType: dto.scheduleType as Prisma.ReminderCreateInput['scheduleType'],
        oneTimeAt: dto.oneTimeAt ? new Date(dto.oneTimeAt) : null,
        autoCloseEnabled: dto.autoCloseEnabled ?? false,
        autoCloseSeconds: dto.autoCloseSeconds ?? 60,
        snoozeDefaultSeconds: dto.snoozeDefaultSeconds ?? 300,
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        maxOccurrences: dto.maxOccurrences ?? null,
        sortOrder,
        group: dto.groupId ? { connect: { id: dto.groupId } } : undefined,
        recurrenceRules: {
          create: (dto.recurrenceRules ?? []).map((rule) => ({
            ruleMode: rule.ruleMode as Prisma.RecurrenceRuleCreateWithoutReminderInput['ruleMode'],
            monthDay: rule.monthDay ?? null,
            weekDays: serializeWeekDays(rule.weekDays),
            timeOfDay: rule.timeOfDay ?? null,
            intervalMinutes: rule.intervalMinutes ?? null,
            activeFrom: rule.activeFrom ?? null,
            activeUntil: rule.activeUntil ?? null,
          })),
        },
      },
    });
    return normalizeReminder(created);
  }

  async update(id: string, dto: UpdateReminderDto) {
    const current = await this.findOne(id);
    const confirmedMonthDays = current.recurrenceRules
      .filter(
        (rule) =>
          rule.ruleMode === RuleMode.MONTHLY_DAY &&
          rule.monthDay !== null &&
          rule.monthDay >= 29,
      )
      .map((rule) => rule.monthDay as number);
    const mergedForValidation: CreateReminderDto = {
      title: dto.title ?? current.title,
      content: dto.content ?? current.content,
      scheduleType: (dto.scheduleType ?? current.scheduleType) as ScheduleType,
      oneTimeAt:
        dto.oneTimeAt !== undefined
          ? dto.oneTimeAt ?? undefined
          : current.oneTimeAt?.toISOString(),
      enabled: dto.enabled ?? current.enabled,
      autoCloseEnabled: dto.autoCloseEnabled ?? current.autoCloseEnabled,
      autoCloseSeconds: dto.autoCloseSeconds ?? current.autoCloseSeconds,
      snoozeDefaultSeconds: dto.snoozeDefaultSeconds ?? current.snoozeDefaultSeconds,
      endAt:
        dto.endAt !== undefined ? dto.endAt ?? undefined : current.endAt?.toISOString(),
      maxOccurrences:
        dto.maxOccurrences !== undefined
          ? dto.maxOccurrences ?? undefined
          : current.maxOccurrences ?? undefined,
      recurrenceRules:
        dto.recurrenceRules ??
        current.recurrenceRules.map((rule) => ({
          ruleMode: rule.ruleMode as RuleMode,
          monthDay: rule.monthDay ?? undefined,
          weekDays: rule.weekDays ?? undefined,
          timeOfDay: rule.timeOfDay ?? undefined,
          intervalMinutes: rule.intervalMinutes ?? undefined,
          activeFrom: rule.activeFrom ?? undefined,
          activeUntil: rule.activeUntil ?? undefined,
        })),
      skipShortMonthConfirmation: dto.skipShortMonthConfirmation ?? false,
    };

    this.validateReminderInput(mergedForValidation, { confirmedMonthDays });

    const payload: Prisma.ReminderUpdateInput = {
      title: dto.title ?? current.title,
      content: dto.content ?? current.content,
      scheduleType: (dto.scheduleType ?? current.scheduleType) as Prisma.ReminderUpdateInput['scheduleType'],
      oneTimeAt:
        dto.oneTimeAt !== undefined
          ? dto.oneTimeAt
            ? new Date(dto.oneTimeAt)
            : null
          : current.oneTimeAt,
      enabled: dto.enabled ?? current.enabled,
      autoCloseEnabled: dto.autoCloseEnabled ?? current.autoCloseEnabled,
      autoCloseSeconds: dto.autoCloseSeconds ?? current.autoCloseSeconds,
      snoozeDefaultSeconds: dto.snoozeDefaultSeconds ?? current.snoozeDefaultSeconds,
      endAt: dto.endAt !== undefined ? (dto.endAt ? new Date(dto.endAt) : null) : current.endAt,
      maxOccurrences:
        dto.maxOccurrences !== undefined ? dto.maxOccurrences : current.maxOccurrences,
    };

    if (dto.groupId !== undefined) {
      if (dto.groupId) {
        const group = await this.prisma.group.findUnique({ where: { id: dto.groupId } });
        if (!group) throw new BadRequestException('指定的群組不存在');
        payload.group = { connect: { id: dto.groupId } };
      } else {
        payload.group = { disconnect: true };
      }
    }

    if (dto.recurrenceRules !== undefined) {
      payload.recurrenceRules = {
        deleteMany: {},
        create: dto.recurrenceRules.map((rule) => ({
          ruleMode: rule.ruleMode as Prisma.RecurrenceRuleCreateWithoutReminderInput['ruleMode'],
          monthDay: rule.monthDay ?? null,
          weekDays: serializeWeekDays(rule.weekDays),
          timeOfDay: rule.timeOfDay ?? null,
          intervalMinutes: rule.intervalMinutes ?? null,
          activeFrom: rule.activeFrom ?? null,
          activeUntil: rule.activeUntil ?? null,
        })),
      };
    }

    await this.prisma.reminder.update({
      where: { id },
      data: payload,
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.reminder.delete({ where: { id } });
    return { success: true };
  }

  async setEnabled(id: string, enabled: boolean) {
    await this.findOne(id);
    const updated = await this.prisma.reminder.update({
      where: { id },
      data: { enabled },
      include: { recurrenceRules: true, group: true },
    });
    return normalizeReminder(updated);
  }

  async reorder(dto: ReorderRemindersDto) {
    const ids = dto.items.map((item) => item.id);
    const reminders = await this.prisma.reminder.findMany({
      where: { id: { in: ids } },
    });

    if (reminders.length !== ids.length) {
      throw new BadRequestException('排序資料包含不存在的提醒 id');
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.reminder.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
    return this.findAll();
  }

  async snooze(id: string, seconds: number) {
    const reminder = await this.findOne(id);

    if (reminder.scheduleType === 'one_time') {
      const newOneTimeAt = new Date(Date.now() + seconds * 1000);
      await this.prisma.reminder.update({
        where: { id },
        data: { oneTimeAt: newOneTimeAt },
      });
    } else {
      this.schedulerService.snoozeReminder(id, seconds);
    }

    return { success: true };
  }

  private validateReminderInput(
    dto: CreateReminderDto,
    opts?: { confirmedMonthDays?: number[] },
  ) {
    if (dto.scheduleType === ScheduleType.ONE_TIME && !dto.oneTimeAt) {
      throw new BadRequestException('單次提醒必須提供 oneTimeAt');
    }

    if (
      dto.scheduleType === ScheduleType.RECURRING &&
      (!dto.recurrenceRules || dto.recurrenceRules.length === 0)
    ) {
      throw new BadRequestException('重複提醒必須至少提供一條 recurrenceRules');
    }

    if (dto.scheduleType === ScheduleType.RECURRING && dto.recurrenceRules) {
      for (const rule of dto.recurrenceRules) {
        if (rule.ruleMode === RuleMode.DAILY_TIME) {
          if (!rule.timeOfDay) {
            throw new BadRequestException('daily_time 必須提供 timeOfDay');
          }
        }

        if (rule.ruleMode === RuleMode.WEEKLY_DAY) {
          if (!rule.weekDays || rule.weekDays.length === 0) {
            throw new BadRequestException('weekly_day 必須選擇至少一個星期');
          }
          if (!rule.timeOfDay) {
            throw new BadRequestException('weekly_day 必須提供 timeOfDay');
          }
        }

        if (rule.ruleMode === RuleMode.MONTHLY_DAY) {
          if (!rule.monthDay) {
            throw new BadRequestException('monthly_day 必須提供 monthDay');
          }
          if (!rule.timeOfDay) {
            throw new BadRequestException('monthly_day 必須提供 timeOfDay');
          }
          const alreadyConfirmed = opts?.confirmedMonthDays?.includes(rule.monthDay) ?? false;
          if (
            rule.monthDay >= 29 &&
            !dto.skipShortMonthConfirmation &&
            !alreadyConfirmed
          ) {
            // 用 409 Conflict + 顯式 body shape，前端只要看 status 與 code 即可；
            // 避免依賴 BadRequestException 內部序列化格式（不同 NestJS 版本可能不同）
            throw new HttpException(
              {
                code: 'SHORT_MONTH_CONFIRMATION_REQUIRED',
                message: '若遇到沒有該日期的月份，此月份將跳過提醒，是否確定繼續？',
              },
              HttpStatus.CONFLICT,
            );
          }
        }

        if (rule.ruleMode === RuleMode.INTERVAL) {
          if (!rule.intervalMinutes || rule.intervalMinutes < 1 || rule.intervalMinutes > 1440) {
            throw new BadRequestException('interval 必須提供 intervalMinutes（1~1440 分鐘）');
          }
          const hasFrom = !!rule.activeFrom;
          const hasUntil = !!rule.activeUntil;
          if (hasFrom !== hasUntil) {
            throw new BadRequestException('interval 限定時段需同時提供 activeFrom 與 activeUntil');
          }
          if (hasFrom && hasUntil && rule.activeFrom! >= rule.activeUntil!) {
            throw new BadRequestException('interval activeFrom 必須早於 activeUntil（不支援跨夜）');
          }
        }
      }
    }
  }
}
