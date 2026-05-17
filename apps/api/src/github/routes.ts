/**
 * GitHub API Routes
 * Proxies GitHub API calls to fetch repo, branch, and PR information
 */

import { Router } from 'express';
import { Octokit } from '@octokit/rest';

const router = Router();

// Initialize Octokit with token from environment
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Owner for all repos
const OWNER = 'perfectuser21';

// Repos to track
const TRACKED_REPOS = ['zenithjoy-engine', 'cecelia-workspace'];

interface RepoInfo {
  name: string;
  fullName: string;
  defaultBranch: string;
  description: string | null;
  updatedAt: string;
  pushedAt: string;
  openIssues: number;
}

interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
  lastCommit: {
    sha: string;
    message: string;
    author: string;
    date: string;
  };
}

interface PrInfo {
  number: number;
  title: string;
  state: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headBranch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
}

// GET /api/github/repos - Get all tracked repos info
router.get('/repos', async (_req, res) => {
  try {
    const repos: RepoInfo[] = await Promise.all(
      TRACKED_REPOS.map(async (repo) => {
        const { data } = await octokit.repos.get({ owner: OWNER, repo });
        return {
          name: data.name,
          fullName: data.full_name,
          defaultBranch: data.default_branch,
          description: data.description,
          updatedAt: data.updated_at,
          pushedAt: data.pushed_at,
          openIssues: data.open_issues_count,
        };
      })
    );
    res.json({ success: true, data: repos });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch repos' });
  }
});

// GET /api/github/repos/:repo/branches - Get all branches for a repo
router.get('/repos/:repo/branches', async (req, res) => {
  try {
    const { repo } = req.params;
    const { data } = await octokit.repos.listBranches({
      owner: OWNER,
      repo,
      per_page: 100,
    });

    const branches: BranchInfo[] = await Promise.all(
      data.map(async (branch) => {
        const { data: commit } = await octokit.repos.getCommit({
          owner: OWNER,
          repo,
          ref: branch.commit.sha,
        });
        return {
          name: branch.name,
          sha: branch.commit.sha,
          protected: branch.protected,
          lastCommit: {
            sha: commit.sha,
            message: commit.commit.message.split('\n')[0],
            author: commit.commit.author?.name || 'Unknown',
            date: commit.commit.author?.date || '',
          },
        };
      })
    );

    // Sort: main first, then develop, then others by date
    branches.sort((a, b) => {
      if (a.name === 'main') return -1;
      if (b.name === 'main') return 1;
      if (a.name === 'develop') return -1;
      if (b.name === 'develop') return 1;
      return new Date(b.lastCommit.date).getTime() - new Date(a.lastCommit.date).getTime();
    });

    res.json({ success: true, data: branches });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch branches' });
  }
});

// GET /api/github/repos/:repo/pulls - Get recent PRs for a repo
router.get('/repos/:repo/pulls', async (req, res) => {
  try {
    const { repo } = req.params;
    const state = (req.query.state as 'open' | 'closed' | 'all') || 'all';
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const { data } = await octokit.pulls.list({
      owner: OWNER,
      repo,
      state,
      per_page: limit,
      sort: 'updated',
      direction: 'desc',
    });

    const prs: PrInfo[] = data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.merged_at ? 'merged' : pr.state,
      author: pr.user?.login || 'Unknown',
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      // These fields are only available in PR detail API, not list API
      additions: (pr as unknown as { additions?: number }).additions || 0,
      deletions: (pr as unknown as { deletions?: number }).deletions || 0,
      changedFiles: (pr as unknown as { changed_files?: number }).changed_files || 0,
      url: pr.html_url,
    }));

    res.json({ success: true, data: prs });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch PRs' });
  }
});

// GET /api/github/panorama - Get full panorama data for all repos
router.get('/panorama', async (_req, res) => {
  try {
    const panorama = await Promise.all(
      TRACKED_REPOS.map(async (repoName) => {
        // Get repo info
        const { data: repo } = await octokit.repos.get({ owner: OWNER, repo: repoName });

        // Get branches (limited to avoid rate limits)
        const { data: branchesData } = await octokit.repos.listBranches({
          owner: OWNER,
          repo: repoName,
          per_page: 30,
        });

        // Get recent PRs
        const { data: prsData } = await octokit.pulls.list({
          owner: OWNER,
          repo: repoName,
          state: 'all',
          per_page: 10,
          sort: 'updated',
          direction: 'desc',
        });

        // Categorize branches
        const branches = {
          main: branchesData.find((b) => b.name === 'main'),
          develop: branchesData.find((b) => b.name === 'develop'),
          features: branchesData.filter((b) => b.name.startsWith('feature/')),
          checkpoints: branchesData.filter((b) => b.name.startsWith('cp-')),
          others: branchesData.filter(
            (b) => !['main', 'develop'].includes(b.name) && !b.name.startsWith('feature/') && !b.name.startsWith('cp-')
          ),
        };

        return {
          repo: {
            name: repo.name,
            description: repo.description,
            defaultBranch: repo.default_branch,
            updatedAt: repo.updated_at,
            pushedAt: repo.pushed_at,
          },
          branches: {
            total: branchesData.length,
            main: branches.main?.name || null,
            develop: branches.develop?.name || null,
            featureCount: branches.features.length,
            checkpointCount: branches.checkpoints.length,
            features: branches.features.map((b) => b.name),
            checkpoints: branches.checkpoints.map((b) => b.name),
          },
          recentPrs: prsData.slice(0, 5).map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: pr.merged_at ? 'merged' : pr.state,
            author: pr.user?.login || 'Unknown',
            createdAt: pr.created_at,
            mergedAt: pr.merged_at,
            headBranch: pr.head.ref,
            baseBranch: pr.base.ref,
            url: pr.html_url,
          })),
        };
      })
    );

    res.json({ success: true, data: panorama });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch panorama' });
  }
});

// GET /api/github/repos/:repo/commits - Get commit history for branch graph
router.get('/repos/:repo/commits', async (req, res) => {
  try {
    const { repo } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

    // Fetch commits from main and develop branches
    const fetchBranchCommits = async (branch: string) => {
      try {
        const { data } = await octokit.repos.listCommits({
          owner: OWNER,
          repo,
          sha: branch,
          per_page: limit,
        });
        return data.map((commit) => ({
          sha: commit.sha.substring(0, 7),
          fullSha: commit.sha,
          message: commit.commit.message.split('\n')[0],
          author: commit.commit.author?.name || 'Unknown',
          date: commit.commit.author?.date || '',
          parents: commit.parents.map((p) => p.sha.substring(0, 7)),
        }));
      } catch {
        return [];
      }
    };

    const [mainCommits, developCommits] = await Promise.all([
      fetchBranchCommits('main'),
      fetchBranchCommits('develop'),
    ]);

    // Find merge points (commits that appear in both branches)
    const mainShas = new Set(mainCommits.map((c) => c.fullSha));
    const mergePoints = developCommits
      .filter((c) => mainShas.has(c.fullSha))
      .map((c) => c.sha);

    res.json({
      success: true,
      data: {
        main: mainCommits,
        develop: developCommits,
        mergePoints,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch commits' });
  }
});

// Helper: Extract feature name from PR title or branch name
function extractFeatureName(title: string, branch: string): string {
  // Try PR title: feat(xxx): or fix(xxx):
  const titleMatch = title.match(/^(?:feat|fix|refactor|chore)\(([^)]+)\):/i);
  if (titleMatch) {
    return titleMatch[1].toLowerCase();
  }

  // Try branch name: cp-xxx-yyy or feature/xxx
  const branchMatch = branch.match(/^(?:cp-\d+-)?([a-z]+)/i) || branch.match(/^feature\/([^/]+)/i);
  if (branchMatch) {
    return branchMatch[1].toLowerCase();
  }

  return 'other';
}

// GET /api/github/repos/:repo/features - Get PRs grouped by feature
router.get('/repos/:repo/features', async (req, res) => {
  try {
    const { repo } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    // Fetch all PRs
    const { data: prsData } = await octokit.pulls.list({
      owner: OWNER,
      repo,
      state: 'all',
      per_page: limit,
      sort: 'updated',
      direction: 'desc',
    });

    // Group by feature
    const featureMap = new Map<string, PrInfo[]>();

    prsData.forEach((pr) => {
      const featureName = extractFeatureName(pr.title, pr.head.ref);
      const prInfo: PrInfo = {
        number: pr.number,
        title: pr.title,
        state: pr.merged_at ? 'merged' : pr.state,
        author: pr.user?.login || 'Unknown',
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        mergedAt: pr.merged_at,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        url: pr.html_url,
      };

      if (!featureMap.has(featureName)) {
        featureMap.set(featureName, []);
      }
      featureMap.get(featureName)!.push(prInfo);
    });

    // Convert to array and sort by PR count
    const features = Array.from(featureMap.entries())
      .map(([name, prs]) => ({
        name,
        displayName: name.charAt(0).toUpperCase() + name.slice(1),
        prs: prs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        latestPr: prs[0],
      }))
      .sort((a, b) => b.prs.length - a.prs.length);

    res.json({ success: true, data: { features } });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch features' });
  }
});

export default router;
