import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SnoozeReminderDto {
  @ApiProperty({ description: '延後秒數', minimum: 1 })
  @IsInt()
  @Min(1)
  seconds: number;
}
