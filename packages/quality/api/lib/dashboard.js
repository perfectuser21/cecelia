/**
 * Dashboard Module - Data aggregation for frontend
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getAllRepos, getRepoById } from './registry.js';
import { getContractByRepoId } from './contracts.js';

const PROJECT_ROOT = join(import.meta.dirname, '../..');
const QUALITY_RUNS_DIR = join(PROJECT_ROOT, 'quality-runs');

/**
 * Get health status for a repo based on latest run
 */
function getRepoHealth(repoId) {
  if (!existsSync(QUALITY_RUNS_DIR)) {
    return { health: 'unknown', lastRun: null };
  }

  try {
    const runs = readdirSync(QUALITY_RUNS_DIR)
      .map(runId => {
        const runPath = join(QUALITY_RUNS_DIR, runId, 'run.json');
        if (!existsSync(runPath)) return null;

        try {
          const run = JSON.parse(readFileSync(runPath, 'utf-8'));
          if (run.repoId !== repoId) return null;

          return {
            ...run,
            mtime: statSync(join(QUALITY_RUNS_DIR, runId)).mtime.getTime(),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);

    if (runs.length === 0) {
      return { health: 'unknown', lastRun: null };
    }

    const latest = runs[0];
    const health = latest.status === 'passed' ? 'green' :
                   latest.status === 'failed' ? 'red' : 'yellow';

    return {
      health,
      lastRun: latest.completedAt || latest.startedAt,
      lastRunId: latest.runId,
      lastStatus: latest.status,
    };
  } catch {
    return { health: 'unknown', lastRun: null };
  }
}

/**
 * Get dashboard overview
 */
export function getDashboardOverview() {
  const repos = getAllRepos();
  const repoStats = [];

  let healthyCount = 0;
  let failingCount = 0;
  let unknownCount = 0;

  for (const repo of repos) {
    const contract = getContractByRepoId(repo.id);
    const { health, lastRun, lastRunId, lastStatus } = getRepoHealth(repo.id);

    const rciTotal = contract?.rcis?.length || 0;

    // Count health
    if (health === 'green') healthyCount++;
    else if (health === 'red') failingCount++;
    else unknownCount++;

    repoStats.push({
      id: repo.id,
      name: repo.name,
      type: repo.type,
      priority: repo.priority,
      enabled: repo.enabled,
      health,
      lastRun,
      lastRunId,
      lastStatus,
      rciTotal,
      rciPassed: health === 'green' ? rciTotal : 0,
      rciFailed: health === 'red' ? rciTotal : 0,
    });
  }

  return {
    repos: repoStats,
    summary: {
      totalRepos: repos.length,
      healthyRepos: healthyCount,
      failingRepos: failingCount,
      unknownRepos: unknownCount,
      lastFullScan: null, // TODO: track full scan times
    },
  };
}

/**
 * Get detailed dashboard data for a single repo
 */
export function getRepoDashboard(repoId) {
  const repo = getRepoById(repoId);
  if (!repo) return null;

  const contract = getContractByRepoId(repoId);
  const { health, lastRun, lastRunId, lastStatus } = getRepoHealth(repoId);

  // Get recent runs
  const recentRuns = getRecentRuns(repoId, 10);

  return {
    repo: {
      id: repo.id,
      name: repo.name,
      type: repo.type,
      path: repo.path,
      gitUrl: repo.git_url,
      mainBranch: repo.main_branch,
      priority: repo.priority,
      enabled: repo.enabled,
    },
    health,
    lastRun,
    lastStatus,
    contract: contract ? {
      version: contract.version,
      lastUpdated: contract.lastUpdated,
      rciCount: contract.rcis?.length || 0,
      goldenPathCount: contract.goldenPaths?.length || 0,
    } : null,
    rcis: contract?.rcis || [],
    recentRuns,
  };
}

/**
 * Get recent runs for a repo
 */
function getRecentRuns(repoId, limit = 10) {
  if (!existsSync(QUALITY_RUNS_DIR)) {
    return [];
  }

  try {
    return readdirSync(QUALITY_RUNS_DIR)
      .map(runId => {
        const runPath = join(QUALITY_RUNS_DIR, runId, 'run.json');
        if (!existsSync(runPath)) return null;

        try {
          const run = JSON.parse(readFileSync(runPath, 'utf-8'));
          if (run.repoId !== repoId) return null;

          return {
            runId: run.runId,
            status: run.status,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            rciResults: run.rciResults?.length || 0,
            mtime: statSync(join(QUALITY_RUNS_DIR, runId)).mtime.getTime(),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map(({ mtime, ...rest }) => rest);
  } catch {
    return [];
  }
}

/**
 * Get history/trend data
 */
export function getDashboardHistory(days = 7) {
  // TODO: Implement trend tracking
  return {
    message: 'History tracking not yet implemented',
    days,
  };
}
