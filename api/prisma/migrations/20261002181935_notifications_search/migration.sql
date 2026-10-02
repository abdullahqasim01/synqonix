-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSIGNED', 'MENTIONED', 'COMMENTED', 'STATUS_CHANGED', 'DUE_SOON', 'OVERDUE', 'SPRINT_STARTED', 'SPRINT_COMPLETED', 'PR_OPENED', 'PR_MERGED', 'CI_FAILED', 'CHAT_MENTION');

-- CreateEnum
CREATE TYPE "EmailMode" AS ENUM ('INSTANT', 'DIGEST', 'OFF');

-- CreateEnum
CREATE TYPE "EmailState" AS ENUM ('NONE', 'PENDING', 'SENT');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "NotificationType" NOT NULL,
    "actorId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "taskId" TEXT,
    "taskKey" TEXT,
    "channelId" TEXT,
    "messageId" TEXT,
    "url" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "emailState" "EmailState" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "emailMode" "EmailMode" NOT NULL DEFAULT 'INSTANT',
    "quietEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietStart" INTEGER NOT NULL DEFAULT 1320,
    "quietEnd" INTEGER NOT NULL DEFAULT 480,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "types" JSONB NOT NULL DEFAULT '{}',
    "lastDigestAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "NotificationMute" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "NotificationMute_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_emailState_userId_idx" ON "Notification"("emailState", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMute" ADD CONSTRAINT "NotificationMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMute" ADD CONSTRAINT "NotificationMute_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- search
-- Fuzzy matching on short names and titles, and full-text search on longer text.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Task_title_trgm_idx" ON "Task" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Project_name_trgm_idx" ON "Project" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Channel_name_trgm_idx" ON "Channel" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "Task_fts_idx" ON "Task" USING GIN (to_tsvector('english', "title" || ' ' || coalesce("description", '')));
CREATE INDEX "Comment_fts_idx" ON "Comment" USING GIN (to_tsvector('english', "body"));
CREATE INDEX "Message_fts_idx" ON "Message" USING GIN (to_tsvector('english', "body"));
