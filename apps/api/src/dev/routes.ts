/**
 * Dev Task Tracker REST API Routes
 * Base path: /api/dev
 */

import { Router, Request, Response } from 'express';
import {
  getRepoStatus,
  getAllTasks,
  updateStepStatus,
  resetSteps,
  getTrackedRepos,
} from '../dashboard/services/dev-tracker.js';
import type { StepStatus } from '../shared/types.js';

const router = Router();

// Whitelist of allowed repositories
const ALLOWED_REPOS = ['zenithjoy-engine', 'cecelia-workspace'];

// Step validation bounds
const MIN_STEP = 1;
const MAX_STEP = 10;

/**
 * Validate repo name against whitelist
 */
function isValidRepo(repo: string): boolean {
  return ALLOWED_REPOS.includes(repo);
}

/**
 * Validate step number is within bounds
 */
function isValidStep(step: number): boolean {
  return Number.isInteger(step) && step >= MIN_STEP && step <= MAX_STEP;
}

interface UpdateStatusBody {
  repo: string;
  step: number;
  status: StepStatus;
}

interface ResetBody {
  repo: string;
  taskName?: string;
}

/**
 * GET /api/dev/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    trackedRepos: getTrackedRepos(),
  });
});

/**
 * GET /api/dev/status?repo=xxx
 * Get status for a single repository
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const repo = req.query.repo as string;

    if (!repo) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameter: repo',
      });
    }

    if (!isValidRepo(repo)) {
      return res.status(400).json({
        success: false,
        error: `Invalid repo. Must be one of: ${ALLOWED_REPOS.join(', ')}`,
      });
    }

    const status = await getRepoStatus(repo);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: `Repository not found or not tracked: ${repo}`,
      });
    }

    return res.json({
      success: true,
      data: status,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/dev/tasks
 * Get all active tasks across all repositories
 */
router.get('/tasks', async (_req: Request, res: Response) => {
  try {
    const tasks = await getAllTasks();

    return res.json({
      success: true,
      data: tasks,
      count: tasks.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/dev/status
 * Update step status for a repository
 * Body: { repo: string, step: number, status: StepStatus }
 */
router.post('/status', async (req: Request, res: Response) => {
  try {
    const { repo, step, status } = req.body as UpdateStatusBody;

    if (!repo || step === undefined || !status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: repo, step, status',
      });
    }

    if (!isValidRepo(repo)) {
      return res.status(400).json({
        success: false,
        error: `Invalid repo. Must be one of: ${ALLOWED_REPOS.join(', ')}`,
      });
    }

    if (!isValidStep(step)) {
      return res.status(400).json({
        success: false,
        error: `Invalid step. Must be an integer between ${MIN_STEP} and ${MAX_STEP}`,
      });
    }

    const validStatuses: StepStatus[] = ['pending', 'in_progress', 'done', 'skipped', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const updatedStep = await updateStepStatus(repo, step, status);

    if (!updatedStep) {
      return res.status(404).json({
        success: false,
        error: `Repository or step not found: ${repo}, step ${step}`,
      });
    }

    return res.json({
      success: true,
      data: updatedStep,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/dev/reset
 * Reset all steps for a repository
 * Body: { repo: string, taskName?: string }
 */
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const { repo, taskName } = req.body as ResetBody;

    if (!repo) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: repo',
      });
    }

    if (!isValidRepo(repo)) {
      return res.status(400).json({
        success: false,
        error: `Invalid repo. Must be one of: ${ALLOWED_REPOS.join(', ')}`,
      });
    }

    await resetSteps(repo, taskName);

    return res.json({
      success: true,
      message: `Steps reset for ${repo}`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/dev/repos
 * Get list of tracked repositories
 */
router.get('/repos', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    data: getTrackedRepos(),
  });
});

export default router;
