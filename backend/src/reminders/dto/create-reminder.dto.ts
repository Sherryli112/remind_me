import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RuleMode, ScheduleType } from '../../common/enums';

export class RecurrenceRuleInputDto {
  @ApiProperty({ enum: RuleMode })
  @IsEnum(RuleMode)
  ruleMode: RuleMode;

  @ApiPropertyOptional({ minimum: 1, maximum: 31, description: 'monthly_day 必填' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthDay?: number;

  @ApiPropertyOptional({
    type: [Number],
    description: 'weekly_day 必填 1+；interval 可選的星期過濾',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @ArrayMaxSize(7)
  weekDays?: number[];

  @ApiPropertyOptional({ description: '格式 HH:mm；daily/weekly/monthly 必填', example: '15:30' })
  @IsOptional()
  @IsString()
  @Length(5, 5)
  timeOfDay?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1440, description: 'interval 必填，每 N 分鐘' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  intervalMinutes?: number;

  @ApiPropertyOptional({ description: 'interval 可選時段起 HH:mm', example: '09:00' })
  @IsOptional()
  @IsString()
  @Length(5, 5)
  activeFrom?: string;

  @ApiPropertyOptional({ description: 'interval 可選時段迄 HH:mm', example: '18:00' })
  @IsOptional()
  @IsString()
  @Length(5, 5)
  activeUntil?: string;
}

export class CreateReminderDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ enum: ScheduleType })
  @IsEnum(ScheduleType)
  scheduleType: ScheduleType;

  @ApiPropertyOptional({ description: 'scheduleType 為 one_time 時必填' })
  @IsOptional()
  @IsDateString()
  oneTimeAt?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  autoCloseEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 600, default: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  autoCloseSeconds?: number;

  @ApiPropertyOptional({ minimum: 60, maximum: 600, default: 300 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(600)
  snoozeDefaultSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxOccurrences?: number;

  @ApiPropertyOptional({ type: [RecurrenceRuleInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => RecurrenceRuleInputDto)
  recurrenceRules?: RecurrenceRuleInputDto[];

  @ApiPropertyOptional({
    description: '每月 29~31 號需帶 true 才可儲存',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  skipShortMonthConfirmation?: boolean;
}
