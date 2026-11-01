-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('PUBLIC', 'PRIVATE', 'DIRECT');

-- CreateEnum
CREATE TYPE "ChannelRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "TaskLinkSource" AS ENUM ('MENTION', 'LINKED', 'CREATED');

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "ChannelType" NOT NULL,
    "name" TEXT,
    "slug" TEXT,
    "topic" TEXT,
    "dmKey" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMember" (
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChannelRole" NOT NULL DEFAULT 'MEMBER',
    "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMember_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplyAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageMention" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "MessageMention_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateTable
CREATE TABLE "Reaction" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("messageId","userId","emoji")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "uploaderId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTaskLink" (
    "messageId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "source" "TaskLinkSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTaskLink_pkey" PRIMARY KEY ("messageId","taskId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_projectId_key" ON "Channel"("projectId");

-- CreateIndex
CREATE INDEX "Channel_workspaceId_type_idx" ON "Channel"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_workspaceId_slug_key" ON "Channel"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_workspaceId_dmKey_key" ON "Channel"("workspaceId", "dmKey");

-- CreateIndex
CREATE INDEX "ChannelMember_userId_idx" ON "ChannelMember"("userId");

-- CreateIndex
CREATE INDEX "Message_channelId_parentId_seq_idx" ON "Message"("channelId", "parentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Message_channelId_seq_key" ON "Message"("channelId", "seq");

-- CreateIndex
CREATE INDEX "MessageMention_userId_idx" ON "MessageMention"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttachment_storageKey_key" ON "MessageAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "MessageTaskLink_taskId_idx" ON "MessageTaskLink"("taskId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTaskLink" ADD CONSTRAINT "MessageTaskLink_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTaskLink" ADD CONSTRAINT "MessageTaskLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing project gets its channel, and project members follow it.
INSERT INTO "Channel" ("id", "workspaceId", "projectId", "type", "name", "slug", "createdAt")
SELECT gen_random_uuid()::text, p."workspaceId", p."id",
       CASE WHEN p."visibility" = 'PRIVATE' THEN 'PRIVATE'::"ChannelType" ELSE 'PUBLIC'::"ChannelType" END,
       lower(p."key"), lower(p."key"), now()
FROM "Project" p;

INSERT INTO "ChannelMember" ("channelId", "userId", "role", "joinedAt")
SELECT c."id", pm."userId", CASE WHEN pm."role" = 'ADMIN' THEN 'ADMIN'::"ChannelRole" ELSE 'MEMBER'::"ChannelRole" END, now()
FROM "ProjectMember" pm JOIN "Channel" c ON c."projectId" = pm."projectId";
