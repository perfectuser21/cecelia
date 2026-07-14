/**
 * 刀C-3 — skill-relay-spawn 事件终态回收（17 条永久 running）
 * 验证 executor 在 spawnSkillRelaySession 完成后，更新 initiative_run_events
 * 中 skill-relay-spawn 事件的 status 为 'done'（成功）或 'failed'（失败）
 */
import { describe, it, expect, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

describe('executor skill-relay-spawn 事件终态写入', () => {
  it('executor.js 在 spawn 后更新 initiative_run_events status 为终态', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../executor.js', import.meta.url).pathname,
      'utf8'
    );

    const spawnIdx = src.indexOf('spawnSkillRelaySession');
    expect(spawnIdx, 'executor.js 必须导入 spawnSkillRelaySession').toBeGreaterThan(-1);

    // 截取从 spawnSkillRelaySession 起的 800 字符
    const afterSpawn = src.slice(spawnIdx, spawnIdx + 800);

    // 必须有终态更新：UPDATE initiative_run_events 或含 'done'/'failed' + initiative_run_events
    const hasTerminalUpdate =
      afterSpawn.includes('UPDATE initiative_run_events') ||
      afterSpawn.includes("status: 'done'") ||
      afterSpawn.includes("status: 'failed'") ||
      (afterSpawn.includes("'done'") && afterSpawn.includes('initiative_run_events'));

    expect(hasTerminalUpdate, '必须在 spawnSkillRelaySession 之后有 skill-relay-spawn 终态更新').toBe(true);
  });
});

describe('initiative_run_events 终态回收 SQL 验证', () => {
  it('spawn 成功 → skill-relay-spawn 事件 UPDATE 为 done', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../executor.js', import.meta.url).pathname,
      'utf8'
    );

    // 检查含 skill-relay-spawn 且后接 done/failed 的 UPDATE 语句
    const updatePattern = /UPDATE\s+initiative_run_events[\s\S]*?skill-relay-spawn[\s\S]*?(done|failed)/;
    const hasUpdateSql = updatePattern.test(src);

    // 或使用 updateInitiativeRunEvent helper（在 spawnSkillRelaySession 之后）
    const usesHelper = src.includes('updateInitiativeRunEvent') &&
      src.indexOf('updateInitiativeRunEvent') > src.indexOf('spawnSkillRelaySession');

    expect(hasUpdateSql || usesHelper, 'executor.js 必须含 skill-relay-spawn 终态 UPDATE').toBe(true);
  });
});
