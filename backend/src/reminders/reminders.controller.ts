import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { ReorderRemindersDto } from './dto/reorder-reminders.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { RemindersService } from './reminders.service';

@ApiTags('reminders')
@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  @ApiOperation({ summary: '取得提醒清單（MVP 基礎）' })
  @ApiOkResponse({ description: '提醒清單' })
  findAll() {
    return this.remindersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '取得單一提醒' })
  findOne(@Param('id') id: string) {
    return this.remindersService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '建立提醒' })
  create(@Body() dto: CreateReminderDto) {
    return this.remindersService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新提醒' })
  update(@Param('id') id: string, @Body() dto: UpdateReminderDto) {
    return this.remindersService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '刪除提醒' })
  remove(@Param('id') id: string) {
    return this.remindersService.remove(id);
  }

  @Patch(':id/enable')
  @ApiOperation({ summary: '啟用提醒' })
  enable(@Param('id') id: string) {
    return this.remindersService.setEnabled(id, true);
  }

  @Patch(':id/disable')
  @ApiOperation({ summary: '停用提醒' })
  disable(@Param('id') id: string) {
    return this.remindersService.setEnabled(id, false);
  }

  @Post('reorder')
  @ApiOperation({ summary: '批次調整提醒排序' })
  @ApiBody({ type: ReorderRemindersDto })
  reorder(@Body() dto: ReorderRemindersDto) {
    return this.remindersService.reorder(dto);
  }
}
