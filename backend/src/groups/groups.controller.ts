import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateGroupDto } from './dto/create-group.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @ApiOperation({ summary: '取得所有群組（按建立時間排序）' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.groupsService.findAll(user.id);
  }

  @Post()
  @ApiOperation({ summary: '建立群組' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '重命名群組' })
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateGroupDto,
  ) {
    return this.groupsService.rename(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '刪除群組（Reminder 自動歸入未分組）' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groupsService.remove(user.id, id);
  }
}
