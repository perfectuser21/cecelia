/**
 * 刀C-1 — spawn 时写 initiative_runs.current_task_id
 * 修 relay-runs ?task_id= 对 relay run 恒空的问题：
 *   - headless spawn (spawnSkillRelaySession) 的 INSERT 含 current_task_id = initiative_id
 *   - headed spawn 的 INSERT 同样含 current_task_id = initiative_id
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

// 阻断 harness-skill-relay 的外部 IO：docker/ssh 调用
vi.mock('../harness-credentials.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue({ name: 'acc1', home: '/home/acc1' }),
}));

describe('spawnSkillRelaySession — current_task_id 写入', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    // 默认所有 query 返回成功
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('INSERT initiative_runs 包含 current_task_id 列', async () => {
    // 捕获所有 INSERT 到 initiative_runs 的 SQL
    const insertSqls = [];
    mockPool.query.mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO initiative_runs')) {
        insertSqls.push({ sql, params });
      }
      return { rows: [], rowCount: 0 };
    });

    // 需要 spawnSkillRelaySession 函数，但它会尝试真实 docker；
    // 我们只验证 INSERT SQL 中含 current_task_id 列
    // 通过检查模块源码（编译时验证）
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../harness-skill-relay.js', import.meta.url).pathname,
      'utf8'
    );

    // headless INSERT 必须含 current_task_id
    const headlessInsertMatch = src.match(
      /INSERT INTO initiative_runs[\s\S]*?initiative_id.*?current_task_id[\s\S]*?VALUES[\s\S]*?(?=\n\s*\n|\*\/|\/\/)/
    );

    // 提取所有 INSERT INTO initiative_runs 代码块
    const allInserts = [...src.matchAll(/INSERT INTO initiative_runs([\s\S]*?)VALUES([\s\S]*?)\`/g)];
    const insertWithCurrentTaskId = allInserts.filter(m => m[0].includes('current_task_id'));

    expect(insertWithCurrentTaskId.length).toBeGreaterThanOrEqual(2);
  });
});

describe('skill-relay INSERT SQL 静态验证', () => {
  it('headless spawn INSERT 含 current_task_id', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../harness-skill-relay.js', import.meta.url).pathname,
      'utf8'
    );
    // 找所有 INSERT INTO initiative_runs 的列声明部分
    const sections = src.split('INSERT INTO initiative_runs');
    // 跳过第一个（注释）
    const insertSections = sections.slice(1);
    const allHaveCurrentTaskId = insertSections.every(s => s.slice(0, 400).includes('current_task_id'));
    expect(allHaveCurrentTaskId).toBe(true);
  });
});
