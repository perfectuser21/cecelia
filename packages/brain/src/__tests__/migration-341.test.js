/**
 * Migration 341 Tests — zenithjoy 裸表归位 schema，禁止 ALTER DATABASE 全局副作用
 *
 * 背景（P0 事故 2026-07-13）：原版 migration 341 含
 * `ALTER DATABASE cecelia SET search_path = zenithjoy, public`，
 * 该语句是数据库级别全局设置，把 Brain 自己裸写的 `tasks(goal_id)` 解析到了
 * ZenithJoy 同名但结构不同的 zenithjoy.tasks 表，导致 Brain 容器 crash-loop。
 * 两个 App 共享一个物理库时，任何一条 migration 都不能用 ALTER DATABASE 改
 * 全局 search_path —— 消费方应显式加 schema 前缀（zenithjoy.xxx），不能靠
 * search_path 兜底。
 *
 * 不依赖 DB（避免 CI flaky），通过读取 migration SQL 文件验证关键内容。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '../../migrations');
describe('全局守卫 — 任何 migration 文件都不能出现 ALTER DATABASE', () => {
  it('packages/brain/migrations/*.sql 里没有任何 ALTER DATABASE 语句（防止同类事故复发）', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const offenders = [];
    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), 'utf8');
      if (/ALTER\s+DATABASE/i.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
