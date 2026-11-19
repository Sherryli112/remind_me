import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { ReorderRemindersDto } from './dto/reorder-reminders.dto';
import { SnoozeReminderDto } from './dto/snooze-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { RemindersService } from './reminders.service';

@ApiTags('reminders')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  @ApiOperation({ summary: '取得提醒清單（MVP 基礎）' })
  @ApiOkResponse({ description: '提醒清單' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.remindersService.findAll(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '取得單一提醒' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.remindersService.findOne(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: '建立提醒' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReminderDto) {
    return this.remindersService.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新提醒' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ) {
    return this.remindersService.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '刪除提醒' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.remindersService.remove(user.id, id);
  }

  @Patch(':id/enable')
  @ApiOperation({ summary: '啟用提醒' })
  enable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.remindersService.setEnabled(user.id, id, true);
  }

  @Patch(':id/disable')
  @ApiOperation({ summary: '停用提醒' })
  disable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.remindersService.setEnabled(user.id, id, false);
  }

  @Post('reorder')
  @ApiOperation({ summary: '批次調整提醒排序' })
  @ApiBody({ type: ReorderRemindersDto })
  reorder(@CurrentUser() user: AuthUser, @Body() dto: ReorderRemindersDto) {
    return this.remindersService.reorder(user.id, dto);
  }

  @Patch(':id/snooze')
  @ApiOperation({ summary: '延後提醒（Popup 用）' })
  snooze(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SnoozeReminderDto,
  ) {
    return this.remindersService.snooze(user.id, id, dto.seconds);
  }
}
