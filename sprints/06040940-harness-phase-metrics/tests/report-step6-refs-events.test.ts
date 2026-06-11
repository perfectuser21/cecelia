import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EVENTS_PATH = path.join(REPO_ROOT, 'packages/brain/src/events/initiativeRunEvents.js');

// phase 指标的 owner 是 Brain 侧 events/initiativeRunEvents.js，不是 harness-report SKILL.md。
// SSOT 链路审计（zenithjoy-skills #50，2026-06）移除了 skill 侧自拼 initiative_run_events 查询
// 的指令（skill 侧 curl 埋点自始未在生产生效）；故旧的「SKILL.md 含 initiative_run_events + 三列
// 字面」断言已过时，改为校验 Brain 侧 owner 写这张表与三列（对齐新 SSOT + 保留回归防线）。
describe('initiative_run_events owner = Brain 侧 events/initiativeRunEvents.js [BEHAVIOR]', () => {
  it('initiativeRunEvents.js 写 initiative_run_events 且维护三列（ts_end / cost_usd / model）', async () => {
    const content = await fs.promises.readFile(EVENTS_PATH, 'utf8');
    expect(content).toMatch(/initiative_run_events/);
    expect(content).toMatch(/INSERT INTO initiative_run_events/);
    expect(content).toMatch(/UPDATE initiative_run_events/);
    expect(content).toMatch(/ts_end/);
    expect(content).toMatch(/cost_usd/);
    expect(content).toMatch(/\bmodel\b/);
  });
});
