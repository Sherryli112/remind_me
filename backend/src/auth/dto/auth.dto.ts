import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsByteLength,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { IsIanaTimeZone } from '../../common/timezone';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 72,
    description: '8–72 字元，且 UTF-8 不超過 72 bytes',
  })
  @IsString()
  @Length(8, 72)
  @IsByteLength(0, 72, { message: 'password 以 UTF-8 計算不可超過 72 bytes' })
  password: string;

  @ApiPropertyOptional({
    example: 'Asia/Taipei',
    description: 'IANA 時區名稱，預設 Asia/Taipei',
  })
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmail)
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken: string;
}

export class UpdateMeDto {
  @ApiProperty({ example: 'Asia/Taipei' })
  @IsIanaTimeZone()
  timezone: string;
}
