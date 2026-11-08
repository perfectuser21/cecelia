/**
 * Coding Pathway Cleanup 测试
 * 覆盖本次 PR 的三个改动：
 * D1: 断链#3 mode=design 完成 + 无任何 dev 任务 → 创建 cecelia_events 告警
 * D2: 断链#3 mode=design 完成 + 有历史 dev 任务（全部完成）→ 不创建告警
 * D3: 5e 已删除 — dev task 完成不再触发 initiative_plan
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn(() => mockClient),
};
vi.mock('../db.js', () => ({ default: mockPool }));

const mockCreateTask = vi.fn().mockResolvedValue({ success: true, task: { id: 'new-task-id' } });
vi.mock('../actions.js', () => ({
  createTask: mockCreateTask,
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));

vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
}));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn() }));
vi.mock('../tick.js', () => ({ getTickStatus: vi.fn(), enableTick: vi.fn(), disableTick: vi.fn(), executeTick: vi.fn(), runTickSafe: vi.fn(async () => ({ actions_taken: [] })), routeTask: vi.fn(), TASK_TYPE_AGENT_MAP: {} }));
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null), identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), isValidTaskType: vi.fn(() => true), getDomainSkillOverride: vi.fn(() => null), VALID_TASK_TYPES: ['dev', 'code_review', 'initiative_verify', 'initiative_plan', 'decomp_review', 'architecture_design', 'cecelia_events'] }));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(async () => ({})), ACTION_WHITELIST: [], EVENT_TYPES: { TASK_COMPLETED: 'task_completed', TASK_FAILED: 'task_failed' } }));
vi.mock('../cortex.js', () => ({ analyzeEvent: vi.fn(async () => ({})), loadReflectionState: vi.fn(async () => {}) }));
vi.mock('../alertness.js', () => ({ getAlertnessLevel: vi.fn(() => ({ level: 1, levelName: 'CALM' })), updateAlertnessFromEvent: vi.fn(async () => {}), setAlertnessOverride: vi.fn(), clearAlertnessOverride: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({ getState: vi.fn(() => ({})), isAllowed: vi.fn(() => true), recordSuccess: vi.fn(async () => {}), recordFailure: vi.fn(async () => {}), reset: vi.fn(async () => {}), getAllStates: vi.fn(() => ({})), FAILURE_THRESHOLD: 3, OPEN_DURATION_MS: 60000 }));
vi.mock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn(async () => {}), notifyTaskFailed: vi.fn(async () => {}), sendFeishuMessage: vi.fn(async () => {}) }));
vi.mock('../event-bus.js', () => ({ emitEvent: vi.fn(async () => {}), emit: vi.fn(async () => {}), onEvent: vi.fn(), publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn(), ensureEventsTable: vi.fn(async () => {}), queryEvents: vi.fn(async () => []), getEventCounts: vi.fn(async () => ({})) }));
vi.mock('../auto-learning.js', () => ({ triggerLearningCapture: vi.fn(async () => {}), processExecutionAutoLearning: vi.fn(async () => null) }));
vi.mock('../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn(async () => {}) }));
vi.mock('../proactive-mouth.js', () => ({ notifyTaskCompletion: vi.fn(async () => {}) }));
vi.mock('../review-gate.js', () => ({ processReviewResult: vi.fn(async () => {}) }));
vi.mock('../progress-ledger.js', () => ({ recordProgressStep: vi.fn(async () => {}) }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(async () => ({})) }));
vi.mock('../working-memory.js', () => ({ getMemory: vi.fn(async () => null), setMemory: vi.fn(async () => {}) }));
vi.mock('../watchdog.js', () => ({ startWatching: vi.fn(), stopWatching: vi.fn(), sampleAll: vi.fn(async () => []) }));
vi.mock('../desire-engine.js', () => ({ processDesires: vi.fn(async () => ({})) }));
vi.mock('../dev-failure-classifier.js', () => ({ classifyDevFailure: vi.fn(async () => ({})) }));
vi.mock('../self-model.js', () => ({ updateSelfModel: vi.fn(async () => {}), getSelfModel: vi.fn(async () => ({})) }));
vi.mock('../suggestion-dispatcher.js', () => ({ dispatchSuggestion: vi.fn(async () => {}) }));
vi.mock('../dep-cascade.js', () => ({ propagateDependencyFailure: vi.fn(async () => ({ affected: [] })), recoverDependencyChain: vi.fn(async () => ({ recovered: [] })) }));

import express from 'express';
import request from 'supertest';
import { runTickSafe } from '../tick.js';



const failed = JSON.stringify({suggestion_id:'suggestion-1',identified_layer:'unknown',status:'failed',error:'insufficient information'});
const good = JSON.stringify({suggestion_id:'suggestion-1',identified_layer:'feature',status:'success'});
describe('isolated suggestion callback compatibility', () => {
 async function scenario({type='suggestion_plan',result=failed,duplicate=false,runId=null,failSuggestion=false}) {
  vi.clearAllMocks();
  const row = {task_type:type,project_id:'project-1',goal_id:'goal-1',title:'test',payload:{suggestion_id:'suggestion-1'}};
  mockPool.query.mockImplementation(async sql => {
   if (sql.includes('FROM decision_log') && duplicate) return {rows:[{id:1,callback_task_id:'task-1'}],rowCount:1};
   if (sql.includes('FROM tasks WHERE id = $1') && sql.includes('task_type')) return {rows:[row],rowCount:1};
   if (sql.includes('INSERT INTO callback_queue')) return {rows:[{id:1}],rowCount:1};
   return {rows:[],rowCount:0};
  });
  mockClient.query.mockImplementation(async sql => {
   if (failSuggestion && sql.includes('UPDATE suggestions')) throw new Error('db unavailable');
   return sql.includes('UPDATE tasks') ? {rows:[row],rowCount:1} : {rows:[],rowCount:1};
  });
  const {default:router} = await import('../routes.js');
  const app=express();app.use(express.json());app.use('/api/brain',router);
  const res=await request(app).post('/api/brain/execution-callback').send({task_id:'task-1',run_id:runId,status:'AI Done',result});
  return {res,status:mockClient.query.mock.calls.find(c=>c[0].includes('UPDATE tasks'))?.[1]?.[1],
    architecture:mockCreateTask.mock.calls.filter(c=>c[0]?.task_type==='architecture_design'),
    suggestion:mockClient.query.mock.calls.some(c=>c[0].includes("status = 'failed'") && c[0].includes('UPDATE suggestions')) ? 'failed' : mockPool.query.mock.calls.find(c=>c[0].includes('UPDATE suggestions'))?.[1]?.[0],
    queued:mockPool.query.mock.calls.find(c=>c[0].includes('INSERT INTO callback_queue'))?.[1]};
 }
 it('failed plan must not complete or create architecture',async()=>{
  const x=await scenario({});
  expect(x.res.status).toBe(200); expect(x.status).toBe('failed'); expect(x.architecture).toHaveLength(0); expect(x.suggestion).toBe('failed'); expect(runTickSafe).not.toHaveBeenCalled();
  const update=mockClient.query.mock.calls.find(c=>c[0].includes('UPDATE tasks'));
  expect(JSON.parse(update[1][9]).exit_code).toBeNull();
 });
 it('rolls back and leaves the queue retryable when suggestion update fails',async()=>{
  const x=await scenario({failSuggestion:true});
  expect(x.res.status).toBe(500);
  expect(mockClient.query.mock.calls.some(c=>c[0]==='ROLLBACK')).toBe(true);
  expect(mockPool.query.mock.calls.some(c=>c[0].includes('processed_at = NOW()'))).toBe(false);
 });
 it('successful structured suggestion retains current completed behavior',async()=>{
  const x=await scenario({result:good}); expect(x.status).toBe('completed'); expect(x.architecture).toHaveLength(1); expect(x.suggestion).toBe('processed');
 });
 it('historical unstructured output retains current completed behavior',async()=>{
  const x=await scenario({result:'legacy output'}); expect(x.status).toBe('completed'); expect(x.architecture).toHaveLength(1);
 });
 it('non-suggestion failure-shaped content retains outer status',async()=>{
  const x=await scenario({type:'research'}); expect(x.status).toBe('completed'); expect(x.architecture).toHaveLength(0);
 });
 it('duplicate receipt does not create further task',async()=>{
  const x=await scenario({duplicate:true,runId:'run-1'}); expect(x.res.body.duplicate).toBe(true); expect(x.architecture).toHaveLength(0); expect(x.status).toBeUndefined();
 });
 it('queue stores exact string result under _raw with original status',async()=>{
  const x=await scenario({duplicate:true,runId:'run-1'}); expect(x.queued[3]).toBe('AI Done'); expect(JSON.parse(x.queued[4])).toEqual({_raw:failed});
 });
});
