import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('Harness phase metrics — migration 293 + selfcheck bump [BEHAVIOR]', () => {
  it('migration 293 文件存在并 ADD COLUMN 3 列', () => {
    const f = path.join(REPO_ROOT, 'packages/brain/migrations/293_initiative_run_events_phase_metrics.sql');
    expect(fs.existsSync(f)).toBe(true);
    const sql = fs.readFileSync(f, 'utf8');
    expect(sql).toMatch(/ADD COLUMN[^\n]*ts_end[^\n]*BIGINT/);
    expect(sql).toMatch(/ADD COLUMN[^\n]*cost_usd[^\n]*NUMERIC/);
    expect(sql).toMatch(/ADD COLUMN[^\n]*model[^\n]*TEXT/);
  });

  it('migration 293 扩 status CHECK 接受 "completed"', () => {
    const f = path.join(REPO_ROOT, 'packages/brain/migrations/293_initiative_run_events_phase_metrics.sql');
    const sql = fs.readFileSync(f, 'utf8');
    expect(sql).toMatch(/completed/);
  });

  it('selfcheck EXPECTED_SCHEMA_VERSION 升至 293', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/selfcheck.js'), 'utf8');
    expect(src).toMatch(/EXPECTED_SCHEMA_VERSION\s*=\s*'293'/);
  });
});

describe('Harness phase metrics — writeInitiativeRunEvent + updateInitiativeRunEvent [BEHAVIOR]', () => {
  it('writeInitiativeRunEvent 接受 model 参数', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/events/initiativeRunEvents.js'), 'utf8');
    expect(src).toMatch(/\bmodel\b/);
  });

  it('updateInitiativeRunEvent 函数存在且 dbPool 可覆盖连接', async () => {
    const { updateInitiativeRunEvent } = (await import('../../../packages/brain/src/events/initiativeRunEvents.js')) as any;
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await updateInitiativeRunEvent({ id: 9999999, status: 'running', dbPool: mockPool });
    expect(result).toBeNull();
  });
});

describe('Harness phase metrics — POST/PATCH /phase-event 路由 [BEHAVIOR]', () => {
  it('harness.js 含 POST /phase-event 路由', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    expect(src).toMatch(/router\.post\([^)]*phase-event/);
  });

  it('harness.js 含 PATCH /phase-event/:id 路由', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    expect(src).toMatch(/router\.patch\([^)]*phase-event/);
  });

  it('POST 响应使用 id 而非 event_id（PRD 字段名纪律）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    const postHandlerMatch = src.match(/router\.post\([^)]*phase-event[^]*?(?=\nrouter\.(post|patch|get|delete)|$)/);
    expect(postHandlerMatch).not.toBeNull();
    const postHandler = postHandlerMatch?.[0] || '';
    expect(postHandler).toMatch(/\bid\b/);
  });
});

// ── phase metrics 的 owner 是 Brain 侧，不是 skill ─────────────────────────────────
// SSOT 链路审计（zenithjoy-skills #50，2026-06）确认：harness skill 自 06-04 起已无
// phase-event 埋点指令；pipeline phase metrics 由 Brain 侧（图节点生命周期 emitGraphNodeUpdate
// → events/initiativeRunEvents.js 写 initiative_run_events）唯一负责，skill 侧 curl 埋点自始
// 未在生产生效（生产实测：表 2200+ 行、近 7 天事件全部 Brain 侧写）。故旧的「5 个 skill 含
// phase-event 字面」断言已过时，改为断言 Brain 侧 owner 仍在吞错写库（真实生产机制 + 回归防线）。
describe('Harness phase metrics — Brain 侧吞错写库 [BEHAVIOR]（owner = events/initiativeRunEvents.js）', () => {
  it('executor 现有非致命 warn 字符串保留（PRD 边界情况：phase-event 写失败吞错不阻断）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/executor.js'), 'utf8');
    expect(src).toMatch(/writeInitiativeRunEvent failed \(non-fatal\)/);
  });

  it('events/initiativeRunEvents.js INSERT 写 initiative_run_events（Brain 侧唯一 owner）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/events/initiativeRunEvents.js'), 'utf8');
    expect(src).toMatch(/INSERT INTO initiative_run_events/);
    expect(src).toMatch(/writeInitiativeRunEvent/);
  });
});

describe('Harness phase metrics — 重复 POST 同一 phase → 最后 model 覆盖 [BEHAVIOR]（PRD 边界情况3）', () => {
  it('harness.js 有 POST 路由 + initiativeRunEvents.js 含 model 参数（边界情况3 静态红）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    expect(src).toMatch(/router\.post\([^)]*phase-event/);
  });

  it('writeInitiativeRunEvent 接受 model 参数（覆盖语义依赖 model 被写入才能验证）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/events/initiativeRunEvents.js'), 'utf8');
    // model 必须出现在 INSERT 语句中，否则重复 POST 无法覆盖 model
    expect(src).toMatch(/INSERT INTO initiative_run_events[\s\S]*\bmodel\b/);
  });
});

// Reporter 不再在 SKILL.md 内自己拼 initiative_run_events 查询（#50 移除）；phase 指标的
// 三列（耗时 ts_end / 成本 cost_usd / 模型 model）由 Brain 侧 events/initiativeRunEvents.js
// 写入与维护。下列断言改为校验 Brain 侧 owner 写了这三列（对齐新 SSOT + 保留回归防线）。
describe('Harness phase metrics — 三列指标由 Brain 侧 owner 维护 [BEHAVIOR]', () => {
  it('events/initiativeRunEvents.js 写/维护 ts_end / cost_usd / model 三列', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/events/initiativeRunEvents.js'), 'utf8');
    expect(src).toMatch(/UPDATE initiative_run_events/);
    expect(src).toMatch(/ts_end/);
    expect(src).toMatch(/cost_usd/);
    expect(src).toMatch(/\bmodel\b/);
  });

  it('migration 293 定义这三列（ts_end / cost_usd / model）', () => {
    const sql = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/migrations/293_initiative_run_events_phase_metrics.sql'), 'utf8');
    expect(sql).toMatch(/ts_end/);
    expect(sql).toMatch(/cost_usd/);
    expect(sql).toMatch(/model/);
  });
});

describe('Harness phase metrics — PATCH response schema 完整性 [BEHAVIOR]（Reviewer R4 — oracle completeness）', () => {
  it('harness.js PATCH handler 区块含 model 字段（5 必填字段之一）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    const patchHandlerMatch = src.match(/router\.patch[\s\S]*?(?=\nrouter\.(post|patch|get|delete|put)|$)/);
    expect(patchHandlerMatch).not.toBeNull();
    const patchHandler = patchHandlerMatch?.[0] ?? '';
    expect(patchHandler).toMatch(/\bmodel\b/);
  });

  it('harness.js PATCH handler 不暴露禁用字段 event_id / created_at', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/routes/harness.js'), 'utf8');
    const patchHandlerMatch = src.match(/router\.patch[\s\S]*?(?=\nrouter\.(post|patch|get|delete|put)|$)/);
    const patchHandler = patchHandlerMatch?.[0] ?? src;
    expect(patchHandler).not.toMatch(/['"]event_id['"]\s*:/);
    expect(patchHandler).not.toMatch(/['"]created_at['"]\s*:/);
  });
});
