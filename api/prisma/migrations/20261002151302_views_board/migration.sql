-- CreateEnum
CREATE TYPE "ViewLayout" AS ENUM ('LIST', 'BOARD', 'CALENDAR', 'TIMELINE');

-- CreateEnum
CREATE TYPE "ViewScope" AS ENUM ('PERSONAL', 'SHARED');

-- AlterTable
ALTER TABLE "ProjectStatus" ADD COLUMN     "wipLimit" INTEGER;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "View" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "ViewScope" NOT NULL DEFAULT 'PERSONAL',
    "layout" "ViewLayout" NOT NULL DEFAULT 'LIST',
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentTask" (
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentTask_pkey" PRIMARY KEY ("userId","taskId")
);

-- CreateIndex
CREATE INDEX "View_workspaceId_projectId_idx" ON "View"("workspaceId", "projectId");

-- CreateIndex
CREATE INDEX "View_ownerId_idx" ON "View"("ownerId");

-- CreateIndex
CREATE INDEX "RecentTask_userId_viewedAt_idx" ON "RecentTask"("userId", "viewedAt");

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentTask" ADD CONSTRAINT "RecentTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentTask" ADD CONSTRAINT "RecentTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
