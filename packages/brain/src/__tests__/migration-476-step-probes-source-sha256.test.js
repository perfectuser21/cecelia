/**
 * 迁移 476 结构断言（链 bf5088a3 棒2 后续）：step_probes 加 source_sha256——探针文件整文件哈希
 * （与 workspace probes-lib loadChecks().sha256 同口径），与逐条 spec_hash 并存：文件级看"仓库那份和库里登记的是不是同一版"，
 * 逐条级看"哪条探针变了"。（原拟 475，与棒3a #5590 的 475_business_probe_receipts 撞号后改 476。）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/476_step_probes_source_sha256.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/476_step_probes_source_sha256.down.sql', import.meta.url));

describe('migration 476', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('幂等加列 source_sha256 text 可空 + hex64 CHECK（DROP+ADD）', () => {
    expect(sql).toMatch(/ALTER TABLE step_probes ADD COLUMN IF NOT EXISTS source_sha256 text/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS step_probes_source_sha256_check/);
    expect(sql).toMatch(/CHECK \(source_sha256 IS NULL OR source_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });

  it('登记 schema_version 476', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'476'/);
  });

  it('回滚脚本删列并摘掉 schema_version 记录', () => {
    const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(downSql).toMatch(/ALTER TABLE step_probes DROP COLUMN IF EXISTS source_sha256/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '476'/);
  });
});
