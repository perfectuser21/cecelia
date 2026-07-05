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

  // T2 已兑现 bump（orchestrator 代码强依赖 312 列：orchestrator_decision_log + initiative_runs 心跳列）。
  // 此后 313（licenses.credit_balance）、314（tasks.custom_props）又各自因真实代码依赖再 bump。
  // issue 14d66027 语义不变：加 migration 本身不 bump，只有代码真依赖新 schema 才 bump；
  // 本用例只验证地板号 >= 312（T2 的下限），不再断言精确等于某个历史值（否则每次后续
  // 合理 bump 都要来改这个不相关的文件）。
  it('selfcheck EXPECTED_SCHEMA_VERSION >= 312（T2 兑现的代码依赖 bump；issue 14d66027 语义不变）', () => {
    const c = readFileSync(selfcheckPath, 'utf8');
    const match = c.match(/EXPECTED_SCHEMA_VERSION = '(\d+)'/);
    expect(match, 'selfcheck.js 里找不到 EXPECTED_SCHEMA_VERSION').toBeTruthy();
    expect(Number(match[1])).toBeGreaterThanOrEqual(312);
  });
});
