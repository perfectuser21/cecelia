/**
 * Engine API Routes
 * Base path: /api/engine
 */

import { Router, Request, Response } from 'express';
import { getEngineInfo, isEngineAccessible } from '../dashboard/services/engine-info.js';

const router = Router();

/**
 * GET /api/engine/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  const accessible = isEngineAccessible();
  return res.json({
    success: true,
    status: accessible ? 'healthy' : 'degraded',
    engineAccessible: accessible,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/engine/info
 * Get complete engine info (version, skills, hooks, changelog)
 */
router.get('/info', (_req: Request, res: Response) => {
  try {
    if (!isEngineAccessible()) {
      return res.status(503).json({
        success: false,
        error: 'Engine not accessible',
      });
    }

    const engineInfo = getEngineInfo();

    return res.json({
      success: true,
      engine: engineInfo,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
