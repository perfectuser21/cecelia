/**
 * 迁移 486（主理人 2026-09-28/29 拍板）：
 *   一、D 类剩余 2 张「接口都在从没人调用」的空表连代码删：topic_decision_feedback、publish_success_daily。
 *   二、ZenithJoy 授权 4 张空副本连大脑侧路由删（真账在 hk zenithjoy）：licenses、license_machines、
 *       license_credit_transactions、keyword_tasks。
 *   三、AI Journey / AI Feature 两个 Notion 镜子恢复推送（决策 7a4a41a9 覆盖 24a37029）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const up = `${root}packages/brain/migrations/486_cleanup_final_and_restore_journey_mirrors.sql`;
const down = `${root}packages/brain/migrations/rollback/486_cleanup_final_and_restore_journey_mirrors.down.sql`;
const sql = (existsSync(up) ? readFileSync(up, 'utf8') : '').replace(/^\s*--.*$/gm, '');
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';
const TABLES = ['topic_decision_feedback', 'publish_success_daily', 'licenses', 'license_machines', 'license_credit_transactions', 'keyword_tasks'];

describe('migration 486', () => {
  it('非空闸 + 单条 DROP 6 表、无 CASCADE', () => {
    const drop = (sql.match(/DROP TABLE IF EXISTS([\s\S]*?);/) || [])[1] || '';
    for (const t of TABLES) expect(drop).toContain(`public.${t}`);
    expect(drop.match(/public\./g)).toHaveLength(6);
    expect(sql).toMatch(/RAISE EXCEPTION/);
    expect(sql).not.toMatch(/CASCADE/i);
  });

  it('AI Journey / AI Feature 登记恢复 push/active', () => {
    expect(sql).toMatch(/UPDATE notion_projection_map[\s\S]*status = 'active'[\s\S]*direction = 'push'[\s\S]*358c40c2-ba63-8148-bde7-e313d789931a/);
    expect(sql).toMatch(/UPDATE notion_projection_map[\s\S]*status = 'active'[\s\S]*direction = 'push'[\s\S]*358c40c2-ba63-81e3-96c5-d762b3d34dff/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'486'/);
  });

  it('回滚重建 6 表、两登记行回到 archived/none、删版本', () => {
    expect(downSql.match(/^CREATE TABLE /gm)).toHaveLength(6);
    expect(downSql).toMatch(/status = 'archived', direction = 'none'/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '486'/);
  });

  it('源码不再读写这 6 张表、不再挂授权/积分/关键词任务路由', () => {
    const pat = `(FROM|JOIN|INTO|UPDATE)[[:space:]]+(${TABLES.join('|')})([[:space:](,;]|$)`;
    const out = execSync(`git grep -lE '${pat}' -- packages/brain/src apps/api/src ':!*__tests__*' ':!*.test.*' || true`, { cwd: root, encoding: 'utf8' });
    expect(out.trim()).toBe('');
    const server = readFileSync(`${root}packages/brain/server.js`, 'utf8');
    expect(server).not.toMatch(/routes\/(license|agent-credit|acquisition)\.js/);
  });
});
