/**
 * Cecelia Executor - Trigger headless Claude Code execution
 *
 * This module integrates the Brain's tick mechanism with cecelia-run,
 * enabling automatic task execution in a self-driving loop.
 */

/* global console */
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import pool from './db.js';

const execAsync = promisify(exec);

// Configuration
const CECELIA_RUN_PATH = process.env.CECELIA_RUN_PATH || '/home/xx/bin/cecelia-run';
const PROMPT_DIR = '/tmp/cecelia-prompts';
const WORK_DIR = process.env.CECELIA_WORK_DIR || '/home/xx/dev/cecelia-workspace';

/**
 * Ensure prompt directory exists
 */
async function ensurePromptDir() {
  try {
    await mkdir(PROMPT_DIR, { recursive: true });
  } catch (err) {
    // Directory might already exist
    if (err.code !== 'EEXIST') {
      console.error('[executor] Failed to create prompt dir:', err.message);
    }
  }
}

/**
 * Generate a unique run ID
 */
function generateRunId(taskId) {
  const timestamp = Date.now();
  return `run-${taskId.slice(0, 8)}-${timestamp}`;
}

/**
 * Prepare prompt content from task
 *
 * Task can have:
 * - prd_content: Direct PRD text
 * - prd_path: Path to PRD file
 * - payload.prd: PRD in payload JSON
 */
function preparePrompt(task) {
  // Check for PRD content in different locations
  // All prompts must start with /dev to trigger the skill
  if (task.prd_content) {
    return `/dev\n\n${task.prd_content}`;
  }

  if (task.payload?.prd_content) {
    return `/dev\n\n${task.payload.prd_content}`;
  }

  if (task.payload?.prd_path) {
    return `/dev ${task.payload.prd_path}`;
  }

  // Fallback: Create a minimal PRD from task title/description
  const prd = `# PRD - ${task.title}

## 背景
任务来自 Brain 自动调度。

## 功能描述
${task.description || task.title}

## 成功标准
- [ ] 任务完成
`;

  return `/dev\n\n${prd}`;
}

/**
 * Update task with run information
 */
async function updateTaskRunInfo(taskId, runId, status = 'triggered') {
  try {
    await pool.query(`
      UPDATE tasks
      SET
        payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
          'current_run_id', $2,
          'run_status', $3,
          'run_triggered_at', NOW()
        )
      WHERE id = $1
    `, [taskId, runId, status]);

    return { success: true };
  } catch (err) {
    console.error('[executor] Failed to update task run info:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Trigger cecelia-run for a task
 *
 * This function:
 * 1. Prepares the prompt file
 * 2. Generates a run ID
 * 3. Launches cecelia-run asynchronously
 * 4. Updates task with run info
 *
 * @param {Object} task - The task object from database
 * @returns {Object} - { success, runId, taskId, error? }
 */
async function triggerCeceliaRun(task) {
  try {
    await ensurePromptDir();

    const runId = generateRunId(task.id);
    const promptFile = path.join(PROMPT_DIR, `${task.id}-${runId}.txt`);

    // 1. Prepare prompt content
    const promptContent = preparePrompt(task);

    // 2. Write prompt to file
    await writeFile(promptFile, promptContent, 'utf-8');
    console.log(`[executor] Prompt written to ${promptFile}`);

    // 3. Update task with run info before execution
    await updateTaskRunInfo(task.id, runId, 'triggered');

    // 4. Launch cecelia-run asynchronously (fire and forget)
    // The callback webhook will handle completion
    const logFile = `/tmp/cecelia-${task.id}.log`;
    // Set WEBHOOK_URL to point to Brain API callback endpoint
    const webhookUrl = process.env.BRAIN_CALLBACK_URL || 'http://localhost:5212/api/brain/execution-callback';
    const cmd = `cd "${WORK_DIR}" && WEBHOOK_URL="${webhookUrl}" nohup "${CECELIA_RUN_PATH}" "${task.id}" "${runId}" "${promptFile}" > "${logFile}" 2>&1 &`;

    console.log(`[executor] Launching: ${cmd}`);

    // Use exec without waiting for completion
    exec(cmd, (error) => {
      if (error) {
        console.error(`[executor] Failed to launch cecelia-run: ${error.message}`);
      }
    });

    console.log(`[executor] Triggered run ${runId} for task ${task.id}`);

    return {
      success: true,
      runId,
      taskId: task.id,
      promptFile,
      logFile
    };

  } catch (err) {
    console.error(`[executor] Error triggering cecelia-run: ${err.message}`);
    return {
      success: false,
      taskId: task.id,
      error: err.message
    };
  }
}

/**
 * Check if cecelia-run is available
 */
async function checkCeceliaRunAvailable() {
  try {
    await execAsync(`test -x "${CECELIA_RUN_PATH}"`);
    return { available: true, path: CECELIA_RUN_PATH };
  } catch {
    return { available: false, path: CECELIA_RUN_PATH, error: 'Not found or not executable' };
  }
}

/**
 * Get execution status for a task
 */
async function getTaskExecutionStatus(taskId) {
  try {
    const result = await pool.query(`
      SELECT
        payload->'current_run_id' as run_id,
        payload->'run_status' as run_status,
        payload->'run_triggered_at' as triggered_at,
        payload->'last_run_result' as last_result
      FROM tasks
      WHERE id = $1
    `, [taskId]);

    if (result.rows.length === 0) {
      return { found: false };
    }

    return {
      found: true,
      ...result.rows[0]
    };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

export {
  triggerCeceliaRun,
  checkCeceliaRunAvailable,
  getTaskExecutionStatus,
  updateTaskRunInfo,
  preparePrompt,
  generateRunId
};
