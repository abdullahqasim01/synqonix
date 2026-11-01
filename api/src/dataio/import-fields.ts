export const IMPORT_FIELDS = [
  'externalId', 'title', 'description', 'status', 'priority', 'type', 'assignees', 'labels', 'estimate', 'timeEstimate', 'startDate', 'dueDate', 'parent', 'ignore',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Column names we understand (lower-cased, punctuation removed), covering our own export, Jira and GitHub exports. */
const ALIASES: Record<string, ImportField> = {
  key: 'externalId', 'issue key': 'externalId', 'issue id': 'externalId', id: 'externalId', number: 'externalId', 'issue number': 'externalId',
  title: 'title', summary: 'title', name: 'title', subject: 'title',
  description: 'description', body: 'description', details: 'description',
  status: 'status', state: 'status',
  priority: 'priority',
  type: 'type', 'issue type': 'type',
  assignee: 'assignees', assignees: 'assignees',
  labels: 'labels', label: 'labels', tags: 'labels',
  estimate: 'estimate', 'story points': 'estimate', 'story point estimate': 'estimate', points: 'estimate', 'custom field story points': 'estimate',
  'time estimate minutes': 'timeEstimate', 'original estimate': 'ignore',
  'start date': 'startDate', start: 'startDate',
  'due date': 'dueDate', due: 'dueDate', duedate: 'dueDate',
  parent: 'parent', 'parent key': 'parent', 'parent id': 'parent', 'parent summary': 'ignore', 'epic link': 'parent', 'epic key': 'parent',
};

const norm = (header: string) => header.toLowerCase().replace(/[()_]/g, ' ').replace(/\s+/g, ' ').trim();

export interface ColumnMapping { column: string; index: number; field: ImportField }

/** Maps each header to a field: explicit choices win, then known names; everything else is ignored. */
export function detectMapping(headers: string[], explicit: Record<string, string> = {}): ColumnMapping[] {
  const wanted = new Map(Object.entries(explicit).map(([k, v]) => [norm(k), v]));
  return headers.map((column, index) => {
    const chosen = wanted.get(norm(column));
    const field = (IMPORT_FIELDS as readonly string[]).includes(chosen ?? '') ? (chosen as ImportField) : ALIASES[norm(column)] ?? 'ignore';
    return { column, index, field };
  });
}

/** A usable file needs at least a title column. */
export const hasTitle = (m: ColumnMapping[]) => m.some((c) => c.field === 'title');

// ---------------------------------------------------------------- value parsing

/** Undoes the apostrophe our own export puts in front of cells that look like formulas. */
export const cleanCell = (v: string) => v.replace(/^'(?=[=+\-@])/, '').trim();

const TYPES: Record<string, 'TASK' | 'BUG' | 'STORY' | 'EPIC' | 'SUBTASK'> = {
  task: 'TASK', bug: 'BUG', defect: 'BUG', story: 'STORY', 'user story': 'STORY', feature: 'STORY', 'new feature': 'STORY', improvement: 'STORY',
  epic: 'EPIC', subtask: 'SUBTASK', 'sub task': 'SUBTASK', 'sub-task': 'SUBTASK', chore: 'TASK',
};

/** Returns the type, or null when unknown (the caller decides how loudly to complain). */
export const parseType = (v: string) => (v.trim() === '' ? 'TASK' : TYPES[v.trim().toLowerCase()] ?? null);

const PRIORITIES: Record<string, 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'> = {
  none: 'NONE', '': 'NONE', low: 'LOW', minor: 'LOW', lowest: 'LOW', trivial: 'LOW', medium: 'MEDIUM', normal: 'MEDIUM', moderate: 'MEDIUM',
  high: 'HIGH', major: 'HIGH', urgent: 'URGENT', critical: 'URGENT', highest: 'URGENT', blocker: 'URGENT',
};
export const parsePriority = (v: string) => PRIORITIES[v.trim().toLowerCase()] ?? null;

/** A finite number, tolerating a decimal comma. Null when it is not one. */
export function parseNumber(v: string): number | null {
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** ISO dates and timestamps, `YYYY/MM/DD`, and Jira's `21/Mar/24 9:30 AM`. Null when unreadable. */
export function parseDate(v: string): Date | null {
  const text = v.trim();
  if (!text) return null;
  const jira = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?$/i.exec(text);
  if (jira) {
    const month = MONTHS.indexOf(jira[2].toLowerCase());
    if (month < 0) return null;
    const year = jira[3].length === 2 ? 2000 + Number(jira[3]) : Number(jira[3]);
    let hour = Number(jira[4] ?? 0);
    if (jira[6]?.toUpperCase() === 'PM' && hour < 12) hour += 12;
    if (jira[6]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
    return new Date(Date.UTC(year, month, Number(jira[1]), hour, Number(jira[5] ?? 0)));
  }
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (slash) return new Date(Date.UTC(Number(slash[1]), Number(slash[2]) - 1, Number(slash[3])));
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const d = new Date(text.length === 10 ? `${text}T00:00:00Z` : text);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Splits a multi-value cell on `;` or `,` (Jira uses spaces between labels, which cannot be told apart from names). */
export const splitList = (v: string) => [...new Set(v.split(/[;,]/).map((x) => x.trim()).filter(Boolean))];

/** Where an unknown status name most likely belongs, judged by its wording. */
export function statusCategoryGuess(name: string): 'TODO' | 'IN_PROGRESS' | 'DONE' {
  const n = name.toLowerCase();
  if (/(done|closed|resolved|complete|finished|fixed|merged|shipped)/.test(n)) return 'DONE';
  if (/(progress|review|testing|doing|active|started|qa|develop)/.test(n)) return 'IN_PROGRESS';
  return 'TODO';
}
