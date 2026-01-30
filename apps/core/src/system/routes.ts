/**
 * System Status API Routes
 * Base path: /api/system
 *
 * Aggregates status from all subsystems:
 * - Brain (semantic-brain): Decision, Focus, Tick, Tasks
 * - Quality (cecelia-quality): QA queue, runs
 * - Workflows (N8N): Active workers, pending tasks
 */

import { Router, Request, Response } from 'express';

const router = Router();

// Service endpoints
const BRAIN_API = process.env.BRAIN_API || 'http://localhost:5220';
const QUALITY_API = process.env.QUALITY_API || 'http://localhost:5681';
const N8N_API = process.env.N8N_BACKEND || 'http://localhost:5678';

// Cache configuration
const CACHE_TTL_MS = 30000; // 30 seconds
let statusCache: { data: any; timestamp: number } | null = null;

interface ServiceStatus {
  health: 'ok' | 'degraded' | 'unavailable';
  [key: string]: any;
}

/**
 * Fetch with timeout and error handling
 */
async function fetchWithTimeout(url: string, timeoutMs: number = 5000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get Brain status from semantic-brain
 */
async function getBrainStatus(): Promise<ServiceStatus> {
  try {
    // Get focus summary
    const focusData = await fetchWithTimeout(`${BRAIN_API}/api/brain/focus/summary`);

    // Get tick status
    const tickData = await fetchWithTimeout(`${BRAIN_API}/api/brain/tick/status`);

    // Get task counts from workspace's own task system
    const tasksResponse = await fetch('http://localhost:5212/api/tasks/tasks');
    const tasksData = await tasksResponse.json() as { tasks?: any[] };

    const tasks = tasksData.tasks || [];
    const taskCounts = {
      p0: tasks.filter((t: any) => t.priority === 'P0' && t.status !== 'completed').length,
      p1: tasks.filter((t: any) => t.priority === 'P1' && t.status !== 'completed').length,
      p2: tasks.filter((t: any) => t.priority === 'P2' && t.status !== 'completed').length,
    };

    return {
      health: 'ok',
      focus: focusData.focus || null,
      tick: {
        enabled: tickData.enabled || false,
        lastTick: tickData.last_tick || null,
      },
      tasks: taskCounts,
    };
  } catch (error) {
    return {
      health: 'unavailable',
      error: error instanceof Error ? error.message : 'Unknown error',
      focus: null,
      tick: null,
      tasks: { p0: 0, p1: 0, p2: 0 },
    };
  }
}

/**
 * Get Quality status from cecelia-quality
 */
async function getQualityStatus(): Promise<ServiceStatus> {
  try {
    const stateData = await fetchWithTimeout(`${QUALITY_API}/api/state`);

    return {
      health: stateData.health || 'ok',
      queueLength: stateData.queueLength || 0,
      lastRun: stateData.lastRun || null,
      stats: stateData.stats || null,
    };
  } catch (error) {
    return {
      health: 'unavailable',
      error: error instanceof Error ? error.message : 'Unknown error',
      queueLength: 0,
      lastRun: null,
      stats: null,
    };
  }
}

/**
 * Get Workflows status from N8N
 */
async function getWorkflowsStatus(): Promise<ServiceStatus> {
  try {
    // N8N health check
    const healthResponse = await fetchWithTimeout(`${N8N_API}/healthz`);

    // Try to get execution count (requires API key in production)
    let activeWorkers = 0;
    let pendingTasks = 0;

    try {
      // This endpoint may require authentication
      const execResponse = await fetchWithTimeout(`${N8N_API}/api/v1/executions?status=running&limit=10`);
      activeWorkers = execResponse.data?.length || 0;

      const waitingResponse = await fetchWithTimeout(`${N8N_API}/api/v1/executions?status=waiting&limit=10`);
      pendingTasks = waitingResponse.data?.length || 0;
    } catch {
      // API may not be accessible without auth, that's ok
    }

    return {
      health: healthResponse.status === 'ok' ? 'ok' : 'degraded',
      activeWorkers,
      pendingTasks,
    };
  } catch (error) {
    return {
      health: 'unavailable',
      error: error instanceof Error ? error.message : 'Unknown error',
      activeWorkers: 0,
      pendingTasks: 0,
    };
  }
}

/**
 * GET /api/system/status
 * Aggregated system status from all subsystems
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    // Check cache
    const now = Date.now();
    if (statusCache && (now - statusCache.timestamp) < CACHE_TTL_MS) {
      return res.json({
        success: true,
        cached: true,
        data: statusCache.data,
      });
    }

    // Fetch all statuses in parallel
    const [brain, quality, workflows] = await Promise.all([
      getBrainStatus(),
      getQualityStatus(),
      getWorkflowsStatus(),
    ]);

    // Determine overall health
    const healths = [brain.health, quality.health, workflows.health];
    let overallHealth: 'ok' | 'degraded' | 'unavailable' = 'ok';
    if (healths.includes('unavailable')) {
      overallHealth = healths.every(h => h === 'unavailable') ? 'unavailable' : 'degraded';
    } else if (healths.includes('degraded')) {
      overallHealth = 'degraded';
    }

    const data = {
      health: overallHealth,
      brain,
      quality,
      workflows,
      timestamp: new Date().toISOString(),
    };

    // Update cache
    statusCache = { data, timestamp: now };

    return res.json({
      success: true,
      cached: false,
      data,
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
 * GET /api/system/health
 * Quick health check for load balancers
 */
router.get('/health', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    status: 'healthy',
    service: 'cecelia-workspace',
    timestamp: new Date().toISOString(),
  });
});

export default router;
