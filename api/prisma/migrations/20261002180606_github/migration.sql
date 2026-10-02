-- CreateEnum
CREATE TYPE "GithubPrState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "GithubIssueState" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "GithubInstallation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "githubId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "installedById" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedRepository" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "githubRepoId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "linkedById" TEXT,
    "autoTransition" BOOLEAN NOT NULL DEFAULT true,
    "prOpenedStatusId" TEXT,
    "prMergedStatusId" TEXT,
    "importIssues" BOOLEAN NOT NULL DEFAULT false,
    "syncIssues" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubBranch" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headSha" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubCommit" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authorLogin" TEXT,
    "authorName" TEXT,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubCommit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubPullRequest" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "state" "GithubPrState" NOT NULL,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "authorLogin" TEXT NOT NULL,
    "headBranch" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "reviewState" TEXT,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubPullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubIssue" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" "GithubIssueState" NOT NULL,
    "url" TEXT NOT NULL,
    "authorLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubCheck" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "conclusion" TEXT,
    "url" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskGithubLink" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "branchId" TEXT,
    "commitId" TEXT,
    "pullRequestId" TEXT,
    "issueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskGithubLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubContributor" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubContributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GithubInstallation_githubId_key" ON "GithubInstallation"("githubId");

-- CreateIndex
CREATE INDEX "GithubInstallation_workspaceId_idx" ON "GithubInstallation"("workspaceId");

-- CreateIndex
CREATE INDEX "LinkedRepository_githubRepoId_idx" ON "LinkedRepository"("githubRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedRepository_projectId_githubRepoId_key" ON "LinkedRepository"("projectId", "githubRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "GithubBranch_repoId_name_key" ON "GithubBranch"("repoId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GithubCommit_repoId_sha_key" ON "GithubCommit"("repoId", "sha");

-- CreateIndex
CREATE UNIQUE INDEX "GithubPullRequest_repoId_number_key" ON "GithubPullRequest"("repoId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GithubIssue_repoId_number_key" ON "GithubIssue"("repoId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GithubCheck_repoId_headSha_name_key" ON "GithubCheck"("repoId", "headSha", "name");

-- CreateIndex
CREATE INDEX "TaskGithubLink_taskId_idx" ON "TaskGithubLink"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskGithubLink_taskId_branchId_key" ON "TaskGithubLink"("taskId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskGithubLink_taskId_commitId_key" ON "TaskGithubLink"("taskId", "commitId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskGithubLink_taskId_pullRequestId_key" ON "TaskGithubLink"("taskId", "pullRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskGithubLink_taskId_issueId_key" ON "TaskGithubLink"("taskId", "issueId");

-- CreateIndex
CREATE UNIQUE INDEX "GithubContributor_workspaceId_login_key" ON "GithubContributor"("workspaceId", "login");

-- AddForeignKey
ALTER TABLE "GithubInstallation" ADD CONSTRAINT "GithubInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedRepository" ADD CONSTRAINT "LinkedRepository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GithubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedRepository" ADD CONSTRAINT "LinkedRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubBranch" ADD CONSTRAINT "GithubBranch_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "LinkedRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubCommit" ADD CONSTRAINT "GithubCommit_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "LinkedRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubPullRequest" ADD CONSTRAINT "GithubPullRequest_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "LinkedRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubIssue" ADD CONSTRAINT "GithubIssue_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "LinkedRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubCheck" ADD CONSTRAINT "GithubCheck_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "LinkedRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskGithubLink" ADD CONSTRAINT "TaskGithubLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskGithubLink" ADD CONSTRAINT "TaskGithubLink_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "GithubBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskGithubLink" ADD CONSTRAINT "TaskGithubLink_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "GithubCommit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskGithubLink" ADD CONSTRAINT "TaskGithubLink_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "GithubPullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskGithubLink" ADD CONSTRAINT "TaskGithubLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "GithubIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubContributor" ADD CONSTRAINT "GithubContributor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
