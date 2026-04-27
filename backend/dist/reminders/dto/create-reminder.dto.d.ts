import { RuleMode, ScheduleType } from '../../common/enums';
export declare class RecurrenceRuleInputDto {
    ruleMode: RuleMode;
    monthDay?: number;
    weekDay?: number;
    timeOfDay?: string;
}
export declare class CreateReminderDto {
    title: string;
    content?: string;
    scheduleType: ScheduleType;
    oneTimeAt?: string;
    enabled?: boolean;
    autoCloseEnabled?: boolean;
    autoCloseSeconds?: number;
    snoozeDefaultSeconds?: number;
    endAt?: string;
    maxOccurrences?: number;
    recurrenceRules?: RecurrenceRuleInputDto[];
    skipShortMonthConfirmation?: boolean;
}
