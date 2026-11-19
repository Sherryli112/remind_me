import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { DisplaySettingsModule } from './display-settings/display-settings.module';
import { GroupsModule } from './groups/groups.module';
import { PrismaModule } from './prisma/prisma.module';
import { RemindersModule } from './reminders/reminders.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    // backend/.env 優先於 repo 根目錄的 .env；已存在的 process.env 永遠優先（Docker 部署用）
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    RemindersModule,
    DisplaySettingsModule,
    GroupsModule,
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
