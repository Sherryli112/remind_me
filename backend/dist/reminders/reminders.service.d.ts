import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { ReorderRemindersDto } from './dto/reorder-reminders.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
export declare class RemindersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(): Prisma.PrismaPromise<({
        recurrenceRules: {
            id: string;
            ruleMode: import("@prisma/client").$Enums.RuleMode;
            monthDay: number | null;
            weekDay: number | null;
            timeOfDay: string | null;
            reminderId: string;
        }[];
    } & {
        title: string;
        id: string;
        content: string;
        scheduleType: import("@prisma/client").$Enums.ScheduleType;
        oneTimeAt: Date | null;
        enabled: boolean;
        autoCloseEnabled: boolean;
        autoCloseSeconds: number;
        snoozeDefaultSeconds: number;
        endAt: Date | null;
        maxOccurrences: number | null;
        sortOrder: number;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    findOne(id: string): Promise<{
        recurrenceRules: {
            id: string;
            ruleMode: import("@prisma/client").$Enums.RuleMode;
            monthDay: number | null;
            weekDay: number | null;
            timeOfDay: string | null;
            reminderId: string;
        }[];
    } & {
        title: string;
        id: string;
        content: string;
        scheduleType: import("@prisma/client").$Enums.ScheduleType;
        oneTimeAt: Date | null;
        enabled: boolean;
        autoCloseEnabled: boolean;
        autoCloseSeconds: number;
        snoozeDefaultSeconds: number;
        endAt: Date | null;
        maxOccurrences: number | null;
        sortOrder: number;
        createdAt: Date;
        updatedAt: Date;
    }>;
    create(dto: CreateReminderDto): Promise<{
        recurrenceRules: {
            id: string;
            ruleMode: import("@prisma/client").$Enums.RuleMode;
            monthDay: number | null;
            weekDay: number | null;
            timeOfDay: string | null;
            reminderId: string;
        }[];
    } & {
        title: string;
        id: string;
        content: string;
        scheduleType: import("@prisma/client").$Enums.ScheduleType;
        oneTimeAt: Date | null;
        enabled: boolean;
        autoCloseEnabled: boolean;
        autoCloseSeconds: number;
        snoozeDefaultSeconds: number;
        endAt: Date | null;
        maxOccurrences: number | null;
        sortOrder: number;
        createdAt: Date;
        updatedAt: Date;
    }>;
    update(id: string, dto: UpdateReminderDto): Promise<{
        recurrenceRules: {
            id: string;
            ruleMode: import("@prisma/client").$Enums.RuleMode;
            monthDay: number | null;
            weekDay: number | null;
            timeOfDay: string | null;
            reminderId: string;
        }[];
    } & {
        title: string;
        id: string;
        content: string;
        scheduleType: import("@prisma/client").$Enums.ScheduleType;
        oneTimeAt: Date | null;
        enabled: boolean;
        autoCloseEnabled: boolean;
        autoCloseSeconds: number;
        snoozeDefaultSeconds: number;
        endAt: Date | null;
        maxOccurrences: number | null;
        sortOrder: number;
        createdAt: Date;
        updatedAt: Date;
    }>;
    remove(id: string): Promise<{
        success: boolean;
    }>;
    setEnabled(id: string, enabled: boolean): Promise<{
        recurrenceRules: {
            id: string;
            ruleMode: import("@prisma/client").$Enums.RuleMode;
            monthDay: number | null;
            weekDay: number | null;
            timeOfDay: string | null;
            reminderId: string;
        }[];
    } & {
        title: string;
        id: string;
        content: string;
        scheduleType: import("@prisma/client").$Enums.ScheduleType;
        oneTimeAt: Date | null;
        enabled: boolean;
        autoCloseEnabled: boolean;
        autoCloseSeconds: number;
        snoozeDefaultSeconds: number;
        endAt: Date | null;
        maxOccurrences: number | null;
        sortOrder: number;
        createdAt: Date;
        updatedAt: Date;
    }>;
    reorder(dto: ReorderRemindersDto): Promise<({
        recurrenceRules: {
            id: string;
            ruleMode: import("@prisma/client").$Enums.RuleMode;
            monthDay: number | null;
            weekDay: number | null;
            timeOfDay: string | null;
            reminderId: string;
        }[];
    } & {
        title: string;
        id: string;
        content: string;
        scheduleType: import("@prisma/client").$Enums.ScheduleType;
        oneTimeAt: Date | null;
        enabled: boolean;
        autoCloseEnabled: boolean;
        autoCloseSeconds: number;
        snoozeDefaultSeconds: number;
        endAt: Date | null;
        maxOccurrences: number | null;
        sortOrder: number;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    private validateReminderInput;
}
