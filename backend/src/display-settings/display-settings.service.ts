import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateDisplaySettingDto } from './dto/update-display-setting.dto';

@Injectable()
export class DisplaySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 每個使用者一份；第一次讀取時自動建立預設值（upsert 避免同時兩個請求重複建立）。 */
  getCurrent(userId: string) {
    return this.prisma.displaySetting.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: { mascotImages: true },
    });
  }

  async updateCurrent(userId: string, dto: UpdateDisplaySettingDto) {
    const current = await this.getCurrent(userId);
    return this.prisma.displaySetting.update({
      where: { id: current.id },
      data: {
        ...dto,
        targetScreenId:
          dto.targetScreenId !== undefined
            ? dto.targetScreenId || null
            : current.targetScreenId,
      },
      include: { mascotImages: true },
    });
  }
}
