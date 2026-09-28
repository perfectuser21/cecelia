/**
 * 迁移 485 结构断言（决策 28674999）：删除 D 类最后 2 张空表 user_annotations / life_events，
 * 引用它们的路由与看板批注框同 PR 删除。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const up = fileURLToPath(new URL('packages/brain/migrations/485_drop_empty_tables_class_d2.sql', root));
const down = fileURLToPath(new URL('packages/brain/migrations/rollback/485_drop_empty_tables_class_d2.down.sql', root));
const sql = (existsSync(up) ? readFileSync(up, 'utf8') : '').replace(/^\s*--.*$/gm, '');
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

describe('migration 485', () => {
  it('非空闸 + 单条 DROP 两表、无 CASCADE、登记 485', () => {
    expect(sql).toMatch(/RAISE EXCEPTION/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.user_annotations, public\.life_events;/);
    expect(sql).not.toMatch(/CASCADE/i);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'485'/);
  });

  it('回滚重建两表并删版本', () => {
    expect(downSql.match(/^CREATE TABLE /gm)).toHaveLength(2);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '485'/);
  });

  it('引用已删：大脑不再挂批注路由、看板服务不再挂人生事件路由、知识页不再请求批注', () => {
    expect(read('packages/brain/server.js')).not.toMatch(/user-annotations/);
    expect(read('apps/api/src/dashboard/server.ts')).not.toMatch(/life-events/);
    for (const page of ['DailyDiary', 'DecisionRegistry', 'DesignVault', 'DevLog']) {
      expect(read(`apps/api/features/knowledge/pages/${page}.tsx`)).not.toMatch(/user-annotations|AnnotationBox/);
    }
  });
});
