-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('one_time', 'recurring');

-- CreateEnum
CREATE TYPE "RuleMode" AS ENUM ('interval', 'daily_time', 'weekly_day', 'monthly_day');

-- CreateEnum
CREATE TYPE "PopupSize" AS ENUM ('small', 'medium', 'large');

-- CreateEnum
CREATE TYPE "PopupTheme" AS ENUM ('light', 'dark');

-- CreateEnum
CREATE TYPE "PopupCorner" AS ENUM ('top_left', 'top_right', 'bottom_left', 'bottom_right');

-- CreateEnum
CREATE TYPE "MascotMode" AS ENUM ('system', 'custom');

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduleType" "ScheduleType" NOT NULL DEFAULT 'one_time',
    "oneTimeAt" TIMESTAMP(3),
    "autoCloseEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoCloseSeconds" INTEGER NOT NULL DEFAULT 60,
    "snoozeDefaultSeconds" INTEGER NOT NULL DEFAULT 300,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "endAt" TIMESTAMP(3),
    "maxOccurrences" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurrenceRule" (
    "id" TEXT NOT NULL,
    "ruleMode" "RuleMode" NOT NULL,
    "monthDay" INTEGER,
    "weekDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "timeOfDay" VARCHAR(5),
    "intervalMinutes" INTEGER,
    "activeFrom" VARCHAR(5),
    "activeUntil" VARCHAR(5),
    "reminderId" TEXT NOT NULL,

    CONSTRAINT "RecurrenceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisplaySetting" (
    "id" TEXT NOT NULL,
    "size" "PopupSize" NOT NULL DEFAULT 'medium',
    "theme" "PopupTheme" NOT NULL DEFAULT 'light',
    "corner" "PopupCorner" NOT NULL DEFAULT 'bottom_right',
    "showContent" BOOLEAN NOT NULL DEFAULT true,
    "targetScreenId" VARCHAR(100),
    "mascotMode" "MascotMode" NOT NULL DEFAULT 'system',

    CONSTRAINT "DisplaySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MascotImage" (
    "id" TEXT NOT NULL,
    "filePath" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "displaySettingId" TEXT NOT NULL,

    CONSTRAINT "MascotImage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RecurrenceRule" ADD CONSTRAINT "RecurrenceRule_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MascotImage" ADD CONSTRAINT "MascotImage_displaySettingId_fkey" FOREIGN KEY ("displaySettingId") REFERENCES "DisplaySetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
