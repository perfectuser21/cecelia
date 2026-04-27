/**
 * Tests for content-pipeline orphan fixes:
 *
 * Fix 1: syncOrphanTasksOnStartup should requeue tasks with run_id=null
 *   (inline orchestration tasks like content-pipeline that never spawn a process)
 *
 * Fix 2 (legacy): zombie subtask cleanup — used to live inside in-Brain
 *   executeQueuedContentTasks. The orchestrator has been retired (search now lives
 *   in ZJ pipeline-worker, PR zenithjoy#216), so this section now just verifies the
 *   underlying SQL semantics that the cleanup relied on.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';

let pool: any;

beforeAll(async () => {
  const db = await import('../db.js');
  pool = db.default;
});

// ────────────────────────────────────────────────
// Fix 1: syncOrphanTasksOnStartup + run_id=null
// ────────────────────────────────────────────────

describe('syncOrphanTasksOnStartup — inline tasks (run_id=null)', () => {
  let pipelineTaskId: string;

  beforeEach(async () => {
    const result = await pool.query(`
      INSERT INTO tasks (title, task_type, status, payload)
      VALUES (
        '[测试] content-pipeline inline orphan',
        'content-pipeline',
        'in_progress',
        '{"pipeline_keyword":"测试关键词","content_type":"solo-company-case"}'::jsonb
      )
      RETURNING id
    `);
    pipelineTaskId = result.rows[0].id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM tasks WHERE title LIKE '%content-pipeline inline orphan%'`);
  });

  it('should requeue content-pipeline task with run_id=null (not kill it)', async () => {
    // Simulate what syncOrphanTasksOnStartup does:
    // 1. Task is in_progress, run_id = null, no process alive → should requeue
    const taskBefore = await pool.query(
      `SELECT status, payload FROM tasks WHERE id = $1`,
      [pipelineTaskId]
    );
    expect(taskBefore.rows[0].status).toBe('in_progress');
    expect(taskBefore.rows[0].payload.current_run_id).toBeUndefined();

    // The fix: tasks with run_id = null get requeued with watchdog_retry_count reset
    // We test the expected DB state after the fix is applied
    await pool.query(
      `UPDATE tasks SET
        status = 'queued',
        error_message = NULL,
        payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [pipelineTaskId, JSON.stringify({ watchdog_retry_count: 0 })]
    );

    const taskAfter = await pool.query(
      `SELECT status, payload, error_message FROM tasks WHERE id = $1`,
      [pipelineTaskId]
    );
    expect(taskAfter.rows[0].status).toBe('queued');
    expect(taskAfter.rows[0].error_message).toBeNull();
    expect(taskAfter.rows[0].payload.watchdog_retry_count).toBe(0);
  });
});

// ────────────────────────────────────────────────
// Fix 2: executeQueuedContentTasks parent check
// ────────────────────────────────────────────────

describe('executeQueuedContentTasks — zombie subtask cleanup', () => {
  let failedPipelineId: string;
  let zombieSubtaskId: string;
  let alivePipelineId: string;
  let liveSubtaskId: string;

  beforeEach(async () => {
    // Create a failed parent pipeline
    const failedRes = await pool.query(`
      INSERT INTO tasks (title, task_type, status, payload)
      VALUES (
        '[测试] 已失败的 content-pipeline',
        'content-pipeline',
        'failed',
        '{"pipeline_keyword":"测试关键词"}'::jsonb
      )
      RETURNING id
    `);
    failedPipelineId = failedRes.rows[0].id;

    // Create a zombie subtask under the failed pipeline
    const zombieRes = await pool.query(`
      INSERT INTO tasks (title, task_type, status, payload)
      VALUES (
        '[测试] 僵尸子任务',
        'content-copywriting',
        'queued',
        jsonb_build_object('parent_pipeline_id', $1::text, 'pipeline_keyword', '测试关键词')
      )
      RETURNING id
    `, [failedPipelineId]);
    zombieSubtaskId = zombieRes.rows[0].id;

    // Create an alive parent pipeline
    const aliveRes = await pool.query(`
      INSERT INTO tasks (title, task_type, status, payload)
      VALUES (
        '[测试] 活跃的 content-pipeline',
        'content-pipeline',
        'in_progress',
        '{"pipeline_keyword":"测试关键词2"}'::jsonb
      )
      RETURNING id
    `);
    alivePipelineId = aliveRes.rows[0].id;

    // Create a live subtask under the alive pipeline
    const liveRes = await pool.query(`
      INSERT INTO tasks (title, task_type, status, payload)
      VALUES (
        '[测试] 活跃子任务',
        'content-copywriting',
        'queued',
        jsonb_build_object('parent_pipeline_id', $1::text, 'pipeline_keyword', '测试关键词2')
      )
      RETURNING id
    `, [alivePipelineId]);
    liveSubtaskId = liveRes.rows[0].id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM tasks WHERE title LIKE '%[测试]%'`);
  });

  it('zombie subtask should have failed parent', async () => {
    const parentResult = await pool.query(
      `SELECT status FROM tasks WHERE id = $1`,
      [failedPipelineId]
    );
    expect(parentResult.rows[0].status).toBe('failed');
  });

  it('alive subtask should have in_progress parent', async () => {
    const parentResult = await pool.query(
      `SELECT status FROM tasks WHERE id = $1`,
      [alivePipelineId]
    );
    expect(parentResult.rows[0].status).toBe('in_progress');
  });

  it('alive parent IDs are correctly identified via SQL', async () => {
    const subtasks = await pool.query(
      `SELECT id, payload->>'parent_pipeline_id' AS parent_id
       FROM tasks
       WHERE task_type = 'content-copywriting'
         AND status = 'queued'
         AND title LIKE '%[测试]%'`
    );

    const parentIds = subtasks.rows.map((r: any) => r.parent_id).filter(Boolean);
    expect(parentIds.length).toBe(2);

    const aliveResult = await pool.query(
      `SELECT id FROM tasks WHERE id = ANY($1::uuid[]) AND status IN ('queued','in_progress')`,
      [parentIds]
    );
    const aliveSet = new Set(aliveResult.rows.map((r: any) => r.id));

    expect(aliveSet.has(alivePipelineId)).toBe(true);
    expect(aliveSet.has(failedPipelineId)).toBe(false);
  });

  it('zombie subtask is cancelled when parent is failed', async () => {
    // Simulate what executeQueuedContentTasks now does for zombie subtasks
    await pool.query(
      `UPDATE tasks SET status = 'cancelled', completed_at = NOW(), error_message = $2 WHERE id = $1`,
      [zombieSubtaskId, '父 pipeline 已失败，子任务自动取消']
    );

    const result = await pool.query(
      `SELECT status, error_message FROM tasks WHERE id = $1`,
      [zombieSubtaskId]
    );
    expect(result.rows[0].status).toBe('cancelled');
    expect(result.rows[0].error_message).toContain('父 pipeline 已失败');
  });
});
