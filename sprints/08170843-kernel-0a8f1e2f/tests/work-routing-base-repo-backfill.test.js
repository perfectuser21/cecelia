/**
 * 合同冻结测试 — work-routing-store createRoutedTask base_repo 回填。
 *
 * 被改的边：代码 ↔ tasks 表 payload 写路径（coding_mutation 建单口）。用既有 fake client
 * （依赖注入，非真 PG）捕获 INSERT INTO tasks 的 payload 参数断言落库形态。
 *
 * 规则（PRD 系统处理 C）：coding_mutation 任务在 payload/metadata 缺 base_repo 时，
 * 从 map_scope_repositories 的 repo/aliases 推出规范 clone URL 写入 payload.base_repo；
 * 短名/别名一律规范化为完整 https://github.com/<owner>/<repo>.git。
 */
import { describe, it, expect, vi } from 'vitest';
import { createRoutedTask } from '../../../packages/brain/src/work-routing-store.js';

const REPOSITORIES = [{
  scope_key: 'cecelia',
  repo: 'cecelia',
  aliases: ['perfectuser21/cecelia'],
}];

function fakeClientPool() {
  const client = {
    query: vi.fn(async (sql) => {
      const s = String(sql);
      if (s.includes('WITH authoritative_scope AS')) return { rows: [{ node_key: 'F1' }] };
      if (s.includes('INSERT INTO tasks')) return { rows: [{ id: 'task-backfill', task_type: 'harness_initiative' }] };
      if (s.includes('INSERT INTO work_routing_receipts')) return { rows: [{ id: 'receipt-backfill' }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) }, client };
}

function extractInsertedPayload(client) {
  const call = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO tasks'));
  expect(call).toBeTruthy();
  const params = call[1] || [];
  for (const p of params) {
    if (typeof p !== 'string') continue;
    try {
      const obj = JSON.parse(p);
      if (obj && typeof obj === 'object' && 'base_repo' in obj) return obj;
    } catch { /* not the payload param */ }
  }
  return null;
}

describe('createRoutedTask base_repo 回填', () => {
  it('coding_mutation 不带 base_repo、repo=cecelia → 落库 payload.base_repo 为完整 GitHub URL', async () => {
    const { pool, client } = fakeClientPool();
    await createRoutedTask(pool, {
      source: 'api',
      source_id: 'base-repo-backfill-1',
      title: '回填 base_repo 测试任务',
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'perfectuser21/cecelia',
      map_scope_hint: ['F1'],
      branch: 'cp-route-backfill',
      base_sha: 'a'.repeat(40),
      // 关键：metadata / task.payload 均不含 base_repo。
      metadata: {},
    }, REPOSITORIES);

    const payload = extractInsertedPayload(client);
    expect(payload).toBeTruthy();
    expect(payload.base_repo).toBe('https://github.com/perfectuser21/cecelia.git');
  });

  it('已带 base_repo 时不覆盖（回填只在缺失时发生）', async () => {
    const { pool, client } = fakeClientPool();
    await createRoutedTask(pool, {
      source: 'api',
      source_id: 'base-repo-backfill-2',
      title: '已带 base_repo 不覆盖',
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'perfectuser21/cecelia',
      map_scope_hint: ['F1'],
      branch: 'cp-route-backfill-2',
      base_sha: 'b'.repeat(40),
      metadata: { base_repo: 'https://github.com/perfectuser21/cecelia.git' },
    }, REPOSITORIES);

    const payload = extractInsertedPayload(client);
    expect(payload).toBeTruthy();
    expect(payload.base_repo).toBe('https://github.com/perfectuser21/cecelia.git');
  });
});
