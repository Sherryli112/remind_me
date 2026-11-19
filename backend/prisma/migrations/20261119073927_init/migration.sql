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

-- CreateEnum
CREATE TYPE "MascotIcon" AS ENUM ('bell_ring', 'sparkles', 'calendar_clock');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Taipei',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
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
    "fireCount" INTEGER NOT NULL DEFAULT 0,
    "group_id" TEXT,
    "userId" TEXT NOT NULL,
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
    "timeOfDay" TEXT,
    "intervalMinutes" INTEGER,
    "activeFrom" TEXT,
    "activeUntil" TEXT,
    "reminderId" TEXT NOT NULL,

    CONSTRAINT "RecurrenceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisplaySetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "size" "PopupSize" NOT NULL DEFAULT 'medium',
    "theme" "PopupTheme" NOT NULL DEFAULT 'light',
    "corner" "PopupCorner" NOT NULL DEFAULT 'bottom_right',
    "showContent" BOOLEAN NOT NULL DEFAULT true,
    "targetScreenId" TEXT,
    "mascotMode" "MascotMode" NOT NULL DEFAULT 'system',
    "mascotIcon" "MascotIcon" NOT NULL DEFAULT 'bell_ring',

    CONSTRAINT "DisplaySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MascotImage" (
    "id" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "displaySettingId" TEXT NOT NULL,

    CONSTRAINT "MascotImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_userId_name_key" ON "Group"("userId", "name");

-- CreateIndex
CREATE INDEX "Reminder_group_id_idx" ON "Reminder"("group_id");

-- CreateIndex
CREATE INDEX "Reminder_userId_idx" ON "Reminder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DisplaySetting_userId_key" ON "DisplaySetting"("userId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurrenceRule" ADD CONSTRAINT "RecurrenceRule_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisplaySetting" ADD CONSTRAINT "DisplaySetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MascotImage" ADD CONSTRAINT "MascotImage_displaySettingId_fkey" FOREIGN KEY ("displaySettingId") REFERENCES "DisplaySetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
