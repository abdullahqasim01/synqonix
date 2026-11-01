import { IsBoolean, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class GithubInstallationDto {
  id: string;
  accountLogin: string;
  accountType: string;
  suspended: boolean;
  repositoryCount: number;
  createdAt: Date;
}

export class GithubStatusDto {
  /** False until the server has GitHub App credentials; the rest of the integration is inert. */
  configured: boolean;
  installations: GithubInstallationDto[];
}

export class GithubInstallUrlDto {
  url: string;
}

export class AvailableRepoDto {
  installationId: string;
  githubRepoId: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  /** Whether this project already has it. */
  linked: boolean;
}

export class LinkRepoDto {
  @IsString() installationId: string;
  @IsString() githubRepoId: string;
}

export class UpdateLinkedRepoDto {
  @IsOptional() @IsBoolean() autoTransition?: boolean;
  /** Status to move tasks to when a pull request opens; null restores the default. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() prOpenedStatusId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() prMergedStatusId?: string | null;
  @IsOptional() @IsBoolean() importIssues?: boolean;
  @IsOptional() @IsBoolean() syncIssues?: boolean;
}

export class LinkedRepoDto {
  id: string;
  projectId: string;
  installationId: string;
  githubRepoId: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  autoTransition: boolean;
  prOpenedStatusId: string | null;
  prMergedStatusId: string | null;
  /** The status actually used for "opened" (the configured one, or the default), or null if there is none. */
  effectiveOpenedStatusId: string | null;
  effectiveMergedStatusId: string | null;
  importIssues: boolean;
  syncIssues: boolean;
  createdAt: Date;
}

export class ContributorDto {
  login: string;
  userId: string | null;
}

export class SetContributorDto {
  @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64) userId: string | null;
}

export class GithubBranchDto {
  id: string;
  repo: string;
  name: string;
  url: string;
  deleted: boolean;
}

export class GithubCommitDto {
  sha: string;
  repo: string;
  /** First line of the message. */
  message: string;
  url: string;
  authorLogin: string | null;
  /** The workspace member this GitHub login is mapped to, if any. */
  authorName: string | null;
  committedAt: Date;
}

export class GithubPullRequestDto {
  id: string;
  repo: string;
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  draft: boolean;
  url: string;
  authorLogin: string;
  authorName: string | null;
  headBranch: string;
  baseBranch: string;
  reviewState: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | null;
  ci: 'PENDING' | 'SUCCESS' | 'FAILURE' | null;
  updatedAt: Date;
}

export class GithubIssueDto {
  id: string;
  repo: string;
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  url: string;
}

export class TaskRepoDto {
  id: string;
  fullName: string;
  defaultBranch: string;
}

export class TaskGithubDto {
  /** Repositories linked to the task's project, for creating branches. */
  repos: TaskRepoDto[];
  /** Name suggested for a new branch. */
  suggestedBranch: string;
  branches: GithubBranchDto[];
  commits: GithubCommitDto[];
  pullRequests: GithubPullRequestDto[];
  issues: GithubIssueDto[];
}

export class CreateBranchDto {
  @IsString() repoId: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  /** Branch to start from; defaults to the repository's default branch. */
  @IsOptional() @IsString() @MaxLength(200) from?: string;
}

export const PR_REVIEW_STATES = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'] as const;
