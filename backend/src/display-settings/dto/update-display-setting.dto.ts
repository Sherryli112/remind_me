import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MascotMode, PopupCorner, PopupSize, PopupTheme } from '../../common/enums';

export class UpdateDisplaySettingDto {
  @ApiPropertyOptional({ enum: PopupSize })
  @IsOptional()
  @IsEnum(PopupSize)
  size?: PopupSize;

  @ApiPropertyOptional({ enum: PopupTheme })
  @IsOptional()
  @IsEnum(PopupTheme)
  theme?: PopupTheme;

  @ApiPropertyOptional({ enum: PopupCorner })
  @IsOptional()
  @IsEnum(PopupCorner)
  corner?: PopupCorner;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showContent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetScreenId?: string;

  @ApiPropertyOptional({ enum: MascotMode })
  @IsOptional()
  @IsEnum(MascotMode)
  mascotMode?: MascotMode;
}
