-- DropIndex
DROP INDEX "Channel_name_trgm_idx";

-- DropIndex
DROP INDEX "Notification_userId_createdAt_idx";

-- DropIndex
DROP INDEX "Project_name_trgm_idx";

-- DropIndex
DROP INDEX "Task_title_trgm_idx";

-- DropIndex
DROP INDEX "User_name_trgm_idx";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "inApp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "surfacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Notification_userId_surfacedAt_idx" ON "Notification"("userId", "surfacedAt");
