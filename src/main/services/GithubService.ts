import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GithubIssue, GithubLabel } from '@shared/types';

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 15_000;

export class GithubService {
  static async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('gh', ['auth', 'status'], {
        timeout: TIMEOUT_MS,
        env: process.env as Record<string, string>,
      });
      return true;
    } catch {
      return false;
    }
  }

  static async searchIssues(cwd: string, query: string): Promise<GithubIssue[]> {
    const args = ['issue', 'list'];
    if (query.trim()) {
      args.push('--search', query);
    }
    args.push('--json', 'number,title,labels,state,body,url,assignees', '--limit', '20');

    const { stdout } = await execFileAsync('gh', args, {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });

    const raw = JSON.parse(stdout);
    return raw.map(mapIssue);
  }

  static async getIssue(cwd: string, number: number): Promise<GithubIssue> {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'view', String(number), '--json', 'number,title,labels,state,body,url,assignees'],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );

    return mapIssue(JSON.parse(stdout));
  }

  static async createIssue(
    cwd: string,
    title: string,
    body?: string,
    labels?: string[],
    assignees?: string[],
  ): Promise<GithubIssue> {
    const args = [
      'issue',
      'create',
      '--title',
      title,
      '--json',
      'number,title,labels,state,body,url,assignees',
    ];
    if (body) args.push('--body', body);
    if (labels && labels.length > 0) args.push('--label', labels.join(','));
    if (assignees && assignees.length > 0) args.push('--assignee', assignees.join(','));

    const { stdout } = await execFileAsync('gh', args, {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });

    return mapIssue(JSON.parse(stdout));
  }

  static async listAllIssues(cwd: string, state: string = 'open'): Promise<GithubIssue[]> {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'issue',
        'list',
        '--state',
        state,
        '--json',
        'number,title,labels,state,body,url,assignees,createdAt,updatedAt,comments,milestone',
        '--limit',
        '200',
      ],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );

    const raw = JSON.parse(stdout);
    return raw.map(mapIssue);
  }

  static async listLabels(cwd: string): Promise<GithubLabel[]> {
    const { stdout } = await execFileAsync(
      'gh',
      ['label', 'list', '--json', 'name,color,description', '--limit', '100'],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );

    const raw = JSON.parse(stdout) as Array<{ name: string; color: string; description: string }>;
    return raw.map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description ?? '',
    }));
  }

  static async getDefaultBranch(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'gh',
        ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'],
        { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
      );
      return stdout.trim() || 'main';
    } catch {
      return 'main';
    }
  }

  static async getPullRequestCommits(
    cwd: string,
    base: string,
    head: string,
  ): Promise<Array<{ hash: string; subject: string; authorName: string; authorDate: number }>> {
    const { stdout } = await execFileAsync(
      'git',
      ['log', `${base}..${head}`, '--format=%H%x00%s%x00%an%x00%at'],
      { cwd, timeout: TIMEOUT_MS },
    );

    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line: string) => {
        const [hash, subject, authorName, authorDate] = line.split('\0');
        return {
          hash,
          subject,
          authorName,
          authorDate: parseInt(authorDate, 10) || 0,
        };
      });
  }

  static async createPullRequest(
    cwd: string,
    options: {
      title: string;
      body: string;
      base: string;
      draft?: boolean;
    },
  ): Promise<string> {
    const args = ['pr', 'create', '--title', options.title, '--body', options.body, '--base', options.base];
    if (options.draft) {
      args.push('--draft');
    }

    const { stdout } = await execFileAsync('gh', args, {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });

    return stdout.trim(); // Returns the PR URL
  }

  static async postBranchComment(cwd: string, issueNumber: number, branch: string): Promise<void> {
    const body = `A task branch has been created for this issue:\n\n\`\`\`\n${branch}\n\`\`\``;
    await execFileAsync('gh', ['issue', 'comment', String(issueNumber), '--body', body], {
      cwd,
      timeout: TIMEOUT_MS,
      env: process.env as Record<string, string>,
    });
  }

  /**
   * Link a branch to an issue's "Development" section via GitHub GraphQL API.
   * Uses createLinkedBranch which creates the branch on the remote and links it.
   * Must be called before the branch is pushed to the remote.
   * Returns the issue URL on success.
   */
  static async linkBranch(cwd: string, issueNumber: number, branch: string): Promise<string> {
    // Resolve owner/repo from the local git remote
    const { stdout: nwo } = await execFileAsync(
      'gh',
      ['repo', 'view', '--json', 'owner,name', '-q', '.owner.login + "/" + .name'],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );
    const [owner, repo] = nwo.trim().split('/');

    // Get repo + issue node IDs
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          id
          issue(number: $number) { id }
        }
      }
    `;
    const { stdout: idsRaw } = await execFileAsync(
      'gh',
      [
        'api',
        'graphql',
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repo}`,
        '-F',
        `number=${issueNumber}`,
        '-f',
        `query=${query}`,
      ],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );

    const ids = JSON.parse(idsRaw);
    const repoId = ids.data?.repository?.id;
    const issueId = ids.data?.repository?.issue?.id;
    if (!repoId || !issueId) {
      throw new Error('Could not resolve repository or issue ID');
    }

    // Resolve the branch OID from the local repo
    const { stdout: oid } = await execFileAsync('git', ['rev-parse', branch], {
      cwd,
      timeout: TIMEOUT_MS,
    });

    // createLinkedBranch creates the branch on the remote and links it to the issue
    const mutation = `
      mutation($repoId: ID!, $issueId: ID!, $oid: GitObjectID!, $branch: String!) {
        createLinkedBranch(input: {
          repositoryId: $repoId,
          issueId: $issueId,
          oid: $oid,
          name: $branch
        }) {
          linkedBranch { id }
        }
      }
    `;
    await execFileAsync(
      'gh',
      [
        'api',
        'graphql',
        '-F',
        `repoId=${repoId}`,
        '-F',
        `issueId=${issueId}`,
        '-F',
        `oid=${oid.trim()}`,
        '-F',
        `branch=${branch}`,
        '-f',
        `query=${mutation}`,
      ],
      { cwd, timeout: TIMEOUT_MS, env: process.env as Record<string, string> },
    );

    return `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
  }
}

function mapIssue(raw: Record<string, unknown>): GithubIssue {
  const labels = Array.isArray(raw.labels)
    ? raw.labels.map((l: Record<string, unknown>) => (typeof l === 'string' ? l : l.name) as string)
    : [];
  const assignees = Array.isArray(raw.assignees)
    ? raw.assignees.map(
        (a: Record<string, unknown>) => (typeof a === 'string' ? a : a.login) as string,
      )
    : [];

  const milestone =
    raw.milestone && typeof raw.milestone === 'object'
      ? {
          number: (raw.milestone as Record<string, unknown>).number as number,
          title: (raw.milestone as Record<string, unknown>).title as string,
        }
      : null;

  return {
    number: raw.number as number,
    title: raw.title as string,
    labels,
    state: raw.state as string,
    body: raw.body as string,
    url: raw.url as string,
    assignees,
    createdAt: raw.createdAt as string | undefined,
    updatedAt: raw.updatedAt as string | undefined,
    comments: raw.comments as number | undefined,
    milestone,
  };
}
