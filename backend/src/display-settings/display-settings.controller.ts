import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { UpdateDisplaySettingDto } from './dto/update-display-setting.dto';
import { DisplaySettingsService } from './display-settings.service';

@ApiTags('display-settings')
@ApiBearerAuth()
@Controller('display-settings')
export class DisplaySettingsController {
  constructor(
    private readonly displaySettingsService: DisplaySettingsService,
  ) {}

  @Get('current')
  @ApiOperation({ summary: '取得目前登入者的顯示設定' })
  @ApiOkResponse({ description: '顯示設定' })
  getCurrent(@CurrentUser() user: AuthUser) {
    return this.displaySettingsService.getCurrent(user.id);
  }

  @Patch('current')
  @ApiOperation({ summary: '更新目前登入者的顯示設定' })
  updateCurrent(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateDisplaySettingDto,
  ) {
    return this.displaySettingsService.updateCurrent(user.id, dto);
  }
}
