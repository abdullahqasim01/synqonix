import { describe, expect, it } from 'vitest';
import { escapeLike, hasFilters, makeSnippet, parseQuery } from './query-parser.js';

describe('query parser', () => {
  it('separates filters from free text', () => {
    expect(parseQuery('assignee:me status:open label:bug login page')).toEqual({
      text: 'login page', filters: { assignee: ['me'], status: ['open'], label: ['bug'] },
    });
  });

  it('supports quoted values, repeated filters and mixed case keys', () => {
    expect(parseQuery('label:"good first issue" Label:ui TYPE:bug')).toEqual({
      text: '', filters: { label: ['good first issue', 'ui'], type: ['bug'] },
    });
    expect(parseQuery('"exact phrase" more').text).toBe('exact phrase more');
  });

  it('keeps unknown pairs and empty filters in the text', () => {
    expect(parseQuery('see https://example.com and foo:bar').text).toBe('see https://example.com and foo:bar');
    expect(parseQuery('assignee: hello')).toEqual({ text: 'hello', filters: {} });
    expect(hasFilters(parseQuery('hello'))).toBe(false);
    expect(hasFilters(parseQuery('is:overdue'))).toBe(true);
  });

  it('handles empty input', () => {
    expect(parseQuery('   ')).toEqual({ text: '', filters: {} });
  });
});

describe('snippets', () => {
  it('centres on the match and marks the cuts', () => {
    const text = `${'word '.repeat(60)}needle ${'tail '.repeat(60)}`;
    const s = makeSnippet(text, ['needle']);
    expect(s).toContain('needle');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThan(220);
  });
  it('returns short text whole and flattens mentions', () => {
    expect(makeSnippet('hello [@Ann](mention:u1)\nthere', ['ann'])).toBe('hello @Ann there');
    expect(makeSnippet('abc', ['zzz'])).toBe('abc');
  });
});

describe('LIKE escaping', () => {
  it('neutralises wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
