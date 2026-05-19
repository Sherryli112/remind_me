import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.group.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async create(dto: CreateGroupDto) {
    const existing = await this.prisma.group.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('群組名稱已存在');
    return this.prisma.group.create({ data: { name: dto.name } });
  }

  async rename(id: string, dto: CreateGroupDto) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('群組不存在');
    const conflict = await this.prisma.group.findUnique({ where: { name: dto.name } });
    if (conflict && conflict.id !== id) throw new ConflictException('群組名稱已存在');
    return this.prisma.group.update({ where: { id }, data: { name: dto.name } });
  }

  async remove(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('群組不存在');
    await this.prisma.group.delete({ where: { id } });
    return { success: true };
  }
}
