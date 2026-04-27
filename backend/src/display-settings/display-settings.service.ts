import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateDisplaySettingDto } from './dto/update-display-setting.dto';

@Injectable()
export class DisplaySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent() {
    let setting = await this.prisma.displaySetting.findFirst({
      include: { mascotImages: true },
    });

    if (!setting) {
      setting = await this.prisma.displaySetting.create({
        data: {},
        include: { mascotImages: true },
      });
    }

    return setting;
  }

  async updateCurrent(dto: UpdateDisplaySettingDto) {
    const current = await this.getCurrent();
    return this.prisma.displaySetting.update({
      where: { id: current.id },
      data: {
        ...dto,
        targetScreenId:
          dto.targetScreenId !== undefined ? dto.targetScreenId || null : current.targetScreenId,
      },
      include: { mascotImages: true },
    });
  }
}
