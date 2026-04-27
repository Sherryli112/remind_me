import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateDisplaySettingDto } from './dto/update-display-setting.dto';
import { DisplaySettingsService } from './display-settings.service';

@ApiTags('display-settings')
@Controller('display-settings')
export class DisplaySettingsController {
  constructor(private readonly displaySettingsService: DisplaySettingsService) {}

  @Get('current')
  @ApiOperation({ summary: '取得目前顯示設定（MVP 基礎）' })
  @ApiOkResponse({ description: '顯示設定' })
  getCurrent() {
    return this.displaySettingsService.getCurrent();
  }

  @Patch('current')
  @ApiOperation({ summary: '更新目前顯示設定' })
  updateCurrent(@Body() dto: UpdateDisplaySettingDto) {
    return this.displaySettingsService.updateCurrent(dto);
  }
}
