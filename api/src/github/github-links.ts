import { extractTaskKeys } from '../channels/task-keys.js';

/** Task keys in free text (commit messages, PR titles and bodies), ignoring code. */
export const keysFromText = extractTaskKeys;

/** Task keys in a branch name, where keys sit between separators: `feature/SYN-12-login-form`. */
export function keysFromBranch(name: string | null | undefined): string[] {
  if (!name) return [];
  const keys = new Set<string>();
  for (const m of name.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})(?!\d)/g)) {
    keys.add(`${m[1].toUpperCase()}-${m[2]}`);
  }
  return [...keys];
}

/** Every key mentioned in a pull request (branch, title, body), upper-cased and unique. */
export function keysFromPullRequest(pr: { headBranch: string; title: string; body?: string | null }): string[] {
  return [...new Set([...keysFromBranch(pr.headBranch), ...keysFromText(pr.title), ...keysFromText(pr.body)])];
}

/** Suggested branch name for a task: `syn-12-fix-login-bug`. */
export function branchNameFor(key: string, title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug ? `${key.toLowerCase()}-${slug}` : key.toLowerCase();
}

/** Whether `name` is acceptable as a git branch name for the subset we allow. */
export const isValidBranchName = (name: string) =>
  /^[A-Za-z0-9._/-]{1,200}$/.test(name) && !name.includes('..') && !/^[-/.]|[/.]$|\/\/|\.lock$/.test(name);

export type CiState = 'PENDING' | 'SUCCESS' | 'FAILURE';

/** Overall CI result for a commit from its check runs; null when nothing reported. */
export function ciState(checks: { status: string; conclusion: string | null }[]): CiState | null {
  if (checks.length === 0) return null;
  const bad = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);
  if (checks.some((c) => c.status === 'completed' && c.conclusion && bad.has(c.conclusion))) return 'FAILURE';
  if (checks.some((c) => c.status !== 'completed')) return 'PENDING';
  return 'SUCCESS';
}
