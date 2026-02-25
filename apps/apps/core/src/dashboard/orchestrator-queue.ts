/**
 * Orchestrator Queue Management API
 * Manages task queue (queued tasks + running tasks)
 *
 * Note: This is a lightweight queue manager for voice control.
 * Actual task execution is handled by the Executor service.
 */

import { Router, Request, Response } from 'express';

const router = Router();

// Type definitions
interface QueuedTask {
  id: string;
  title: string;
  priority?: string;
  prd_path?: string;
  created_at?: string;
  [key: string]: any;
}

interface RunningTask extends QueuedTask {
  status: 'running';
  started_at: string;
  slot: string;
  progress?: number;
}

// Queue management (in-memory storage)
const MAX_SLOTS = parseInt(process.env.MAX_CONCURRENT || '8', 10);
const taskQueue: QueuedTask[] = [];  // Queued tasks waiting for execution
const runningTasks = new Map<string, RunningTask>();  // Tasks currently running (task_id -> task_info)

/**
 * GET /api/orchestrator/queue
 * Get current queue status
 */
router.get('/queue', (_req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: {
        queued: taskQueue,
        running: Array.from(runningTasks.values()),
        stats: {
          queued_count: taskQueue.length,
          running_count: runningTasks.size,
          available_slots: MAX_SLOTS - runningTasks.size
        }
      }
    });
  } catch (error) {
    console.error('[Queue] Error getting queue:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get queue'
    });
  }
});

/**
 * POST /api/orchestrator/execute-now/:id
 * Move task to front of queue and execute immediately if slots available
 */
router.post('/execute-now/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Find task in queue
    const taskIndex = taskQueue.findIndex(t => t.id === id);
    if (taskIndex === -1) {
      return res.status(404).json({
        success: false,
        error: `Task not found in queue: ${id}`
      });
    }

    const task = taskQueue[taskIndex];

    // If slots available, start execution immediately
    if (runningTasks.size < MAX_SLOTS) {
      // Remove from queue
      taskQueue.splice(taskIndex, 1);

      // Add to running tasks
      const runningTask: RunningTask = {
        ...task,
        status: 'running' as const,
        started_at: new Date().toISOString(),
        slot: `slot-${runningTasks.size + 1}`
      };
      runningTasks.set(task.id, runningTask);

      // NOTE: Actual execution is handled by the Executor service (separate component).
      // This endpoint only manages the queue state. Future integration will call:
      // await fetch('http://localhost:5230/execute', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ task_id: task.id, prd_path: task.prd_path })
      // });
      // For now, tasks are marked as "running" for queue visualization purposes.

      return res.json({
        success: true,
        data: {
          task_id: task.id,
          slot: runningTask.slot,
          message: '已插队，正在执行'
        }
      });
    } else {
      // No slots available, move to front of queue
      taskQueue.splice(taskIndex, 1);
      taskQueue.unshift(task);

      return res.json({
        success: true,
        data: {
          task_id: task.id,
          position: 0,
          message: '已插队到第 1 位，等待空闲槽位'
        }
      });
    }
  } catch (error) {
    console.error('[Queue] Error executing task:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute task'
    });
  }
});

/**
 * POST /api/orchestrator/pause/:id
 * Pause a running task and release its slot
 */
router.post('/pause/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const task = runningTasks.get(id);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: `Task not running: ${id}`
      });
    }

    // Remove from running tasks
    const slot = task.slot;
    runningTasks.delete(id);

    // NOTE: Actual task termination is handled by the Executor service.
    // Future integration will call:
    // await fetch(`http://localhost:5230/stop/${id}`, { method: 'POST' });

    return res.json({
      success: true,
      data: {
        task_id: id,
        released_slot: slot,
        message: '任务已暂停'
      }
    });
  } catch (error) {
    console.error('[Queue] Error pausing task:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to pause task'
    });
  }
});

export default router;
