/**
 * DoD test: POST /api/brain/learnings-received 持久化 task_id → action_task_id
 *
 * 背景：旧实现接收 payload.task_id 但只把它放在 issues_found 的 fix-task payload 里，
 * learning 行本身的 action_task_id 列丢失，导致巡检无法通过 learning 反查 task。
 *
 * 本测试在源码层断言：
 *   1. INSERT INTO learnings 的列名清单含 action_task_id
 *   2. VALUES 参数包含 task_id || null（兼容缺省）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = readFileSync(
  resolve(__dirname, '../src/routes/tasks.js'),
  'utf8'
);

describe('POST /api/brain/learnings-received → action_task_id persistence', () => {
  it('INSERT INTO learnings 列清单包含 action_task_id', () => {
    // 抽取 learnings INSERT 语句中的列定义部分（多行）
    const insertMatch = ROUTE_SRC.match(
      /INSERT INTO learnings\s*\(([^]*?)\)\s*VALUES/
    );
    expect(insertMatch, '应存在 INSERT INTO learnings 语句').toBeTruthy();
    const columns = insertMatch[1].replace(/\s+/g, ' ');
    expect(columns, '列清单应含 action_task_id').toContain('action_task_id');
    // 同时 PRESERVE 既有列：source_branch/source_pr/repo 仍在
    expect(columns).toContain('source_branch');
    expect(columns).toContain('source_pr');
    expect(columns).toContain('repo');
  });

  it('INSERT 参数数组传入 task_id || null（缺省时仍能 200 写入）', () => {
    // 在路由 handler 中 task_id 解构和 INSERT 调用之间需要传 task_id || null
    const handlerMatch = ROUTE_SRC.match(
      /router\.post\(['"]\/learnings-received['"][^]*?\n\}\);/
    );
    expect(handlerMatch, '应存在 learnings-received 路由 handler').toBeTruthy();
    const handler = handlerMatch[0];
    expect(handler, '应从 body 解构 task_id').toMatch(/task_id\b/);
    // INSERT 参数数组（紧跟 INSERT 语句的 [..., task_id || null] 形式）
    expect(handler, 'INSERT 参数数组应含 task_id || null（向后兼容 NULL）').toMatch(
      /task_id\s*\|\|\s*null/
    );
  });

  it('next_steps_suggested 路径仍允许无 task_id 提交（向后兼容）', () => {
    // [PRESERVE]：handler 不应 throw 当 task_id 缺省时；只是 action_task_id=NULL
    const handlerMatch = ROUTE_SRC.match(
      /router\.post\(['"]\/learnings-received['"][^]*?\n\}\);/
    );
    const handler = handlerMatch[0];
    // 不应有 `if (!task_id) return res.status(400)` 类强校验
    expect(handler).not.toMatch(/if\s*\(\s*!\s*task_id\s*\)[^\n]*status\(400\)/);
  });
});
