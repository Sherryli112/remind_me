import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(userId: string) {
    return this.prisma.group.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(userId: string, dto: CreateGroupDto) {
    const existing = await this.prisma.group.findUnique({
      where: { userId_name: { userId, name: dto.name } },
    });
    if (existing) throw new ConflictException('群組名稱已存在');
    try {
      return await this.prisma.group.create({
        data: { name: dto.name, userId },
      });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('群組名稱已存在');
      throw e;
    }
  }

  async rename(userId: string, id: string, dto: CreateGroupDto) {
    await this.findOwned(userId, id);
    const conflict = await this.prisma.group.findUnique({
      where: { userId_name: { userId, name: dto.name } },
    });
    if (conflict && conflict.id !== id)
      throw new ConflictException('群組名稱已存在');
    try {
      return await this.prisma.group.update({
        where: { id },
        data: { name: dto.name },
      });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('群組名稱已存在');
      throw e;
    }
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.prisma.group.delete({ where: { id } });
    return { success: true };
  }

  private async findOwned(userId: string, id: string) {
    const group = await this.prisma.group.findFirst({ where: { id, userId } });
    if (!group) throw new NotFoundException('群組不存在');
    return group;
  }
}
