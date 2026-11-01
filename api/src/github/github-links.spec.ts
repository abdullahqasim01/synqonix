import { describe, expect, it } from 'vitest';
import { branchNameFor, ciState, isValidBranchName, keysFromBranch, keysFromPullRequest } from './github-links.js';

describe('task keys in GitHub text', () => {
  it('finds keys in branch names with common separators', () => {
    expect(keysFromBranch('feature/SYN-12-login-form')).toEqual(['SYN-12']);
    expect(keysFromBranch('syn-7_fix')).toEqual(['SYN-7']);
    expect(keysFromBranch('bugfix/WEB-3/and-API-4')).toEqual(['WEB-3', 'API-4']);
    expect(keysFromBranch('main')).toEqual([]);
    // Lookalikes are only candidates: they are matched against real project keys afterwards.
    expect(keysFromBranch('release-2024')).toEqual(['RELEASE-2024']);
  });

  it('combines branch, title and body of a pull request', () => {
    expect(keysFromPullRequest({ headBranch: 'feature/SYN-1-a', title: 'Fix SYN-2', body: 'Closes SYN-3 and `SYN-9`' }))
      .toEqual(['SYN-1', 'SYN-2', 'SYN-3']);
    expect(keysFromPullRequest({ headBranch: 'x', title: 'y', body: null })).toEqual([]);
  });
});

describe('branch names', () => {
  it('suggests a readable name from a task', () => {
    expect(branchNameFor('SYN-12', 'Fix: login bug (Safari)!')).toBe('syn-12-fix-login-bug-safari');
    expect(branchNameFor('SYN-1', '!!!')).toBe('syn-1');
    expect(branchNameFor('SYN-1', 'a'.repeat(80)).length).toBeLessThanOrEqual(46);
  });
  it('only accepts safe branch names', () => {
    for (const ok of ['syn-1-fix', 'feature/a_b.c', 'v1.2']) expect(isValidBranchName(ok)).toBe(true);
    for (const bad of ['', '-x', '/x', 'x/', 'a..b', 'a b', 'a//b', 'x.lock', 'a;rm', '.hidden']) expect(isValidBranchName(bad)).toBe(false);
  });
});

describe('CI state', () => {
  const c = (status: string, conclusion: string | null = null) => ({ status, conclusion });
  it('summarises check runs', () => {
    expect(ciState([])).toBeNull();
    expect(ciState([c('completed', 'success'), c('completed', 'skipped')])).toBe('SUCCESS');
    expect(ciState([c('completed', 'success'), c('in_progress')])).toBe('PENDING');
    expect(ciState([c('completed', 'failure'), c('in_progress')])).toBe('FAILURE');
    expect(ciState([c('completed', 'timed_out')])).toBe('FAILURE');
    expect(ciState([c('queued')])).toBe('PENDING');
  });
});
