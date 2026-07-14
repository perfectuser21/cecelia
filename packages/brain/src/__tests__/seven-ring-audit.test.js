/**
 * seven-ring-audit.test.js — 七环对账巡检单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

vi.mock('node:fs');

// 默认 ratchet 文件不存在（首跑场景）
fs.readFileSync.mockImplementation(() => { throw new Error('no file'); });
fs.writeFileSync.mockImplementation(() => {});

import { runSevenRingAudit, readRatchet, writeRatchet } from '../seven-ring-audit.js';

// sentinel value: pass as override to simulate "key not found in DB"
const NOT_FOUND = Symbol('not_found');

function makePool(overrides = {}) {
  const defaultRows = {
    quality_test_pyramid: {
      value_json: {
        permanent: { total: 1200, layers: { unit: 1000, integration: 200 } },
        smoke: { total: 3, unwired: [] },
        panel: { fresh: true, generated: '2026-07-14 10:00:00' },
        pass: true,
        failures: [],
      },
      updated_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    },
    'scheduler_job_last_run:ci-patrol': {
      value_json: { ok: true },
      updated_at: new Date(Date.now() - 10 * 3600_000).toISOString(),
    },
    'scheduler_job_last_run:postdeploy-verifier': {
      value_json: { ok: true },
      updated_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
    },
    'scheduler_job_last_run:ledger-hygiene': {
      value_json: { ok: true },
      updated_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
    },
    'scheduler_job_last_run:battle-report': {
      value_json: { ok: true },
      updated_at: new Date(Date.now() - 8 * 3600_000).toISOString(),
    },
  };

  const alertnessRows = [
    { level: 0, updated_at: new Date(Date.now() - 3 * 3600_000).toISOString() },
  ];

  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      // alertness 查询
      if (sql.includes('FROM alertness')) {
        return { rows: alertnessRows };
      }
      // working_memory 查询
      if (sql.includes('FROM working_memory')) {
        const key = params?.[0];
        const overrideVal = key in overrides ? overrides[key] : undefined;
        const row = overrideVal === NOT_FOUND ? undefined : (overrideVal !== undefined ? overrideVal : defaultRows[key]);
        if (!row) return { rows: [] };
        return { rows: [row] };
      }
      // INSERT (write back)
      if (sql.includes('INSERT INTO working_memory')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
}

describe('runSevenRingAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.readFileSync.mockImplementation(() => { throw new Error('no file'); });
    fs.writeFileSync.mockImplementation(() => {});
  });

  it('七环全通 → pass=true, hard_defects=0', async () => {
    const pool = makePool();
    const result = await runSevenRingAudit(pool);
    expect(result.rings).toHaveLength(7);
    expect(result.hard_defects).toBe(0);
    expect(result.pass).toBe(true);
    expect(result.ratchet_breached).toBe(false);
    expect(result.audited_at).toBeTruthy();
  });

  it('首跑（无 ratchet 文件）→ 写基线，不击穿', async () => {
    const pool = makePool();
    const result = await runSevenRingAudit(pool);
    expect(result.ratchet_breached).toBe(false);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.hard_defects).toBe(0);
  });

  it('硬伤数超基线 → ratchet_breached=true', async () => {
    // 基线 = 0，但 ci-patrol 和 ledger 都挂了
    fs.readFileSync.mockReturnValue(JSON.stringify({ hard_defects: 0, updated_at: '2026-07-14T00:00:00Z' }));
    const pool = makePool({
      'scheduler_job_last_run:ci-patrol': NOT_FOUND,      // 找不到 → 失败
      'scheduler_job_last_run:ledger-hygiene': NOT_FOUND, // 找不到 → 失败
    });
    const result = await runSevenRingAudit(pool);
    expect(result.hard_defects).toBeGreaterThan(0);
    expect(result.ratchet_breached).toBe(true);
    expect(result.pass).toBe(false);
  });

  it('硬伤数改善 → 更新基线', async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ hard_defects: 3, updated_at: '2026-07-14T00:00:00Z' }));
    const pool = makePool(); // 全通 hard_defects=0
    const result = await runSevenRingAudit(pool);
    expect(result.hard_defects).toBe(0);
    expect(result.ratchet_breached).toBe(false);
    // 写入新基线 0
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.hard_defects).toBe(0);
  });

  it('ci-patrol sentinel 过旧 → 环2 失败', async () => {
    const pool = makePool({
      'scheduler_job_last_run:ci-patrol': {
        value_json: { ok: true },
        updated_at: new Date(Date.now() - 50 * 3600_000).toISOString(), // 50h 前
      },
    });
    const result = await runSevenRingAudit(pool);
    const ring2 = result.rings.find((r) => r.ring === 2);
    expect(ring2.ok).toBe(false);
    expect(ring2.detail).toContain('超过 48h');
  });

  it('alertness 表无记录 → 环6 失败', async () => {
    const pool = makePool();
    pool.query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM alertness')) return { rows: [] };
      return makePool().query(sql, params);
    });
    const result = await runSevenRingAudit(pool);
    const ring6 = result.rings.find((r) => r.ring === 6);
    expect(ring6.ok).toBe(false);
  });

  it('panel.fresh=false → 环7 失败', async () => {
    const pool = makePool({
      quality_test_pyramid: {
        value_json: {
          permanent: { total: 1200, layers: { unit: 1000, integration: 200 } },
          panel: { fresh: false, generated: '2026-07-13 10:00:00' },
          pass: false,
        },
        updated_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
      },
    });
    const result = await runSevenRingAudit(pool);
    const ring7 = result.rings.find((r) => r.ring === 7);
    expect(ring7.ok).toBe(false);
  });

  it('结果写入 working_memory', async () => {
    const pool = makePool();
    await runSevenRingAudit(pool);
    const writes = pool.query.mock.calls.filter((c) => c[0].includes('INSERT INTO working_memory'));
    expect(writes.length).toBeGreaterThan(0);
    const [, params] = writes[0];
    expect(params[0]).toBe('seven_ring_audit_last');
  });
});

describe('readRatchet / writeRatchet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    fs.writeFileSync.mockImplementation(() => {});
  });

  it('文件不存在返回 null', () => {
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(readRatchet()).toBeNull();
  });

  it('文件存在返回解析结果', () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({ hard_defects: 2, updated_at: '2026-07-14T00:00:00Z' }));
    expect(readRatchet()).toEqual({ hard_defects: 2, updated_at: '2026-07-14T00:00:00Z' });
  });

  it('writeRatchet 写入正确数据', () => {
    writeRatchet(3);
    const [, content] = fs.writeFileSync.mock.calls[0];
    const parsed = JSON.parse(content);
    expect(parsed.hard_defects).toBe(3);
    expect(parsed.updated_at).toBeTruthy();
  });
});
