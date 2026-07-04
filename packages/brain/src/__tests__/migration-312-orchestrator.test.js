import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migPath = resolve(__dirname, '../../migrations/312_orchestrator_runs_state.sql');
const selfcheckPath = resolve(__dirname, '../selfcheck.js');

// T1 of harness-orchestration-redesign（architecture.md §2.2）：
// orchestrator 状态字段 + append-only 决策日志 + 心跳 + 双轨 flag。
// 仓库惯例：migration 测试做文件内容断言（CI 无真 Postgres，参照 305 测试）；
// 真库行为（trigger 报错/UNIQUE 拒绝/存量兼容）在本地 dev DB 验证，证据进 PR body。
describe('migration 312：orchestrator runs state', () => {
  it('312 文件存在', () => {
    expect(existsSync(migPath)).toBe(true);
  });

  it('initiative_runs 增列全部 additive（IF NOT EXISTS），含 8 个新列', () => {
    const c = readFileSync(migPath, 'utf8');
    for (const col of ['round', 'pr_url', 'evaluate_verdict', 'judge_verdict',
      'orchestrator_version', 'orchestrator_heartbeat_at', 'orchestrator_host', 'orchestrator_pid']) {
      expect(c, `缺列 ${col}`).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
  });

  it('不加 contract_branch 列（initiative_contracts.propose_branch 唯一存储，消灭双账本）', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).not.toMatch(/ADD COLUMN IF NOT EXISTS contract_branch/);
  });

  it('phase CHECK 扩枚举：必含存量值 A_planning + 全部旧值 + 新值', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/DROP CONSTRAINT IF EXISTS initiative_runs_phase_check/);
    for (const p of ['A_planning', 'A_contract', 'B_task_loop', 'C_final_e2e',
      'done', 'failed', 'planning', 'gan', 'generate', 'evaluate']) {
      expect(c, `phase 枚举缺 ${p}`).toContain(`'${p}'`);
    }
  });

  it('verdict 列带 CHECK（含 evaluator 前科值 FIXED）', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/evaluate_verdict IN \('PASS','FAIL','FIXED'\)/);
    expect(c).toMatch(/judge_verdict IN \('PASS','FAIL'\)/);
  });

  it('orchestrator_version 双轨 flag：默认 v1 + CHECK', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/orchestrator_version TEXT NOT NULL DEFAULT 'v1'/);
    expect(c).toMatch(/orchestrator_version IN \('v1','v2'\)/);
  });

  it('orchestrator_decision_log：UNIQUE(run_id,hop) + FK + 惯例索引名', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/CREATE TABLE IF NOT EXISTS orchestrator_decision_log/);
    expect(c).toMatch(/REFERENCES initiative_runs\(id\)/);
    expect(c).toMatch(/UNIQUE\s*\(run_id,\s*hop\)/);
    expect(c).toMatch(/CREATE INDEX IF NOT EXISTS idx_orchestrator_decision_log_run/);
  });

  it('append-only trigger：完整 CREATE FUNCTION + BEFORE UPDATE OR DELETE trigger', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/CREATE OR REPLACE FUNCTION orchestrator_decision_log_append_only/);
    expect(c).toMatch(/RAISE EXCEPTION/);
    expect(c).toMatch(/BEFORE UPDATE OR DELETE ON orchestrator_decision_log/);
  });

  it('migration 幂等：不手写 INSERT INTO schema_version（310+ 惯例，migrate.js 按文件名记账）', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).not.toMatch(/INSERT INTO schema_version/);
  });

  // 决策修正（T1 实现期发现）：EXPECTED_SCHEMA_VERSION 是"最低可接受地板"，
  // 仓库既有决策（issue 14d66027）明确"加 migration 不要 bump，只有代码真依赖新 schema 才 bump"。
  // T1 无任何代码消费 312 新列 → 不 bump；bump 由 T2（orchestrator 骨架，首个依赖方）负责。
  it('selfcheck EXPECTED_SCHEMA_VERSION 保持地板 293 不随 migration bump（issue 14d66027；312 bump 归 T2）', () => {
    const c = readFileSync(selfcheckPath, 'utf8');
    expect(c).toMatch(/EXPECTED_SCHEMA_VERSION = '293'/);
  });
});
