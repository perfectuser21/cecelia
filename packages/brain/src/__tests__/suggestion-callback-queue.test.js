/**
 * callback-processor.test.js
 *
 * 验证 callback-processor.js 的 WHERE 守卫逻辑：
 * - guard 必须使用白名单 IN ('in_progress', 'queued', 'dispatched')
 * - 修复根因：cecelia-run.sh 抢跑 update-task 把 status 改为 completed，
 *   导致 WHERE status='in_progress' 严格守卫失效，agent result 从未写入 tasks.result
 *   （harness_evaluate 84% verdict=null 根因）
 *
 * TDD 红绿流程：
 *   修复前 → FAIL（WHERE status = 'in_progress' 单一匹配）
 *   修复后 → PASS（WHERE status IN ('in_progress', 'queued', 'dispatched')）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processExecutionCallback } from '../callback-processor.js';

// ─── Mock DB pool（支持事务：pool.query + pool.connect + client）─────────────
const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn().mockResolvedValue(mockClient),
};
vi.mock('../db.js', () => ({ default: mockPool }));

// ─── Mock thalamus──────────────────────────────────────────────────────────
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({
    level: 'normal',
    actions: [{ type: 'fallback_to_tick' }],
  }),
  executeDecision: vi.fn().mockResolvedValue(null),
  EVENT_TYPES: {
    TASK_COMPLETED: 'task_completed',
    TASK_FAILED: 'task_failed',
  },
}));

// ─── Mock decision-executor───────────────────────────────────────────────
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue(null),
}));

// ─── Mock embedding──────────────────────────────────────────────────────
vi.mock('../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null),
}));

// ─── Mock task events────────────────────────────────────────────────────
vi.mock('../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));

// ─── Mock event-bus──────────────────────────────────────────────────────
vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(null),
}));

// ─── Mock circuit-breaker───────────────────────────────────────────────
vi.mock('../circuit-breaker.js', () => ({
  recordSuccess: vi.fn().mockResolvedValue(null),
  recordFailure: vi.fn().mockResolvedValue(null),
}));

// ─── Mock notifier──────────────────────────────────────────────────────
vi.mock('../notifier.js', () => ({
  notifyTaskCompleted: vi.fn().mockResolvedValue(null),
}));

// ─── Mock alerting──────────────────────────────────────────────────────
vi.mock('../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(null),
}));

// ─── Mock quarantine────────────────────────────────────────────────────
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }),
  classifyFailure: vi.fn().mockReturnValue({ class: 'unknown', confidence: 0.5 }),
}));

// ─── Mock desire-feedback───────────────────────────────────────────────
vi.mock('../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn().mockResolvedValue(null),
}));

// ─── Mock routes/shared────────────────────────────────────────────────
vi.mock('../routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue(null),
}));

// ─── Mock dynamic imports──────────────────────────────────────────────
vi.mock('../executor.js', () => ({
  removeActiveProcess: vi.fn(),
  setBillingPause: vi.fn(),
}));

vi.mock('../progress-ledger.js', () => ({
  recordProgressStep: vi.fn().mockResolvedValue(null),
}));

vi.mock('../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null),
}));

import { processEvent as thalamusProcessEvent } from '../thalamus.js';
import { executeDecision as executeThalamusDecision } from '../decision-executor.js';
import { recordFailure as recordCircuitFailure } from '../circuit-breaker.js';
import { handleTaskFailure, classifyFailure } from '../quarantine.js';


describe('isolated queued suggestion failure',()=>{
 it('queue replay must record explicit failure',async()=>{
  const failed=JSON.stringify({suggestion_id:'suggestion-1',identified_layer:'unknown',status:'failed',error:'insufficient information'});
  const row={id:1,task_id:'task-1',run_id:'run-1',status:'AI Done',result_json:{_raw:failed},attempt:1};
  const task={task_type:'suggestion_plan',payload:{suggestion_id:'suggestion-1'}};
  mockPool.query.mockImplementation(async sql => {
    if (sql.includes('failure_class') && sql.includes('FROM tasks')) return {rows:[task],rowCount:1};
    if (sql.includes('SELECT task_id FROM task_runs')) return {rows:[{task_id:'task-1'}],rowCount:1};
    if (sql.includes('SELECT task_id, status FROM task_runs')) return {rows:[{task_id:'task-1',status:'failed'}],rowCount:1};
    return {rows:[],rowCount:0};
  });
  mockClient.query.mockImplementation(async sql=>sql.includes('WITH candidates AS')?{rows:[row],rowCount:1}:sql.includes('UPDATE tasks')?{rows:[task],rowCount:1}:{rows:[],rowCount:1});
  const {pollAndProcess}=await import('../callback-worker.js');
  await pollAndProcess();
  const update=mockClient.query.mock.calls.find(c=>c[0].includes('UPDATE tasks'));
  expect(update).toBeDefined();
  expect(update?.[1]?.[1]).toBe('failed');
  expect(JSON.parse(update[1][9]).exit_code).toBeNull();
  expect(mockClient.query.mock.calls.some(c => c[0].includes('UPDATE suggestions') && c[0].includes("status = 'in_progress'"))).toBe(true);
  expect(handleTaskFailure).not.toHaveBeenCalled();
  expect(mockPool.query.mock.calls.some(c => c[0].includes('UPDATE task_runs') && c[1][1] === 'failed')).toBe(true);
  expect(mockPool.query.mock.calls.some(c => c[0].includes('SELECT task_id, status FROM task_runs'))).toBe(true);
 });
 it.each([true, false])('replay repairs run only with committed failure evidence: %s', async (evidence) => {
  vi.clearAllMocks();
  const failed=JSON.stringify({suggestion_id:'suggestion-1',identified_layer:'unknown',status:'failed'});
  const row={id:2,task_id:'task-1',run_id:'run-1',status:'AI Done',result_json:{_raw:failed},attempt:1};
  const task={task_type:'suggestion_plan',payload:{suggestion_id:'suggestion-1'}};
  mockPool.query.mockImplementation(async sql => {
    if (sql.includes('failure_class') && sql.includes('FROM tasks')) return {rows:[task],rowCount:1};
    if (sql.includes("suggestion_plan_resolution") && sql.includes('SELECT 1')) return {rows:evidence?[{one:1}]:[],rowCount:evidence?1:0};
    if (sql.includes('SELECT task_id FROM task_runs')) return {rows:[{task_id:'task-1'}],rowCount:1};
    if (sql.includes('SELECT task_id, status FROM task_runs')) return {rows:[{task_id:'task-1',status:'failed'}],rowCount:1};
    return {rows:[],rowCount:0};
  });
  mockClient.query.mockImplementation(async sql=>sql.includes('WITH candidates AS')?{rows:[row],rowCount:1}:sql.includes('UPDATE tasks')?{rows:[],rowCount:0}:{rows:[],rowCount:1});
  const {pollAndProcess}=await import('../callback-worker.js');
  await pollAndProcess();
  expect(mockPool.query.mock.calls.some(c => c[0].includes('UPDATE task_runs'))).toBe(evidence);
  expect(mockClient.query.mock.calls.some(c => c[0].includes('UPDATE callback_queue SET processed_at'))).toBe(true);
 });
 it('rolls back and leaves the queue retryable when suggestion update fails', async () => {
  vi.clearAllMocks();
  const failed=JSON.stringify({suggestion_id:'suggestion-1',identified_layer:'unknown',status:'failed'});
  const row={id:3,task_id:'task-1',run_id:'run-1',status:'AI Done',result_json:{_raw:failed}};
  const task={task_type:'suggestion_plan',payload:{suggestion_id:'suggestion-1'}};
  mockPool.query.mockImplementation(async sql => sql.includes('failure_class') && sql.includes('FROM tasks') ? {rows:[task],rowCount:1} : {rows:[],rowCount:0});
  mockClient.query.mockImplementation(async sql => {
   if (sql.includes('WITH candidates AS')) return {rows:[row],rowCount:1};
   if (sql.includes('UPDATE suggestions')) throw new Error('db unavailable');
   if (sql.includes('UPDATE tasks')) return {rows:[task],rowCount:1};
   return {rows:[],rowCount:1};
  });
  const {pollAndProcess}=await import('../callback-worker.js');
  await pollAndProcess();
  expect(mockClient.query.mock.calls.some(c=>c[0]==='ROLLBACK')).toBe(true);
  expect(mockClient.query.mock.calls.some(c=>c[0].includes('UPDATE callback_queue SET processed_at'))).toBe(false);
  expect(mockClient.query.mock.calls.some(c=>c[0].includes('retry_count = COALESCE(retry_count, 0) + 1'))).toBe(true);
 });
});
