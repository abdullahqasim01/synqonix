import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'node:crypto';
import type { Env } from '../config/env.js';

export interface GithubInstallationInfo {
  githubId: string;
  accountLogin: string;
  accountType: string;
}

export interface GithubRepoInfo {
  githubRepoId: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
}

/**
 * Everything we ask of GitHub. An abstract class so the app can inject it and tests can
 * replace it with a fake instead of calling the network.
 */
export abstract class GithubClient {
  abstract isConfigured(): boolean;
  abstract installUrl(state: string): string | null;
  abstract getInstallation(githubId: string): Promise<GithubInstallationInfo | null>;
  abstract listRepositories(installationGithubId: string): Promise<GithubRepoInfo[]>;
  abstract createBranch(installationGithubId: string, fullName: string, name: string, fromBranch: string): Promise<{ sha: string; url: string }>;
  abstract setIssueState(installationGithubId: string, fullName: string, number: number, state: 'open' | 'closed'): Promise<void>;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** Talks to the GitHub REST API as a GitHub App (app JWT, then short-lived installation tokens). */
@Injectable()
export class HttpGithubClient extends GithubClient {
  private readonly logger = new Logger(HttpGithubClient.name);
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  isConfigured() {
    return !!(this.config.get('GITHUB_APP_ID') && this.config.get('GITHUB_APP_PRIVATE_KEY') && this.config.get('GITHUB_APP_SLUG') && this.config.get('GITHUB_WEBHOOK_SECRET'));
  }

  installUrl(state: string) {
    const slug = this.config.get('GITHUB_APP_SLUG');
    return slug ? `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}` : null;
  }

  private appJwt(): string {
    const id = this.config.get('GITHUB_APP_ID');
    const key = this.config.get('GITHUB_APP_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    if (!id || !key) throw new BadGatewayException('GitHub is not configured');
    const now = Math.floor(Date.now() / 1000);
    const head = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: id }))}`;
    return `${head}.${createSign('RSA-SHA256').update(head).sign(key).toString('base64url')}`;
  }

  private async request<T>(path: string, init: RequestInit & { token: string }): Promise<{ status: number; body: T }> {
    const { token, ...rest } = init;
    const res = await fetch(`${this.config.get('GITHUB_API_URL')}${path}`, {
      ...rest,
      headers: {
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'synqonix',
        Authorization: `Bearer ${token}`, ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  private async installationToken(installationId: string): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await this.request<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, { method: 'POST', token: this.appJwt() });
    if (res.status !== 201) throw new BadGatewayException('GitHub refused the installation token');
    this.tokens.set(installationId, { token: res.body.token, expiresAt: new Date(res.body.expires_at).getTime() });
    return res.body.token;
  }

  async getInstallation(githubId: string): Promise<GithubInstallationInfo | null> {
    const res = await this.request<{ id: number; account: { login: string; type: string } }>(`/app/installations/${encodeURIComponent(githubId)}`, { token: this.appJwt() });
    if (res.status === 404) return null;
    if (res.status !== 200) throw new BadGatewayException('Could not read the GitHub installation');
    return { githubId: String(res.body.id), accountLogin: res.body.account.login, accountType: res.body.account.type };
  }

  async listRepositories(installationGithubId: string): Promise<GithubRepoInfo[]> {
    const token = await this.installationToken(installationGithubId);
    const out: GithubRepoInfo[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await this.request<{ repositories: { id: number; full_name: string; html_url: string; default_branch: string; private: boolean }[] }>(
        `/installation/repositories?per_page=100&page=${page}`, { token },
      );
      if (res.status !== 200) throw new BadGatewayException('Could not list GitHub repositories');
      out.push(...res.body.repositories.map((r) => ({ githubRepoId: String(r.id), fullName: r.full_name, htmlUrl: r.html_url, defaultBranch: r.default_branch, private: r.private })));
      if (res.body.repositories.length < 100) break;
    }
    return out;
  }

  async createBranch(installationGithubId: string, fullName: string, name: string, fromBranch: string) {
    const token = await this.installationToken(installationGithubId);
    const base = await this.request<{ object: { sha: string } }>(`/repos/${fullName}/git/ref/heads/${fromBranch.split('/').map(encodeURIComponent).join('/')}`, { token });
    if (base.status !== 200) throw new BadGatewayException(`Could not find branch ${fromBranch} on GitHub`);
    const res = await this.request<{ message?: string }>(`/repos/${fullName}/git/refs`, {
      method: 'POST', token, body: JSON.stringify({ ref: `refs/heads/${name}`, sha: base.body.object.sha }),
    });
    if (res.status === 422) throw new BadGatewayException('That branch already exists on GitHub');
    if (res.status !== 201) {
      this.logger.warn(`createBranch ${fullName} ${name}: ${res.status} ${res.body?.message ?? ''}`);
      throw new BadGatewayException('GitHub could not create the branch');
    }
    return { sha: base.body.object.sha, url: `https://github.com/${fullName}/tree/${name}` };
  }

  async setIssueState(installationGithubId: string, fullName: string, number: number, state: 'open' | 'closed') {
    const token = await this.installationToken(installationGithubId);
    const res = await this.request(`/repos/${fullName}/issues/${number}`, { method: 'PATCH', token, body: JSON.stringify({ state }) });
    if (res.status !== 200) throw new BadGatewayException('GitHub could not update the issue');
  }
}
