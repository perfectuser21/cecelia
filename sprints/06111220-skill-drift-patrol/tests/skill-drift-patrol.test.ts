/**
 * skill-drift-patrol.test.ts
 * TDD Red 阶段：验证 patrol 模块 + patrol-history 端点的核心行为
 * 这些测试在实现前必须 FAIL（Red）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// mock DB pool
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));

// 尝试导入尚未实现的模块（Red 阶段会 fail）
let harnessRouter: any;
try {
  const mod = await import('../../../packages/brain/src/routes/harness.js');
  harnessRouter = mod.default;
} catch {
  harnessRouter = null;
}

let patrolModule: any;
try {
  patrolModule = await import('../../../packages/brain/src/cron/skill-drift-patrol.js');
} catch {
  patrolModule = null;
}

function createApp() {
  const app = express();
  app.use(express.json());
  if (harnessRouter) app.use('/harness', harnessRouter);
  return app;
}

describe('GET /harness/skill-drift/patrol-history', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('返回 HTTP 200 + alerts 数组（空列表）', async () => {
    expect(harnessRouter).not.toBeNull();
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const resp = await request(app).get('/harness/skill-drift/patrol-history');
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('alerts');
    expect(Array.isArray(resp.body.alerts)).toBe(true);
  });

  it('顶层 keys 严格为 ["alerts"]', async () => {
    expect(harnessRouter).not.toBeNull();
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const resp = await request(app).get('/harness/skill-drift/patrol-history');
    expect(Object.keys(resp.body).sort()).toEqual(['alerts']);
  });

  it('记录含必要字段 id/skill_name/drift_date/detected_at', async () => {
    expect(harnessRouter).not.toBeNull();
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        skill_name: 'harness-planner',
        ssot_version: '9.1.0',
        snapshot_version: '9999.0.0',
        drift_date: '2026-06-11',
        detected_at: '2026-06-11T10:00:00.000Z',
      }],
    });

    const resp = await request(app).get('/harness/skill-drift/patrol-history');
    expect(resp.status).toBe(200);
    const alert = resp.body.alerts[0];
    expect(alert).toHaveProperty('id');
    expect(alert).toHaveProperty('skill_name');
    expect(alert).toHaveProperty('drift_date');
    expect(alert).toHaveProperty('detected_at');
  });

  it('禁用字段 alert_id / date 不出现在响应中', async () => {
    expect(harnessRouter).not.toBeNull();
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        skill_name: 'harness-planner',
        ssot_version: null,
        snapshot_version: null,
        drift_date: '2026-06-11',
        detected_at: '2026-06-11T10:00:00.000Z',
      }],
    });

    const resp = await request(app).get('/harness/skill-drift/patrol-history');
    const alert = resp.body.alerts[0];
    expect(alert).not.toHaveProperty('alert_id');
    expect(alert).not.toHaveProperty('date');
  });
});

describe('skill-drift-patrol 模块', () => {
  it('模块文件存在且导出 runSkillDriftPatrol 函数', () => {
    expect(patrolModule).not.toBeNull();
    expect(typeof patrolModule.runSkillDriftPatrol).toBe('function');
  });

  it('isInPatrolWindow 函数存在（按日调度窗口检测）', () => {
    expect(patrolModule).not.toBeNull();
    expect(typeof patrolModule.isInPatrolWindow).toBe('function');
  });
});

describe('smoke 脚本 snapshot_version 断言', () => {
  it('skill-drift-smoke.sh 文件含 snapshot_version 检测', async () => {
    const { readFileSync } = await import('fs');
    const { resolve, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    // 用 import.meta.url 构造绝对路径，不依赖 CWD（brain-unit 从 packages/brain/ 跑）
    const dir = dirname(fileURLToPath(import.meta.url));
    const content = readFileSync(
      resolve(dir, '../../../packages/brain/scripts/smoke/skill-drift-smoke.sh'),
      'utf8'
    );
    expect(content).toContain('snapshot_version');
  });
});
