export const FILTER_KEYS = ['assignee', 'reporter', 'status', 'label', 'type', 'priority', 'project', 'is'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export interface ParsedQuery {
  /** What is left after the filters are taken out, for text matching. */
  text: string;
  filters: Partial<Record<FilterKey, string[]>>;
}

const TOKEN = /([A-Za-z]+):(?:"([^"]*)"|(\S*))|"([^"]*)"|(\S+)/g;

/**
 * Splits `assignee:me status:open label:"good first issue" login bug` into filters and free text.
 * Unknown `word:value` pairs stay in the text, so searching for "https://x" or "a:b" still works.
 */
export function parseQuery(input: string): ParsedQuery {
  const filters: ParsedQuery['filters'] = {};
  const words: string[] = [];
  for (const m of input.matchAll(TOKEN)) {
    const key = m[1]?.toLowerCase();
    if (key && (FILTER_KEYS as readonly string[]).includes(key)) {
      const value = (m[2] ?? m[3] ?? '').trim();
      if (value) (filters[key as FilterKey] ??= []).push(value);
      continue;
    }
    words.push(m[4] ?? m[5] ?? m[0]);
  }
  return { text: words.join(' ').trim(), filters };
}

export const hasFilters = (p: ParsedQuery) => Object.keys(p.filters).length > 0;

/** A short excerpt of `text` around the first matching term, with ellipses where it was cut. */
export function makeSnippet(text: string, terms: string[], radius = 70): string {
  const flat = text.replace(/\[@([^\]]+)\]\(mention:[^)]+\)/g, '@$1').replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms.map((x) => x.toLowerCase()).filter(Boolean)) {
    at = lower.indexOf(t);
    if (at >= 0) break;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + radius * 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** Escapes `%`, `_` and `\` so user text is matched literally by LIKE/ILIKE. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
