import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const API = (process.env.E2E_API_URL ?? "http://localhost:4000") + "/api/v1";
export const PASSWORD = "correct horse battery 9";

export async function api<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const uniqueEmail = (tag: string) => `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e4)}@example.com`;

/** A user with a workspace, a Scrum project and a few tasks, created through the API. */
export async function seed(tag: string) {
  const email = uniqueEmail(tag);
  const session = await api<{ accessToken: string; user: { id: string } }>("/auth/register", { body: { email, name: "E2E User", password: PASSWORD } });
  const token = session.accessToken;
  const ws = await api<{ id: string }>("/workspaces", { token, body: { name: `E2E ${tag}` } });
  const project = await api<{ id: string }>(`/workspaces/${ws.id}/projects`, { token, body: { name: "Checkout", key: "CHK", template: "SCRUM" } });
  const tasks: { key: string; id: string }[] = [];
  for (const title of ["Fix the payment form", "Add order history"]) {
    tasks.push(await api(`/workspaces/${ws.id}/projects/${project.id}/tasks`, { token, body: { title, type: "TASK" } }));
  }
  return { email, token, workspaceId: ws.id, projectId: project.id, tasks };
}

export async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Fails on serious or critical accessibility violations (colour contrast, missing names, bad ARIA, …). */
export async function expectAccessible(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`), "accessibility violations").toEqual([]);
}
