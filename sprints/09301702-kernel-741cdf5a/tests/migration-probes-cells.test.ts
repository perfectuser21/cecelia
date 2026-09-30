/**
 * 冻结结构测试 — 价值流建模⑤（收窄版）迁移 493+（决策 3e867cad 第 11/13 张表）。
 * 扫描 packages/brain/migrations/*.sql（对文件编号不敏感，按 DDL 内容断言）：
 * probes 重挂点（step_probes RENAME→probes + target_type/target_id）/ cells 扩级 落地前应全部 RED。
 * golden_path* 退役已收窄出本 sprint（Brain task 3e60816d），本测试不含其断言。
 * 纯 fs 读，不依赖 Postgres（runtime_resources.postgres=false 稳健）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migDir = fileURLToPath(new URL('../../../packages/brain/migrations/', import.meta.url));
const rbDir = fileURLToPath(new URL('../../../packages/brain/migrations/rollback/', import.meta.url));

function readAll(dir: string): string {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  } catch {
    return '';
  }
  return names.map((f) => readFileSync(dir + f, 'utf8')).join('\n');
}

const upSql = readAll(migDir);
const rbSql = readAll(rbDir);

describe('migration 493+ probes/cells', () => {
  it('RENAME step_probes 到 probes（不复制、up 段不 DROP，零丢失结构保证）', () => {
    expect(upSql).toMatch(/ALTER TABLE (IF EXISTS )?step_probes RENAME TO probes/);
    // up 迁移不得 DROP step_probes（RENAME 已保数据；DROP = 丢探针）
    expect(upSql).not.toMatch(/DROP TABLE (IF EXISTS )?step_probes/);
  });

  it('probes target_type CHECK activity step enabler + target_id 列', () => {
    expect(upSql).toMatch(/target_type/);
    expect(upSql).toMatch(/target_id/);
    expect(upSql).toMatch(
      /CHECK\s*\(\s*target_type\s+IN\s*\(\s*'activity'\s*,\s*'step'\s*,\s*'enabler'\s*\)\s*\)/,
    );
  });

  it('journey_step_links target_type target_id 扩 step/enabler 级', () => {
    // 收紧到具体 ADD COLUMN，避免 [\s\S]* 跨迁移文件误判为已实现
    expect(upSql).toMatch(
      /ALTER TABLE (IF EXISTS )?journey_step_links\s+ADD COLUMN (IF NOT EXISTS )?target_type/,
    );
    expect(upSql).toMatch(
      /ALTER TABLE (IF EXISTS )?journey_step_links\s+ADD COLUMN (IF NOT EXISTS )?target_id/,
    );
  });

  it('schema_version 493 登记 + 回滚脚本存在', () => {
    expect(upSql).toMatch(/INSERT INTO schema_version[\s\S]*'49[3-9]'/);
    // 回滚：probes 改回 step_probes（RENAME 可逆）+ 退版本号
    expect(rbSql).toMatch(/RENAME TO step_probes/);
    expect(rbSql).toMatch(/DELETE FROM schema_version WHERE version = '49[3-9]'/);
  });
});
