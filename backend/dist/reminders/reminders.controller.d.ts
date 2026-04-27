import { CreateReminderDto } from './dto/create-reminder.dto';
import { ReorderRemindersDto } from './dto/reorder-reminders.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { RemindersService } from './reminders.service';
export declare class RemindersController {
    private readonly remindersService;
    constructor(remindersService: RemindersService);
    findAll(): import("@prisma/client").Prisma.PrismaPromise<({
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
    enable(id: string): Promise<{
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
    disable(id: string): Promise<{
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
}
