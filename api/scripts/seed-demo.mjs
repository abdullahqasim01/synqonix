#!/usr/bin/env node
// Fills a running API with a small demo workspace so a fresh install has something to look at.
//   SYNQONIX_API=http://localhost:4000 node scripts/seed-demo.mjs
// Safe to re-run: it signs in to the demo account if it already exists and stops if the demo project is there.
const API = (process.env.SYNQONIX_API ?? 'http://localhost:4000').replace(/\/+$/, '') + '/api/v1';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@synqonix.local';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-123';

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${await res.text()}`), { status: res.status });
  return res.status === 204 ? undefined : res.json();
}

let session;
try {
  session = await call('/auth/register', { method: 'POST', body: { email: EMAIL, name: 'Demo User', password: PASSWORD } });
} catch (e) {
  if (e.status !== 409) throw e;
  session = await call('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
}
const token = session.accessToken;

const workspaces = await call('/workspaces', { token });
let ws = workspaces.find((w) => w.name === 'Demo Workspace');
if (!ws) ws = await call('/workspaces', { method: 'POST', token, body: { name: 'Demo Workspace' } });
const projects = await call(`/workspaces/${ws.id}/projects`, { token });
if (projects.some((p) => p.key === 'DEMO')) {
  console.log(`Demo data is already there (workspace "${ws.name}"). Sign in as ${EMAIL}.`);
  process.exit(0);
}

const project = await call(`/workspaces/${ws.id}/projects`, { method: 'POST', token, body: { name: 'Demo Project', key: 'DEMO', template: 'SCRUM', description: 'Sample data to explore Synqonix' } });
const base = `/workspaces/${ws.id}/projects/${project.id}`;
const task = (body) => call(`${base}/tasks`, { method: 'POST', token, body });

const sprint = await call(`${base}/sprints`, { method: 'POST', token, body: { name: 'Sprint 1', goal: 'Ship the first demo' } });
const epic = await task({ title: 'Onboarding experience', type: 'EPIC', priority: 'HIGH' });
const items = [
  { title: 'Design the welcome screen', type: 'STORY', priority: 'HIGH', estimate: 3, parentId: epic.id, sprintId: sprint.id },
  { title: 'Fix avatar upload on Safari', type: 'BUG', priority: 'URGENT', estimate: 2, sprintId: sprint.id },
  { title: 'Write the getting-started guide', type: 'TASK', priority: 'MEDIUM', estimate: 5, parentId: epic.id, sprintId: sprint.id },
  { title: 'Add keyboard shortcuts', type: 'STORY', priority: 'LOW', estimate: 8 },
  { title: 'Evaluate error tracking tools', type: 'TASK', priority: 'LOW' },
];
const created = [];
for (const item of items) created.push(await task({ ...item, assigneeIds: [session.user.id] }));
await call(`${base}/sprints/${sprint.id}/start`, { method: 'POST', token, body: { endDate: new Date(Date.now() + 14 * 864e5).toISOString() } });
await call(`/workspaces/${ws.id}/tasks/${created[0].key}/comments`, { method: 'POST', token, body: { body: 'Sketches are in the design channel — **feedback welcome**.' } });

console.log(`Seeded "${ws.name}" with project DEMO (${created.length + 1} tasks, an active sprint).`);
console.log(`Sign in as ${EMAIL} / ${PASSWORD}`);
