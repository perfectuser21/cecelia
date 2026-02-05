/**
 * Task Event Publisher
 *
 * Publishes task status changes to WebSocket clients
 */

import { broadcast, WS_EVENTS } from '../websocket.js';

/**
 * Publish task created event
 * @param {object} task - Task object
 */
export function publishTaskCreated(task) {
  broadcast(WS_EVENTS.TASK_CREATED, {
    taskId: task.id,
    runId: task.run_id,
    status: 'queued',
    title: task.title,
    skill: task.skill,
    priority: task.priority
  });
}

/**
 * Publish task started event
 * @param {object} task - Task object with run info
 */
export function publishTaskStarted(task) {
  broadcast(WS_EVENTS.TASK_STARTED, {
    taskId: task.id,
    runId: task.run_id,
    status: 'running',
    startedAt: new Date().toISOString()
  });
}

/**
 * Publish task progress event
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID
 * @param {number} progress - Progress percentage (0-100)
 */
export function publishTaskProgress(taskId, runId, progress) {
  // Validate progress range and warn if invalid
  if (progress < 0 || progress > 100) {
    console.warn(`[taskEvents] Invalid progress value: ${progress} (taskId: ${taskId}), clamping to 0-100`);
  }

  broadcast(WS_EVENTS.TASK_PROGRESS, {
    taskId,
    runId,
    progress: Math.min(100, Math.max(0, progress))
  });
}

/**
 * Publish task completed event
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID
 * @param {object} result - Task result
 */
export function publishTaskCompleted(taskId, runId, result = {}) {
  broadcast(WS_EVENTS.TASK_COMPLETED, {
    taskId,
    runId,
    status: 'completed',
    completedAt: new Date().toISOString(),
    result
  });
}

/**
 * Publish task failed event
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID
 * @param {string} error - Error message
 */
export function publishTaskFailed(taskId, runId, error) {
  broadcast(WS_EVENTS.TASK_FAILED, {
    taskId,
    runId,
    status: 'failed',
    failedAt: new Date().toISOString(),
    error
  });
}

/**
 * Publish executor status event
 * @param {number} activeCount - Number of active tasks
 * @param {number} availableSlots - Number of available slots
 * @param {number} maxConcurrent - Maximum concurrent tasks
 */
export function publishExecutorStatus(activeCount, availableSlots, maxConcurrent) {
  broadcast(WS_EVENTS.EXECUTOR_STATUS, {
    activeCount,
    availableSlots,
    maxConcurrent,
    timestamp: new Date().toISOString()
  });
}
