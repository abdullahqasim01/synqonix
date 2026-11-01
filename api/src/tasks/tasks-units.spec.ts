import { describe, expect, it } from 'vitest';
import { normalizeCustomValue } from './custom-values.js';
import { hierarchyError } from './hierarchy.js';
import { extractMentionedUserIds } from './mentions.js';
import { parseTaskRef } from './task-ref.js';
import { safeFilename } from './attachments.service.js';

describe('parseTaskRef', () => {
  it('parses keys case-insensitively', () => {
    expect(parseTaskRef('syn-12')).toEqual({ kind: 'key', projectKey: 'SYN', number: 12 });
    expect(parseTaskRef('A1B-7')).toEqual({ kind: 'key', projectKey: 'A1B', number: 7 });
  });
  it('treats anything else as an id', () => {
    expect(parseTaskRef('0198a5f0-1234-7abc-9def-0123456789ab')).toEqual({ kind: 'id', id: '0198a5f0-1234-7abc-9def-0123456789ab' });
    expect(parseTaskRef('SYN-')).toEqual({ kind: 'id', id: 'SYN-' });
  });
});

describe('extractMentionedUserIds', () => {
  it('finds unique mention links in order', () => {
    const md = 'cc [@Ann](mention:11111111-aaaa) and [@Bob](mention:22222222-bbbb) and [@Ann](mention:11111111-aaaa)';
    expect(extractMentionedUserIds(md)).toEqual(['11111111-aaaa', '22222222-bbbb']);
  });
  it('ignores plain @text, normal links and empty input', () => {
    expect(extractMentionedUserIds('@ann see [docs](https://x.y)')).toEqual([]);
    expect(extractMentionedUserIds(null)).toEqual([]);
  });
});

describe('hierarchyError', () => {
  it('allows epic > story/task/bug > subtask', () => {
    expect(hierarchyError('EPIC', null)).toBeNull();
    expect(hierarchyError('STORY', 'EPIC')).toBeNull();
    expect(hierarchyError('BUG', null)).toBeNull();
    expect(hierarchyError('SUBTASK', 'TASK')).toBeNull();
  });
  it('rejects invalid nesting', () => {
    expect(hierarchyError('SUBTASK', null)).toMatch(/needs a parent/);
    expect(hierarchyError('SUBTASK', 'EPIC')).toBeTruthy();
    expect(hierarchyError('SUBTASK', 'SUBTASK')).toBeTruthy();
    expect(hierarchyError('EPIC', 'EPIC')).toMatch(/epic cannot have a parent/);
    expect(hierarchyError('TASK', 'STORY')).toBeTruthy();
  });
});

describe('normalizeCustomValue', () => {
  const f = (type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'CHECKBOX', options: unknown = null) => ({ id: '1', name: 'F', type, options });
  it('validates each type', () => {
    expect(normalizeCustomValue(f('TEXT'), 'hi')).toBe('hi');
    expect(() => normalizeCustomValue(f('TEXT'), 5)).toThrow();
    expect(normalizeCustomValue(f('NUMBER'), 3.5)).toBe(3.5);
    expect(() => normalizeCustomValue(f('NUMBER'), 'x')).toThrow();
    expect(() => normalizeCustomValue(f('NUMBER'), Infinity)).toThrow();
    expect(normalizeCustomValue(f('CHECKBOX'), true)).toBe(true);
    expect(() => normalizeCustomValue(f('CHECKBOX'), 'yes')).toThrow();
    expect(normalizeCustomValue(f('DATE'), '2026-01-02')).toBe('2026-01-02T00:00:00.000Z');
    expect(() => normalizeCustomValue(f('DATE'), 'nope')).toThrow();
    expect(normalizeCustomValue(f('SELECT', ['a', 'b']), 'a')).toBe('a');
    expect(() => normalizeCustomValue(f('SELECT', ['a', 'b']), 'c')).toThrow();
  });
  it('treats null as clearing', () => {
    expect(normalizeCustomValue(f('NUMBER'), null)).toBeNull();
  });
});

describe('safeFilename', () => {
  it('drops paths and unsafe characters', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
    expect(safeFilename('a"b<c>.txt')).toBe('abc.txt');
    expect(safeFilename('..')).toBe('file');
    expect(safeFilename('')).toBe('file');
  });
});
