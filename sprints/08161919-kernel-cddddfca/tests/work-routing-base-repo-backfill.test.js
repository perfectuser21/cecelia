/**
 * 冻结合同测试 — work-routing-store createRoutedTask base_repo 回填（根因 #3，建任务口不回填）。
 *
 * 用仓库既有约定：fake 捕获 client 断言 INSERT INTO tasks 的 payload 参数（照抄
 * src/__tests__/integration/work-routing-store.integration.test.js 的 vi.fn 捕获模式）。
 * 被改的边是 payload 构造（纯逻辑，捕获参数即可完整观察）；真实 DB 落库由 Final E2E 用真 PG
 * psql 回读 tasks.payload->>'base_repo' 独立验证（见 contract-draft ## E2E 验收 + 禁 mock 边清单）。
 */
import { describe, it, expect, vi } from 'vitest';
import { createRoutedTask } from '../../../packages/brain/src/work-routing-store.js';

const CANONICAL_URL = 'https://github.com/perfectuser21/cecelia.git';

const REPOSITORY_FACTS = [{
  scope_key: 'cecelia',
  repo: 'cecelia',
  aliases: ['perfectuser21/cecelia'],
}];

const ROUTING_EVIDENCE = Object.freeze({
  branch: 'cp-routing-fixture',
  base_sha: 'a'.repeat(40),
});

function activeF1Result(sql) {
  return String(sql).includes('WITH authoritative_scope AS')
    ? { rows: [{ node_key: 'F1' }] }
    : null;
}

/** 捕获全部 query，落 tasks 的 payload 参数供断言。 */
function makeCapturingClient() {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, args) => {
      calls.push([String(sql), args]);
      if (activeF1Result(sql)) return activeF1Result(sql);
      if (String(sql).includes('INSERT INTO tasks')) return { rows: [{ id: 'task-backfill' }] };
      if (String(sql).includes('INSERT INTO work_routing_receipts')) return { rows: [{ id: 'receipt-backfill' }] };
      return { rows: [] };
    }),
  };
  return { client, calls };
}

/** 从 INSERT INTO tasks 的参数里取出被 JSON.stringify 的 payload 对象。 */
function extractInsertedTaskPayload(calls) {
  const insert = calls.find(([sql]) => sql.includes('INSERT INTO tasks'));
  expect(insert).toBeTruthy();
  const payloadArg = insert[1].find((value) => {
    if (typeof value !== 'string') return false;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && 'work_kind' in parsed;
    } catch { return false; }
  });
  expect(payloadArg).toBeTruthy();
  return JSON.parse(payloadArg);
}

describe('createRoutedTask：coding_mutation 缺 base_repo 时回填规范 clone URL', () => {
  it('POST /tasks 不带 base_repo、repo=cecelia → 落库 payload.base_repo === 完整 GitHub URL', async () => {
    const { client, calls } = makeCapturingClient();

    await createRoutedTask(client, {
      source: 'api',
      source_id: 'backfill-missing-base-repo',
      title: 'fix gan_no_push_streak',
      description: '回填 base_repo 规范 URL',
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'cecelia',
      map_scope_hint: ['F1'],
      ...ROUTING_EVIDENCE,
    }, REPOSITORY_FACTS);

    const payload = extractInsertedTaskPayload(calls);
    expect(payload.work_kind).toBe('coding_mutation');
    expect(payload.base_repo).toBe(CANONICAL_URL);
  });
});
