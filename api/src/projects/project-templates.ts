import type { ProjectTemplate, StatusCategory } from '../generated/prisma/enums.js';

interface StatusSeed { name: string; category: StatusCategory; color: string }
interface TemplateSeed { statuses: StatusSeed[]; labels: { name: string; color: string }[] }

const GRAY = '#71717a', BLUE = '#3b82f6', AMBER = '#f59e0b', PURPLE = '#8b5cf6', GREEN = '#22c55e';
const BASIC_LABELS = [
  { name: 'feature', color: '#6366f1' },
  { name: 'bug', color: '#ef4444' },
  { name: 'chore', color: '#71717a' },
];

export const PROJECT_TEMPLATES: Record<ProjectTemplate, TemplateSeed> = {
  SCRUM: {
    statuses: [
      { name: 'To Do', category: 'TODO', color: GRAY },
      { name: 'In Progress', category: 'IN_PROGRESS', color: BLUE },
      { name: 'In Review', category: 'IN_PROGRESS', color: PURPLE },
      { name: 'Done', category: 'DONE', color: GREEN },
    ],
    labels: BASIC_LABELS,
  },
  KANBAN: {
    statuses: [
      { name: 'Backlog', category: 'TODO', color: GRAY },
      { name: 'To Do', category: 'TODO', color: AMBER },
      { name: 'In Progress', category: 'IN_PROGRESS', color: BLUE },
      { name: 'Review', category: 'IN_PROGRESS', color: PURPLE },
      { name: 'Done', category: 'DONE', color: GREEN },
    ],
    labels: BASIC_LABELS,
  },
  BUG_TRACKING: {
    statuses: [
      { name: 'Open', category: 'TODO', color: GRAY },
      { name: 'Triaged', category: 'TODO', color: AMBER },
      { name: 'In Progress', category: 'IN_PROGRESS', color: BLUE },
      { name: 'In Review', category: 'IN_PROGRESS', color: PURPLE },
      { name: 'Resolved', category: 'DONE', color: GREEN },
      { name: 'Closed', category: 'DONE', color: '#16a34a' },
    ],
    labels: [
      { name: 'bug', color: '#ef4444' },
      { name: 'regression', color: '#f97316' },
      { name: 'security', color: '#dc2626' },
      { name: 'ui', color: '#06b6d4' },
    ],
  },
  BLANK: {
    statuses: [
      { name: 'To Do', category: 'TODO', color: GRAY },
      { name: 'In Progress', category: 'IN_PROGRESS', color: BLUE },
      { name: 'Done', category: 'DONE', color: GREEN },
    ],
    labels: [],
  },
};
