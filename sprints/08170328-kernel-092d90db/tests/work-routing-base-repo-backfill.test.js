/**
 * TDD Red — work-routing-store.createRoutedTask 缺 base_repo 回填规范 clone URL。
 * 根因：7 天内 146 条 harness_initiative 有 29 条缺 payload.base_repo（自愈 successor / 人工建单不回填）
 * → 下游 ground-truth 无 base_repo 可解析 → 提案观测退 origin → gan_no_push_streak 假失败随时复发。
 * 修法：建任务口对 coding_mutation 缺 base_repo 时，从 map_scope_repositories 的 repo/aliases
 * 推出规范完整 URL（短名/别名一律规范化为 https://github.com/<owner>/<repo>.git）写入 payload.base_repo。
 *
 * 被测边（禁 mock）：代码 ↔ tasks 表 payload 写入。此单测按仓库既有约定用 fake client 拦 SQL、
 * 断言 INSERT INTO tasks 的 payload 参数（值计算真验，非伪造 DB 成功）；真库落库真验见 ## E2E 验收 psql。
 */
import { describe, it, expect, vi } from 'vitest';
import { createRoutedTask } from '../../../packages/brain/src/work-routing-store.js';

const REPOSITORIES = [{
  scope_key: 'cecelia',
  repo: 'cecelia',
  aliases: ['perfectuser21/cecelia'],
}];

function fakeClientAndPool() {
  const inserts = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      const text = String(sql);
      if (text.includes('WITH authoritative_scope AS')) {
        return { rows: [{ node_key: 'F1' }] };
      }
      if (text.includes('INSERT INTO tasks')) {
        inserts.push(params);
        return { rows: [{ id: 'task-backfill', task_type: 'harness_initiative' }] };
      }
      if (text.includes('INSERT INTO work_routing_receipts')) {
        return { rows: [{ id: 'receipt-backfill' }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  return { client, pool, inserts };
}

describe('createRoutedTask 缺 base_repo 回填规范 URL [BEHAVIOR]', () => {
  it('coding_mutation 且不带 base_repo、repo 解析为 cecelia → 落库 payload.base_repo=https://github.com/perfectuser21/cecelia.git', async () => {
    const { pool, inserts } = fakeClientAndPool();

    await createRoutedTask(pool, {
      source: 'api',
      source_id: 'base-repo-backfill',
      title: 'route coding work without base_repo',
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'perfectuser21/cecelia',
      map_scope_hint: ['F1'],
      branch: 'cp-route-backfill',
      base_sha: 'a'.repeat(40),
      // 刻意不传 metadata.base_repo，触发回填
    }, REPOSITORIES);

    expect(inserts.length).toBe(1);
    // INSERT INTO tasks 第 10 个参数（0-based 9）= JSON.stringify(payload)
    const payload = JSON.parse(inserts[0][9]);
    expect(payload.base_repo).toBe('https://github.com/perfectuser21/cecelia.git');
  });
});
