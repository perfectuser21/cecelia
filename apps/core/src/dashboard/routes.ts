/**
 * Dashboard REST API Routes
 * Base path: /api/cecelia
 */

import { Router, Request, Response } from 'express';
import { taskTracker } from './services/task-tracker.js';
// @ts-expect-error - intent.js is untyped
import { parseIntent, parseAndCreate, INTENT_TYPES } from '../brain/intent.js';

/**
 * Extract error message from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error occurred';
}
import type {
  CreateRunRequest,
  UpdateCheckpointRequest,
  CreateRunResponse,
  UpdateCheckpointResponse,
  GetRunResponse,
  GetOverviewResponse,
  ErrorResponse,
} from './types.js';

const router = Router();

/**
 * POST /api/cecelia/runs
 * Create a new task run
 */
router.post('/runs', (req: Request, res: Response) => {
  try {
    const body = req.body as CreateRunRequest;

    if (!body.prd_path || !body.project || !body.feature_branch || !body.total_checkpoints) {
      const error: ErrorResponse = {
        success: false,
        error: 'Missing required fields: prd_path, project, feature_branch, total_checkpoints',
      };
      return res.status(400).json(error);
    }

    const run = taskTracker.createRun(body);

    const response: CreateRunResponse = {
      success: true,
      run_id: run.id,
      run,
    };

    return res.status(201).json(response);
  } catch (error: unknown) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: getErrorMessage(error),
    };
    return res.status(500).json(errorResponse);
  }
});

/**
 * GET /api/cecelia/runs/:id
 * Get run details with checkpoints
 */
router.get('/runs/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const run = taskTracker.getRun(id);

    if (!run) {
      const error: ErrorResponse = {
        success: false,
        error: `Run not found: ${id}`,
      };
      return res.status(404).json(error);
    }

    const checkpoints = taskTracker.getCheckpoints(id);

    const response: GetRunResponse = {
      success: true,
      run,
      checkpoints,
    };

    return res.json(response);
  } catch (error: unknown) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: getErrorMessage(error),
    };
    return res.status(500).json(errorResponse);
  }
});

/**
 * PATCH /api/cecelia/runs/:runId/checkpoints/:checkpointId
 * Update checkpoint status
 */
router.patch('/runs/:runId/checkpoints/:checkpointId', (req: Request, res: Response) => {
  try {
    const { runId, checkpointId } = req.params;
    const body = req.body as UpdateCheckpointRequest;

    if (!body.status) {
      const error: ErrorResponse = {
        success: false,
        error: 'Missing required field: status',
      };
      return res.status(400).json(error);
    }

    const run = taskTracker.getRun(runId);
    if (!run) {
      const error: ErrorResponse = {
        success: false,
        error: `Run not found: ${runId}`,
      };
      return res.status(404).json(error);
    }

    const checkpoint = taskTracker.updateCheckpoint(runId, checkpointId, body);

    if (!checkpoint) {
      const error: ErrorResponse = {
        success: false,
        error: `Failed to update checkpoint: ${checkpointId}`,
      };
      return res.status(500).json(error);
    }

    const response: UpdateCheckpointResponse = {
      success: true,
      checkpoint,
    };

    return res.json(response);
  } catch (error: unknown) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: getErrorMessage(error),
    };
    return res.status(500).json(errorResponse);
  }
});

/**
 * PATCH /api/cecelia/checkpoints/:checkpointId
 * Update checkpoint status (alternative endpoint for Cecelia callback)
 * Note: Requires run_id in body or query
 */
router.patch('/checkpoints/:checkpointId', (req: Request, res: Response) => {
  try {
    const { checkpointId } = req.params;
    const runId = (req.body.run_id || req.query.run_id) as string;
    const body = req.body as UpdateCheckpointRequest;

    if (!runId) {
      const error: ErrorResponse = {
        success: false,
        error: 'Missing required field: run_id',
      };
      return res.status(400).json(error);
    }

    if (!body.status) {
      const error: ErrorResponse = {
        success: false,
        error: 'Missing required field: status',
      };
      return res.status(400).json(error);
    }

    const checkpoint = taskTracker.updateCheckpoint(runId, checkpointId, body);

    if (!checkpoint) {
      const error: ErrorResponse = {
        success: false,
        error: `Failed to update checkpoint: ${checkpointId}`,
      };
      return res.status(500).json(error);
    }

    const response: UpdateCheckpointResponse = {
      success: true,
      checkpoint,
    };

    return res.json(response);
  } catch (error: unknown) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: getErrorMessage(error),
    };
    return res.status(500).json(errorResponse);
  }
});

/**
 * GET /api/cecelia/seats
 * Get server seat (concurrency slot) status
 */
router.get('/seats', async (_req: Request, res: Response) => {
  try {
    const fs = await import('fs');
    const MAX_SEATS = parseInt(process.env.MAX_CONCURRENT || '8', 10);
    const LOCK_DIR = process.env.LOCK_DIR || '/tmp/cecelia-locks';
    const slots: { slot: number; mode: string; task_id?: string; title?: string; started?: string; duration?: string }[] = [];
    for (let i = 1; i <= MAX_SEATS; i++) {
      const slotDir = `${LOCK_DIR}/slot-${i}`;
      if (fs.existsSync(slotDir)) {
        try {
          const infoPath = `${slotDir}/info.json`;
          if (!fs.existsSync(infoPath)) { slots.push({ slot: i, mode: 'headless' }); continue; }
          const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
          let duration: string | undefined;
          if (info.started) {
            const mins = Math.floor((Date.now() - new Date(info.started).getTime()) / 60000);
            duration = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60}m`;
          }
          slots.push({
            slot: i,
            mode: info.mode || 'headless',
            task_id: info.task_id,
            title: info.title,
            started: info.started,
            duration,
          });
        } catch {
          slots.push({ slot: i, mode: 'headless' });
        }
      }
    }
    // Enrich slots with task title from DB
    try {
      const dbModule = await import('../task-system/db.js');
      const pool = dbModule.default;
      for (const slot of slots) {
        if (!slot.title && slot.task_id) {
          try {
            const r = await pool.query('SELECT title FROM tasks WHERE id = $1', [slot.task_id]);
            if (r.rows.length > 0) slot.title = r.rows[0].title;
          } catch { /* ignore */ }
        }
      }
    } catch { /* DB not available */ }
    return res.json({ total: MAX_SEATS, active: slots.length, slots });
  } catch (err) {
    return res.json({ total: 8, active: 0, slots: [], error: String(err) });
  }
});

/**
 * GET /api/cecelia/overview
 * Get dashboard overview
 */
router.get('/overview', (req: Request, res: Response) => {
  try {
    const MAX_LIMIT = 100;
    const rawLimit = parseInt(req.query.limit as string, 10) || 10;
    const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT); // Clamp between 1 and 100
    const overview = taskTracker.getOverview(limit);

    const response: GetOverviewResponse = {
      success: true,
      ...overview,
    };

    return res.json(response);
  } catch (error: unknown) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: getErrorMessage(error),
    };
    return res.status(500).json(errorResponse);
  }
});

/**
 * PATCH /api/cecelia/runs/:id/status
 * Update run's realtime status (current action, step, etc.)
 */
router.patch('/runs/:id/status', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { current_action, current_step, step_status, pr_url } = req.body;

    const run = taskTracker.updateRunStatus(id, {
      current_action,
      current_step,
      step_status,
      pr_url,
    });

    if (!run) {
      const error: ErrorResponse = {
        success: false,
        error: `Run not found: ${id}`,
      };
      return res.status(404).json(error);
    }

    return res.json({
      success: true,
      run,
    });
  } catch (error: unknown) {
    const errorResponse: ErrorResponse = {
      success: false,
      error: getErrorMessage(error),
    };
    return res.status(500).json(errorResponse);
  }
});

/**
 * GET /api/cecelia/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/cecelia/chat
 * Front-desk dialogue API: receive natural language → parse intent → execute/reply
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'message is required and must be a string',
      });
    }

    if (message.length > 10000) {
      return res.status(400).json({
        success: false,
        error: 'message too long, maximum 10000 characters',
      });
    }

    // Parse intent
    const parsed = await parseIntent(message);
    const intentType = parsed.intentType;

    const intent = {
      type: intentType,
      confidence: parsed.confidence,
      entities: parsed.entities || {},
    };

    // Execute based on intent type
    const createIntents = [
      INTENT_TYPES.CREATE_TASK,
      INTENT_TYPES.CREATE_GOAL,
      INTENT_TYPES.CREATE_PROJECT,
      INTENT_TYPES.CREATE_FEATURE,
      INTENT_TYPES.FIX_BUG,
      INTENT_TYPES.REFACTOR,
    ];

    if (createIntents.includes(intentType)) {
      // Creation intents: parse and create in database
      const result = await parseAndCreate(message, {
        createProject: intentType === INTENT_TYPES.CREATE_PROJECT || intentType === INTENT_TYPES.CREATE_FEATURE,
        createTasks: true,
      });

      const createdItems = result.created.tasks;
      const itemNames = createdItems.map((t: { title: string }) => t.title).join('、');
      const reply = createdItems.length === 1
        ? `已创建任务「${itemNames}」`
        : `已创建 ${createdItems.length} 个任务：${itemNames}`;

      return res.json({
        success: true,
        reply,
        intent,
        action_result: {
          type: 'created',
          data: createdItems.length === 1 ? createdItems[0] : createdItems,
        },
      });
    }

    if (intentType === INTENT_TYPES.QUERY_STATUS) {
      // Query intent: fetch tasks and goals from database
      const pool = (await import('../task-system/db.js')).default;
      const tasksResult = await pool.query(
        `SELECT id, title, status, priority FROM tasks ORDER BY created_at DESC LIMIT 20`
      );
      const tasks = tasksResult.rows;
      const inProgress = tasks.filter((t: { status: string }) => t.status === 'in_progress').length;
      const queued = tasks.filter((t: { status: string }) => t.status === 'queued').length;

      return res.json({
        success: true,
        reply: `当前有 ${inProgress} 个进行中的任务，${queued} 个排队中`,
        intent,
        action_result: {
          type: 'query',
          data: tasks,
        },
      });
    }

    // Other intents (explore, question, unknown): return parsed intent only
    const reply = intentType === INTENT_TYPES.UNKNOWN
      ? '我不太理解你的意思，可以换个方式描述吗？'
      : `已识别意图：${intentType}（置信度 ${Math.round(parsed.confidence * 100)}%）`;

    return res.json({
      success: true,
      reply,
      intent,
      action_result: null,
    });
  } catch (error: unknown) {
    console.error('[Cecelia Chat] Error:', getErrorMessage(error));
    const errorResponse: ErrorResponse = {
      success: false,
      error: 'Internal error processing message',
    };
    return res.status(500).json(errorResponse);
  }
});

export default router;
