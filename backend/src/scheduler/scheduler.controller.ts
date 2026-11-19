import { BadRequestException, Controller, Get, Headers } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SchedulerService } from './scheduler.service';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

@ApiTags('scheduler')
@ApiBearerAuth()
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get('due')
  @ApiOperation({
    summary:
      '取得並清空「目前使用者、目前裝置」的待觸發提醒佇列（供 Tauri 輪詢）',
  })
  @ApiHeader({
    name: 'X-Device-Id',
    required: true,
    description: 'client 產生的裝置 UUID',
  })
  getDue(
    @CurrentUser() user: AuthUser,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const id = deviceId?.trim();
    if (!id || !DEVICE_ID_PATTERN.test(id)) {
      throw new BadRequestException({
        code: 'DEVICE_ID_REQUIRED',
        message: '缺少或不合法的 X-Device-Id header',
      });
    }
    return this.schedulerService.consumeDue(user.id, id);
  }
}
