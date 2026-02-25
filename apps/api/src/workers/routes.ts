/**
 * Workers REST API Routes
 * Base path: /api/workers
 */

import { Router, Request, Response } from 'express';
import * as workersConfig from './config.js';
import * as workersService from './service.js';

const router = Router();

/**
 * GET /api/workers
 * Get all departments and workers
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const departments = workersConfig.getDepartments();
    const stats = workersConfig.getStats();

    return res.json({
      success: true,
      data: {
        departments,
        totalWorkers: stats.totalWorkers,
        totalAbilities: stats.totalAbilities,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/workers/:workerId
 * Get worker details with matched workflows
 */
router.get('/:workerId', async (req: Request, res: Response) => {
  try {
    const { workerId } = req.params;
    const result = await workersService.getWorkerDetail(workerId);

    if (!result.data) {
      return res.status(404).json({
        success: false,
        error: `Worker not found: ${workerId}`,
      });
    }

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/workers/:workerId/workflows
 * Get workflows matched to a worker
 */
router.get('/:workerId/workflows', async (req: Request, res: Response) => {
  try {
    const { workerId } = req.params;
    const result = await workersService.getWorkerWorkflows(workerId);

    if (!result.data) {
      return res.status(404).json({
        success: false,
        error: `Worker not found: ${workerId}`,
      });
    }

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/workers/match/:workflowName
 * Find worker by workflow name
 */
router.get('/match/:workflowName', (req: Request, res: Response) => {
  try {
    const { workflowName } = req.params;
    const result = workersService.findWorkerByWorkflowName(decodeURIComponent(workflowName));

    if (!result) {
      return res.json({
        success: true,
        data: null,
        message: 'No worker matched for this workflow',
      });
    }

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
