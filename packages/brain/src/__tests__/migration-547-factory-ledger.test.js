/** 迁移 547（技能工厂台账，决策 cc008b7e / 2bb08a99）：只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = readFileSync(fileURLToPath(new URL('../../migrations/547_factory_ledger.sql', import.meta.url)), 'utf8');
const downPath = fileURLToPath(new URL('../../migrations/rollback/547_factory_ledger.down.sql', import.meta.url));

describe('migration 547 factory ledger', () => {
  it('台账一条业务 workflow 一行，阶段 1..7、验证口径两档、卡点类型四种', () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS factory_ledger/);
    expect(up).toMatch(/workflow_id\s+uuid NOT NULL UNIQUE REFERENCES workflows\(id\)/);
    expect(up).toMatch(/CHECK \(stage BETWEEN 1 AND 7\)/);
    expect(up).toMatch(/validation_mode IN \('use_while_validate', 'validate_before_release'\)/);
    expect(up).toMatch(/blocked_kind IN \('none', 'human_gate', 'resource', 'safety'\)/);
    for (const col of ['production_version', 'candidate_version', 'window_k', 'recent_runs', 'recent_pass', 'recent_total', 'degrade_count', 'next_action', 'blocked_reason', 'updated_at'])
      expect(up).toMatch(new RegExp(`\\n\\s+${col}\\s`));
  });
  it('阶段事件只追加，actor 三种，证据是 jsonb 数组', () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS factory_stage_events/);
    expect(up).toMatch(/actor\s+text NOT NULL CHECK \(actor IN \('rule', 'human', 'agent'\)\)/);
    expect(up).toMatch(/jsonb_typeof\(evidence_run_ids\) = 'array'/);
    expect(up).toMatch(/CREATE TRIGGER factory_stage_events_append_only BEFORE UPDATE OR DELETE ON factory_stage_events/);
  });
  it('不改已有表；写 schema_version 547，事务包裹，有回滚脚本', () => {
    expect(up).not.toMatch(/ALTER TABLE (workflows|activities|runs|spans)\b/);
    expect(up).toMatch(/INSERT INTO schema_version[\s\S]*'547'/);
    expect(up).toMatch(/^BEGIN;/m);
    expect(up.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(downPath)).toBe(true);
    const down = readFileSync(downPath, 'utf8');
    expect(down).toMatch(/DROP TABLE IF EXISTS factory_stage_events/);
    expect(down).toMatch(/DROP TABLE IF EXISTS factory_ledger/);
    expect(down).toMatch(/DELETE FROM schema_version WHERE version = '547'/);
  });
});
