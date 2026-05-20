import { Module } from '@nestjs/common';
import { DisplaySettingsModule } from '../display-settings/display-settings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [PrismaModule, DisplaySettingsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
