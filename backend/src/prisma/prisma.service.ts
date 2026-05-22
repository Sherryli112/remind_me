import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
    await this.ensureSchema();
  }

  async enableShutdownHooks(app: INestApplication) {
    app.enableShutdownHooks();
  }

  private async ensureSchema() {
    await this.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Group" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await this.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Group_name_key" ON "Group"("name")`);

    await this.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Reminder" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "content" TEXT NOT NULL DEFAULT '',
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "scheduleType" TEXT NOT NULL DEFAULT 'one_time',
      "oneTimeAt" DATETIME,
      "autoCloseEnabled" BOOLEAN NOT NULL DEFAULT false,
      "autoCloseSeconds" INTEGER NOT NULL DEFAULT 60,
      "snoozeDefaultSeconds" INTEGER NOT NULL DEFAULT 300,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "endAt" DATETIME,
      "maxOccurrences" INTEGER,
      "group_id" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "Reminder_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`);
    await this.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Reminder_group_id_idx" ON "Reminder"("group_id")`);

    await this.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "RecurrenceRule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "ruleMode" TEXT NOT NULL,
      "monthDay" INTEGER,
      "weekDays" TEXT NOT NULL DEFAULT '[]',
      "timeOfDay" TEXT,
      "intervalMinutes" INTEGER,
      "activeFrom" TEXT,
      "activeUntil" TEXT,
      "reminderId" TEXT NOT NULL,
      CONSTRAINT "RecurrenceRule_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);

    await this.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DisplaySetting" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "size" TEXT NOT NULL DEFAULT 'medium',
      "theme" TEXT NOT NULL DEFAULT 'light',
      "corner" TEXT NOT NULL DEFAULT 'bottom_right',
      "showContent" BOOLEAN NOT NULL DEFAULT true,
      "targetScreenId" TEXT,
      "mascotMode" TEXT NOT NULL DEFAULT 'system',
      "mascotIcon" TEXT NOT NULL DEFAULT 'bell_ring'
    )`);

    await this.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MascotImage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "filePath" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "width" INTEGER NOT NULL,
      "height" INTEGER NOT NULL,
      "sizeBytes" INTEGER NOT NULL,
      "displaySettingId" TEXT NOT NULL,
      CONSTRAINT "MascotImage_displaySettingId_fkey" FOREIGN KEY ("displaySettingId") REFERENCES "DisplaySetting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
  }
}
