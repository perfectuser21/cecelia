/**
 * test-pyramid-endpoint.test.ts — GET /api/quality/test-pyramid 单元测试（TDD Red 阶段）
 *
 * 覆盖三态：
 *   1. guard exit 0（pass:true JSON）→ 200 + available:true + 原样数据
 *   2. guard exit 1（pass:false JSON，stdout 仍是合法 JSON）→ 200 照常返回，不是 500
 *   3. execFile 真异常/超时/JSON parse 失败 → 200 {available:false, error}（面板灰态数据）
 *
 * mock execFile，不依赖真实 guard 脚本，可在 CI 无仓库根状态下运行。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('child_process', () => ({
  execFile: execFileMock,
  default: { execFile: execFileMock },
}));

import testPyramidRouter from '../quality/test-pyramid.js';

function buildApp() {
  const app = express();
  app.use('/api/quality', testPyramidRouter);
  return app;
}

const passPayload = {
  pass: true,
  failures: [],
  orphans: { tests: 0, e2e: 0, total: 0 },
  smoke: { total: 2, unwired: [] },
  permanent: { total: 1123, layers: { unit: 1020, integration: 103 } },
  panel: { fresh: true, generated: '2026-07-14 10:59:31' },
};

const failPayload = {
  ...passPayload,
  pass: false,
  failures: ['tests/foo.test.ts 未挂任何跑道'],
};

describe('GET /api/quality/test-pyramid', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('guard exit 0：200 + available:true + guard JSON 原样透传', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify(passPayload), '');
    });

    const res = await request(buildApp()).get('/api/quality/test-pyramid');

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.pass).toBe(true);
    expect(res.body.permanent.layers.unit).toBe(1020);
    expect(res.body.permanent.layers.integration).toBe(103);
    expect(res.body.smoke.total).toBe(2);
    expect(res.body.panel.generated).toBe('2026-07-14 10:59:31');
  });

  it('调用参数：node scripts/test-pyramid-guard.mjs --json，5s 超时', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify(passPayload), '');
    });

    await request(buildApp()).get('/api/quality/test-pyramid');

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe('node');
    expect(args).toEqual(['scripts/test-pyramid-guard.mjs', '--json']);
    expect(opts.timeout).toBe(5000);
    expect(typeof opts.cwd).toBe('string');
  });

  it('guard exit 1 但 stdout 是合法 JSON（pass:false）：照常 200，不是 500', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error('Command failed'), { code: 1 });
      cb(err, JSON.stringify(failPayload), '');
    });

    const res = await request(buildApp()).get('/api/quality/test-pyramid');

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.pass).toBe(false);
    expect(res.body.failures).toEqual(['tests/foo.test.ts 未挂任何跑道']);
  });

  it('execFile 真异常（超时/ENOENT，stdout 无合法 JSON）：200 {available:false, error}', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = Object.assign(new Error('spawn node ETIMEDOUT'), { killed: true });
      cb(err, '', '');
    });

    const res = await request(buildApp()).get('/api/quality/test-pyramid');

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('stdout 非 JSON 垃圾输出：200 {available:false, error}', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, 'not-json-at-all', '');
    });

    const res = await request(buildApp()).get('/api/quality/test-pyramid');

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });
});
