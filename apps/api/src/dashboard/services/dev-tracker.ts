/**
 * Dev Task Tracker Service
 * Tracks development workflow progress across multiple repositories
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  DevTaskStatus,
  StepItem,
  StepStatus,
  BranchType,
  CIStatus,
} from '../../shared/types.js';
import { DEV_WORKFLOW_STEPS } from '../../shared/types.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repository paths - 通过环境变量配置基础路径，支持 dev/prod 分离
const CODE_BASE = process.env.CODE_BASE_PATH || '/home/xx/dev';
const REPO_PATHS: Record<string, string> = {
  'zenithjoy-engine': `${CODE_BASE}/zenithjoy-engine`,
  'cecelia-workspace': `${CODE_BASE}/cecelia-workspace`,
};

// Data directory for persisted status
const DATA_DIR = join(__dirname, '../../../data/dev-status');

interface PersistedSteps {
  createdAt: string;
  taskName: string;
  items: StepItem[];
}

/**
 * Execute a git command in a specific repository
 * Uses execFile to prevent command injection
 */
async function gitCommand(repoPath: string, args: string): Promise<string> {
  try {
    const argsArray = args.split(/\s+/).filter(Boolean);
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...argsArray], { timeout: 10000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Execute gh CLI command
 * Uses execFile with cwd option to prevent command injection
 */
async function ghCommand(repoPath: string, args: string): Promise<string> {
  try {
    const argsArray = args.split(/\s+/).filter(Boolean);
    const { stdout } = await execFileAsync('gh', argsArray, { cwd: repoPath, timeout: 15000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Determine branch type from branch name
 */
function getBranchType(branchName: string): BranchType {
  if (branchName === 'main' || branchName === 'master') return 'main';
  if (branchName === 'develop') return 'develop';
  if (branchName.startsWith('feature/')) return 'feature';
  if (branchName.startsWith('cp-')) return 'cp';
  return 'unknown';
}

/**
 * Get persisted file path for a repository
 */
function getPersistedPath(repoName: string): string {
  return join(DATA_DIR, `${repoName}.json`);
}

/**
 * Load persisted steps for a repository
 */
async function loadPersistedSteps(repoName: string): Promise<PersistedSteps | null> {
  const filePath = getPersistedPath(repoName);
  try {
    if (!existsSync(filePath)) return null;
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save persisted steps for a repository
 */
async function savePersistedSteps(repoName: string, data: PersistedSteps): Promise<void> {
  const filePath = getPersistedPath(repoName);
  try {
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }
    await writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Failed to save persisted steps for ${repoName}:`, err);
  }
}

/**
 * Create default step items from workflow steps
 */
function createDefaultSteps(): StepItem[] {
  return DEV_WORKFLOW_STEPS.map((step) => ({
    id: step.id,
    name: step.name,
    status: 'pending' as StepStatus,
  }));
}

/**
 * Get PR info from gh CLI
 */
async function getPRInfo(repoPath: string): Promise<{
  number: number | null;
  url: string | null;
  state: 'open' | 'closed' | 'merged' | null;
  ci: CIStatus;
}> {
  const result = { number: null as number | null, url: null as string | null, state: null as 'open' | 'closed' | 'merged' | null, ci: 'unknown' as CIStatus };

  try {
    const prJson = await ghCommand(repoPath, 'pr view --json number,url,state,statusCheckRollup');
    if (!prJson) return result;

    const pr = JSON.parse(prJson);
    result.number = pr.number || null;
    result.url = pr.url || null;
    result.state = pr.state?.toLowerCase() || null;

    // Parse CI status from statusCheckRollup
    if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
      const statuses = pr.statusCheckRollup.map((c: { conclusion?: string; state?: string }) => c.conclusion || c.state);
      if (statuses.some((s: string) => s === 'FAILURE' || s === 'ERROR')) {
        result.ci = 'failed';
      } else if (statuses.some((s: string) => s === 'PENDING' || s === 'IN_PROGRESS')) {
        result.ci = 'running';
      } else if (statuses.every((s: string) => s === 'SUCCESS')) {
        result.ci = 'passed';
      }
    }
  } catch {
    // PR doesn't exist or gh CLI error
  }

  return result;
}

/**
 * Get status for a single repository
 */
export async function getRepoStatus(repoName: string): Promise<DevTaskStatus | null> {
  const repoPath = REPO_PATHS[repoName];
  if (!repoPath || !existsSync(repoPath)) return null;

  // Get git info
  const [currentBranch, remoteUrl] = await Promise.all([
    gitCommand(repoPath, 'branch --show-current'),
    gitCommand(repoPath, 'remote get-url origin'),
  ]);

  if (!currentBranch) return null;

  const branchType = getBranchType(currentBranch);

  // Load persisted steps
  const persisted = await loadPersistedSteps(repoName);
  const steps = persisted?.items || createDefaultSteps();
  const taskName = persisted?.taskName || currentBranch;
  const createdAt = persisted?.createdAt || new Date().toISOString();

  // Get PR info
  const prInfo = await getPRInfo(repoPath);

  // Calculate current step
  const currentStepIndex = steps.findIndex((s) => s.status === 'in_progress');
  const currentStep = currentStepIndex >= 0 ? currentStepIndex + 1 :
    steps.findIndex((s) => s.status === 'pending') + 1 || steps.length;

  return {
    repo: {
      name: repoName,
      path: repoPath,
      remoteUrl,
    },
    branches: {
      main: 'main',
      develop: 'develop',
      feature: branchType === 'feature' ? currentBranch : null,
      current: currentBranch,
      type: branchType,
    },
    task: {
      name: taskName,
      createdAt,
      prNumber: prInfo.number,
      prUrl: prInfo.url,
      prState: prInfo.state,
    },
    steps: {
      current: currentStep,
      total: DEV_WORKFLOW_STEPS.length,
      items: steps,
    },
    quality: {
      ci: prInfo.ci,
      codex: 'unknown',
      lastCheck: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get all active tasks across all repositories
 */
export async function getAllTasks(): Promise<DevTaskStatus[]> {
  const tasks: DevTaskStatus[] = [];

  for (const repoName of Object.keys(REPO_PATHS)) {
    const status = await getRepoStatus(repoName);
    if (status && status.branches.type !== 'main' && status.branches.type !== 'develop') {
      tasks.push(status);
    }
  }

  return tasks;
}

/**
 * Update step status for a repository
 */
export async function updateStepStatus(
  repoName: string,
  stepId: number,
  status: StepStatus
): Promise<StepItem | null> {
  const repoPath = REPO_PATHS[repoName];
  if (!repoPath) return null;

  // Load or create persisted steps
  let persisted = await loadPersistedSteps(repoName);

  if (!persisted) {
    const currentBranch = await gitCommand(repoPath, 'branch --show-current');
    persisted = {
      createdAt: new Date().toISOString(),
      taskName: currentBranch || repoName,
      items: createDefaultSteps(),
    };
  }

  // Find and update the step
  const step = persisted.items.find((s) => s.id === stepId);
  if (!step) return null;

  step.status = status;

  if (status === 'in_progress' && !step.startedAt) {
    step.startedAt = new Date().toISOString();
  }

  if (status === 'done' || status === 'failed' || status === 'skipped') {
    step.completedAt = new Date().toISOString();
  }

  // Save updated steps
  await savePersistedSteps(repoName, persisted);

  return step;
}

/**
 * Reset all steps for a repository
 */
export async function resetSteps(repoName: string, taskName?: string): Promise<void> {
  const repoPath = REPO_PATHS[repoName];
  if (!repoPath) return;

  const currentBranch = await gitCommand(repoPath, 'branch --show-current');

  const persisted: PersistedSteps = {
    createdAt: new Date().toISOString(),
    taskName: taskName || currentBranch || repoName,
    items: createDefaultSteps(),
  };

  await savePersistedSteps(repoName, persisted);
}

/**
 * Get list of tracked repositories
 */
export function getTrackedRepos(): string[] {
  return Object.keys(REPO_PATHS);
}
