"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemindersService = void 0;
const common_1 = require("@nestjs/common");
const enums_1 = require("../common/enums");
const prisma_service_1 = require("../prisma/prisma.service");
let RemindersService = class RemindersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    findAll() {
        return this.prisma.reminder.findMany({
            include: { recurrenceRules: true },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
    }
    async findOne(id) {
        const reminder = await this.prisma.reminder.findUnique({
            where: { id },
            include: { recurrenceRules: true },
        });
        if (!reminder) {
            throw new common_1.NotFoundException('提醒不存在');
        }
        return reminder;
    }
    async create(dto) {
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
                scheduleType: dto.scheduleType,
                oneTimeAt: dto.oneTimeAt ? new Date(dto.oneTimeAt) : null,
                autoCloseEnabled: dto.autoCloseEnabled ?? false,
                autoCloseSeconds: dto.autoCloseSeconds ?? 60,
                snoozeDefaultSeconds: dto.snoozeDefaultSeconds ?? 300,
                endAt: dto.endAt ? new Date(dto.endAt) : null,
                maxOccurrences: dto.maxOccurrences ?? null,
                sortOrder,
                recurrenceRules: {
                    create: (dto.recurrenceRules ?? []).map((rule) => ({
                        ruleMode: rule.ruleMode,
                        monthDay: rule.monthDay ?? null,
                        weekDay: rule.weekDay ?? null,
                        timeOfDay: rule.timeOfDay ?? null,
                    })),
                },
            },
        });
    }
    async update(id, dto) {
        const current = await this.findOne(id);
        const mergedForValidation = {
            title: dto.title ?? current.title,
            content: dto.content ?? current.content,
            scheduleType: (dto.scheduleType ?? current.scheduleType),
            oneTimeAt: dto.oneTimeAt ?? current.oneTimeAt?.toISOString(),
            enabled: dto.enabled ?? current.enabled,
            autoCloseEnabled: dto.autoCloseEnabled ?? current.autoCloseEnabled,
            autoCloseSeconds: dto.autoCloseSeconds ?? current.autoCloseSeconds,
            snoozeDefaultSeconds: dto.snoozeDefaultSeconds ?? current.snoozeDefaultSeconds,
            endAt: dto.endAt ?? current.endAt?.toISOString(),
            maxOccurrences: dto.maxOccurrences ?? current.maxOccurrences ?? undefined,
            recurrenceRules: dto.recurrenceRules ??
                current.recurrenceRules.map((rule) => ({
                    ruleMode: rule.ruleMode,
                    monthDay: rule.monthDay ?? undefined,
                    weekDay: rule.weekDay ?? undefined,
                    timeOfDay: rule.timeOfDay ?? undefined,
                })),
            skipShortMonthConfirmation: dto.skipShortMonthConfirmation ?? false,
        };
        this.validateReminderInput(mergedForValidation);
        const payload = {
            title: dto.title ?? current.title,
            content: dto.content ?? current.content,
            scheduleType: (dto.scheduleType ?? current.scheduleType),
            oneTimeAt: dto.oneTimeAt !== undefined
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
                    ruleMode: rule.ruleMode,
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
    async remove(id) {
        await this.findOne(id);
        await this.prisma.reminder.delete({ where: { id } });
        return { success: true };
    }
    async setEnabled(id, enabled) {
        await this.findOne(id);
        return this.prisma.reminder.update({
            where: { id },
            data: { enabled },
            include: { recurrenceRules: true },
        });
    }
    async reorder(dto) {
        const ids = dto.items.map((item) => item.id);
        const reminders = await this.prisma.reminder.findMany({
            where: { id: { in: ids } },
        });
        if (reminders.length !== ids.length) {
            throw new common_1.BadRequestException('排序資料包含不存在的提醒 id');
        }
        await this.prisma.$transaction(dto.items.map((item) => this.prisma.reminder.update({
            where: { id: item.id },
            data: { sortOrder: item.sortOrder },
        })));
        return this.findAll();
    }
    validateReminderInput(dto) {
        if (dto.scheduleType === enums_1.ScheduleType.ONE_TIME && !dto.oneTimeAt) {
            throw new common_1.BadRequestException('單次提醒必須提供 oneTimeAt');
        }
        if (dto.scheduleType === enums_1.ScheduleType.RECURRING &&
            (!dto.recurrenceRules || dto.recurrenceRules.length === 0)) {
            throw new common_1.BadRequestException('重複提醒必須至少提供一條 recurrenceRules');
        }
        if (dto.scheduleType === enums_1.ScheduleType.RECURRING && dto.recurrenceRules) {
            for (const rule of dto.recurrenceRules) {
                if (rule.ruleMode === enums_1.RuleMode.MONTHLY_DAY) {
                    if (!rule.monthDay) {
                        throw new common_1.BadRequestException('monthly_day 必須提供 monthDay');
                    }
                    if (rule.monthDay >= 29 && !dto.skipShortMonthConfirmation) {
                        throw new common_1.BadRequestException({
                            code: 'SHORT_MONTH_CONFIRMATION_REQUIRED',
                            message: '若遇到沒有該日期的月份，此月份將跳過提醒，是否確定繼續？',
                        });
                    }
                }
                if (rule.ruleMode === enums_1.RuleMode.WEEKLY_DAY &&
                    (rule.weekDay === undefined || rule.weekDay === null)) {
                    throw new common_1.BadRequestException('weekly_day 必須提供 weekDay');
                }
                if (rule.ruleMode === enums_1.RuleMode.DAILY_TIME && !rule.timeOfDay) {
                    throw new common_1.BadRequestException('daily_time 必須提供 timeOfDay');
                }
            }
        }
    }
};
exports.RemindersService = RemindersService;
exports.RemindersService = RemindersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RemindersService);
//# sourceMappingURL=reminders.service.js.map