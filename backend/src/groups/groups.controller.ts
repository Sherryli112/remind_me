import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateGroupDto } from './dto/create-group.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @ApiOperation({ summary: '取得所有群組（按建立時間排序）' })
  findAll() {
    return this.groupsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: '建立群組' })
  create(@Body() dto: CreateGroupDto) {
    return this.groupsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '重命名群組' })
  rename(@Param('id') id: string, @Body() dto: CreateGroupDto) {
    return this.groupsService.rename(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '刪除群組（Reminder 自動歸入未分組）' })
  remove(@Param('id') id: string) {
    return this.groupsService.remove(id);
  }
}
