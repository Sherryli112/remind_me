-- CreateEnum
CREATE TYPE "MascotIcon" AS ENUM ('bell_ring', 'sparkles', 'calendar_clock');

-- AlterTable
ALTER TABLE "DisplaySetting" ADD COLUMN     "mascotIcon" "MascotIcon" NOT NULL DEFAULT 'bell_ring';
