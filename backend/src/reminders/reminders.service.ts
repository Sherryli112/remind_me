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

const REMINDER_INCLUDE = { recurrenceRules: true, group: true } as const;

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerService: SchedulerService,
  ) {}

  findAll(userId: string) {
    return this.prisma.reminder.findMany({
      where: { userId },
      include: REMINDER_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** 只回傳屬於 userId 的提醒；別人的提醒與不存在的提醒一律 404，避免洩漏資源是否存在。 */
  async findOne(userId: string, id: string) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id, userId },
      include: REMINDER_INCLUDE,
    });
    if (!reminder) {
      throw new NotFoundException('提醒不存在');
    }
    return reminder;
  }

  async create(userId: string, dto: CreateReminderDto) {
    this.validateReminderInput(dto);

    const maxSort = await this.prisma.reminder.aggregate({
      where: { userId },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    if (dto.groupId) {
      await this.assertGroupOwned(userId, dto.groupId);
    }

    return this.prisma.reminder.create({
      include: REMINDER_INCLUDE,
      data: {
        user: { connect: { id: userId } },
        title: dto.title,
        content: dto.content ?? '',
        enabled: dto.enabled ?? true,
        scheduleType:
          dto.scheduleType as Prisma.ReminderCreateInput['scheduleType'],
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
            ruleMode:
              rule.ruleMode as Prisma.RecurrenceRuleCreateWithoutReminderInput['ruleMode'],
            monthDay: rule.monthDay ?? null,
            weekDays: rule.weekDays ?? [],
            timeOfDay: rule.timeOfDay ?? null,
            intervalMinutes: rule.intervalMinutes ?? null,
            activeFrom: rule.activeFrom ?? null,
            activeUntil: rule.activeUntil ?? null,
          })),
        },
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateReminderDto) {
    const current = await this.findOne(userId, id);
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
          ? (dto.oneTimeAt ?? undefined)
          : current.oneTimeAt?.toISOString(),
      enabled: dto.enabled ?? current.enabled,
      autoCloseEnabled: dto.autoCloseEnabled ?? current.autoCloseEnabled,
      autoCloseSeconds: dto.autoCloseSeconds ?? current.autoCloseSeconds,
      snoozeDefaultSeconds:
        dto.snoozeDefaultSeconds ?? current.snoozeDefaultSeconds,
      endAt:
        dto.endAt !== undefined
          ? (dto.endAt ?? undefined)
          : current.endAt?.toISOString(),
      maxOccurrences:
        dto.maxOccurrences !== undefined
          ? (dto.maxOccurrences ?? undefined)
          : (current.maxOccurrences ?? undefined),
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
      scheduleType: (dto.scheduleType ??
        current.scheduleType) as Prisma.ReminderUpdateInput['scheduleType'],
      oneTimeAt:
        dto.oneTimeAt !== undefined
          ? dto.oneTimeAt
            ? new Date(dto.oneTimeAt)
            : null
          : current.oneTimeAt,
      enabled: dto.enabled ?? current.enabled,
      autoCloseEnabled: dto.autoCloseEnabled ?? current.autoCloseEnabled,
      autoCloseSeconds: dto.autoCloseSeconds ?? current.autoCloseSeconds,
      snoozeDefaultSeconds:
        dto.snoozeDefaultSeconds ?? current.snoozeDefaultSeconds,
      endAt:
        dto.endAt !== undefined
          ? dto.endAt
            ? new Date(dto.endAt)
            : null
          : current.endAt,
      maxOccurrences:
        dto.maxOccurrences !== undefined
          ? dto.maxOccurrences
          : current.maxOccurrences,
    };

    if (dto.groupId !== undefined) {
      if (dto.groupId) {
        await this.assertGroupOwned(userId, dto.groupId);
        payload.group = { connect: { id: dto.groupId } };
      } else {
        payload.group = { disconnect: true };
      }
    }

    if (dto.recurrenceRules !== undefined) {
      payload.recurrenceRules = {
        deleteMany: {},
        create: dto.recurrenceRules.map((rule) => ({
          ruleMode:
            rule.ruleMode as Prisma.RecurrenceRuleCreateWithoutReminderInput['ruleMode'],
          monthDay: rule.monthDay ?? null,
          weekDays: rule.weekDays ?? [],
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

    // id 已在上方 findOne 確認屬於 userId，scheduler 的狀態只會清到自己的提醒
    await this.schedulerService.resetReminder(id);

    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.reminder.delete({ where: { id } });
    this.schedulerService.forgetReminder(id);
    return { success: true };
  }

  async setEnabled(userId: string, id: string, enabled: boolean) {
    await this.findOne(userId, id);
    return this.prisma.reminder.update({
      where: { id },
      data: { enabled },
      include: REMINDER_INCLUDE,
    });
  }

  async reorder(userId: string, dto: ReorderRemindersDto) {
    const ids = [...new Set(dto.items.map((item) => item.id))];
    const owned = await this.prisma.reminder.count({
      where: { id: { in: ids }, userId },
    });

    if (owned !== ids.length) {
      throw new NotFoundException('排序資料包含不存在的提醒 id');
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.reminder.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
    return this.findAll(userId);
  }

  async snooze(userId: string, id: string, seconds: number) {
    const reminder = await this.findOne(userId, id);

    if (reminder.scheduleType === 'one_time') {
      const newOneTimeAt = new Date(Date.now() + seconds * 1000);
      await this.prisma.reminder.update({
        where: { id },
        data: { oneTimeAt: newOneTimeAt },
      });
      // Clear firedSet so checkDue can fire again at the new oneTimeAt
      this.schedulerService.clearFiredSet(id);
    } else {
      this.schedulerService.snoozeReminder(id, seconds);
    }

    return { success: true };
  }

  private async assertGroupOwned(userId: string, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, userId },
    });
    if (!group) throw new NotFoundException('指定的群組不存在');
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
          const alreadyConfirmed =
            opts?.confirmedMonthDays?.includes(rule.monthDay) ?? false;
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
                message:
                  '若遇到沒有該日期的月份，此月份將跳過提醒，是否確定繼續？',
              },
              HttpStatus.CONFLICT,
            );
          }
        }

        if (rule.ruleMode === RuleMode.INTERVAL) {
          if (
            !rule.intervalMinutes ||
            rule.intervalMinutes < 1 ||
            rule.intervalMinutes > 1440
          ) {
            throw new BadRequestException(
              'interval 必須提供 intervalMinutes（1~1440 分鐘）',
            );
          }
          const hasFrom = !!rule.activeFrom;
          const hasUntil = !!rule.activeUntil;
          if (hasFrom !== hasUntil) {
            throw new BadRequestException(
              'interval 限定時段需同時提供 activeFrom 與 activeUntil',
            );
          }
          if (hasFrom && hasUntil && rule.activeFrom! >= rule.activeUntil!) {
            throw new BadRequestException(
              'interval activeFrom 必須早於 activeUntil（不支援跨夜）',
            );
          }
        }
      }
    }
  }
}
