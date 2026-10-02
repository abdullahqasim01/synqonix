import { describe, expect, it } from 'vitest';
import {
  cleanCell, detectMapping, hasTitle, parseDate, parseNumber, parsePriority, parseType, splitList, statusCategoryGuess,
} from './import-fields.js';

describe('column mapping', () => {
  it('recognises our own, Jira and GitHub headers', () => {
    const own = detectMapping(['Key', 'Title', 'Status', 'Estimate', 'Due date', 'Labels']);
    expect(own.map((c) => c.field)).toEqual(['externalId', 'title', 'status', 'estimate', 'dueDate', 'labels']);
    const jira = detectMapping(['Summary', 'Issue key', 'Issue Type', 'Custom field (Story Points)', 'Epic Link', 'Reporter', 'Labels', 'Labels']);
    expect(jira.map((c) => c.field)).toEqual(['title', 'externalId', 'type', 'estimate', 'parent', 'ignore', 'labels', 'labels']);
    const gh = detectMapping(['number', 'title', 'body', 'state', 'assignees']);
    expect(gh.map((c) => c.field)).toEqual(['externalId', 'title', 'description', 'status', 'assignees']);
  });
  it('lets explicit choices win and ignores nonsense', () => {
    const m = detectMapping(['Foo', 'Summary'], { Foo: 'title', summary: 'description', Bar: 'banana' });
    expect(m.map((c) => c.field)).toEqual(['title', 'description']);
    expect(detectMapping(['x'], { x: 'banana' })[0].field).toBe('ignore');
    expect(hasTitle(detectMapping(['Nothing']))).toBe(false);
  });
});

describe('value parsing', () => {
  it('maps types and priorities from other tools', () => {
    expect(parseType('Sub-task')).toBe('SUBTASK');
    expect(parseType('Bug')).toBe('BUG');
    expect(parseType('')).toBe('TASK');
    expect(parseType('Spike')).toBeNull();
    expect(parsePriority('Highest')).toBe('URGENT');
    expect(parsePriority('Minor')).toBe('LOW');
    expect(parsePriority('')).toBe('NONE');
    expect(parsePriority('P0')).toBeNull();
  });
  it('reads numbers and dates in the formats people have', () => {
    expect(parseNumber('3')).toBe(3);
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseDate('2026-03-05')?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(parseDate('2026-03-05T10:00:00Z')?.toISOString()).toBe('2026-03-05T10:00:00.000Z');
    expect(parseDate('2026/3/5')?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(parseDate('21/Mar/24 9:30 PM')?.toISOString()).toBe('2024-03-21T21:30:00.000Z');
    expect(parseDate('21/Mar/24 12:05 AM')?.toISOString()).toBe('2024-03-21T00:05:00.000Z');
    for (const bad of ['yesterday', '31/13/2026', '2026-13-45', '5 March']) expect(parseDate(bad)).toBeNull();
  });
  it('cleans cells and lists', () => {
    expect(cleanCell("'=SUM(1)")).toBe('=SUM(1)');
    expect(cleanCell("'quoted")).toBe("'quoted");
    expect(splitList('a; b,c ;a')).toEqual(['a', 'b', 'c']);
  });
  it('guesses where unknown statuses belong', () => {
    expect(statusCategoryGuess('Closed')).toBe('DONE');
    expect(statusCategoryGuess('In QA')).toBe('IN_PROGRESS');
    expect(statusCategoryGuess('Waiting on customer')).toBe('TODO');
  });
});
