import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @Length(1, 60)
  name: string;
}
