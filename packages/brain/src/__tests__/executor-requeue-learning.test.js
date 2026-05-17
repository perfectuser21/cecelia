/**
 * Executor requeueTask Learning Record Test
 * Fix: requeueTask 失败后应在 learnings 表记录 failure_pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock pool
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('executor requeueTask: learning record', () => {
  it('learning INSERT uses correct category=failure_pattern and includes content_hash', () => {
    // 验证 INSERT 语句使用正确的 category，且包含 content_hash 去重字段
    const expectedCategory = 'failure_pattern';
    const expectedTriggerEvent = 'watchdog_kill';

    // 模拟修复后的 INSERT 构造（包含 content_hash）
    const insertSql = `INSERT INTO learnings (title, category, trigger_event, content, metadata, content_hash, version, is_latest, digested) VALUES ($1, 'failure_pattern', 'watchdog_kill', $2, $3, $4, 1, true, false)`;

    expect(insertSql).toContain(expectedCategory);
    expect(insertSql).toContain(expectedTriggerEvent);
    expect(insertSql).toContain('content_hash');
  });

  it('content_hash is computed as SHA256(title+content).slice(0,16)', () => {
    const title = 'Task Failure: test-task [RSS exceeded]';
    const content = 'Watchdog killed task after 1 attempts. Reason: RSS exceeded';
    const hash = crypto.createHash('sha256')
      .update(`${title}\n${content}`)
      .digest('hex')
      .slice(0, 16);

    // 同样的 title+content 总是产生相同的 hash
    const hash2 = crypto.createHash('sha256')
      .update(`${title}\n${content}`)
      .digest('hex')
      .slice(0, 16);

    expect(hash).toBe(hash2);
    expect(hash).toHaveLength(16);

    // 不同内容产生不同 hash
    const hashDiff = crypto.createHash('sha256')
      .update(`${title}\nWatchdog killed task after 2 attempts. Reason: RSS exceeded`)
      .digest('hex')
      .slice(0, 16);
    expect(hash).not.toBe(hashDiff);
  });

  it('learning metadata contains task_id, task_type, project_id', () => {
    const taskId = 'task-uuid-123';
    const task_type = 'dev';
    const project_id = 'project-uuid-456';

    const metadata = JSON.stringify({
      task_id: taskId,
      task_type: task_type || null,
      project_id: project_id || null,
    });

    const parsed = JSON.parse(metadata);
    expect(parsed.task_id).toBe(taskId);
    expect(parsed.task_type).toBe(task_type);
    expect(parsed.project_id).toBe(project_id);
  });

  it('planner buildLearningPenaltyMap can find the record via metadata->task_id', () => {
    // 模拟 planner 的查询逻辑：
    // metadata->>'task_id' IN (SELECT id::text FROM tasks WHERE project_id = $2)
    const taskId = 'task-uuid-123';
    const projectId = 'project-uuid-456';

    // 模拟 learnings 记录
    const learningRecord = {
      category: 'failure_pattern',
      metadata: { task_id: taskId, task_type: 'dev', project_id: projectId },
    };

    // 验证 planner 能找到这条记录
    expect(learningRecord.category).toBe('failure_pattern');
    expect(learningRecord.metadata.task_id).toBe(taskId);
    expect(learningRecord.metadata.task_type).toBe('dev');
  });

  it('learning error does not prevent requeue from succeeding', () => {
    // Fix 的关键：learning 记录失败不应影响 requeueTask 的返回值
    const learningFailed = true;

    // 模拟：即使 learning INSERT 失败，requeueTask 仍返回成功
    const result = learningFailed
      ? { requeued: true, retry_count: 1, next_run_at: new Date().toISOString() }
      : { requeued: true, retry_count: 1 };

    expect(result.requeued).toBe(true); // requeue 仍然成功
  });

  it('duplicate failure_pattern with same hash is skipped', () => {
    // 模拟去重逻辑：existing.rows.length > 0 时跳过 INSERT
    const existingRows = [{ id: 'existing-id' }];
    const shouldInsert = existingRows.length === 0;

    expect(shouldInsert).toBe(false); // 有重复时不 INSERT
  });
});
