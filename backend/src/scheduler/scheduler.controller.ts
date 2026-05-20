import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SchedulerService } from './scheduler.service';

@ApiTags('scheduler')
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get('due')
  @ApiOperation({ summary: '取得並清空待觸發提醒佇列（供 Tauri 輪詢）' })
  getDue() {
    return this.schedulerService.consumeDue();
  }
}
