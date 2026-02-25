/**
 * auto-rca.test.js
 * 自动 RCA 触发逻辑单元测试
 *
 * DoD 覆盖：
 * - 任务失败触发 RCA（performRCA 被调用一次）
 * - 24h 内重复失败跳过 RCA（shouldAnalyzeFailure 返回 false）
 * - RCA 失败不影响主流程
 * - billing_cap 类型失败不触发 RCA
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerAutoRCA } from '../routes.js';

// ─────────────────────────────────────────
// Mock 全局依赖（routes.js 的 import）
// ─────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
  setBillingPause: vi.fn(),
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));

vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn(),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getFocusSummary: vi.fn(),
}));

vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn(),
  enableTick: vi.fn(),
  disableTick: vi.fn(),
  executeTick: vi.fn(),
  runTickSafe: vi.fn(async () => ({ actions_taken: [] })),
  routeTask: vi.fn(),
  drainTick: vi.fn(),
  getDrainStatus: vi.fn(),
  cancelDrain: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));

vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(async () => ({ level: 'L0', actions: [] })),
  EVENT_TYPES: { TASK_FAILED: 'TASK_FAILED', TASK_COMPLETED: 'TASK_COMPLETED' },
}));

vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(async () => {}),
  getPendingActions: vi.fn(async () => []),
  approvePendingAction: vi.fn(),
  rejectPendingAction: vi.fn(),
}));

vi.mock('../notifier.js', () => ({
  notifyTaskCompleted: vi.fn(async () => {}),
  notifyTaskFailed: vi.fn(async () => {}),
}));

vi.mock('../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn(),
  getEventCounts: vi.fn(),
  emit: vi.fn(async () => {}),
}));

vi.mock('../circuit-breaker.js', () => ({
  getState: vi.fn(),
  reset: vi.fn(),
  getAllStates: vi.fn(),
  recordSuccess: vi.fn(async () => {}),
  recordFailure: vi.fn(async () => {}),
}));

vi.mock('../events/taskEvents.js', () => ({
  publishTaskCreated: vi.fn(),
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));

vi.mock('../websocket.js', () => ({
  default: { broadcast: vi.fn() },
}));

vi.mock('../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(async () => {}),
}));

vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(async () => ({ quarantined: false })),
  getQuarantinedTasks: vi.fn(async () => []),
  getQuarantineStats: vi.fn(async () => ({})),
  releaseTask: vi.fn(),
  quarantineTask: vi.fn(),
  QUARANTINE_REASONS: {},
  REVIEW_ACTIONS: {},
  classifyFailure: vi.fn(() => ({ class: 'UNKNOWN', pattern: null, retry_strategy: null })),
}));

vi.mock('../task-router.js', () => ({
  identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn(() => []),
  LOCATION_MAP: {},
}));

vi.mock('../intent.js', () => ({
  parseIntent: vi.fn(),
  parseAndCreate: vi.fn(),
  INTENT_TYPES: {},
  INTENT_ACTION_MAP: {},
  extractEntities: vi.fn(),
  classifyIntent: vi.fn(),
  getSuggestedAction: vi.fn(),
}));

vi.mock('../templates.js', () => ({
  generatePrdFromTask: vi.fn(),
  generatePrdFromGoalKR: vi.fn(),
  generateTrdFromGoal: vi.fn(),
  generateTrdFromGoalKR: vi.fn(),
  validatePrd: vi.fn(),
  validateTrd: vi.fn(),
  prdToJson: vi.fn(),
  trdToJson: vi.fn(),
  PRD_TYPE_MAP: {},
}));

vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn(),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  rollbackDecision: vi.fn(),
}));

vi.mock('../planner.js', () => ({
  planNextTask: vi.fn(),
  getPlanStatus: vi.fn(),
  handlePlanInput: vi.fn(),
}));

vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn(async () => ({ level: 0 })),
  setManualOverride: vi.fn(),
  clearManualOverride: vi.fn(),
  evaluateAlertness: vi.fn(async () => ({ level: 0 })),
  ALERTNESS_LEVELS: {},
  LEVEL_NAMES: {},
}));

vi.mock('../proposal.js', () => ({
  createProposal: vi.fn(),
  approveProposal: vi.fn(),
  rollbackProposal: vi.fn(),
  rejectProposal: vi.fn(),
  getProposal: vi.fn(),
  listProposals: vi.fn(),
}));

vi.mock('../cortex.js', () => ({
  performRCA: vi.fn(async () => ({})),
  searchRelevantAnalyses: vi.fn(async () => []),
}));

vi.mock('../rca-deduplication.js', () => ({
  shouldAnalyzeFailure: vi.fn(async () => ({ should_analyze: true, signature: 'test-sig-001' })),
  generateErrorSignature: vi.fn(() => 'test-sig-001'),
  cacheRcaResult: vi.fn(async () => {}),
}));

vi.mock('../trace.js', () => ({
  createTrace: vi.fn(),
  endTrace: vi.fn(),
  addSpan: vi.fn(),
}));

vi.mock('../learning.js', () => ({
  recordLearning: vi.fn(),
  getLearnings: vi.fn(async () => []),
}));

vi.mock('../immune-system.js', () => ({
  checkImmunity: vi.fn(async () => ({ immune: false })),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock('../policy-validator.js', () => ({
  validateAction: vi.fn(async () => ({ valid: true })),
}));

vi.mock('../openai-client.js', () => ({
  default: { chat: vi.fn() },
}));

// ─────────────────────────────────────────
// triggerAutoRCA 单元测试（纯函数注入）
// ─────────────────────────────────────────

describe('triggerAutoRCA - 自动 RCA 触发逻辑', () => {
  let mockPerformRCA;
  let mockShouldAnalyzeFailure;
  let consoleSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockPerformRCA = vi.fn(async () => ({}));
    mockShouldAnalyzeFailure = vi.fn(async () => ({
      should_analyze: true,
      signature: 'abc123def456'
    }));
    consoleSpy = vi.spyOn(console, 'log');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ── Case 1: 任务失败触发 RCA ──────────────────────────────────────
  it('任务失败时触发 RCA：performRCA 被调用一次', async () => {
    const classification = { class: 'AI_FAILURE', pattern: null };

    await triggerAutoRCA({
      task_id: 'task-001',
      errorMsg: 'Claude API error: 500 Internal Server Error',
      classification,
      shouldAnalyzeFailure: mockShouldAnalyzeFailure,
      performRCA: mockPerformRCA
    });

    // performRCA 必须被调用一次
    expect(mockPerformRCA).toHaveBeenCalledTimes(1);
    expect(mockPerformRCA).toHaveBeenCalledWith({
      task_id: 'task-001',
      error: 'Claude API error: 500 Internal Server Error',
      classification
    });

    // 日志应包含 [AutoRCA]
    const logMessages = consoleSpy.mock.calls.map(call => call[0]);
    expect(logMessages.some(msg => msg.includes('[AutoRCA]'))).toBe(true);
  });

  // ── Case 2: 24h 内重复失败跳过 RCA ──────────────────────────────
  it('24h 内重复失败：shouldAnalyzeFailure 返回 false 时跳过 RCA', async () => {
    mockShouldAnalyzeFailure = vi.fn(async () => ({
      should_analyze: false,
      signature: 'abc123def456',
      cached_result: {
        root_cause: 'Previous analysis result',
        confidence: 0.85
      }
    }));

    const classification = { class: 'AI_FAILURE', pattern: null };

    await triggerAutoRCA({
      task_id: 'task-002',
      errorMsg: 'Same error again',
      classification,
      shouldAnalyzeFailure: mockShouldAnalyzeFailure,
      performRCA: mockPerformRCA
    });

    // performRCA 不应被调用
    expect(mockPerformRCA).not.toHaveBeenCalled();

    // 日志应包含 [AutoRCA] Skip
    const logMessages = consoleSpy.mock.calls.map(call => call[0]);
    expect(logMessages.some(msg => msg.includes('[AutoRCA]') && msg.includes('Skip'))).toBe(true);
  });

  // ── Case 3: RCA 失败不影响主流程 ─────────────────────────────────
  it('performRCA 抛出异常时：主函数不抛出异常', async () => {
    mockPerformRCA = vi.fn(async () => {
      throw new Error('Opus API rate limit exceeded');
    });

    const classification = { class: 'AI_FAILURE', pattern: null };

    // 不应该抛出异常
    await expect(triggerAutoRCA({
      task_id: 'task-003',
      errorMsg: 'Task failed',
      classification,
      shouldAnalyzeFailure: mockShouldAnalyzeFailure,
      performRCA: mockPerformRCA
    })).resolves.toBeUndefined();

    // 错误日志应包含 [AutoRCA] Error
    const errorSpy = vi.spyOn(console, 'error');
    // 再执行一次验证日志
    const errorLogSpy = vi.spyOn(console, 'error');
    mockPerformRCA = vi.fn(async () => {
      throw new Error('Opus API rate limit exceeded');
    });

    await triggerAutoRCA({
      task_id: 'task-003b',
      errorMsg: 'Task failed',
      classification,
      shouldAnalyzeFailure: mockShouldAnalyzeFailure,
      performRCA: mockPerformRCA
    });

    const errorMessages = errorLogSpy.mock.calls.map(call => call[0]);
    expect(errorMessages.some(msg => msg.includes('[AutoRCA]') && msg.includes('Error'))).toBe(true);
  });

  // ── Case 4: BILLING_CAP 类型不触发 RCA ──────────────────────────
  it('classification.class = BILLING_CAP 时：RCA 不被触发', async () => {
    const classification = { class: 'BILLING_CAP', pattern: 'spending_cap' };

    await triggerAutoRCA({
      task_id: 'task-004',
      errorMsg: 'Claude Spending Cap reached',
      classification,
      shouldAnalyzeFailure: mockShouldAnalyzeFailure,
      performRCA: mockPerformRCA
    });

    // shouldAnalyzeFailure 和 performRCA 都不应被调用
    expect(mockShouldAnalyzeFailure).not.toHaveBeenCalled();
    expect(mockPerformRCA).not.toHaveBeenCalled();

    // 日志应包含 [AutoRCA] Skip
    const logMessages = consoleSpy.mock.calls.map(call => call[0]);
    expect(logMessages.some(msg => msg.includes('[AutoRCA]') && msg.includes('BILLING_CAP'))).toBe(true);
  });
});
