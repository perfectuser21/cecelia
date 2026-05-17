/**
 * N8N API Routes (local implementation)
 * Base path: /api/v1/n8n-workflows and /api/v1/n8n-live-status
 * Replaces the old Autopilot proxy (port 3333)
 * Talks directly to N8N REST API at port 5679
 */

import { Router, Request, Response } from 'express';

const router = Router();

const N8N_URL = process.env.N8N_LOCAL_URL || 'http://localhost:5679';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

async function n8nFetch(path: string): Promise<any> {
  const res = await fetch(`${N8N_URL}/api/v1${path}`, {
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`N8N API error: ${res.status}`);
  return res.json();
}

// ===================== N8N Workflows API =====================

/**
 * GET /api/v1/n8n-workflows/instances/status
 */
router.get('/n8n-workflows/instances/status', async (_req: Request, res: Response) => {
  let localAvailable = false;
  try {
    await n8nFetch('/workflows?limit=1');
    localAvailable = true;
  } catch { /* N8N not reachable */ }

  res.json({
    cloud: { available: false, name: 'Cloud (disabled)' },
    local: { available: localAvailable, name: 'Local N8N' },
  });
});

/**
 * GET /api/v1/n8n-workflows/instances/:instance/overview
 */
router.get('/n8n-workflows/instances/:instance/overview', async (req: Request, res: Response) => {
  try {
    if (req.params.instance === 'cloud') {
      return res.json({
        workflows: { totalWorkflows: 0, activeWorkflows: 0, inactiveWorkflows: 0, workflows: [], timestamp: Date.now() },
        recentExecutions: { total: 0, success: 0, error: 0, running: 0, successRate: 0, executions: [], timestamp: Date.now() },
        timestamp: Date.now(),
      });
    }

    const [wfData, exData] = await Promise.all([
      n8nFetch('/workflows'),
      n8nFetch('/executions?limit=20'),
    ]);

    const workflows = (wfData.data || []).map((w: any) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      tags: w.tags || [],
      runStats: {
        runningCount: 0,
        recentStats: { total: 0, success: 0, error: 0, successRate: 0 },
      },
    }));

    const executions = (exData.data || []).map(mapExecution);
    const success = executions.filter((e: any) => e.status === 'success').length;
    const error = executions.filter((e: any) => e.status === 'error').length;
    const running = executions.filter((e: any) => e.status === 'running').length;

    res.json({
      workflows: {
        totalWorkflows: workflows.length,
        activeWorkflows: workflows.filter((w: any) => w.active).length,
        inactiveWorkflows: workflows.filter((w: any) => !w.active).length,
        workflows,
        timestamp: Date.now(),
      },
      recentExecutions: {
        total: executions.length,
        success,
        error,
        running,
        successRate: executions.length > 0 ? Math.round((success / executions.length) * 100) : 0,
        executions,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/**
 * GET /api/v1/n8n-workflows/instances/:instance/workflows
 */
router.get('/n8n-workflows/instances/:instance/workflows', async (req: Request, res: Response) => {
  try {
    if (req.params.instance === 'cloud') {
      return res.json({ totalWorkflows: 0, activeWorkflows: 0, inactiveWorkflows: 0, workflows: [], timestamp: Date.now() });
    }

    const data = await n8nFetch('/workflows');
    const workflows = (data.data || []).map((w: any) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      tags: w.tags || [],
      runStats: {
        runningCount: 0,
        recentStats: { total: 0, success: 0, error: 0, successRate: 0 },
      },
    }));

    res.json({
      totalWorkflows: workflows.length,
      activeWorkflows: workflows.filter((w: any) => w.active).length,
      inactiveWorkflows: workflows.filter((w: any) => !w.active).length,
      workflows,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/**
 * GET /api/v1/n8n-workflows/instances/:instance/workflows/:id
 */
router.get('/n8n-workflows/instances/:instance/workflows/:id', async (req: Request, res: Response) => {
  try {
    const data = await n8nFetch(`/workflows/${req.params.id}`);
    const nodes = (data.nodes || []).map((n: any) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      position: n.position || [0, 0],
    }));

    // Detect trigger type
    let triggerType: string = 'manual';
    let triggerInfo: string | undefined;
    const triggerNode = nodes.find((n: any) =>
      n.type.includes('webhook') || n.type.includes('schedule') || n.type.includes('cron')
    );
    if (triggerNode) {
      if (triggerNode.type.includes('webhook')) {
        triggerType = 'webhook';
        triggerInfo = 'Webhook trigger';
      } else if (triggerNode.type.includes('schedule') || triggerNode.type.includes('cron')) {
        triggerType = 'schedule';
        triggerInfo = 'Scheduled trigger';
      }
    }

    res.json({
      id: data.id,
      name: data.name,
      active: data.active,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      tags: data.tags || [],
      nodes,
      nodeCount: nodes.length,
      triggerType,
      triggerInfo,
      instance: req.params.instance,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/**
 * GET /api/v1/n8n-workflows/instances/:instance/workflows/:id/executions
 */
router.get('/n8n-workflows/instances/:instance/workflows/:id/executions', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const data = await n8nFetch(`/executions?workflowId=${req.params.id}&limit=${limit}`);
    const executions = (data.data || []).map(mapExecution);
    const success = executions.filter((e: any) => e.status === 'success').length;
    const error = executions.filter((e: any) => e.status === 'error').length;

    res.json({
      total: executions.length,
      success,
      error,
      running: executions.filter((e: any) => e.status === 'running').length,
      successRate: executions.length > 0 ? Math.round((success / executions.length) * 100) : 0,
      executions,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

// Legacy single-instance endpoints (redirect to local)
router.get('/n8n-workflows/overview', async (req: Request, res: Response) => {
  req.params.instance = 'local';
  const handler = router.stack.find(r => r.route?.path === '/n8n-workflows/instances/:instance/overview');
  if (handler) return handler.route?.stack[0].handle(req, res, () => {});
  res.status(404).json({ error: 'Not found' });
});

router.get('/n8n-workflows/workflows', async (req: Request, res: Response) => {
  req.params.instance = 'local';
  const handler = router.stack.find(r => r.route?.path === '/n8n-workflows/instances/:instance/workflows');
  if (handler) return handler.route?.stack[0].handle(req, res, () => {});
  res.status(404).json({ error: 'Not found' });
});

// ===================== N8N Live Status API =====================

/**
 * GET /api/v1/n8n-live-status/instances/status
 */
router.get('/n8n-live-status/instances/status', async (_req: Request, res: Response) => {
  let localAvailable = false;
  try {
    await n8nFetch('/workflows?limit=1');
    localAvailable = true;
  } catch { /* N8N not reachable */ }

  res.json({
    cloud: { available: false, name: 'Cloud (disabled)' },
    local: { available: localAvailable, name: 'Local N8N' },
  });
});

/**
 * GET /api/v1/n8n-live-status/instances/:instance/overview
 */
router.get('/n8n-live-status/instances/:instance/overview', async (req: Request, res: Response) => {
  try {
    if (req.params.instance === 'cloud') {
      return res.json({
        todayStats: { running: 0, success: 0, error: 0, total: 0, successRate: 0 },
        runningExecutions: [],
        recentCompleted: [],
        timestamp: Date.now(),
      });
    }

    // Get recent executions
    const data = await n8nFetch('/executions?limit=50');
    const allExecs = (data.data || []).map(mapExecution);

    // Today's executions
    const today = new Date().toISOString().split('T')[0];
    const todayExecs = allExecs.filter((e: any) => e.startedAt?.startsWith(today));
    const success = todayExecs.filter((e: any) => e.status === 'success').length;
    const error = todayExecs.filter((e: any) => e.status === 'error').length;
    const running = todayExecs.filter((e: any) => e.status === 'running').length;

    // Running executions with details
    const runningExecutions = allExecs
      .filter((e: any) => e.status === 'running' || e.status === 'waiting')
      .map((e: any) => ({
        id: e.id,
        workflowId: e.workflowId,
        workflowName: e.workflowName || `Workflow ${e.workflowId}`,
        startedAt: e.startedAt,
        duration: e.startedAt ? Math.floor((Date.now() - new Date(e.startedAt).getTime()) / 1000) : 0,
      }));

    // Recent completed
    const recentCompleted = allExecs
      .filter((e: any) => e.status === 'success' || e.status === 'error')
      .slice(0, 10)
      .map((e: any) => ({
        ...e,
        duration: e.startedAt && e.stoppedAt
          ? Math.floor((new Date(e.stoppedAt).getTime() - new Date(e.startedAt).getTime()) / 1000)
          : undefined,
      }));

    res.json({
      todayStats: {
        running,
        success,
        error,
        total: todayExecs.length,
        successRate: todayExecs.length > 0 ? Math.round((success / todayExecs.length) * 100) : 0,
      },
      runningExecutions,
      recentCompleted,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

/**
 * GET /api/v1/n8n-live-status/instances/:instance/executions/:executionId
 */
router.get('/n8n-live-status/instances/:instance/executions/:executionId', async (req: Request, res: Response) => {
  try {
    const data = await n8nFetch(`/executions/${req.params.executionId}`);

    res.json({
      id: data.id,
      workflowId: data.workflowId?.toString() || '',
      workflowName: data.workflowName,
      status: mapStatus(data.status),
      mode: data.mode || 'manual',
      startedAt: data.startedAt,
      stoppedAt: data.stoppedAt,
      finished: data.finished ?? true,
      duration: data.startedAt && data.stoppedAt
        ? Math.floor((new Date(data.stoppedAt).getTime() - new Date(data.startedAt).getTime()) / 1000)
        : undefined,
      errorMessage: data.data?.resultData?.error?.message,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(502).json({ error: message });
  }
});

// ===================== Helpers =====================

function mapStatus(status: string): string {
  const statusMap: Record<string, string> = {
    success: 'success',
    error: 'error',
    crashed: 'crashed',
    waiting: 'waiting',
    running: 'running',
    new: 'running',
  };
  return statusMap[status] || status;
}

function mapExecution(e: any) {
  return {
    id: e.id?.toString() || '',
    workflowId: e.workflowId?.toString() || '',
    status: mapStatus(e.status),
    startedAt: e.startedAt || '',
    stoppedAt: e.stoppedAt || undefined,
    mode: e.mode || 'manual',
    finished: e.finished ?? true,
    workflowName: e.workflowName,
  };
}

export default router;
