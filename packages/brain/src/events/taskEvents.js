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

/**
 * Publish alertness level changed event
 * @param {object} data - Alertness change data
 * @param {number} data.level - New alertness level (0-4)
 * @param {number} data.previous - Previous alertness level
 * @param {string} data.label - Level name (SLEEPING/CALM/AWARE/ALERT/PANIC)
 * @param {string} data.reason - Reason for transition
 */
export function publishAlertnessChanged(data) {
  broadcast(WS_EVENTS.ALERTNESS_CHANGED, {
    level: data.level,
    previous: data.previous,
    label: data.label,
    reason: data.reason,
    timestamp: new Date().toISOString()
  });
}

/**
 * Publish desire created event
 * @param {object} desire - Desire data
 * @param {string} desire.id - Desire ID
 * @param {string} desire.type - Desire type (propose/warn/inform/celebrate/question)
 * @param {number} desire.urgency - Urgency score
 * @param {string} desire.content - Desire summary content
 */
export function publishDesireCreated(desire) {
  broadcast(WS_EVENTS.DESIRE_CREATED, {
    id: desire.id,
    type: desire.type,
    urgency: desire.urgency,
    summary: desire.content,
    timestamp: new Date().toISOString()
  });
}

/**
 * Publish desire updated event
 * @param {object} data - Update data
 * @param {string} data.id - Desire ID
 * @param {string} data.status - New status
 * @param {string} data.previous_status - Previous status
 */
export function publishDesireUpdated(data) {
  broadcast(WS_EVENTS.DESIRE_UPDATED, {
    id: data.id,
    status: data.status,
    previous_status: data.previous_status,
    timestamp: new Date().toISOString()
  });
}

/**
 * Publish desire expressed event (管家主动表达，发送到 Dashboard)
 * @param {object} data - Expression data
 * @param {string} data.id - Desire ID
 * @param {string} data.type - Desire type
 * @param {number} data.urgency - Urgency score
 * @param {string} data.content - Desire content
 * @param {string} data.message - Formatted message text
 */
export function publishDesireExpressed(data) {
  broadcast(WS_EVENTS.DESIRE_EXPRESSED, {
    id: data.id,
    type: data.type,
    urgency: data.urgency,
    content: data.content,
    message: data.message,
    timestamp: new Date().toISOString()
  });
}

/**
 * Publish tick executed event
 * @param {object} data - Tick execution data
 * @param {number} data.tick_number - Tick counter
 * @param {number} data.duration_ms - Tick duration in milliseconds
 * @param {number} data.actions_taken - Number of actions taken
 * @param {string} data.next_tick_at - ISO timestamp of next tick
 */
export function publishTickExecuted(data) {
  broadcast(WS_EVENTS.TICK_EXECUTED, {
    tick_number: data.tick_number,
    duration_ms: data.duration_ms,
    actions_taken: data.actions_taken,
    next_tick_at: data.next_tick_at,
    timestamp: new Date().toISOString()
  });
}

/**
 * Publish cognitive state event (活性信号)
 * 让前端实时感知 Cecelia 的认知阶段
 * @param {object} data
 * @param {string} data.phase - 认知阶段 (idle|alertness|thalamus|decomposition|planning|dispatching|decision|rumination|desire|reflecting)
 * @param {string} data.detail - 人类可读的描述
 * @param {number} [data.progress] - 可选进度 0-100
 * @param {object} [data.meta] - 可选元数据
 */
export function publishCognitiveState(data) {
  broadcast(WS_EVENTS.COGNITIVE_STATE, {
    phase: data.phase,
    detail: data.detail,
    progress: data.progress,
    meta: data.meta,
    timestamp: new Date().toISOString()
  });
}

/**
 * Publish Cecelia proactive message (主动推送)
 * 叙事完成、情绪变化时推送，不经过 LLM 直接广播
 * @param {object} data
 * @param {string} data.type - 消息类型 ('narrative'|'emotion'|'task_complete')
 * @param {string} data.message - 消息文本（Cecelia 的原文）
 * @param {object} [data.meta] - 可选元数据
 */
export function publishCeceliaMessage(data) {
  broadcast(WS_EVENTS.CECELIA_MESSAGE, {
    type: data.type,
    message: data.message,
    meta: data.meta || {},
    timestamp: new Date().toISOString()
  });
}
