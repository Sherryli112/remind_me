import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ReminderOrderItemDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  sortOrder: number;
}

export class ReorderRemindersDto {
  @ApiProperty({ type: [ReminderOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderOrderItemDto)
  items: ReminderOrderItemDto[];
}
