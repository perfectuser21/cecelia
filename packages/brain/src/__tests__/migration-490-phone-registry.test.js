/**
 * 迁移 490 结构断言（任务 b923b1f7，决策 432172f7 方案 C）：phone_registry 手机台账。
 * 映射是台账数据——昵称/别名/抖音号/微信都落这张表，代码里不写任何一台手机。
 * 种子 = 2026-09-29 实测的四台；真库行为见 ../routes/phone-registry.test.js 与 routing/__tests__/phone-resolver.test.js。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/490_phone_registry.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/490_phone_registry.down.sql', import.meta.url));

describe('migration 490 phone_registry', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('建表：serial PK、nickname NOT NULL、aliases text[]、douyin_accounts jsonb、enabled 默认 true', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS phone_registry/);
    expect(sql).toMatch(/serial text PRIMARY KEY/);
    expect(sql).toMatch(/nickname text NOT NULL/);
    expect(sql).toMatch(/aliases text\[\] NOT NULL DEFAULT '\{\}'/);
    for (const col of ['host text', 'profile text', 'model text', 'owner text', 'role text', 'wechat jsonb', 'updated_by text']) {
      expect(sql).toContain(col);
    }
    expect(sql).toMatch(/douyin_accounts jsonb NOT NULL DEFAULT '\[\]'/);
    expect(sql).toMatch(/enabled boolean NOT NULL DEFAULT true/);
    expect(sql).toMatch(/updated_at timestamptz NOT NULL DEFAULT NOW\(\)/);
  });

  it('种子四台走 INSERT … ON CONFLICT（幂等，不覆盖台账里后改的值）', () => {
    expect(sql).toMatch(/INSERT INTO phone_registry[\s\S]*ON CONFLICT \(serial\) DO NOTHING/);
    for (const s of ['ANGYVB4311010223', 'e6c7ef34', 'ANGYVB4402004137', 'ANGYVB4227006983']) expect(sql).toContain(`'${s}'`);
    for (const n of ['小彩', '小白', '小黄', '小蓝', '小龙虾', '一号机', '金诺机']) expect(sql).toContain(n);
    for (const p of ['xiaolongxia', 'yueshengyun-work', 'legacy', 'jinoshengyuan-work']) expect(sql).toContain(`'${p}'`);
    for (const id of ['90915521618', '37358506855', '44997267357', 'langzi63485']) expect(sql).toContain(id);
    expect(sql).toContain('RMX3478');
  });

  it('登记 schema_version 490', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'490'/);
  });

  it('回滚脚本删表并摘掉 schema_version 记录', () => {
    const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(downSql).toMatch(/DROP TABLE IF EXISTS phone_registry/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '490'/);
  });
});
