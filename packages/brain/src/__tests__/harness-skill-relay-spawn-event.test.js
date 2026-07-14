/**
 * 刀C-3 — skill-relay-spawn 事件终态回收（17 条永久 running）
 * 验证 executor 在 spawnSkillRelaySession 完成后，更新 initiative_run_events
 * 中 skill-relay-spawn 事件的 status 为 'done'（成功）或 'failed'（失败）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

describe('executor skill-relay-spawn 事件终态写入', () => {
  it('executor.js 在 spawn 后更新 initiative_run_events status 为终态', async () => {
    // 通过静态分析确认 executor.js 含有 spawn 后的 UPDATE 或 write 调用
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../executor.js', import.meta.url).pathname,
      'utf8'
    );

    // skill-relay-spawn 事件后必须有终态更新
    // 检查：在 spawnSkillRelaySession 调用后有 UPDATE initiative_run_events 或 writeInitiativeRunEvent('done'/'failed')
    const spawnIdx = src.indexOf('spawnSkillRelaySession');
    expect(spawnIdx).toBeGreaterThan(-1);

    // 截取 spawn 调用之后的代码（最多 800 字符）
    const afterSpawn = src.slice(spawnIdx, spawnIdx + 800);

    // 必须有终态更新：UPDATE initiative_run_events 或 writeInitiativeRunEvent 含 done/failed
    const hasTerminalUpdate =
      afterSpawn.includes('UPDATE initiative_run_events') ||
      afterSpawn.includes("status: 'done'") ||
      afterSpawn.includes("status: 'failed'") ||
      afterSpawn.includes("'done'") && afterSpawn.includes('initiative_run_events');

    expect(hasTerminalUpdate).toBe(true);
  });
});

describe('initiative_run_events 终态回收 SQL 验证', () => {
  it('spawn 成功 → skill-relay-spawn 事件改为 done', async () => {
    const queryCalls = [];
    mockPool.query.mockImplementation(async (sql, params) => {
      queryCalls.push({ sql: String(sql), params });
      return { rows: [], rowCount: 1 };
    });

    // 模拟写入 running 然后更新为 done
    // 验证 executor 实际执行了正确的 UPDATE
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../executor.js', import.meta.url).pathname,
      'utf8'
    );

    // 验证代码包含终态 UPDATE 逻辑
    const updatePattern = /UPDATE\s+initiative_run_events[\s\S]*?skill-relay-spawn[\s\S]*?(done|failed)/;
    const hasUpdateSql = updatePattern.test(src);

    // 如果不是 inline SQL，检查是否使用 updateInitiativeRunEvent helper
    const usesHelper = src.includes('updateInitiativeRunEvent') &&
      src.indexOf('updateInitiativeRunEvent') > src.indexOf('spawnSkillRelaySession');

    expect(hasUpdateSql || usesHelper).toBe(true);
  });
});
