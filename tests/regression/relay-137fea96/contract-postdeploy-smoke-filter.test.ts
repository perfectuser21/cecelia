import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { runPostdeployVerifier, _resetThrottleForTest } from '../../../packages/brain/src/postdeploy-verifier.js';

/**
 * Golden Path Step 4 — fetchPendingBatch 排除 smoke: 前缀任务 [BEHAVIOR]
 *
 * TDD Red phase: fetchPendingBatch 当前无 title 过滤，title='smoke: ...' 的
 * pending_postdeploy 任务会被正常批次消费、执行 command、标记 completed/failed。
 * 本测试插入一个真实 smoke: 前缀任务（command 会成功执行），断言
 * runPostdeployVerifier 扫描后该任务 status 仍为 pending_postdeploy（未被消费）。
 * 过滤未加时该断言 FAIL（任务会被标 completed）→ 真红。
 *
 * 同时插入一个不带 smoke: 前缀的对照任务，断言其正常被消费为 completed —
 * 证明过滤是选择性排除（只挡 smoke: 前缀），不是把整个批次机制打坏。
 *
 * 真实调用方式：直接调用真实 runPostdeployVerifier(真实 pg.Client)，不 mock db pool
 * （命中「禁 mock 边清单」第二条：postdeploy-verifier.js ↔ tasks 表 调度批次查询）。
 * 命令用白名单内的 `sh -c "echo ok"`，不产生真实副作用；执行环境要求同上一测试文件。
 */

const DB_URL = process.env.DB || 'postgresql://localhost/cecelia';
const RUN_TAG = `137fea96-${Date.now()}`;

let client: pg.Client;
let smokeTaskId: string;
let controlTaskId: string;

beforeAll(async () => {
  client = new pg.Client(DB_URL);
  await client.connect();

  const r1 = await client.query<{ id: string }>(
    `INSERT INTO tasks (task_type, status, title, payload)
     VALUES ('dev', 'pending_postdeploy', $1,
             jsonb_build_object('postdeploy_check', jsonb_build_object('command', 'sh -c "echo ok"', 'timeout_s', 5)))
     RETURNING id::text`,
    [`smoke: contract-filter-test-${RUN_TAG}`]
  );
  smokeTaskId = r1.rows[0].id;

  const r2 = await client.query<{ id: string }>(
    `INSERT INTO tasks (task_type, status, title, payload)
     VALUES ('dev', 'pending_postdeploy', $1,
             jsonb_build_object('postdeploy_check', jsonb_build_object('command', 'sh -c "echo ok"', 'timeout_s', 5)))
     RETURNING id::text`,
    [`contract-filter-test-control-${RUN_TAG}`]
  );
  controlTaskId = r2.rows[0].id;

  _resetThrottleForTest();
  await runPostdeployVerifier(client);
});

afterAll(async () => {
  if (client) {
    await client.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [
      [smokeTaskId, controlTaskId].filter(Boolean),
    ]);
    await client.end();
  }
});

describe('postdeploy-verifier — fetchPendingBatch 排除 smoke: 前缀 [BEHAVIOR]', () => {
  it('title 以 "smoke:" 开头的任务 → runPostdeployVerifier 扫描后 status 仍为 pending_postdeploy（未被消费）', async () => {
    const r = await client.query<{ status: string; retry_count: string | null }>(
      `SELECT status, payload->>'postdeploy_retry_count' AS retry_count FROM tasks WHERE id = $1`,
      [smokeTaskId]
    );
    expect(r.rows[0].status).toBe('pending_postdeploy');
    expect(r.rows[0].retry_count).toBeNull();
  });

  it('对照：不带 smoke: 前缀的同批次任务 → 正常被消费，status 变为 completed', async () => {
    const r = await client.query<{ status: string }>('SELECT status FROM tasks WHERE id = $1', [controlTaskId]);
    expect(r.rows[0].status).toBe('completed');
  });
});
