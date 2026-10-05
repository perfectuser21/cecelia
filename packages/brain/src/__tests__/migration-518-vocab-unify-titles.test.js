/**
 * 迁移 518 结构断言（框架标准 v2.0 术语表，决策 cebd1540）：
 * Notion 5 个镜子库标题已改为标准词表，notion_projection_map.title 必须同步，否则投影对账报告仍显示旧名。
 * 只改 title，按 notion_db_id 定位；不动 direction/face/vessel。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/518_vocab_unify_projection_titles.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/518_vocab_unify_projection_titles.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

const RENAMES = [
  ['358c40c2-ba63-8148-bde7-e313d789931a', 'AI Journey', '价值流与能力（journeys）'],
  ['c213e387-b2ae-45a4-98c0-4a66fe3408be', 'Backbone Activities', 'Activity（活动）'],
  ['3e8c40c2-ba63-8194-a47c-dcf5f4b508bb', '承诺地图格子', 'Activity 卡片格子'],
  ['3d9c40c2-ba63-8145-bfa8-f4c0c006e0af', 'Workflows 总库', '流程（workflows）'],
  ['358c40c2-ba63-81e3-96c5-d762b3d34dff', 'AI Feature', '旧树 · Feature（只读，待退役）'],
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('migration 518 — 词表统一：notion_projection_map 标题同步', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('按 notion_db_id 逐条 UPDATE title 为标准词表，不动其他列', () => {
    for (const [dbId, , next] of RENAMES) {
      expect(sql, `${dbId} → ${next}`).toMatch(new RegExp(`UPDATE notion_projection_map SET title = '${esc(next)}'[^;]*WHERE notion_db_id = '${dbId}'`));
    }
    expect(sql).not.toMatch(/SET\s+(direction|face|vessel|brain_table)\s*=/);
  });

  it('回滚把 5 条标题改回旧名', () => {
    for (const [dbId, prev] of RENAMES) {
      expect(downSql, `${dbId} ← ${prev}`).toMatch(new RegExp(`SET title = '${esc(prev)}'[^;]*WHERE notion_db_id = '${dbId}'`));
    }
  });

  it('登记 schema_version 518 并在回滚中删除', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'518'/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '518'/);
  });
});
