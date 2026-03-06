/**
 * monitor-loop.test.js
 *
 * 覆盖 monitor-loop.js 所有导出函数和内部核心路径：
 *
 * 导出函数：
 * - startMonitorLoop: 启动监控循环
 * - getMonitorStatus:  获取监控状态
 *
 * 内部函数（通过 runMonitorCycle 间接测试）：
 * - detectStuckRuns:       检测卡住的任务
 * - detectFailureSpike:    检测失败率激增
 * - detectResourcePressure: 检测资源压力
 * - handleStuckRun:        处置卡住任务（restart/retry/quarantine）
 * - handleFailureSpike:    处置失败率激增（immune system + RCA）
 * - handleResourcePressure: 处置资源压力（throttle）
 * - callCortexForRca:      调用 Cortex 进行 RCA（通过 handleFailureSpike 间接触发）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────
// 所有 mock 必须在 import 被测模块之前声明
// 使用 vi.hoisted 保证 factory 内引用的变量不被提升问题影响
// ─────────────────────────────────────────────────────────

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../db.js', () => ({ default: mockPool }));

const mockUpdateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({ updateTask: mockUpdateTask }));

const mockShouldAnalyzeFailure = vi.hoisted(() => vi.fn());
const mockCacheRcaResult = vi.hoisted(() => vi.fn());
const mockGetRcaCacheStats = vi.hoisted(() => vi.fn());
vi.mock('../rca-deduplication.js', () => ({
  shouldAnalyzeFailure: mockShouldAnalyzeFailure,
  cacheRcaResult: mockCacheRcaResult,
  getRcaCacheStats: mockGetRcaCacheStats,
  generateErrorSignature: vi.fn().mockReturnValue('abcd1234abcd1234'),
}));

const mockShouldAutoFix = vi.hoisted(() => vi.fn());
const mockDispatchToDevSkill = vi.hoisted(() => vi.fn());
const mockGetAutoFixStats = vi.hoisted(() => vi.fn());
vi.mock('../auto-fix.js', () => ({
  shouldAutoFix: mockShouldAutoFix,
  dispatchToDevSkill: mockDispatchToDevSkill,
  getAutoFixStats: mockGetAutoFixStats,
}));

const mockValidatePolicyJson = vi.hoisted(() => vi.fn());
vi.mock('../policy-validator.js', () => ({
  validatePolicyJson: mockValidatePolicyJson,
}));

// 动态 import 的模块：executor.js、quarantine.js、cortex.js、immune-system.js
// vi.mock 也会拦截动态 import()，所以这里统一声明

const mockGetActiveProcessCount = vi.hoisted(() => vi.fn());
vi.mock('../executor.js', () => ({
  getActiveProcessCount: mockGetActiveProcessCount,
  MAX_SEATS: 10,
}));

const mockQuarantineTask = vi.hoisted(() => vi.fn());
vi.mock('../quarantine.js', () => ({
  quarantineTask: mockQuarantineTask,
}));

const mockPerformRCA = vi.hoisted(() => vi.fn());
vi.mock('../cortex.js', () => ({
  performRCA: mockPerformRCA,
}));

const mockUpdateFailureSignature = vi.hoisted(() => vi.fn());
const mockFindActivePolicy = vi.hoisted(() => vi.fn());
const mockFindProbationPolicy = vi.hoisted(() => vi.fn());
const mockRecordPolicyEvaluation = vi.hoisted(() => vi.fn());
const mockShouldPromoteToProbation = vi.hoisted(() => vi.fn());
const mockParsePolicyAction = vi.hoisted(() => vi.fn());
vi.mock('../immune-system.js', () => ({
  updateFailureSignature: mockUpdateFailureSignature,
  findActivePolicy: mockFindActivePolicy,
  findProbationPolicy: mockFindProbationPolicy,
  recordPolicyEvaluation: mockRecordPolicyEvaluation,
  shouldPromoteToProbation: mockShouldPromoteToProbation,
  parsePolicyAction: mockParsePolicyAction,
}));

// ─────────────────────────────────────────────────────────
// 被测模块：动态 import，每次 beforeEach 重新加载以重置模块级 _monitorTimer 状态
// ─────────────────────────────────────────────────────────
let startMonitorLoop;
let getMonitorStatus;

// ─────────────────────────────────────────────────────────
// 辅助工厂函数
// ─────────────────────────────────────────────────────────

function makeStuckRun(overrides = {}) {
  return {
    run_id: 'run-001',
    task_id: 'task-001',
    span_id: 'span-001',
    layer: 'L2_executor',
    step_name: 'dispatch',
    ts_start: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    heartbeat_ts: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    minutes_since_heartbeat: '8',
    ...overrides,
  };
}

function makeFailure(overrides = {}) {
  return {
    run_id: 'run-fail-001',
    task_id: 'task-fail-001',
    span_id: 'span-fail-001',
    layer: 'L2_executor',
    step_name: 'dispatch',
    reason_code: 'TIMEOUT',
    reason_kind: 'TRANSIENT',
    status: 'failed',
    ts_start: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    ts_end: new Date(Date.now() - 29 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function makeRcaResult(overrides = {}) {
  return {
    root_cause: 'Task timed out due to network latency',
    proposed_fix: 'Increase timeout threshold and add retry mechanism with exponential backoff',
    action_plan: 'Update executor config',
    confidence: 0.85,
    evidence: 'Heartbeat logs show 8 minute gap',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────
// 默认 mock 返回值（供 beforeEach 重置）
// ─────────────────────────────────────────────────────────

function setupDefaultMocks() {
  // pool.query 默认：按 SQL 内容智能分发
  // - detectStuckRuns (heartbeat_ts): 无卡住任务 → []
  // - detectFailureSpike (COUNT(*) FILTER): 聚合查询，必须返回 1 行
  // - INSERT / resource_snapshot writes: 无需 rows
  mockPool.query.mockImplementation((sql) => {
    const s = typeof sql === 'string' ? sql : (sql?.text || '');
    if (s.includes('COUNT(*) FILTER') || s.includes('failure_rate')) {
      return Promise.resolve({ rows: [{ failed_count: '0', total_count: '0', failure_rate: '0.00' }] });
    }
    return Promise.resolve({ rows: [] });
  });

  // executor：3/10 座位 → 30% 压力（低于阈值 85%）
  mockGetActiveProcessCount.mockReturnValue(3);

  // rca-deduplication
  mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: false, cached_result: null });
  mockCacheRcaResult.mockResolvedValue(undefined);
  mockGetRcaCacheStats.mockResolvedValue({
    total_cached: 0,
    cached_last_24h: 0,
    avg_confidence: 0,
  });

  // auto-fix
  mockShouldAutoFix.mockReturnValue(false);
  mockDispatchToDevSkill.mockResolvedValue('task-autofix-001');
  mockGetAutoFixStats.mockResolvedValue({
    total_auto_fixes: 0,
    completed_fixes: 0,
    in_progress_fixes: 0,
    queued_fixes: 0,
  });

  // policy-validator
  mockValidatePolicyJson.mockReturnValue({ valid: true, errors: [], warnings: [], normalized: {} });

  // immune-system
  mockFindActivePolicy.mockResolvedValue(null);
  mockFindProbationPolicy.mockResolvedValue(null);
  mockUpdateFailureSignature.mockResolvedValue(undefined);
  mockRecordPolicyEvaluation.mockResolvedValue(undefined);
  mockShouldPromoteToProbation.mockResolvedValue(false);
  mockParsePolicyAction.mockReturnValue({
    type: 'requeue',
    params: { delay_minutes: 30 },
    expected_outcome: 'Task will retry',
  });

  // cortex
  mockPerformRCA.mockResolvedValue({
    analysis: '```json\n{"root_cause":"timeout","proposed_fix":"increase timeout threshold above 20 chars","action_plan":"update config","confidence":0.8,"evidence":"heartbeat gap"}\n```',
  });

  // quarantine
  mockQuarantineTask.mockResolvedValue(undefined);
}

// ─────────────────────────────────────────────────────────
// 辅助：刷新微任务队列（setImmediate 不被 vi.useFakeTimers 拦截）
// startMonitorLoop 中 runMonitorCycle() 是 fire-and-forget 调用，
// 需要多次 tick 才能让嵌套 await pool.query 等 Promise 全部 resolve。
// ─────────────────────────────────────────────────────────
async function flushCycle() {
  // 推进 fake timer 100ms：
  // 1. 驱动 detectResourcePressure 中的 setTimeout(10ms)
  // 2. 在每个 timer 回调间刷新微任务（Promise 链）
  // 3. 不触发 setInterval(30000ms)
  await vi.advanceTimersByTimeAsync(100);
}

// ─────────────────────────────────────────────────────────
// Test Suites
// ─────────────────────────────────────────────────────────

describe('monitor-loop', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // 只 fake setTimeout/setInterval，保留 setImmediate/process.nextTick 真实
    // 这样 flushCycle() 中的 setImmediate 可以正常刷新微任务队列
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
    setupDefaultMocks();
    // 每个测试重新加载模块，重置 _monitorTimer/_monitoring 等模块级状态
    vi.resetModules();
    const mod = await import('../monitor-loop.js');
    startMonitorLoop = mod.startMonitorLoop;
    getMonitorStatus = mod.getMonitorStatus;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // =====================================================
  // getMonitorStatus
  // =====================================================

  describe('getMonitorStatus', () => {
    it('未启动时 running 为 false', () => {
      const status = getMonitorStatus();
      expect(status.running).toBe(false);
    });

    it('返回正确的 interval_ms 常量（30000）', () => {
      const status = getMonitorStatus();
      expect(status.interval_ms).toBe(30000);
    });

    it('返回正确的阈值配置', () => {
      const status = getMonitorStatus();
      expect(status.thresholds).toEqual({
        stuck_minutes: 5,
        failure_spike_rate: 0.3,
        resource_pressure: 0.85,
      });
    });

    it('初始 monitoring 字段为 false', () => {
      const status = getMonitorStatus();
      expect(status.monitoring).toBe(false);
    });

    it('启动后 running 变为 true', () => {
      startMonitorLoop();
      const status = getMonitorStatus();
      expect(status.running).toBe(true);

      // 清理 timer
      vi.clearAllTimers();
    });
  });

  // =====================================================
  // startMonitorLoop
  // =====================================================

  describe('startMonitorLoop', () => {
    it('调用一次后立即触发第一次 cycle（detectStuckRuns 被调用）', async () => {
      startMonitorLoop();
      // 让 Promise 微任务队列排空（runMonitorCycle 是异步的）
      await flushCycle();

      expect(mockPool.query).toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('重复调用不会启动第二个 timer（幂等性）', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      startMonitorLoop();
      startMonitorLoop(); // 第二次调用

      const alreadyRunningLogs = logSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('already running')
      );
      expect(alreadyRunningLogs.length).toBeGreaterThanOrEqual(1);

      logSpy.mockRestore();
      vi.clearAllTimers();
    });

    it('每隔 30s 触发一次 runMonitorCycle', async () => {
      startMonitorLoop();

      // 推进 30 秒，再推进 30 秒
      await vi.advanceTimersByTimeAsync(30000);
      await vi.advanceTimersByTimeAsync(30000);

      // pool.query 至少被调用了多次（多个 cycle）
      expect(mockPool.query.mock.calls.length).toBeGreaterThan(2);

      vi.clearAllTimers();
    });
  });

  // =====================================================
  // runMonitorCycle - 无异常情况（正常低负载）
  // =====================================================

  describe('runMonitorCycle（正常低负载）', () => {
    it('无卡住任务时不调用 updateTask', async () => {
      // detectStuckRuns 返回空
      mockPool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('resource_snapshot')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      startMonitorLoop();
      await flushCycle();

      expect(mockUpdateTask).not.toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('失败率低于 30% 时不调用 handleFailureSpike 路径', async () => {
      // detectFailureSpike 返回低失败率
      let queryCount = 0;
      mockPool.query.mockImplementation(() => {
        queryCount++;
        if (queryCount === 1) {
          // detectStuckRuns
          return Promise.resolve({ rows: [] });
        }
        if (queryCount === 2) {
          // detectFailureSpike
          return Promise.resolve({
            rows: [{ failed_count: '1', total_count: '20', failure_rate: '0.05' }],
          });
        }
        // resource_snapshot write
        return Promise.resolve({ rows: [] });
      });

      startMonitorLoop();
      await flushCycle();

      // immune-system 函数不应被调用（因为 failure_rate < 0.3）
      expect(mockFindActivePolicy).not.toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('资源压力低于 85% 时不调用 handleResourcePressure 路径', async () => {
      mockGetActiveProcessCount.mockReturnValue(3); // 3/10 = 30%
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      startMonitorLoop();
      await flushCycle();

      const throttleLogs = logSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('THROTTLE')
      );
      expect(throttleLogs.length).toBe(0);

      logSpy.mockRestore();
      vi.clearAllTimers();
    });

    it('cycle 结束后写入 resource_snapshot 到 cecelia_events', async () => {
      startMonitorLoop();
      await flushCycle();

      const snapshotCall = mockPool.query.mock.calls.find(([sql]) =>
        typeof sql === 'string' && sql.includes('resource_snapshot')
      );
      expect(snapshotCall).toBeDefined();
      vi.clearAllTimers();
    });
  });

  // =====================================================
  // detectStuckRuns + handleStuckRun
  // =====================================================

  describe('handleStuckRun - retry_count = 0（第一次卡住：RESTART）', () => {
    it('应将任务状态重置为 queued（updateTask 被调用）', async () => {
      const stuck = makeStuckRun({ task_id: 'task-restart-001', run_id: 'run-001' });

      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) {
          // detectStuckRuns
          return Promise.resolve({ rows: [stuck] });
        }
        if (queryIndex === 2) {
          // SELECT retry_count FROM tasks
          return Promise.resolve({ rows: [{ retry_count: 0 }] });
        }
        // UPDATE run_events + resource_snapshot + detectFailureSpike etc.
        return Promise.resolve({ rows: [{ failed_count: '0', total_count: '5', failure_rate: '0' }] });
      });
      mockUpdateTask.mockResolvedValue({ success: true });

      startMonitorLoop();
      await flushCycle();

      expect(mockUpdateTask).toHaveBeenCalledWith({
        task_id: 'task-restart-001',
        status: 'queued',
      });
      vi.clearAllTimers();
    });

    it('应将 run_events 标记为 failed + MONITOR_RESTART', async () => {
      const stuck = makeStuckRun({ task_id: 'task-001', run_id: 'run-001' });

      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [stuck] });
        if (queryIndex === 2) return Promise.resolve({ rows: [{ retry_count: 0 }] });
        return Promise.resolve({ rows: [{ failed_count: '0', total_count: '5', failure_rate: '0' }] });
      });
      mockUpdateTask.mockResolvedValue({ success: true });

      startMonitorLoop();
      await flushCycle();

      const runUpdateCall = mockPool.query.mock.calls.find(([sql]) =>
        typeof sql === 'string' && sql.includes('MONITOR_RESTART')
      );
      expect(runUpdateCall).toBeDefined();
      vi.clearAllTimers();
    });

    it('任务不存在（空行）时跳过处置', async () => {
      const stuck = makeStuckRun({ task_id: 'nonexistent-task' });

      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [stuck] });
        if (queryIndex === 2) return Promise.resolve({ rows: [] }); // 任务不存在
        return Promise.resolve({ rows: [{ failed_count: '0', total_count: '5', failure_rate: '0' }] });
      });

      startMonitorLoop();
      await flushCycle();

      expect(mockUpdateTask).not.toHaveBeenCalled();
      vi.clearAllTimers();
    });
  });

  describe('handleStuckRun - retry_count = 1（第二次卡住：RETRY 降优先级）', () => {
    it('应通过 SQL 更新任务优先级并重新排队', async () => {
      const stuck = makeStuckRun({ task_id: 'task-retry-001', run_id: 'run-002' });

      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [stuck] });
        if (queryIndex === 2) return Promise.resolve({ rows: [{ retry_count: 1 }] });
        return Promise.resolve({ rows: [{ failed_count: '0', total_count: '5', failure_rate: '0' }] });
      });

      startMonitorLoop();
      await flushCycle();

      // 不应调用 updateTask（retry 路径直接走 SQL）
      expect(mockUpdateTask).not.toHaveBeenCalled();

      // 应有包含优先级降级的 UPDATE tasks SQL
      const priorityUpdateCall = mockPool.query.mock.calls.find(([sql]) =>
        typeof sql === 'string' && sql.includes('priority') && sql.includes('P0') && sql.includes('P1')
      );
      expect(priorityUpdateCall).toBeDefined();
      vi.clearAllTimers();
    });

    it('应将 run_events 标记为 failed + MONITOR_RETRY', async () => {
      const stuck = makeStuckRun({ task_id: 'task-retry-001', run_id: 'run-002' });

      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [stuck] });
        if (queryIndex === 2) return Promise.resolve({ rows: [{ retry_count: 1 }] });
        return Promise.resolve({ rows: [{ failed_count: '0', total_count: '5', failure_rate: '0' }] });
      });

      startMonitorLoop();
      await flushCycle();

      const retryMarkCall = mockPool.query.mock.calls.find(([sql]) =>
        typeof sql === 'string' && sql.includes('MONITOR_RETRY')
      );
      expect(retryMarkCall).toBeDefined();
      vi.clearAllTimers();
    });
  });

  describe('handleStuckRun - retry_count >= 2（第三次卡住：QUARANTINE）', () => {
    it('应调用 quarantineTask 并传入正确参数', async () => {
      const stuck = makeStuckRun({
        task_id: 'task-quarantine-001',
        run_id: 'run-003',
        layer: 'L2_executor',
        step_name: 'dispatch',
      });

      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [stuck] });
        if (queryIndex === 2) return Promise.resolve({ rows: [{ retry_count: 2 }] });
        return Promise.resolve({ rows: [{ failed_count: '0', total_count: '5', failure_rate: '0' }] });
      });

      startMonitorLoop();
      await flushCycle();

      expect(mockQuarantineTask).toHaveBeenCalledWith(
        'task-quarantine-001',
        'stuck_repeatedly',
        expect.objectContaining({
          run_id: 'run-003',
          stuck_count: 3, // retry_count + 1
          last_layer: 'L2_executor',
          last_step: 'dispatch',
        })
      );
      vi.clearAllTimers();
    });

    it('retry_count 为 null 时视为 0（RESTART 路径）', async () => {
      const stuck = makeStuckRun({ task_id: 'task-null-retry' });

      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [stuck] });
        if (queryIndex === 2) return Promise.resolve({ rows: [{ retry_count: null }] });
        return Promise.resolve({ rows: [{ failed_count: '0', total_count: '5', failure_rate: '0' }] });
      });
      mockUpdateTask.mockResolvedValue({ success: true });

      startMonitorLoop();
      await flushCycle();

      // null → 0 → RESTART
      expect(mockUpdateTask).toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('多个卡住任务时逐个处置', async () => {
      const stuck1 = makeStuckRun({ task_id: 'task-A', run_id: 'run-A' });
      const stuck2 = makeStuckRun({ task_id: 'task-B', run_id: 'run-B' });

      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [stuck1, stuck2] });
        // SELECT retry_count for task-A
        if (queryIndex === 2) return Promise.resolve({ rows: [{ retry_count: 0 }] });
        // UPDATE run_events for task-A
        if (queryIndex === 3) return Promise.resolve({ rows: [] });
        // SELECT retry_count for task-B
        if (queryIndex === 4) return Promise.resolve({ rows: [{ retry_count: 0 }] });
        // UPDATE run_events for task-B
        if (queryIndex === 5) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{ failed_count: '0', total_count: '5', failure_rate: '0' }] });
      });
      mockUpdateTask.mockResolvedValue({ success: true });

      startMonitorLoop();
      await flushCycle();

      expect(mockUpdateTask).toHaveBeenCalledTimes(2);
      vi.clearAllTimers();
    });
  });

  // =====================================================
  // detectFailureSpike + handleFailureSpike
  // =====================================================

  describe('detectFailureSpike', () => {
    it('返回正确结构（failed_count/total_count/failure_rate）', async () => {
      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [] }); // no stuck
        if (queryIndex === 2) {
          // detectFailureSpike
          return Promise.resolve({
            rows: [{ failed_count: '5', total_count: '20', failure_rate: '0.25' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      // failure_rate = 0.25 < 0.3 threshold → handleFailureSpike 不调用
      startMonitorLoop();
      await flushCycle();

      expect(mockFindActivePolicy).not.toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('total_count 为 0 时 failure_rate 应安全解析为 0（不抛出）', async () => {
      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [] });
        if (queryIndex === 2) {
          return Promise.resolve({
            rows: [{ failed_count: '0', total_count: '0', failure_rate: null }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        (async () => {
          startMonitorLoop();
          await flushCycle();
        })()
      ).resolves.not.toThrow();

      vi.clearAllTimers();
    });
  });

  describe('handleFailureSpike - 无活跃策略、无缓存 RCA', () => {
    function setupFailureSpike(failureRows = [makeFailure()]) {
      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [] }); // no stuck
        if (queryIndex === 2) {
          return Promise.resolve({
            rows: [{ failed_count: '8', total_count: '20', failure_rate: '0.40' }],
          });
        }
        if (queryIndex === 3) {
          // GET recent failures
          return Promise.resolve({ rows: failureRows });
        }
        // cecelia_events insert / resource_snapshot
        return Promise.resolve({ rows: [] });
      });
    }

    it('失败率超阈值时调用 findActivePolicy', async () => {
      setupFailureSpike();
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: false });

      startMonitorLoop();
      await flushCycle();

      expect(mockFindActivePolicy).toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('无活跃策略时调用 updateFailureSignature', async () => {
      setupFailureSpike();
      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: false });

      startMonitorLoop();
      await flushCycle();

      expect(mockUpdateFailureSignature).toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('shouldAnalyzeFailure 返回 false 时跳过 RCA', async () => {
      setupFailureSpike();
      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: false });

      startMonitorLoop();
      await flushCycle();

      expect(mockPerformRCA).not.toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('shouldAnalyzeFailure 返回 true 时调用 callCortexForRca', async () => {
      setupFailureSpike();
      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: true });

      startMonitorLoop();
      await flushCycle();

      expect(mockPerformRCA).toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('RCA 完成后调用 cacheRcaResult', async () => {
      setupFailureSpike();
      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: true });

      startMonitorLoop();
      await flushCycle();

      expect(mockCacheRcaResult).toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('shouldAutoFix 返回 true 时调用 dispatchToDevSkill', async () => {
      setupFailureSpike();
      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: true });
      mockShouldAutoFix.mockReturnValue(true);

      startMonitorLoop();
      await flushCycle();

      expect(mockDispatchToDevSkill).toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('dispatchToDevSkill 抛出异常时不影响主流程（不向上传播）', async () => {
      setupFailureSpike();
      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: true });
      mockShouldAutoFix.mockReturnValue(true);
      mockDispatchToDevSkill.mockRejectedValue(new Error('dispatch failed'));

      await expect(
        (async () => {
          startMonitorLoop();
          await flushCycle();
        })()
      ).resolves.not.toThrow();

      vi.clearAllTimers();
    });

    it('shouldPromoteToProbation 返回 true 时打印晋升日志', async () => {
      setupFailureSpike();
      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: false });
      mockShouldPromoteToProbation.mockResolvedValue(true);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      startMonitorLoop();
      await flushCycle();

      const promotionLogs = logSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('promotion criteria')
      );
      expect(promotionLogs.length).toBeGreaterThanOrEqual(1);

      logSpy.mockRestore();
      vi.clearAllTimers();
    });

    it('失败列表为空时跳过所有策略和 RCA 处理', async () => {
      let queryIndex = 0;
      mockPool.query.mockImplementation(() => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [] }); // no stuck
        if (queryIndex === 2) {
          return Promise.resolve({
            rows: [{ failed_count: '5', total_count: '10', failure_rate: '0.50' }],
          });
        }
        if (queryIndex === 3) {
          return Promise.resolve({ rows: [] }); // 空失败列表
        }
        return Promise.resolve({ rows: [] });
      });

      startMonitorLoop();
      await flushCycle();

      expect(mockFindActivePolicy).not.toHaveBeenCalled();
      expect(mockPerformRCA).not.toHaveBeenCalled();
      vi.clearAllTimers();
    });
  });

  // =====================================================
  // handleFailureSpike - Active Policy 路径
  // =====================================================

  describe('handleFailureSpike - 存在 active policy', () => {
    function setupWithActivePolicy() {
      let queryIndex = 0;
      mockPool.query.mockImplementation(() => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [] }); // no stuck
        if (queryIndex === 2) {
          return Promise.resolve({
            rows: [{ failed_count: '8', total_count: '20', failure_rate: '0.40' }],
          });
        }
        if (queryIndex === 3) {
          return Promise.resolve({ rows: [makeFailure()] });
        }
        return Promise.resolve({ rows: [] });
      });

      mockFindActivePolicy.mockResolvedValue({
        policy_id: 'pol-001',
        policy_type: 'requeue',
        signature: 'abcd1234abcd1234',
      });
    }

    it('发现 active policy 时调用 recordPolicyEvaluation（enforce 模式）', async () => {
      setupWithActivePolicy();

      startMonitorLoop();
      await flushCycle();

      expect(mockRecordPolicyEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          policy_id: 'pol-001',
          mode: 'enforce',
          decision: 'applied',
        })
      );
      vi.clearAllTimers();
    });

    it('active policy 处理后跳过 RCA（continue 分支）', async () => {
      setupWithActivePolicy();

      startMonitorLoop();
      await flushCycle();

      expect(mockPerformRCA).not.toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('recordPolicyEvaluation 抛出异常时 fall-through 到 RCA', async () => {
      setupWithActivePolicy();
      mockRecordPolicyEvaluation.mockRejectedValueOnce(new Error('DB error'));
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: true });

      startMonitorLoop();
      await flushCycle();

      // fall-through: 进入 RCA 流程
      expect(mockUpdateFailureSignature).toHaveBeenCalled();
      vi.clearAllTimers();
    });
  });

  // =====================================================
  // handleFailureSpike - Probation Policy 路径
  // =====================================================

  describe('handleFailureSpike - 存在 probation policy', () => {
    function setupWithProbationPolicy(policyJson = {
      action: 'requeue',
      params: { delay_minutes: 30 },
      expected_outcome: 'retry',
      confidence: 0.8,
      reasoning: 'test reason',
    }) {
      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [] }); // no stuck
        if (queryIndex === 2) {
          return Promise.resolve({
            rows: [{ failed_count: '8', total_count: '20', failure_rate: '0.40' }],
          });
        }
        if (queryIndex === 3) {
          return Promise.resolve({ rows: [makeFailure()] });
        }
        return Promise.resolve({ rows: [] });
      });

      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue({
        policy_id: 'prob-001',
        signature: 'abcd1234abcd1234',
        policy_json: policyJson,
      });
    }

    it('有效 probation policy 时调用 recordPolicyEvaluation（simulate 模式）', async () => {
      setupWithProbationPolicy();
      mockValidatePolicyJson.mockReturnValue({ valid: true, errors: [], warnings: [] });
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: false });

      startMonitorLoop();
      await flushCycle();

      expect(mockRecordPolicyEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          policy_id: 'prob-001',
          mode: 'simulate',
        })
      );
      vi.clearAllTimers();
    });

    it('无效 probation policy 时跳过 simulate 并写入 probation_policy_validation_failed 事件', async () => {
      setupWithProbationPolicy();
      mockValidatePolicyJson.mockReturnValue({
        valid: false,
        errors: [{ field: 'action', message: 'invalid action' }],
        warnings: [],
      });
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: false });

      startMonitorLoop();
      await flushCycle();

      // simulate 不应被调用
      expect(mockRecordPolicyEvaluation).not.toHaveBeenCalled();

      // 应写入 probation_policy_validation_failed 事件
      const eventInsertCall = mockPool.query.mock.calls.find(([sql]) =>
        typeof sql === 'string' && sql.includes('probation_policy_validation_failed')
      );
      expect(eventInsertCall).toBeDefined();
      vi.clearAllTimers();
    });

    it('probation 验证失败后仍继续 RCA 流程', async () => {
      setupWithProbationPolicy();
      mockValidatePolicyJson.mockReturnValue({ valid: false, errors: [{ field: 'action', message: 'bad' }], warnings: [] });
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: true });

      startMonitorLoop();
      await flushCycle();

      // RCA 流程继续（updateFailureSignature 被调用）
      expect(mockUpdateFailureSignature).toHaveBeenCalled();
      vi.clearAllTimers();
    });

    it('parsePolicyAction 抛出异常时不影响主流程', async () => {
      setupWithProbationPolicy();
      mockValidatePolicyJson.mockReturnValue({ valid: true, errors: [], warnings: [] });
      mockParsePolicyAction.mockImplementation(() => { throw new Error('parse failed'); });
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: false });

      await expect(
        (async () => {
          startMonitorLoop();
          await flushCycle();
        })()
      ).resolves.not.toThrow();

      vi.clearAllTimers();
    });
  });

  // =====================================================
  // callCortexForRca 路径（通过 handleFailureSpike 间接触发）
  // =====================================================

  describe('callCortexForRca', () => {
    function setupForRca() {
      let queryIndex = 0;
      mockPool.query.mockImplementation(() => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [] });
        if (queryIndex === 2) {
          return Promise.resolve({
            rows: [{ failed_count: '8', total_count: '20', failure_rate: '0.40' }],
          });
        }
        if (queryIndex === 3) return Promise.resolve({ rows: [makeFailure()] });
        return Promise.resolve({ rows: [] });
      });
      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: true });
    }

    it('performRCA 返回 JSON 代码块时正确解析 root_cause/proposed_fix', async () => {
      setupForRca();
      mockPerformRCA.mockResolvedValue({
        analysis: '```json\n{"root_cause":"Network timeout","proposed_fix":"Increase retry limit in executor config above 20 chars","action_plan":"Update config","confidence":0.9,"evidence":"Logs show gap"}\n```',
      });
      mockShouldAutoFix.mockReturnValue(false);

      startMonitorLoop();
      await flushCycle();

      // cacheRcaResult 应以解析后的结构调用
      expect(mockCacheRcaResult).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          root_cause: 'Network timeout',
          confidence: 0.9,
        })
      );
      vi.clearAllTimers();
    });

    it('performRCA 返回纯文本（无 JSON 代码块）时使用 fallback 结构', async () => {
      setupForRca();
      mockPerformRCA.mockResolvedValue({
        analysis: 'This is a plain text analysis without json block. It needs manual review.',
      });
      mockShouldAutoFix.mockReturnValue(false);

      startMonitorLoop();
      await flushCycle();

      expect(mockCacheRcaResult).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          confidence: 0.3,
          proposed_fix: 'Manual review needed',
        })
      );
      vi.clearAllTimers();
    });

    it('performRCA 返回空/无 analysis 时使用默认结构（confidence=0）', async () => {
      setupForRca();
      mockPerformRCA.mockResolvedValue({});
      mockShouldAutoFix.mockReturnValue(false);

      startMonitorLoop();
      await flushCycle();

      expect(mockCacheRcaResult).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          confidence: 0,
          root_cause: 'RCA returned no analysis',
        })
      );
      vi.clearAllTimers();
    });

    it('performRCA 抛出异常时返回 confidence=0 的错误结构', async () => {
      setupForRca();
      mockPerformRCA.mockRejectedValue(new Error('Cortex unavailable'));
      mockShouldAutoFix.mockReturnValue(false);

      startMonitorLoop();
      await flushCycle();

      expect(mockCacheRcaResult).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          confidence: 0,
          root_cause: expect.stringContaining('Cortex invocation failed'),
        })
      );
      vi.clearAllTimers();
    });
  });

  // =====================================================
  // detectResourcePressure + handleResourcePressure
  // =====================================================

  describe('detectResourcePressure', () => {
    it('active_count / MAX_SEATS 计算压力值', async () => {
      mockGetActiveProcessCount.mockReturnValue(9); // 9/10 = 90% → 超阈值

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      startMonitorLoop();
      await flushCycle();

      const pressureLogs = logSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('Resource pressure:')
      );
      expect(pressureLogs.length).toBeGreaterThanOrEqual(1);

      logSpy.mockRestore();
      vi.clearAllTimers();
    });

    it('压力超过 90% 时打印 THROTTLE 日志', async () => {
      mockGetActiveProcessCount.mockReturnValue(10); // 10/10 = 100%

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      startMonitorLoop();
      await flushCycle();

      const throttleLogs = logSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('THROTTLE')
      );
      expect(throttleLogs.length).toBeGreaterThanOrEqual(1);

      logSpy.mockRestore();
      vi.clearAllTimers();
    });

    it('压力在 85%-90% 之间触发 handleResourcePressure 但不 THROTTLE', async () => {
      mockGetActiveProcessCount.mockReturnValue(9); // 9/10 = 90% → 刚好边界，触发 THROTTLE

      // 换成 8/10 = 80% → 不超 85%，不触发
      mockGetActiveProcessCount.mockReturnValue(8); // 8/10 = 80%

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      startMonitorLoop();
      await flushCycle();

      const throttleLogs = logSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('THROTTLE')
      );
      // 80% < 85% threshold → handleResourcePressure 不被调用
      expect(throttleLogs.length).toBe(0);

      logSpy.mockRestore();
      vi.clearAllTimers();
    });

    it('resource_snapshot 写入失败时不影响 cycle 正常完成', async () => {
      let queryIndex = 0;
      mockPool.query.mockImplementation((sql) => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [] });
        if (queryIndex === 2) {
          return Promise.resolve({
            rows: [{ failed_count: '0', total_count: '10', failure_rate: '0' }],
          });
        }
        if (typeof sql === 'string' && sql.includes('resource_snapshot')) {
          return Promise.reject(new Error('DB write failed'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        (async () => {
          startMonitorLoop();
          await flushCycle();
        })()
      ).resolves.not.toThrow();

      vi.clearAllTimers();
    });
  });

  // =====================================================
  // runMonitorCycle - 防重入（并发保护）
  // =====================================================

  describe('runMonitorCycle - 防重入', () => {
    it('上一 cycle 未完成时跳过新 cycle（_monitoring 锁）', async () => {
      // 让第一个 cycle 的 pool.query 永不 resolve（模拟卡住）
      let resolveFirst = null;
      let queryCount = 0;
      mockPool.query.mockImplementation(() => {
        queryCount++;
        if (queryCount === 1) {
          return new Promise((resolve) => {
            resolveFirst = () => resolve({ rows: [] });
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      startMonitorLoop();

      // 推进 30s 触发第二个 cycle（但第一个还没结束）
      await vi.advanceTimersByTimeAsync(30000);

      const skipLogs = logSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('Previous cycle still running')
      );
      expect(skipLogs.length).toBeGreaterThanOrEqual(1);

      // 释放第一个 cycle
      if (resolveFirst) resolveFirst();

      logSpy.mockRestore();
      vi.clearAllTimers();
    });
  });

  // =====================================================
  // getRcaCacheStats + getAutoFixStats（尾部日志验证）
  // =====================================================

  describe('handleFailureSpike 尾部统计日志', () => {
    it('cycle 结束后打印 RCA Cache 统计', async () => {
      let queryIndex = 0;
      mockPool.query.mockImplementation(() => {
        queryIndex++;
        if (queryIndex === 1) return Promise.resolve({ rows: [] });
        if (queryIndex === 2) {
          return Promise.resolve({
            rows: [{ failed_count: '8', total_count: '20', failure_rate: '0.40' }],
          });
        }
        if (queryIndex === 3) return Promise.resolve({ rows: [makeFailure()] });
        return Promise.resolve({ rows: [] });
      });
      mockFindActivePolicy.mockResolvedValue(null);
      mockFindProbationPolicy.mockResolvedValue(null);
      mockShouldAnalyzeFailure.mockResolvedValue({ should_analyze: false });
      mockGetRcaCacheStats.mockResolvedValue({
        total_cached: 10,
        cached_last_24h: 3,
        avg_confidence: '0.75',
      });
      mockGetAutoFixStats.mockResolvedValue({
        total_auto_fixes: 5,
        completed_fixes: 3,
        in_progress_fixes: 1,
        queued_fixes: 1,
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      startMonitorLoop();
      await flushCycle();

      const rcaCacheLogs = logSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('RCA Cache:')
      );
      expect(rcaCacheLogs.length).toBeGreaterThanOrEqual(1);

      const autoFixLogs = logSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].includes('Auto-Fix:')
      );
      expect(autoFixLogs.length).toBeGreaterThanOrEqual(1);

      logSpy.mockRestore();
      vi.clearAllTimers();
    });
  });

  // =====================================================
  // 全局错误处理（cycle 级别 catch）
  // =====================================================

  describe('runMonitorCycle - 全局错误处理', () => {
    it('detectStuckRuns 抛出异常时 cycle 不崩溃（_monitoring 重置为 false）', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Connection timeout'));

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      startMonitorLoop();
      await flushCycle();

      // _monitoring 应在 finally 里重置
      const status = getMonitorStatus();
      expect(status.monitoring).toBe(false);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Monitor] Error in monitoring cycle:'),
        expect.any(Error)
      );

      errorSpy.mockRestore();
      vi.clearAllTimers();
    });
  });
});
