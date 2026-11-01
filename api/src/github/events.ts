export const GithubEvents = {
  pullRequest: 'github.pull_request',
  ciFailed: 'github.ci_failed',
} as const;

export interface GithubPullRequestEvent {
  workspaceId: string;
  /** Distinguishes the pull request in dedupe keys (repository link id + number). */
  prKey: string;
  action: 'opened' | 'merged';
  number: number;
  title: string;
  url: string;
  taskIds: string[];
  /** Member the pull request author is mapped to, if any. */
  actorId: string | null;
}

export interface GithubCiFailedEvent {
  workspaceId: string;
  prKey: string;
  headSha: string;
  checkName: string;
  number: number;
  title: string;
  url: string;
  taskIds: string[];
}
