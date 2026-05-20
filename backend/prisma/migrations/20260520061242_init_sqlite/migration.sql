-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Reminder" (
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
);

-- CreateTable
CREATE TABLE "RecurrenceRule" (
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
);

-- CreateTable
CREATE TABLE "DisplaySetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "size" TEXT NOT NULL DEFAULT 'medium',
    "theme" TEXT NOT NULL DEFAULT 'light',
    "corner" TEXT NOT NULL DEFAULT 'bottom_right',
    "showContent" BOOLEAN NOT NULL DEFAULT true,
    "targetScreenId" TEXT,
    "mascotMode" TEXT NOT NULL DEFAULT 'system',
    "mascotIcon" TEXT NOT NULL DEFAULT 'bell_ring'
);

-- CreateTable
CREATE TABLE "MascotImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "displaySettingId" TEXT NOT NULL,
    CONSTRAINT "MascotImage_displaySettingId_fkey" FOREIGN KEY ("displaySettingId") REFERENCES "DisplaySetting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

-- CreateIndex
CREATE INDEX "Reminder_group_id_idx" ON "Reminder"("group_id");
