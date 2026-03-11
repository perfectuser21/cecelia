/**
 * trace.test.js - trace.js 单元测试（mock pool，无需真实数据库）
 *
 * 覆盖范围：
 * - 常量导出（EXECUTOR_HOSTS, STATUS, REASON_KIND, LAYER）
 * - sanitize() 数据清洗
 * - classifyError() 错误分类
 * - storeArtifact() / getArtifact() 制品管理
 * - traceStep() / TraceStep 生命周期（start/heartbeat/end/addArtifact）
 * - withSpan() 高阶包装器
 * - 查询辅助函数（getActiveRuns, getRunSummary, getStuckRuns, getTopFailureReasons, getLastAliveSpan）
 * - Hard Boundaries 验证
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 使用 vi.hoisted 确保 mockQuery 在 vi.mock 提升后仍可访问
const { mockQuery } = vi.hoisted(() => {
  return { mockQuery: vi.fn() };
});

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

// Mock crypto.randomUUID
let uuidCounter = 0;
vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomUUID: () => {
      uuidCounter++;
      return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
    },
  };
});

import {
  sanitize,
  classifyError,
  storeArtifact,
  getArtifact,
  traceStep,
  withSpan,
  getActiveRuns,
  getRunSummary,
  getStuckRuns,
  getTopFailureReasons,
  getLastAliveSpan,
  EXECUTOR_HOSTS,
  STATUS,
  REASON_KIND,
  LAYER,
} from '../trace.js';

describe('trace.js 单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    uuidCounter = 0;
    mockQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==================== 常量导出 ====================

  describe('常量导出', () => {
    it('EXECUTOR_HOSTS 包含所有预期主机', () => {
      expect(EXECUTOR_HOSTS).toEqual({
        US_VPS: 'us-vps',
        HK_VPS: 'hk-vps',
        HK_N8N: 'hk-n8n',
        MAC_MINI: 'mac-mini',
        XIAN_MAC_MINI: 'xian-mac-mini',
        NODE_PC: 'node-pc',
      });
    });

    it('STATUS 包含所有预期状态', () => {
      expect(STATUS).toEqual({
        QUEUED: 'queued',
        RUNNING: 'running',
        BLOCKED: 'blocked',
        RETRYING: 'retrying',
        SUCCESS: 'success',
        FAILED: 'failed',
        CANCELED: 'canceled',
      });
    });

    it('REASON_KIND 包含所有错误类型', () => {
      expect(REASON_KIND).toEqual({
        TRANSIENT: 'TRANSIENT',
        PERSISTENT: 'PERSISTENT',
        RESOURCE: 'RESOURCE',
        CONFIG: 'CONFIG',
        UNKNOWN: 'UNKNOWN',
      });
    });

    it('LAYER 包含所有执行层', () => {
      expect(LAYER).toEqual({
        L0_ORCHESTRATOR: 'L0_orchestrator',
        L1_BRAIN: 'L1_brain',
        L2_EXECUTOR: 'L2_executor',
        L3_BROWSER: 'L3_browser',
        L4_ARTIFACT: 'L4_artifact',
      });
    });
  });

  // ==================== sanitize() ====================

  describe('sanitize() 数据清洗', () => {
    it('脱敏包含 password 的键', () => {
      const result = sanitize({ password: 'secret123' });
      expect(result.password).toBe('[REDACTED]');
    });

    it('脱敏包含 token 的键', () => {
      const result = sanitize({ access_token: 'tok-abc' });
      expect(result.access_token).toBe('[REDACTED]');
    });

    it('脱敏包含 api_key 的键', () => {
      const result = sanitize({ api_key: 'key-123' });
      expect(result.api_key).toBe('[REDACTED]');
    });

    it('脱敏包含 secret 的键', () => {
      const result = sanitize({ my_secret: 'shh' });
      expect(result.my_secret).toBe('[REDACTED]');
    });

    it('脱敏包含 authorization 的键', () => {
      const result = sanitize({ authorization: 'Bearer xxx' });
      expect(result.authorization).toBe('[REDACTED]');
    });

    it('保留非敏感键', () => {
      const result = sanitize({ username: 'test', value: 42 });
      expect(result.username).toBe('test');
      expect(result.value).toBe(42);
    });

    it('递归脱敏嵌套对象', () => {
      const result = sanitize({
        data: {
          token: 'abc',
          info: { private_key: 'pem-data', name: 'test' },
        },
      });
      expect(result.data.token).toBe('[REDACTED]');
      expect(result.data.info.private_key).toBe('[REDACTED]');
      expect(result.data.info.name).toBe('test');
    });

    it('处理数组输入', () => {
      const result = sanitize([
        { password: 'x', val: 1 },
        { credential: 'y', val: 2 },
      ]);
      expect(result[0].password).toBe('[REDACTED]');
      expect(result[0].val).toBe(1);
      expect(result[1].credential).toBe('[REDACTED]');
      expect(result[1].val).toBe(2);
    });

    it('处理嵌套数组', () => {
      const result = sanitize({
        items: [{ token: 'abc' }, { name: 'ok' }],
      });
      expect(result.items[0].token).toBe('[REDACTED]');
      expect(result.items[1].name).toBe('ok');
    });

    it('null 输入返回 null', () => {
      expect(sanitize(null)).toBe(null);
    });

    it('undefined 输入返回 undefined', () => {
      expect(sanitize(undefined)).toBe(undefined);
    });

    it('数字输入直接返回', () => {
      expect(sanitize(42)).toBe(42);
    });

    it('字符串输入直接返回', () => {
      expect(sanitize('hello')).toBe('hello');
    });

    it('布尔值输入直接返回', () => {
      expect(sanitize(true)).toBe(true);
    });

    it('空对象返回空对象', () => {
      expect(sanitize({})).toEqual({});
    });

    it('键名大小写匹配（lowerKey.includes 逻辑）', () => {
      const result = sanitize({ PASSWORD: 'x', ApiKey: 'y', TOKEN: 'z' });
      expect(result.PASSWORD).toBe('[REDACTED]');
      // ApiKey → lowerKey='apikey'，SENSITIVE_KEYS 中 'apiKey' 不被 includes 匹配
      expect(result.ApiKey).toBe('y');
      expect(result.TOKEN).toBe('[REDACTED]');
    });

    it('部分匹配也会脱敏（如 session_id）', () => {
      const result = sanitize({ session_id: 'sess-123', refresh_token: 'rt' });
      expect(result.session_id).toBe('[REDACTED]');
      expect(result.refresh_token).toBe('[REDACTED]');
    });
  });

  // ==================== classifyError() ====================

  describe('classifyError() 错误分类', () => {
    describe('TRANSIENT 错误（网络/超时/限速）', () => {
      it.each([
        ['timeout', 'Connection timeout'],
        ['ETIMEDOUT', 'ETIMEDOUT error'],
        ['ECONNRESET', 'ECONNRESET by peer'],
        ['ECONNREFUSED', 'ECONNREFUSED on port 5432'],
        ['429', 'HTTP 429 Too Many Requests'],
      ])('消息包含 "%s" -> TRANSIENT', (_, msg) => {
        const result = classifyError(new Error(msg));
        expect(result.reason_code).toBe('TIMEOUT');
        expect(result.reason_kind).toBe(REASON_KIND.TRANSIENT);
      });

      it('error.code = ENOTFOUND -> TRANSIENT', () => {
        const err = new Error('DNS error');
        err.code = 'ENOTFOUND';
        const result = classifyError(err);
        expect(result.reason_code).toBe('TIMEOUT');
        expect(result.reason_kind).toBe(REASON_KIND.TRANSIENT);
      });

      it('error.code = ETIMEDOUT -> TRANSIENT', () => {
        const err = new Error('generic');
        err.code = 'ETIMEDOUT';
        const result = classifyError(err);
        expect(result.reason_code).toBe('TIMEOUT');
        expect(result.reason_kind).toBe(REASON_KIND.TRANSIENT);
      });
    });

    describe('RESOURCE 错误（资源耗尽）', () => {
      it.each([
        ['out of memory', 'out of memory'],
        ['ENOMEM', 'ENOMEM: cannot allocate'],
        ['disk full', 'disk full'],
        ['ENOSPC', 'ENOSPC: no space left'],
        ['resource exhausted', 'resource exhausted'],
      ])('消息包含 "%s" -> RESOURCE', (_, msg) => {
        const result = classifyError(new Error(msg));
        expect(result.reason_code).toBe('RESOURCE_EXHAUSTED');
        expect(result.reason_kind).toBe(REASON_KIND.RESOURCE);
      });
    });

    describe('CONFIG 错误（配置/文件缺失）', () => {
      it.each([
        ['not found', 'file not found'],
        ['ENOENT', 'ENOENT: no such file'],
        ['invalid config', 'invalid config for brain'],
        ['missing required', 'missing required field: name'],
      ])('消息包含 "%s" -> CONFIG', (_, msg) => {
        const result = classifyError(new Error(msg));
        expect(result.reason_code).toBe('CONFIG_ERROR');
        expect(result.reason_kind).toBe(REASON_KIND.CONFIG);
      });
    });

    describe('PERSISTENT 错误（认证）', () => {
      it.each([
        ['auth', 'auth failed'],
        ['unauthorized', 'unauthorized access'],
        ['403', 'HTTP 403 Forbidden'],
        ['401', 'HTTP 401 Unauthorized'],
      ])('消息包含 "%s" -> PERSISTENT', (_, msg) => {
        const result = classifyError(new Error(msg));
        expect(result.reason_code).toBe('AUTH_OR_SELECTOR_ERROR');
        expect(result.reason_kind).toBe(REASON_KIND.PERSISTENT);
      });
    });

    describe('"not found" 优先匹配 CONFIG（代码顺序）', () => {
      it.each([
        ['selector not found', 'selector not found: #btn'],
        ['element not found', 'element not found on page'],
      ])('消息包含 "%s" -> CONFIG（先于 PERSISTENT 匹配）', (_, msg) => {
        const result = classifyError(new Error(msg));
        expect(result.reason_code).toBe('CONFIG_ERROR');
        expect(result.reason_kind).toBe(REASON_KIND.CONFIG);
      });
    });

    describe('UNKNOWN 错误（默认）', () => {
      it('无法识别的错误消息 -> UNKNOWN', () => {
        const result = classifyError(new Error('something unexpected'));
        expect(result.reason_code).toBe('UNKNOWN_ERROR');
        expect(result.reason_kind).toBe(REASON_KIND.UNKNOWN);
      });

      it('空错误消息 -> UNKNOWN', () => {
        const result = classifyError(new Error(''));
        expect(result.reason_code).toBe('UNKNOWN_ERROR');
        expect(result.reason_kind).toBe(REASON_KIND.UNKNOWN);
      });
    });

    it('非 Error 对象（仅有 toString）也能分类', () => {
      const fakeError = { toString: () => 'Connection timeout occurred' };
      const result = classifyError(fakeError);
      expect(result.reason_code).toBe('TIMEOUT');
      expect(result.reason_kind).toBe(REASON_KIND.TRANSIENT);
    });
  });

  // ==================== storeArtifact() ====================

  describe('storeArtifact() 制品存储', () => {
    it('插入制品并返回 UUID', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const id = await storeArtifact(
        'span-1',
        'screenshot',
        'local',
        '/tmp/test.png',
        { contentType: 'image/png', sizeBytes: 1024 }
      );

      expect(id).toMatch(/^00000000-0000-0000-0000-/);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO run_artifacts'),
        expect.arrayContaining([
          expect.any(String), // artifactId
          'span-1',
          'screenshot',
          'local',
          '/tmp/test.png',
          'image/png',
          1024,
          null,      // expiresAt
          null,      // metadata
        ])
      );
    });

    it('不传 options 时可选字段为 null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await storeArtifact('span-2', 'log', 's3', 's3://logs/run.log');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO run_artifacts'),
        expect.arrayContaining([
          expect.any(String),
          'span-2',
          'log',
          's3',
          's3://logs/run.log',
          null, // contentType
          null, // sizeBytes
          null, // expiresAt
          null, // metadata
        ])
      );
    });

    it('metadata 被 JSON.stringify 处理', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const meta = { key: 'value' };

      await storeArtifact('span-3', 'diff', 'nas', '/nas/diff.patch', {
        metadata: meta,
      });

      const callArgs = mockQuery.mock.calls[0][1];
      expect(callArgs[8]).toBe(JSON.stringify(meta));
    });

    it('传入 expiresAt 时正确传递', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const expires = '2026-12-31T23:59:59Z';

      await storeArtifact('span-4', 'video', 'local', '/tmp/v.mp4', {
        expiresAt: expires,
      });

      const callArgs = mockQuery.mock.calls[0][1];
      expect(callArgs[7]).toBe(expires);
    });
  });

  // ==================== getArtifact() ====================

  describe('getArtifact() 制品查询', () => {
    it('找到制品时返回行数据', async () => {
      const row = { id: 'art-1', artifact_type: 'screenshot' };
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await getArtifact('art-1');
      expect(result).toEqual(row);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM run_artifacts WHERE id'),
        ['art-1']
      );
    });

    it('未找到时返回 null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getArtifact('non-existent');
      expect(result).toBeNull();
    });
  });

  // ==================== traceStep() / TraceStep ====================

  describe('traceStep() 创建与生命周期', () => {
    it('创建 TraceStep 时生成唯一 spanId（Hard Boundary #2）', () => {
      uuidCounter = 0;
      const step1 = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'step-a',
      });
      const step2 = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'step-b',
      });

      expect(step1.spanId).not.toBe(step2.spanId);
    });

    it('继承 runId（Hard Boundary #1）', () => {
      const step = traceStep({
        runId: 'my-run-id',
        layer: LAYER.L1_BRAIN,
        stepName: 'test',
      });
      expect(step.runId).toBe('my-run-id');
    });

    it('初始状态为 queued', () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });
      expect(step.status).toBe(STATUS.QUEUED);
    });

    it('可选字段有默认值', () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      expect(step.taskId).toBeNull();
      expect(step.parentSpanId).toBeNull();
      expect(step.executorHost).toBeNull();
      expect(step.agent).toBeNull();
      expect(step.region).toBeNull();
      expect(step.attempt).toBe(1);
      expect(step.inputSummary).toEqual({});
      expect(step.metadata).toEqual({});
      expect(step.artifacts).toEqual({});
      expect(step.heartbeatInterval).toBeNull();
    });

    it('传入所有字段时正确赋值', () => {
      const step = traceStep({
        taskId: 'task-1',
        runId: 'run-1',
        parentSpanId: 'parent-span',
        layer: LAYER.L2_EXECUTOR,
        stepName: 'execute',
        executorHost: EXECUTOR_HOSTS.HK_VPS,
        agent: 'caramel',
        region: 'hk',
        attempt: 3,
        inputSummary: { cmd: 'test' },
        metadata: { env: 'prod' },
      });

      expect(step.taskId).toBe('task-1');
      expect(step.parentSpanId).toBe('parent-span');
      expect(step.executorHost).toBe('hk-vps');
      expect(step.agent).toBe('caramel');
      expect(step.region).toBe('hk');
      expect(step.attempt).toBe(3);
      expect(step.metadata).toEqual({ env: 'prod' });
    });

    it('inputSummary 在构造时被 sanitize 处理', () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
        inputSummary: { token: 'secret', name: 'ok' },
      });

      expect(step.inputSummary.token).toBe('[REDACTED]');
      expect(step.inputSummary.name).toBe('ok');
    });
  });

  describe('TraceStep.start() 启动', () => {
    it('插入 run_events 并设置 status=running', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test_start',
        executorHost: EXECUTOR_HOSTS.US_VPS,
        agent: 'agent-1',
        region: 'us',
      });

      await step.start();

      expect(step.status).toBe(STATUS.RUNNING);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO run_events'),
        expect.arrayContaining([
          step.spanId,
          null,        // taskId
          'run-1',
          null,        // parentSpanId
          LAYER.L0_ORCHESTRATOR,
          'test_start',
          STATUS.RUNNING,
          EXECUTOR_HOSTS.US_VPS,
          'agent-1',
          'us',
          1,           // attempt
          expect.any(String), // inputSummary JSON
          expect.any(String), // metadata JSON
        ])
      );

      step.stopHeartbeat();
    });

    it('start() 启动心跳定时器', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      await step.start();

      expect(step.heartbeatInterval).not.toBeNull();

      step.stopHeartbeat();
    });
  });

  describe('TraceStep.heartbeat() 心跳', () => {
    it('status=running 时更新心跳时间戳', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      await step.start();
      mockQuery.mockClear();

      await step.heartbeat();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE run_events SET heartbeat_ts'),
        [step.spanId]
      );

      step.stopHeartbeat();
    });

    it('status=blocked 时仍允许心跳', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      step.status = STATUS.BLOCKED;
      mockQuery.mockClear();

      await step.heartbeat();

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('status 不是 running/blocked 时跳过心跳（Hard Boundary #4）', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      step.status = STATUS.SUCCESS;
      mockQuery.mockClear();

      await step.heartbeat();

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('status=queued 时跳过心跳', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      // 默认 status 是 queued
      mockQuery.mockClear();
      await step.heartbeat();

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('自动心跳每 30 秒触发一次', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      await step.start();
      mockQuery.mockClear();

      // 推进 30 秒
      await vi.advanceTimersByTimeAsync(30000);

      // 应该触发一次心跳
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE run_events SET heartbeat_ts'),
        [step.spanId]
      );

      step.stopHeartbeat();
    });
  });

  describe('TraceStep.startHeartbeat() / stopHeartbeat()', () => {
    it('重复调用 startHeartbeat 不会创建多个定时器', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      await step.start();
      const firstInterval = step.heartbeatInterval;

      step.startHeartbeat(); // 重复调用
      expect(step.heartbeatInterval).toBe(firstInterval);

      step.stopHeartbeat();
    });

    it('stopHeartbeat 清除定时器并设为 null', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      await step.start();
      expect(step.heartbeatInterval).not.toBeNull();

      step.stopHeartbeat();
      expect(step.heartbeatInterval).toBeNull();
    });

    it('对已停止的心跳再次 stop 不报错', () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      // heartbeatInterval 初始为 null
      expect(() => step.stopHeartbeat()).not.toThrow();
    });
  });

  describe('TraceStep.end() 结束', () => {
    it('成功结束时更新 status 并停止心跳（Hard Boundary #4）', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test_end',
      });

      await step.start();
      mockQuery.mockClear();

      await step.end({
        status: STATUS.SUCCESS,
        outputSummary: { result: 'done' },
      });

      expect(step.status).toBe(STATUS.SUCCESS);
      expect(step.heartbeatInterval).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE run_events'),
        [
          STATUS.SUCCESS,
          JSON.stringify({ result: 'done' }),
          null,  // reason_code
          null,  // reason_kind
          null,  // artifacts
          step.spanId,
        ]
      );
    });

    it('失败结束时自动分类错误', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test_fail',
      });

      await step.start();
      mockQuery.mockClear();

      await step.end({
        status: STATUS.FAILED,
        error: new Error('Connection timeout'),
      });

      expect(step.status).toBe(STATUS.FAILED);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE run_events'),
        [
          STATUS.FAILED,
          null,        // outputSummary
          'TIMEOUT',   // reason_code
          'TRANSIENT', // reason_kind
          null,        // artifacts
          step.spanId,
        ]
      );
    });

    it('取消时不带错误分类', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test_cancel',
      });

      await step.start();
      mockQuery.mockClear();

      await step.end({
        status: STATUS.CANCELED,
      });

      expect(step.status).toBe(STATUS.CANCELED);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE run_events'),
        expect.arrayContaining([
          STATUS.CANCELED,
          null,  // outputSummary
          null,  // reason_code
          null,  // reason_kind
        ])
      );
    });

    it('outputSummary 被 sanitize 处理', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test_sanitize',
      });

      await step.start();
      mockQuery.mockClear();

      await step.end({
        status: STATUS.SUCCESS,
        outputSummary: { token: 'secret', value: 42 },
      });

      const callArgs = mockQuery.mock.calls[0][1];
      const outputJson = JSON.parse(callArgs[1]);
      expect(outputJson.token).toBe('[REDACTED]');
      expect(outputJson.value).toBe(42);
    });

    it('传入 artifacts 时 JSON.stringify', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test_artifacts',
      });

      await step.start();
      mockQuery.mockClear();

      const arts = { screenshot_id: 'art-123' };
      await step.end({
        status: STATUS.SUCCESS,
        artifacts: arts,
      });

      const callArgs = mockQuery.mock.calls[0][1];
      expect(callArgs[4]).toBe(JSON.stringify(arts));
    });
  });

  describe('TraceStep.addArtifact() 添加制品', () => {
    it('存储制品并更新 artifacts 映射（Hard Boundary #5）', async () => {
      uuidCounter = 0;
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test_add_art',
      });

      // start() 会调用一次 query（INSERT run_events）
      await step.start();
      mockQuery.mockClear();

      const artifactId = await step.addArtifact(
        'screenshot',
        'local',
        '/tmp/test.png',
        { contentType: 'image/png' }
      );

      expect(artifactId).toMatch(/^00000000-0000-0000-0000-/);

      // 应该调用两次：1) INSERT run_artifacts 2) UPDATE run_events.artifacts
      expect(mockQuery).toHaveBeenCalledTimes(2);

      // 验证 artifacts 映射格式：{type}_id
      expect(step.artifacts).toEqual({
        screenshot_id: artifactId,
      });

      // 验证第二次调用更新了 run_events.artifacts
      expect(mockQuery).toHaveBeenNthCalledWith(2,
        expect.stringContaining('UPDATE run_events SET artifacts'),
        [JSON.stringify({ screenshot_id: artifactId }), step.spanId]
      );

      step.stopHeartbeat();
    });

    it('多个制品累积到 artifacts 映射', async () => {
      uuidCounter = 0;
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test_multi_art',
      });

      await step.start();

      await step.addArtifact('screenshot', 'local', '/tmp/s.png');
      await step.addArtifact('log', 'local', '/tmp/l.txt');

      expect(step.artifacts).toHaveProperty('screenshot_id');
      expect(step.artifacts).toHaveProperty('log_id');

      step.stopHeartbeat();
    });
  });

  // ==================== withSpan() ====================

  describe('withSpan() 高阶包装器', () => {
    it('成功时返回函数结果并记录 trace', async () => {
      const fn = vi.fn().mockResolvedValue(42);
      const wrapped = withSpan(fn, {
        runId: 'run-1',
        layer: LAYER.L2_EXECUTOR,
        stepName: 'compute',
      });

      const result = await wrapped('arg1', 'arg2');

      expect(result).toBe(42);
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');

      // 至少 2 次 DB 调用：start (INSERT) + end (UPDATE)
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO run_events'),
        expect.any(Array)
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE run_events'),
        expect.arrayContaining([STATUS.SUCCESS])
      );
    });

    it('失败时记录错误并重新抛出', async () => {
      const err = new Error('boom');
      const fn = vi.fn().mockRejectedValue(err);
      const wrapped = withSpan(fn, {
        runId: 'run-2',
        layer: LAYER.L2_EXECUTOR,
        stepName: 'failing',
      });

      await expect(wrapped()).rejects.toThrow('boom');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE run_events'),
        expect.arrayContaining([STATUS.FAILED])
      );
    });

    it('原始函数参数正确传递', async () => {
      const fn = vi.fn().mockImplementation((a, b) => Promise.resolve(a + b));
      const wrapped = withSpan(fn, {
        runId: 'run-3',
        layer: LAYER.L1_BRAIN,
        stepName: 'add',
      });

      const result = await wrapped(3, 7);
      expect(result).toBe(10);
      expect(fn).toHaveBeenCalledWith(3, 7);
    });
  });

  // ==================== 查询辅助函数 ====================

  describe('查询辅助函数', () => {
    it('getActiveRuns() 查询 v_active_runs 视图', async () => {
      const rows = [{ run_id: 'r1' }, { run_id: 'r2' }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await getActiveRuns();
      expect(result).toEqual(rows);
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM v_active_runs');
    });

    it('getActiveRuns() 无数据时返回空数组', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await getActiveRuns();
      expect(result).toEqual([]);
    });

    it('getRunSummary() 按 runId 查询 v_run_summary', async () => {
      const row = { run_id: 'r1', total_spans: 5 };
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await getRunSummary('r1');
      expect(result).toEqual(row);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('v_run_summary'),
        ['r1']
      );
    });

    it('getRunSummary() 未找到时返回 null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await getRunSummary('non-existent');
      expect(result).toBeNull();
    });

    it('getStuckRuns() 调用 detect_stuck_runs() 函数', async () => {
      const rows = [{ span_id: 's1', minutes_stuck: 10 }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await getStuckRuns();
      expect(result).toEqual(rows);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('detect_stuck_runs()')
      );
    });

    it('getTopFailureReasons() 查询 v_top_failure_reasons', async () => {
      const rows = [{ reason_code: 'TIMEOUT', count: 42 }];
      mockQuery.mockResolvedValueOnce({ rows });

      const result = await getTopFailureReasons();
      expect(result).toEqual(rows);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('v_top_failure_reasons')
      );
    });

    it('getLastAliveSpan() 按 runId 查询', async () => {
      const row = { run_id: 'r1', span_id: 's1' };
      mockQuery.mockResolvedValueOnce({ rows: [row] });

      const result = await getLastAliveSpan('r1');
      expect(result).toEqual(row);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('v_run_last_alive_span'),
        ['r1']
      );
    });

    it('getLastAliveSpan() 未找到时返回 null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await getLastAliveSpan('non-existent');
      expect(result).toBeNull();
    });
  });

  // ==================== Hard Boundaries 综合验证 ====================

  describe('Hard Boundaries 综合验证', () => {
    it('HB#1: runId 从调用方传入，不自动生成', () => {
      const step = traceStep({
        runId: 'custom-run-id-abc',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });
      expect(step.runId).toBe('custom-run-id-abc');
    });

    it('HB#2: 每个 TraceStep 有独立的 spanId', () => {
      uuidCounter = 0;
      const steps = Array.from({ length: 5 }, (_, i) =>
        traceStep({
          runId: 'same-run',
          layer: LAYER.L0_ORCHESTRATOR,
          stepName: `step-${i}`,
        })
      );

      const spanIds = steps.map(s => s.spanId);
      const uniqueIds = new Set(spanIds);
      expect(uniqueIds.size).toBe(5);
    });

    it('HB#3: STATUS 枚举包含所有状态机状态', () => {
      const expected = ['queued', 'running', 'blocked', 'retrying', 'success', 'failed', 'canceled'];
      const values = Object.values(STATUS);
      for (const s of expected) {
        expect(values).toContain(s);
      }
    });

    it('HB#4: end() 后心跳停止', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      await step.start();
      expect(step.heartbeatInterval).not.toBeNull();

      await step.end({ status: STATUS.SUCCESS });
      expect(step.heartbeatInterval).toBeNull();

      // end 之后 heartbeat() 不应发起 DB 调用
      mockQuery.mockClear();
      await step.heartbeat();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('HB#5: artifacts 格式为 {type}_id: uuid', async () => {
      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      await step.start();
      await step.addArtifact('screenshot', 'local', '/tmp/s.png');

      const keys = Object.keys(step.artifacts);
      expect(keys).toEqual(['screenshot_id']);

      step.stopHeartbeat();
    });

    it('HB#6: EXECUTOR_HOSTS 值全部为小写连字符格式（含数字）', () => {
      for (const host of Object.values(EXECUTOR_HOSTS)) {
        expect(host).toMatch(/^[a-z]+(-[a-z0-9]+)+$/);
      }
    });

    it('HB#7: REASON_KIND 值全部为大写', () => {
      for (const kind of Object.values(REASON_KIND)) {
        expect(kind).toMatch(/^[A-Z]+$/);
      }
    });
  });

  // ==================== 错误处理 ====================

  describe('错误处理', () => {
    it('心跳失败时打印错误但不中断', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const step = traceStep({
        runId: 'run-1',
        layer: LAYER.L0_ORCHESTRATOR,
        stepName: 'test',
      });

      await step.start();

      // 让下一次心跳 DB 调用失败
      mockQuery.mockRejectedValueOnce(new Error('DB down'));

      // 推进 30 秒触发心跳
      await vi.advanceTimersByTimeAsync(30000);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Heartbeat failed'),
        expect.any(Error)
      );

      step.stopHeartbeat();
      consoleSpy.mockRestore();
    });
  });
});
