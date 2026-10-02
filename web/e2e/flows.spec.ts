import { expect, test } from "@playwright/test";
import { api, expectAccessible, logIn, PASSWORD, seed, uniqueEmail } from "./helpers";

test.describe("critical flows", () => {
  test("register, create a workspace, sign out and back in", async ({ page }) => {
    const email = uniqueEmail("flow");
    await page.goto("/register");
    await page.getByLabel("Name").fill("Flow Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByLabel("Name").fill("Flow Workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/w\//);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await logIn(page, email);
    await expect(page.getByText("Flow Workspace")).toBeVisible();
  });

  test("a wrong password is refused with a message", async ({ page }) => {
    const { email } = await seed("wrongpw");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("protected pages send visitors to login and come back after signing in", async ({ page }) => {
    const { email, workspaceId } = await seed("redirect");
    await page.goto(`/w/${workspaceId}/my-tasks`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/my-tasks`));
  });

  test("open a task, comment on it and see the comment", async ({ page }) => {
    const s = await seed("task");
    await logIn(page, s.email);
    await page.goto(`/w/${s.workspaceId}/tasks/${s.tasks[0].key}`);
    await expect(page.getByRole("textbox", { name: "Task title", exact: true })).toHaveValue("Fix the payment form");
    const comment = page.getByPlaceholder(/leave a comment/i);
    await comment.fill("Looks good from the browser");
    await comment.press("Control+Enter");
    await expect(page.getByText("Looks good from the browser")).toBeVisible();
    const task = await api<{ key: string }>(`/workspaces/${s.workspaceId}/tasks/${s.tasks[0].key}`, { token: s.token });
    expect(task.key).toBe(s.tasks[0].key);
  });

  test("the project board lists the project's tasks", async ({ page }) => {
    const s = await seed("board");
    await logIn(page, s.email);
    await page.goto(`/w/${s.workspaceId}/projects/${s.projectId}`);
    await expect(page.getByText("Fix the payment form").first()).toBeVisible();
    await expect(page.getByText("Add order history").first()).toBeVisible();
  });

  test("the editor sign-in handshake only produces a vscode:// link for a valid state", async ({ page }) => {
    const s = await seed("connect");
    await logIn(page, s.email);
    await page.goto("/connect/vscode?state=nope");
    await expect(page.getByText(/link is not valid/i)).toBeVisible();
    await page.goto(`/connect/vscode?state=${"ab".repeat(16)}`);
    await page.getByRole("button", { name: "Connect VS Code" }).click();
    const link = page.getByRole("link", { name: /open it manually/i });
    await expect(link).toHaveAttribute("href", new RegExp(`^vscode://synqonix\\.synqonix/auth\\?token=sqx_.+&state=${"ab".repeat(16)}$`));
  });
});

test.describe("security headers", () => {
  test("pages carry a nonce-based CSP and the browser reports no violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()); });
    const res = await page.goto("/login");
    const csp = res!.headers()["content-security-policy"];
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(res!.headers()["x-frame-options"]).toBe("DENY");
    const s = await seed("csp");
    await logIn(page, s.email);
    await page.goto(`/w/${s.workspaceId}/projects/${s.projectId}`);
    await expect(page.getByText("Fix the payment form").first()).toBeVisible();
    expect(violations).toEqual([]);
  });
});

test.describe("accessibility (axe, WCAG 2.1 A/AA — serious and critical)", () => {
  test("signed-out pages", async ({ page }) => {
    for (const path of ["/login", "/register", "/forgot-password"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, path);
    }
  });

  test("signed-in pages", async ({ page }) => {
    const s = await seed("a11y");
    await logIn(page, s.email);
    const pages = ["/dashboard", `/w/${s.workspaceId}/my-tasks`, `/w/${s.workspaceId}/projects/${s.projectId}`, `/w/${s.workspaceId}/tasks/${s.tasks[0].key}`, "/settings/security", "/settings/notifications"];
    for (const path of pages) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, path);
    }
  });
});
