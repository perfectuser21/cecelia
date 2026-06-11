import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EVENTS_PATH = path.join(REPO_ROOT, 'packages/brain/src/events/initiativeRunEvents.js');
const HARNESS_ROUTE = path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js');

// phase-event 埋点的 owner 是 Brain 侧，不是 skill。SSOT 链路审计（zenithjoy-skills #50，
// 2026-06）确认 harness skill 自 06-04 起已无 phase-event 埋点指令；图节点生命周期由 Brain 侧
// （events/initiativeRunEvents.js 写 initiative_run_events + harness.js POST/PATCH /phase-event
// 端点向后兼容）唯一负责，skill 侧 curl 埋点自始未在生产生效（生产实测事件流完整且全部 Brain 侧写）。
// 故旧的「5 个 SKILL.md 含 phase-event 字面」断言已过时，改为校验 Brain 侧 owner（对齐新 SSOT）。
describe('phase-event owner = Brain 侧（events/initiativeRunEvents.js + harness.js 端点）[BEHAVIOR]', () => {
  it('events/initiativeRunEvents.js 写 initiative_run_events（节点生命周期事件）', async () => {
    const src = await fs.promises.readFile(EVENTS_PATH, 'utf8');
    expect(src).toMatch(/INSERT INTO initiative_run_events/);
    expect(src).toMatch(/writeInitiativeRunEvent/);
    expect(src).toMatch(/updateInitiativeRunEvent/);
  });

  it('harness.js 保留 POST/PATCH /phase-event 端点（向后兼容）', async () => {
    const src = await fs.promises.readFile(HARNESS_ROUTE, 'utf8');
    expect(src).toMatch(/router\.post\([^)]*phase-event/);
    expect(src).toMatch(/router\.patch\([^)]*phase-event/);
  });
});
