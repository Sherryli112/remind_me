import { Module } from '@nestjs/common';
import { DisplaySettingsController } from './display-settings.controller';
import { DisplaySettingsService } from './display-settings.service';

@Module({
  controllers: [DisplaySettingsController],
  providers: [DisplaySettingsService],
  exports: [DisplaySettingsService],
})
export class DisplaySettingsModule {}
