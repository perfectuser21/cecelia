/**
 * trace-routes.test.js - trace-routes.js 单元测试（mock trace.js + fs，无需真实 DB）
 *
 * 覆盖范围：
 * - GET /runs/active
 * - GET /runs/:run_id
 * - GET /runs/:run_id/last-alive
 * - GET /failures/top
 * - GET /stuck
 * - GET /artifacts/:id
 * - GET /artifacts/:id/download（local / s3 / nas / unknown 后端 + 路径穿越防护）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted 确保 mock 函数在模块提升后仍可访问
const {
  mockGetActiveRuns,
  mockGetRunSummary,
  mockGetLastAliveSpan,
  mockGetTopFailureReasons,
  mockGetStuckRuns,
  mockGetArtifact,
  mockFsReadFile,
} = vi.hoisted(() => ({
  mockGetActiveRuns: vi.fn(),
  mockGetRunSummary: vi.fn(),
  mockGetLastAliveSpan: vi.fn(),
  mockGetTopFailureReasons: vi.fn(),
  mockGetStuckRuns: vi.fn(),
  mockGetArtifact: vi.fn(),
  mockFsReadFile: vi.fn(),
}));

// Mock trace.js（所有查询辅助函数）
vi.mock('../trace.js', () => ({
  getActiveRuns: mockGetActiveRuns,
  getRunSummary: mockGetRunSummary,
  getLastAliveSpan: mockGetLastAliveSpan,
  getTopFailureReasons: mockGetTopFailureReasons,
  getStuckRuns: mockGetStuckRuns,
  getArtifact: mockGetArtifact,
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: { readFile: mockFsReadFile },
}));

// 动态 import（在 mock 之后）
const { default: router } = await import('../trace-routes.js');

// ==================== 测试工具函数 ====================

/**
 * 创建 mock req / res 对象
 * res 模拟 Express 的链式 API：status().json()、setHeader()、send()
 */
function mockReqRes(params = {}, query = {}) {
  const req = { params, query };
  const res = {
    _status: 200,
    _data: undefined,
    _sent: undefined,
    _headers: {},
    json(data) {
      this._data = data;
      return this;
    },
    status(code) {
      this._status = code;
      return this;
    },
    setHeader(key, value) {
      this._headers[key] = value;
      return this;
    },
    send(data) {
      this._sent = data;
      return this;
    },
  };
  return { req, res };
}

/**
 * 从 router.stack 中按 HTTP 方法和路径查找处理器
 */
function getHandler(method, routePath) {
  const layers = router.stack.filter(
    (l) => l.route && l.route.methods[method] && l.route.path === routePath
  );
  if (layers.length === 0) {
    throw new Error(`未找到处理器: ${method.toUpperCase()} ${routePath}`);
  }
  return layers[0].route.stack[0].handle;
}

// ==================== 测试套件 ====================

describe('trace-routes.js 路由单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== GET /runs/active ====================

  describe('GET /runs/active', () => {
    const handler = getHandler('get', '/runs/active');

    it('正常返回活跃运行列表', async () => {
      const rows = [
        { run_id: 'r1', status: 'running' },
        { run_id: 'r2', status: 'running' },
      ];
      mockGetActiveRuns.mockResolvedValueOnce(rows);

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data).toEqual({
        success: true,
        data: rows,
        count: 2,
      });
    });

    it('无活跃运行时返回空数组和 count=0', async () => {
      mockGetActiveRuns.mockResolvedValueOnce([]);

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.success).toBe(true);
      expect(res._data.data).toEqual([]);
      expect(res._data.count).toBe(0);
    });

    it('数据库异常时返回 500', async () => {
      mockGetActiveRuns.mockRejectedValueOnce(new Error('DB connection lost'));

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('DB connection lost');
    });
  });

  // ==================== GET /runs/:run_id ====================

  describe('GET /runs/:run_id', () => {
    const handler = getHandler('get', '/runs/:run_id');

    it('找到 run 时返回 summary 数据', async () => {
      const summary = {
        run_id: 'abc-123',
        total_spans: 5,
        failed_spans: 0,
      };
      mockGetRunSummary.mockResolvedValueOnce(summary);

      const { req, res } = mockReqRes({ run_id: 'abc-123' });
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data).toEqual({ success: true, data: summary });
      expect(mockGetRunSummary).toHaveBeenCalledWith('abc-123');
    });

    it('run 不存在时返回 404', async () => {
      mockGetRunSummary.mockResolvedValueOnce(null);

      const { req, res } = mockReqRes({ run_id: 'nonexistent' });
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Run not found');
    });

    it('数据库异常时返回 500', async () => {
      mockGetRunSummary.mockRejectedValueOnce(new Error('query timeout'));

      const { req, res } = mockReqRes({ run_id: 'r1' });
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('query timeout');
    });
  });

  // ==================== GET /runs/:run_id/last-alive ====================

  describe('GET /runs/:run_id/last-alive', () => {
    const handler = getHandler('get', '/runs/:run_id/last-alive');

    it('找到最后存活 span 时正常返回', async () => {
      const lastAlive = {
        run_id: 'run-xyz',
        span_id: 'span-001',
        heartbeat_ts: '2026-03-06T10:00:00Z',
      };
      mockGetLastAliveSpan.mockResolvedValueOnce(lastAlive);

      const { req, res } = mockReqRes({ run_id: 'run-xyz' });
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data).toEqual({ success: true, data: lastAlive });
      expect(mockGetLastAliveSpan).toHaveBeenCalledWith('run-xyz');
    });

    it('run 不存在时返回 404', async () => {
      mockGetLastAliveSpan.mockResolvedValueOnce(null);

      const { req, res } = mockReqRes({ run_id: 'missing-run' });
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Run not found');
    });

    it('数据库异常时返回 500', async () => {
      mockGetLastAliveSpan.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { req, res } = mockReqRes({ run_id: 'r1' });
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('ECONNREFUSED');
    });
  });

  // ==================== GET /failures/top ====================

  describe('GET /failures/top', () => {
    const handler = getHandler('get', '/failures/top');

    it('正常返回失败原因列表', async () => {
      const failures = [
        { reason_code: 'TIMEOUT', count: 42 },
        { reason_code: 'AUTH_OR_SELECTOR_ERROR', count: 7 },
      ];
      mockGetTopFailureReasons.mockResolvedValueOnce(failures);

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data).toEqual({
        success: true,
        data: failures,
        count: 2,
      });
    });

    it('无失败记录时返回空数组', async () => {
      mockGetTopFailureReasons.mockResolvedValueOnce([]);

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.data).toEqual([]);
      expect(res._data.count).toBe(0);
    });

    it('数据库异常时返回 500', async () => {
      mockGetTopFailureReasons.mockRejectedValueOnce(new Error('view not found'));

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('view not found');
    });
  });

  // ==================== GET /stuck ====================

  describe('GET /stuck', () => {
    const handler = getHandler('get', '/stuck');

    it('正常返回卡住的 run 列表', async () => {
      const stuckRuns = [
        { span_id: 's1', run_id: 'r1', minutes_stuck: 12 },
        { span_id: 's2', run_id: 'r2', minutes_stuck: 8 },
      ];
      mockGetStuckRuns.mockResolvedValueOnce(stuckRuns);

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data).toEqual({
        success: true,
        data: stuckRuns,
        count: 2,
      });
    });

    it('无卡住 run 时返回空列表', async () => {
      mockGetStuckRuns.mockResolvedValueOnce([]);

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data.data).toEqual([]);
      expect(res._data.count).toBe(0);
    });

    it('数据库异常时返回 500', async () => {
      mockGetStuckRuns.mockRejectedValueOnce(new Error('function does not exist'));

      const { req, res } = mockReqRes();
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('function does not exist');
    });
  });

  // ==================== GET /artifacts/:id ====================

  describe('GET /artifacts/:id', () => {
    const handler = getHandler('get', '/artifacts/:id');

    it('找到制品时返回元数据', async () => {
      const artifact = {
        id: 'art-001',
        artifact_type: 'screenshot',
        storage_backend: 'local',
        storage_key: '/tmp/shot.png',
        content_type: 'image/png',
      };
      mockGetArtifact.mockResolvedValueOnce(artifact);

      const { req, res } = mockReqRes({ id: 'art-001' });
      await handler(req, res);

      expect(res._status).toBe(200);
      expect(res._data).toEqual({ success: true, data: artifact });
      expect(mockGetArtifact).toHaveBeenCalledWith('art-001');
    });

    it('制品不存在时返回 404', async () => {
      mockGetArtifact.mockResolvedValueOnce(null);

      const { req, res } = mockReqRes({ id: 'no-such-id' });
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Artifact not found');
    });

    it('数据库异常时返回 500', async () => {
      mockGetArtifact.mockRejectedValueOnce(new Error('DB error'));

      const { req, res } = mockReqRes({ id: 'art-001' });
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('DB error');
    });
  });

  // ==================== GET /artifacts/:id/download ====================

  describe('GET /artifacts/:id/download', () => {
    const handler = getHandler('get', '/artifacts/:id/download');

    // ---- 制品不存在 ----

    it('制品不存在时返回 404', async () => {
      mockGetArtifact.mockResolvedValueOnce(null);

      const { req, res } = mockReqRes({ id: 'no-such' });
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Artifact not found');
    });

    // ---- local 后端：正常下载 ----

    it('local 后端：读取文件并发送', async () => {
      const artifact = {
        id: 'art-local',
        storage_backend: 'local',
        storage_key: '/tmp/logs/run.log',
        content_type: 'text/plain',
      };
      const fileContent = Buffer.from('log content here');
      mockGetArtifact.mockResolvedValueOnce(artifact);
      mockFsReadFile.mockResolvedValueOnce(fileContent);

      const { req, res } = mockReqRes({ id: 'art-local' });
      await handler(req, res);

      expect(mockFsReadFile).toHaveBeenCalledWith('/tmp/logs/run.log');
      expect(res._headers['Content-Type']).toBe('text/plain');
      expect(res._headers['Content-Disposition']).toBe(
        'attachment; filename="run.log"'
      );
      expect(res._sent).toBe(fileContent);
      expect(res._status).toBe(200);
    });

    it('local 后端：无 content_type 时不设置 Content-Type 头', async () => {
      const artifact = {
        id: 'art-no-ct',
        storage_backend: 'local',
        storage_key: '/tmp/data.bin',
        content_type: null,
      };
      mockGetArtifact.mockResolvedValueOnce(artifact);
      mockFsReadFile.mockResolvedValueOnce(Buffer.from('binary'));

      const { req, res } = mockReqRes({ id: 'art-no-ct' });
      await handler(req, res);

      expect(res._headers['Content-Type']).toBeUndefined();
      expect(res._headers['Content-Disposition']).toBe(
        'attachment; filename="data.bin"'
      );
      expect(res._sent).toBeDefined();
    });

    it('local 后端：文件不存在（ENOENT）时返回 404', async () => {
      const artifact = {
        id: 'art-missing',
        storage_backend: 'local',
        storage_key: '/tmp/nonexistent.png',
        content_type: 'image/png',
      };
      const enoentErr = Object.assign(new Error('ENOENT: no such file'), {
        code: 'ENOENT',
      });
      mockGetArtifact.mockResolvedValueOnce(artifact);
      mockFsReadFile.mockRejectedValueOnce(enoentErr);

      const { req, res } = mockReqRes({ id: 'art-missing' });
      await handler(req, res);

      expect(res._status).toBe(404);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Artifact file not found on disk');
    });

    it('local 后端：非 ENOENT 读取错误向上抛出（捕获为 500）', async () => {
      const artifact = {
        id: 'art-err',
        storage_backend: 'local',
        storage_key: '/tmp/secret.txt',
        content_type: 'text/plain',
      };
      const permErr = Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      });
      mockGetArtifact.mockResolvedValueOnce(artifact);
      mockFsReadFile.mockRejectedValueOnce(permErr);

      const { req, res } = mockReqRes({ id: 'art-err' });
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('EACCES: permission denied');
    });

    // ---- 路径穿越防护（安全边界） ----

    it('local 后端：storage_key 含 ".." 时返回 403', async () => {
      const artifact = {
        id: 'art-traversal',
        storage_backend: 'local',
        storage_key: '/tmp/../etc/passwd',
        content_type: 'text/plain',
      };
      mockGetArtifact.mockResolvedValueOnce(artifact);

      const { req, res } = mockReqRes({ id: 'art-traversal' });
      await handler(req, res);

      expect(res._status).toBe(403);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Invalid file path');
      // 不应读取文件
      expect(mockFsReadFile).not.toHaveBeenCalled();
    });

    it('local 后端：仅含 ".." 不带斜杠时也被拦截', async () => {
      const artifact = {
        id: 'art-dotdot',
        storage_backend: 'local',
        storage_key: '..secretfile',
        content_type: null,
      };
      mockGetArtifact.mockResolvedValueOnce(artifact);

      const { req, res } = mockReqRes({ id: 'art-dotdot' });
      await handler(req, res);

      expect(res._status).toBe(403);
      expect(res._data.error).toBe('Invalid file path');
    });

    // ---- s3 后端 ----

    it('s3 后端：返回 501 未实现', async () => {
      const artifact = {
        id: 'art-s3',
        storage_backend: 's3',
        storage_key: 's3://my-bucket/run/output.log',
        content_type: 'text/plain',
      };
      mockGetArtifact.mockResolvedValueOnce(artifact);

      const { req, res } = mockReqRes({ id: 'art-s3' });
      await handler(req, res);

      expect(res._status).toBe(501);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('S3 backend not implemented yet');
    });

    // ---- nas 后端 ----

    it('nas 后端：返回 501 未实现', async () => {
      const artifact = {
        id: 'art-nas',
        storage_backend: 'nas',
        storage_key: '/mnt/nas/data/video.mp4',
        content_type: 'video/mp4',
      };
      mockGetArtifact.mockResolvedValueOnce(artifact);

      const { req, res } = mockReqRes({ id: 'art-nas' });
      await handler(req, res);

      expect(res._status).toBe(501);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('NAS backend not implemented yet');
    });

    // ---- 未知后端 ----

    it('未知 storage_backend 时返回 400', async () => {
      const artifact = {
        id: 'art-unknown',
        storage_backend: 'gcs',
        storage_key: 'gs://bucket/file.txt',
        content_type: null,
      };
      mockGetArtifact.mockResolvedValueOnce(artifact);

      const { req, res } = mockReqRes({ id: 'art-unknown' });
      await handler(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('Unknown storage backend: gcs');
    });

    // ---- 顶层异常（getArtifact 抛错） ----

    it('getArtifact 异常时返回 500', async () => {
      mockGetArtifact.mockRejectedValueOnce(new Error('unexpected DB failure'));

      const { req, res } = mockReqRes({ id: 'art-crash' });
      await handler(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toBe('unexpected DB failure');
    });
  });
});
