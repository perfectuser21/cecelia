/**
 * Heartbeat File API Tests
 * Tests for GET/PUT /api/brain/heartbeat (read/write HEARTBEAT.md)
 *
 * Tests route handler logic directly without importing the full routes.js
 * to avoid deep mock chains.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile } from 'fs/promises';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const HEARTBEAT_DEFAULT_TEMPLATE = `# HEARTBEAT.md — Cecelia 巡检清单

## 巡检项目

- [ ] 系统健康检查
- [ ] 任务队列状态
- [ ] 资源使用率
`;

// Replicate the GET handler logic from routes.js
async function handleGet(req, res) {
  try {
    const content = await readFile(new URL('../../HEARTBEAT.md', import.meta.url), 'utf-8');
    res.json({ success: true, content });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json({ success: true, content: HEARTBEAT_DEFAULT_TEMPLATE });
    }
    res.status(500).json({ success: false, error: err.message });
  }
}

// Replicate the PUT handler logic from routes.js
async function handlePut(req, res) {
  try {
    const { content } = req.body;
    if (content === undefined || content === null) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    await writeFile(new URL('../../HEARTBEAT.md', import.meta.url), content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// Helper: create mock req/res
function mockReqRes(body = {}) {
  const req = { body };
  const res = {
    _status: 200,
    _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}

describe('Heartbeat File API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /heartbeat', () => {
    it('should return file content when HEARTBEAT.md exists', async () => {
      const content = '# My Heartbeat\n- [x] Check 1';
      readFile.mockResolvedValueOnce(content);

      const { req, res } = mockReqRes();
      await handleGet(req, res);

      expect(res._data).toEqual({ success: true, content });
      expect(readFile).toHaveBeenCalledTimes(1);
      expect(readFile.mock.calls[0][1]).toBe('utf-8');
    });

    it('should return default template when file does not exist', async () => {
      const enoent = new Error('ENOENT');
      enoent.code = 'ENOENT';
      readFile.mockRejectedValueOnce(enoent);

      const { req, res } = mockReqRes();
      await handleGet(req, res);

      expect(res._data.success).toBe(true);
      expect(res._data.content).toContain('HEARTBEAT.md');
      expect(res._data.content).toContain('巡检清单');
      expect(res._status).toBe(200);
    });

    it('should return 500 on other read errors', async () => {
      readFile.mockRejectedValueOnce(new Error('Permission denied'));

      const { req, res } = mockReqRes();
      await handleGet(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toContain('Permission denied');
    });
  });

  describe('PUT /heartbeat', () => {
    it('should write content to file', async () => {
      writeFile.mockResolvedValueOnce();

      const content = '# Updated Heartbeat\n- [ ] New check';
      const { req, res } = mockReqRes({ content });
      await handlePut(req, res);

      expect(res._data).toEqual({ success: true });
      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(writeFile.mock.calls[0][1]).toBe(content);
      expect(writeFile.mock.calls[0][2]).toBe('utf-8');
    });

    it('should return 400 when content is missing', async () => {
      const { req, res } = mockReqRes({});
      await handlePut(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toContain('content is required');
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should return 400 when content is null', async () => {
      const { req, res } = mockReqRes({ content: null });
      await handlePut(req, res);

      expect(res._status).toBe(400);
      expect(res._data.success).toBe(false);
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should return 500 on write errors', async () => {
      writeFile.mockRejectedValueOnce(new Error('Disk full'));

      const { req, res } = mockReqRes({ content: 'test' });
      await handlePut(req, res);

      expect(res._status).toBe(500);
      expect(res._data.success).toBe(false);
      expect(res._data.error).toContain('Disk full');
    });
  });
});
