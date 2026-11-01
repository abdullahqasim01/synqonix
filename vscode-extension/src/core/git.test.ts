import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { branchNameFor, commitTemplate, Git, GitError, mentionsKey, taskKeyFromBranch } from "./git";

describe("branch names", () => {
  it("builds a readable branch from the key and title", () => {
    expect(branchNameFor("SYN-12", "Fix: login bug (Safari)!")).toBe("syn-12-fix-login-bug-safari");
    expect(branchNameFor("SYN-1", "!!!")).toBe("syn-1");
    expect(branchNameFor("SYN-1", "Überprüfung läuft")).toBe("syn-1-uberprufung-lauft");
    expect(branchNameFor("SYN-1", "a".repeat(80)).length).toBeLessThanOrEqual(46);
  });
  it("finds the task key in branch names", () => {
    expect(taskKeyFromBranch("syn-12-fix-login")).toBe("SYN-12");
    expect(taskKeyFromBranch("feature/SYN-7_thing")).toBe("SYN-7");
    expect(taskKeyFromBranch("bugfix/WEB-3/and-API-4")).toBe("WEB-3");
    for (const none of ["main", "develop", "", null, undefined]) expect(taskKeyFromBranch(none as string)).toBeNull();
  });
  it("writes commit templates and spots keys already in a message", () => {
    expect(commitTemplate("SYN-12", "Fix login")).toBe("SYN-12: Fix login");
    expect(commitTemplate("SYN-12")).toBe("SYN-12:");
    expect(mentionsKey("SYN-12: fix", "SYN-12")).toBe(true);
    expect(mentionsKey("fixes syn-12", "SYN-12")).toBe(true);
    expect(mentionsKey("SYN-123 other", "SYN-12")).toBe(false);
    expect(mentionsKey("ASYN-12", "SYN-12")).toBe(false);
  });
});

describe("git operations on a real repository", () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), "sx-git-"));
    sh(dir, "init", "-q", "-b", "main");
    sh(dir, "config", "user.email", "t@example.com");
    sh(dir, "config", "user.name", "T");
    writeFileSync(join(dir, "a.txt"), "a");
    sh(dir, "add", ".");
    sh(dir, "commit", "-q", "-m", "init");
    return dir;
  }

  it("creates a branch, switches to an existing one, and reports state", async () => {
    const dir = repo();
    const git = new Git();
    expect(await git.root(dir)).toContain("sx-git-");
    expect(await git.currentBranch(dir)).toBe("main");
    expect(await git.checkoutOrCreate(dir, "syn-1-fix")).toBe(true);
    expect(await git.currentBranch(dir)).toBe("syn-1-fix");
    sh(dir, "checkout", "-q", "main");
    expect(await git.checkoutOrCreate(dir, "syn-1-fix")).toBe(false); // already exists: just switch
    expect(await git.currentBranch(dir)).toBe("syn-1-fix");
    expect(await git.branchExists(dir, "nope")).toBe(false);
    expect(await git.isDirty(dir)).toBe(false);
    writeFileSync(join(dir, "b.txt"), "b");
    expect(await git.isDirty(dir)).toBe(true);
  });

  it("can start from a base branch", async () => {
    const dir = repo();
    sh(dir, "checkout", "-q", "-b", "develop");
    writeFileSync(join(dir, "d.txt"), "d");
    sh(dir, "add", ".");
    sh(dir, "commit", "-q", "-m", "on develop");
    sh(dir, "checkout", "-q", "main");
    await new Git().checkoutOrCreate(dir, "syn-2-x", "develop");
    expect(sh(dir, "log", "--format=%s", "-1").trim()).toBe("on develop");
  });

  it("says no outside a repository and explains a missing git", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sx-nogit-"));
    const git = new Git();
    expect(await git.root(dir)).toBeNull();
    expect(await git.currentBranch(dir)).toBeNull();
    const missing = new Git(async () => { throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }); });
    await expect(missing.isDirty(dir)).rejects.toThrow(/not installed/);
    await expect(new Git().checkoutOrCreate(dir, "x")).rejects.toThrow(GitError);
  });
});
