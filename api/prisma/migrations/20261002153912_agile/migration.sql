-- CreateEnum
CREATE TYPE "Methodology" AS ENUM ('SCRUM', 'KANBAN');

-- CreateEnum
CREATE TYPE "EstimationUnit" AS ENUM ('POINTS', 'TSHIRT', 'HOURS');

-- CreateEnum
CREATE TYPE "SprintState" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SprintTaskOutcome" AS ENUM ('COMPLETED', 'CARRIED_OVER', 'REMOVED');

-- CreateEnum
CREATE TYPE "SnapshotReason" AS ENUM ('START', 'DAILY', 'SCOPE_CHANGE', 'COMPLETE');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('UNRELEASED', 'RELEASED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "definitionOfDone" TEXT,
ADD COLUMN     "estimationUnit" "EstimationUnit" NOT NULL DEFAULT 'POINTS',
ADD COLUMN     "methodology" "Methodology" NOT NULL DEFAULT 'KANBAN',
ADD COLUMN     "nextSprintNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sprintDurationDays" INTEGER NOT NULL DEFAULT 14;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "acceptanceCriteria" TEXT,
ADD COLUMN     "milestoneId" TEXT,
ADD COLUMN     "releaseId" TEXT,
ADD COLUMN     "sprintId" TEXT;

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "state" "SprintState" NOT NULL DEFAULT 'PLANNED',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "capacity" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SprintTask" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "estimateAtAdd" DOUBLE PRECISION,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedAfterStart" BOOLEAN NOT NULL DEFAULT false,
    "removedAt" TIMESTAMP(3),
    "outcome" "SprintTaskOutcome",

    CONSTRAINT "SprintTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SprintSnapshot" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" "SnapshotReason" NOT NULL,
    "scopePoints" DOUBLE PRECISION NOT NULL,
    "donePoints" DOUBLE PRECISION NOT NULL,
    "scopeTasks" INTEGER NOT NULL,
    "doneTasks" INTEGER NOT NULL,

    CONSTRAINT "SprintSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'UNRELEASED',
    "startDate" TIMESTAMP(3),
    "releaseDate" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sprint_projectId_state_idx" ON "Sprint"("projectId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Sprint_projectId_number_key" ON "Sprint"("projectId", "number");

-- CreateIndex
CREATE INDEX "SprintTask_sprintId_idx" ON "SprintTask"("sprintId");

-- CreateIndex
CREATE INDEX "SprintTask_taskId_idx" ON "SprintTask"("taskId");

-- CreateIndex
CREATE INDEX "SprintSnapshot_sprintId_at_idx" ON "SprintSnapshot"("sprintId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Release_projectId_name_key" ON "Release"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_projectId_name_key" ON "Milestone"("projectId", "name");

-- CreateIndex
CREATE INDEX "Task_sprintId_idx" ON "Task"("sprintId");

-- CreateIndex
CREATE INDEX "Task_releaseId_idx" ON "Task"("releaseId");

-- CreateIndex
CREATE INDEX "Task_milestoneId_idx" ON "Task"("milestoneId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintTask" ADD CONSTRAINT "SprintTask_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintTask" ADD CONSTRAINT "SprintTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintSnapshot" ADD CONSTRAINT "SprintSnapshot_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing Scrum-template projects keep working as Scrum projects.
UPDATE "Project" SET "methodology" = 'SCRUM' WHERE "template" = 'SCRUM';
