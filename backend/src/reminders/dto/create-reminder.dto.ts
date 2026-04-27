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

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthDay?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekDay?: number;

  @ApiPropertyOptional({ description: '格式 HH:mm', example: '15:30' })
  @IsOptional()
  @IsString()
  @Length(5, 5)
  timeOfDay?: string;
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
