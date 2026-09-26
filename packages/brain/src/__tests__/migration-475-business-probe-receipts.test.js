/**
 * 迁移 475 结构断言（棒3a 判定，任务 33aa2bc4）：journey_assertion_receipts 放行
 * executor_kind='business_probe_runner'，并给它一套不要求 source_sha/machine_id 的 verdict 校验。
 * 374 的 brain_assertion_runner 分支原式保留。（474 号已被棒2 的 step_probes 占用。）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/475_business_probe_receipts.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/475_business_probe_receipts.down.sql', import.meta.url));

describe('migration 475', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('executor_kind CHECK 从单值放宽为两值（374 内联约束名 journey_assertion_receipts_executor_kind_check）', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS journey_assertion_receipts_executor_kind_check/);
    expect(sql).toMatch(/CHECK \(executor_kind IN \('brain_assertion_runner', 'business_probe_runner'\)\)/);
  });

  it('verdict_chk 重建：brain_assertion_runner 保留原式；business_probe_runner 只要求 PASS↔exit 0+证据非空 / FAIL↔exit≠0', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS journey_assertion_receipt_verdict_chk/);
    expect(sql).toMatch(/executor_kind = 'brain_assertion_runner'[\s\S]*source_sha ~ '\^\[0-9a-f\]\{40\}\$'[\s\S]*machine_id IS NOT NULL/);
    expect(sql).toMatch(/executor_kind = 'business_probe_runner'[\s\S]*verdict = 'PASS'[\s\S]*exit_code = 0[\s\S]*scenario_evidence <> '\{\}'::jsonb/);
    expect(sql).toMatch(/verdict = 'FAIL' AND exit_code <> 0/);
    expect(sql).toMatch(/NOT VALID/);
  });

  it('登记 schema_version 475', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'475'/);
  });

  it('回滚脚本恢复单值 CHECK 与 374 原 verdict_chk 并摘掉 schema_version', () => {
    const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(downSql).toMatch(/DELETE FROM journey_assertion_receipts WHERE executor_kind = 'business_probe_runner'/);
    expect(downSql).toMatch(/CHECK \(executor_kind = 'brain_assertion_runner'\)/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '475'/);
  });
});
