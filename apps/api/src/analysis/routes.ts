/**
 * Analysis API Routes
 * Base path: /api/analysis
 */

import { Router, Request, Response } from 'express';
import { historicalDropoffAnalyzer } from './historical-dropoff.js';

const router = Router();

/**
 * Extract error message from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error occurred';
}

/**
 * GET /api/analysis/cohorts
 * Get cohort analysis data
 */
router.get('/cohorts', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, groupBy } = req.query;

    const cohorts = await historicalDropoffAnalyzer.analyzeCohorts({
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      groupBy: (groupBy as 'week' | 'month') || 'week',
    });

    return res.json({
      success: true,
      data: cohorts,
    });
  } catch (error: unknown) {
    console.error('[Analysis API] Cohort analysis error:', getErrorMessage(error));
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
});

/**
 * GET /api/analysis/funnel
 * Get funnel analysis data
 */
router.get('/funnel', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    const funnel = await historicalDropoffAnalyzer.analyzeFunnel({
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });

    return res.json({
      success: true,
      data: funnel,
    });
  } catch (error: unknown) {
    console.error('[Analysis API] Funnel analysis error:', getErrorMessage(error));
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
});

/**
 * GET /api/analysis/dropoff
 * Get drop-off moment data
 */
router.get('/dropoff', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, minRiskScore } = req.query;

    const dropoffs = await historicalDropoffAnalyzer.analyzeDropoffs({
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      minRiskScore: minRiskScore ? parseFloat(minRiskScore as string) : 0.5,
    });

    return res.json({
      success: true,
      data: dropoffs,
    });
  } catch (error: unknown) {
    console.error('[Analysis API] Drop-off analysis error:', getErrorMessage(error));
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
});

/**
 * GET /api/analysis/complete
 * Get complete historical drop-off analysis
 */
router.get('/complete', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    const analysis = await historicalDropoffAnalyzer.analyzeAll(
      startDate as string | undefined,
      endDate as string | undefined
    );

    return res.json({
      success: true,
      data: analysis,
    });
  } catch (error: unknown) {
    console.error('[Analysis API] Complete analysis error:', getErrorMessage(error));
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
});

/**
 * GET /api/analysis/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

export default router;
