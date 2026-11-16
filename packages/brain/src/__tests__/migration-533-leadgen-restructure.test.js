/** 迁移 533（获客重组，决策 eb9f8f77）：只读 SQL 文本断言形状——新旧并存，旧流程与定义版本、Step 一律不动。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/533_leadgen_restructure.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/533_leadgen_restructure.down.sql', import.meta.url));
const OLD_KW = 'b1000000-0000-4000-8000-000000000001', OLD_BM = 'b1000000-0000-4000-8000-000000000002';

describe('migration 533 获客重组', () => {
  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
  const code = sql.replace(/--[^\n]*/g, '');

  it('事务包裹、先备份再改', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(code.indexOf('INSERT INTO migration_533_backup')).toBeLessThan(code.indexOf('UPDATE capabilities'));
  });

  it('能力：关键词获客改名「智能获客」保留 id；对标/视频链接/直播获客标 deprecated 并写明已并入', () => {
    expect(code).toMatch(/UPDATE capabilities\s+SET name = '智能获客'[\s\S]*WHERE id = 'a1000000-0000-4000-8000-000000000001'/);
    expect(code).toMatch(/SET status = 'deprecated'[\s\S]*已并入智能获客，作为发现的找法[\s\S]*'a1000000-0000-4000-8000-000000000002', '5265cb99-ca28-45a8-9c33-6d63124bda96', 'cc21a3c0-cd97-4b14-8cc9-7d90a3267353'/);
  });

  it('新流程不登记 source_repo，避免契约同步误认', () => {
    expect(code).toMatch(/INSERT INTO workflows \(id, capability_id, key, name, channel, form, version, status\)/);
    expect(code).not.toMatch(/INSERT INTO workflows[^;]*source_repo/);
  });

  it('预检与收尾复用同一实体', () => {
    const refs = [...code.matchAll(/\('(b1000000-0000-4000-8000-00000000010\d)', '(\w+)',\s+'([0-9a-f-]+)', (\d+)\)/g)].map(m => ({ wf: m[1], slot: m[2], act: m[3], seq: Number(m[4]) }));
    const preflight = refs.filter(r => r.slot === 'preflight').map(r => r.act), cleanup = refs.filter(r => r.slot === 'cleanup').map(r => r.act);
    expect(new Set(preflight).size).toBe(1);
    expect(new Set(cleanup).size).toBe(1);
  });

  it('不能把线上采收搞停：不碰旧流程、定义版本、release、契约、Step', () => {
    expect(code).not.toMatch(/UPDATE workflows\b/);
    expect(code).not.toMatch(/(UPDATE|DELETE FROM|INSERT INTO) (workflow_definition_versions|activity_definition_versions|release_versions|release_observations|run_definition_bindings|steps)\b/);
    expect(code).not.toMatch(/contract_sha256\s*=|current_definition_version_id\s*=|\bcontract\s*=/);
    expect(code).not.toMatch(/(UPDATE|DELETE FROM) workflow_activity_refs/);
    expect(code).not.toContain(OLD_BM);
  });

  it('闹钟：触发器改挂新流程，在用看护项摘除，只动仍挂在旧关键词获客上的行，不碰 updated_at', () => {
    expect(code).toMatch(/SET workflow_id = 'b1000000-0000-4000-8000-000000000101'\s+WHERE workflow_id = 'b1000000-0000-4000-8000-000000000001'[\s\S]*321856, 321860, 321863, 508370/);
    expect(code).toMatch(/SET workflow_id = 'b1000000-0000-4000-8000-000000000104'\s+WHERE workflow_id = 'b1000000-0000-4000-8000-000000000001' AND id = 508368/);
    expect(code).toMatch(/SET workflow_id = NULL\s+WHERE workflow_id = 'b1000000-0000-4000-8000-000000000001' AND enabled/);
    expect(code).not.toMatch(/UPDATE ops_schedule_entries[^;]*updated_at/);
  });

  it('回滚脚本按备份还原能力/Activity/闹钟，删新流程与新 Activity、清投影链接', () => {
    expect(existsSync(down)).toBe(true);
    const rb = readFileSync(down, 'utf8');
    expect(rb).toMatch(/UPDATE capabilities c[\s\S]*FROM migration_533_backup/);
    expect(rb).toMatch(/UPDATE activities a[\s\S]*FROM migration_533_backup/);
    expect(rb).toMatch(/UPDATE ops_schedule_entries e[\s\S]*FROM migration_533_backup/);
    expect(rb).toMatch(/DELETE FROM workflows[\s\S]*b1000000-0000-4000-8000-000000000104/);
    expect(rb).toMatch(/DELETE FROM activities a[\s\S]*c1000000-0000-4000-8000-000000000106/);
    expect(rb).toMatch(/DELETE FROM projection_links/);
  });
});
