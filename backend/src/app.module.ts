import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DisplaySettingsModule } from './display-settings/display-settings.module';
import { PrismaModule } from './prisma/prisma.module';
import { RemindersModule } from './reminders/reminders.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 本地 nest 從 backend/ 啟動時讀 root 的 .env；docker 內透過 compose 注入 env，
      // 找不到 .env 也不會出錯（ignore missing）
      envFilePath: ['../.env', '.env'],
    }),
    PrismaModule,
    RemindersModule,
    DisplaySettingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
