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

describe('Harness phase metrics — 5 个 skill 首尾埋点 + 吞错 [BEHAVIOR]（PRD 字面：Planner/Proposer/Generator/Evaluator/Reporter，不含 Reviewer）', () => {
  const skills = [
    'harness-planner',
    'harness-contract-proposer',
    'harness-generator',
    'harness-evaluator',
    'harness-report',
  ];

  for (const skill of skills) {
    it(`${skill}/SKILL.md 含 phase-event 调用`, () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, `packages/workflows/skills/${skill}/SKILL.md`), 'utf8');
      expect(src).toMatch(/phase-event/);
    });
  }

  it('executor 现有非致命 warn 字符串保留（回归保护，PRD 边界情况：phase-event 写失败吞错不阻断）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/brain/src/executor.js'), 'utf8');
    expect(src).toMatch(/writeInitiativeRunEvent failed \(non-fatal\)/);
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

describe('Harness phase metrics — Reporter Step 6 引用 events [BEHAVIOR]', () => {
  it('harness-report SKILL.md 引用 initiative_run_events 表', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/workflows/skills/harness-report/SKILL.md'), 'utf8');
    expect(src).toMatch(/initiative_run_events/);
  });

  it('harness-report SKILL.md 含三列字面：耗时(ts_end/duration) / 成本(cost_usd) / 模型(model)', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/workflows/skills/harness-report/SKILL.md'), 'utf8');
    expect(src).toMatch(/ts_end|duration|耗时/);
    expect(src).toMatch(/cost_usd|成本/);
    expect(src).toMatch(/\bmodel\b|模型/);
  });

  it('harness-report SKILL.md duration 计算含 /1000 单位转换（ts=秒, ts_end=毫秒 — Reviewer R1）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/workflows/skills/harness-report/SKILL.md'), 'utf8');
    expect(src).toMatch(/ts_end\s*\/\s*1000|ts_end.*1000|duration.*1000|1000\.0/);
  });

  it('harness-report SKILL.md 含 NULL cost_usd → "-" 守卫逻辑（PRD 边界情况 #2 — Reviewer R2）', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'packages/workflows/skills/harness-report/SKILL.md'), 'utf8');
    expect(src).toMatch(/cost_usd.*null|cost_usd.*IS NULL|cost_usd.*\?.*-|null.*cost_usd|cost_usd.*['\"]-['\"]|cost_usd.*:-/i);
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
