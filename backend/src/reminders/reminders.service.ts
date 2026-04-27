import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RuleMode, ScheduleType } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { ReorderRemindersDto } from './dto/reorder-reminders.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';

@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.reminder.findMany({
      include: { recurrenceRules: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(id: string) {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id },
      include: { recurrenceRules: true },
    });
    if (!reminder) {
      throw new NotFoundException('提醒不存在');
    }
    return reminder;
  }

  async create(dto: CreateReminderDto) {
    this.validateReminderInput(dto);

    const maxSort = await this.prisma.reminder.aggregate({
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    return this.prisma.reminder.create({
      include: { recurrenceRules: true },
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
        recurrenceRules: {
          create: (dto.recurrenceRules ?? []).map((rule) => ({
            ruleMode: rule.ruleMode as Prisma.RecurrenceRuleCreateWithoutReminderInput['ruleMode'],
            monthDay: rule.monthDay ?? null,
            weekDay: rule.weekDay ?? null,
            timeOfDay: rule.timeOfDay ?? null,
          })),
        },
      },
    });
  }

  async update(id: string, dto: UpdateReminderDto) {
    const current = await this.findOne(id);
    const mergedForValidation: CreateReminderDto = {
      title: dto.title ?? current.title,
      content: dto.content ?? current.content,
      scheduleType: (dto.scheduleType ?? current.scheduleType) as ScheduleType,
      oneTimeAt: dto.oneTimeAt ?? current.oneTimeAt?.toISOString(),
      enabled: dto.enabled ?? current.enabled,
      autoCloseEnabled: dto.autoCloseEnabled ?? current.autoCloseEnabled,
      autoCloseSeconds: dto.autoCloseSeconds ?? current.autoCloseSeconds,
      snoozeDefaultSeconds: dto.snoozeDefaultSeconds ?? current.snoozeDefaultSeconds,
      endAt: dto.endAt ?? current.endAt?.toISOString(),
      maxOccurrences: dto.maxOccurrences ?? current.maxOccurrences ?? undefined,
      recurrenceRules:
        dto.recurrenceRules ??
        current.recurrenceRules.map((rule) => ({
          ruleMode: rule.ruleMode as RuleMode,
          monthDay: rule.monthDay ?? undefined,
          weekDay: rule.weekDay ?? undefined,
          timeOfDay: rule.timeOfDay ?? undefined,
        })),
      skipShortMonthConfirmation: dto.skipShortMonthConfirmation ?? false,
    };

    this.validateReminderInput(mergedForValidation);

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
      maxOccurrences: dto.maxOccurrences ?? current.maxOccurrences,
    };

    if (dto.recurrenceRules !== undefined) {
      payload.recurrenceRules = {
        deleteMany: {},
        create: dto.recurrenceRules.map((rule) => ({
          ruleMode: rule.ruleMode as Prisma.RecurrenceRuleCreateWithoutReminderInput['ruleMode'],
          monthDay: rule.monthDay ?? null,
          weekDay: rule.weekDay ?? null,
          timeOfDay: rule.timeOfDay ?? null,
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
    return this.prisma.reminder.update({
      where: { id },
      data: { enabled },
      include: { recurrenceRules: true },
    });
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

  private validateReminderInput(dto: CreateReminderDto) {
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
        if (rule.ruleMode === RuleMode.MONTHLY_DAY) {
          if (!rule.monthDay) {
            throw new BadRequestException('monthly_day 必須提供 monthDay');
          }
          if (rule.monthDay >= 29 && !dto.skipShortMonthConfirmation) {
            throw new BadRequestException({
              code: 'SHORT_MONTH_CONFIRMATION_REQUIRED',
              message: '若遇到沒有該日期的月份，此月份將跳過提醒，是否確定繼續？',
            });
          }
        }

        if (
          rule.ruleMode === RuleMode.WEEKLY_DAY &&
          (rule.weekDay === undefined || rule.weekDay === null)
        ) {
          throw new BadRequestException('weekly_day 必須提供 weekDay');
        }

        if (rule.ruleMode === RuleMode.DAILY_TIME && !rule.timeOfDay) {
          throw new BadRequestException('daily_time 必須提供 timeOfDay');
        }
      }
    }
  }
}
