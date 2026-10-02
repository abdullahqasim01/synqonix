import { execFile } from "node:child_process";

/** `syn-12-fix-login-bug`: the key, then a short slug of the title. */
export function branchNameFor(key: string, title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug ? `${key.toLowerCase()}-${slug}` : key.toLowerCase();
}

/** The task key in a branch name (`feature/SYN-12-login` → `SYN-12`), or null. First match wins. */
export function taskKeyFromBranch(branch: string | undefined | null): string | null {
  if (!branch) return null;
  const m = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})(?!\d)/.exec(branch);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

/** What goes into a new commit message so the task links itself. */
export const commitTemplate = (key: string, title?: string) => `${key}: ${title ?? ""}`.trimEnd();

/** Whether a commit message already mentions the key (so we do not add it twice). */
export const mentionsKey = (message: string, key: string) => new RegExp(`(?<![A-Za-z0-9])${key}(?!\\d)`, "i").test(message);

export type Runner = (cwd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export const defaultRunner: Runner = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: 20_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error(stderr.trim() || err.message), { code: (err as NodeJS.ErrnoException).code }));
      else resolve({ stdout, stderr });
    });
  });

export class GitError extends Error {}

/** The few git operations the extension needs, through the `git` command line. */
export class Git {
  constructor(private readonly run: Runner = defaultRunner) {}

  private async out(cwd: string, ...args: string[]) {
    try {
      return (await this.run(cwd, args)).stdout.trim();
    } catch (e) {
      throw new GitError((e as NodeJS.ErrnoException).code === "ENOENT" ? "Git is not installed or not on the PATH" : (e as Error).message);
    }
  }

  /** The repository folder containing `cwd`, or null when it is not in one. */
  async root(cwd: string): Promise<string | null> {
    try {
      return await this.out(cwd, "rev-parse", "--show-toplevel");
    } catch {
      return null;
    }
  }

  /** Current branch name; null when detached or there are no commits yet on an unborn branch is still reported. */
  async currentBranch(cwd: string): Promise<string | null> {
    try {
      const name = await this.out(cwd, "symbolic-ref", "--quiet", "--short", "HEAD");
      return name || null;
    } catch {
      return null;
    }
  }

  async branchExists(cwd: string, name: string): Promise<boolean> {
    try {
      await this.out(cwd, "show-ref", "--verify", "--quiet", `refs/heads/${name}`);
      return true;
    } catch {
      return false;
    }
  }

  async isDirty(cwd: string): Promise<boolean> {
    return (await this.out(cwd, "status", "--porcelain")).length > 0;
  }

  /** Switches to the branch, creating it from `base` (or the current HEAD) when it does not exist. Returns whether it was created. */
  async checkoutOrCreate(cwd: string, name: string, base?: string): Promise<boolean> {
    if (await this.branchExists(cwd, name)) {
      await this.out(cwd, "checkout", name);
      return false;
    }
    await this.out(cwd, "checkout", "-b", name, ...(base ? [base] : []));
    return true;
  }
}
