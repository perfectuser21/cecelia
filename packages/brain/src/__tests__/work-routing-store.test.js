/**
 * work-routing-store.test.js —— createRoutedTask 是仓内唯一建单路径（INSERT INTO tasks）。
 * 本文件钉住 tasks.kind 真列的写入合同（决策 df67a9d6 / e073bdc2，任务 94465721）：
 *   ① 调用方不给 kind → 按 canonical_task_type 从注册表派生
 *   ② 调用方给合法 kind → 原样写入（Jev/人工判定优先于类型缺省）
 *   ③ 调用方给非法 kind → 抛 code=invalid_task_kind，且根本不 INSERT
 *
 * 不 mock work-router：走真实路由，只 mock pg 池，从 INSERT 的列清单里定位 kind 的参数位，
 * 不靠数下标（列清单以后再加列，下标断言会静默漂）。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRoutedTask, loadRepositoryFacts } from '../work-routing-store.js';
import { resolveRepo, routeWork } from '../work-router.js';

it('真实仓库路由回归登记为生产store的精确辅助验证来源', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../.implementation-source-relations.json', import.meta.url), 'utf8'));
  expect(manifest.relations).toContainEqual({
    owner_path: 'packages/brain/src/work-routing-store.js',
    path: 'packages/brain/src/__tests__/work-routing-store.test.js',
    role: 'verification',
  });
});

function makePool() {
  const query = vi.fn(async (sql) => {
    if (/INSERT INTO tasks/.test(sql)) {
      return { rows: [{ id: 'task-1', title: 'T', status: 'queued', payload: {} }], rowCount: 1 };
    }
    if (/INSERT INTO work_routing_receipts/.test(sql)) return { rows: [{ id: 'receipt-1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { query };
}

/** 从 INSERT SQL 的列清单里找某列的参数值。 */
function insertedValue(pool, column) {
  const call = pool.query.mock.calls.find(([sql]) => /INSERT INTO tasks/.test(sql));
  expect(call, '未发生 INSERT INTO tasks').toBeTruthy();
  const [sql, params] = call;
  const cols = sql.match(/INSERT INTO tasks \(([\s\S]*?)\) VALUES/)[1]
    .split(',').map((c) => c.trim()).filter(Boolean);
  const idx = cols.indexOf(column);
  expect(idx, `INSERT 列清单里没有 ${column}：${cols.join(',')}`).toBeGreaterThanOrEqual(0);
  return params[idx];
}

const nonCoding = (over = {}) => ({
  source: 'api',
  source_id: `src-${Math.random().toString(36).slice(2)}`,
  title: '跑一轮周报工作流',
  description: 'd',
  requested_task_type: 'workflow_run',
  mutation_intent: 'none',
  declared_domain: 'operations',
  metadata: {},
  task: { priority: 'P2' },
  ...over,
});

// 2026-10-19 生产完整8行只读快照；不含凭据，不在测试中读取生产。
const REGISTERED_REPOSITORIES = [
  { scope_key: 'cecelia', repo: 'cecelia', adapter_config: { aliases: ['perfectuser21/cecelia', 'https://github.com/perfectuser21/cecelia'], ledger_partition: 'cecelia' } },
  { scope_key: 'cecelia-device-patrol-definitions', repo: 'patrol-definitions-workspace', adapter_config: { source_repo: 'perfectuser21/zenithjoy-workspace', workflow_keys: ['single-phone-account-patrol', 'phone-account-patrol-batch', 'phone-account-patrol-maintenance'], definition_protocol: 'definition-freeze-v1' } },
  { scope_key: 'cecelia-factory', repo: 'cecelia-factory-source', adapter_config: { source_repo: 'perfectuser21/cecelia' } },
  { scope_key: 'cecelia-kr', repo: 'cecelia-kr-source', adapter_config: { source_repo: 'perfectuser21/cecelia' } },
  { scope_key: 'commander-generic', repo: 'commander-generic-workspace', adapter_config: { source_repo: 'perfectuser21/zenithjoy-workspace', workflow_keys: ['workflow_report.internal', 'workflow_commander.internal'], definition_protocol: 'definition-freeze-v1' } },
  { scope_key: 'zenithjoy', repo: 'zenithjoy-pilot-source', adapter_config: { source_repo: 'perfectuser21/zenithjoy-workspace' } },
  { scope_key: 'zenithjoy-skills', repo: 'zenithjoy-skills', adapter_config: { source_repo: 'perfectuser21/zenithjoy-skills' } },
  { scope_key: 'zenithjoy-workspace', repo: 'zenithjoy-workspace', adapter_config: { aliases: ['perfectuser21/zenithjoy-workspace'], ledger_partition: 'zenithjoy' } },
];
const PHYSICAL_HINTS = ['cecelia', 'zenithjoy-workspace', 'zenithjoy-skills'].flatMap(repo => [
  repo, `perfectuser21/${repo}`, `https://github.com/perfectuser21/${repo}`,
  `https://github.com/perfectuser21/${repo}.git`, `git@github.com:perfectuser21/${repo}.git`,
].map(hint => ({ repo, hint })));
const factsFrom = rows => loadRepositoryFacts({ query: vi.fn(async () => ({ rows })) });

describe('物理仓库别名与authoring scope投影隔离', () => {
  it.each(PHYSICAL_HINTS)('$hint只路由到物理仓$repo', async ({ repo, hint }) => {
    const facts = await factsFrom(REGISTERED_REPOSITORIES);
    expect(facts).toHaveLength(8);
    expect(facts.map(f => [f.scope_key, f.repo])).toEqual(REGISTERED_REPOSITORIES.map(r => [r.scope_key, r.repo]));
    expect(resolveRepo({ repo_hint: hint }, facts)).toBe(repo);
    const decision = routeWork({ source: 'child', source_id: 'commander-repair:fixture', title: '冻结源码缺陷修补',
      mutation_intent: 'write', declared_change_kind: 'bugfix', repo_hint: hint, map_scope_hint: ['F1'] }, facts);
    expect(decision).toMatchObject({ repo, canonical_task_type: 'coding_workflow', map_scope: ['F1'] });
  });

  it('投影仍按原登记身份可读，显式别名和path不被过滤', async () => {
    const rows = structuredClone(REGISTERED_REPOSITORIES);
    rows[2].adapter_config.aliases = ['explicit-factory']; rows[2].adapter_config.path = '/registered/factory';
    const facts = await factsFrom(rows);
    for (const row of rows) expect(resolveRepo({ repo_hint: row.repo }, facts)).toBe(row.repo);
    for (const hint of ['explicit-factory', '/registered/factory']) expect(resolveRepo({ repo_hint: hint }, facts)).toBe('cecelia-factory-source');
  });

  it('物理仓以完整slug登记时仍派生原规范别名', async () => {
    const repo = 'perfectuser21/zenithjoy-skills';
    const facts = await factsFrom([{ scope_key: 'skills', repo, adapter_config: { source_repo: repo } }]);
    expect(resolveRepo({ repo_hint: 'zenithjoy-skills' }, facts)).toBe(repo);
  });

  it('不同物理仓显式占用同一别名仍拒绝，不取首行', async () => {
    const rows = structuredClone(REGISTERED_REPOSITORIES);
    rows[0].adapter_config.aliases.push('ambiguous'); rows[7].adapter_config.aliases.push('ambiguous');
    for (const ordered of [rows, [...rows].reverse()]) {
      const facts = await factsFrom(ordered);
      expect(() => resolveRepo({ repo_hint: 'ambiguous' }, facts)).toThrow('repo_unknown');
    }
    expect(() => resolveRepo({ repo_hint: 'unregistered' }, [])).toThrow('repo_unknown');
  });
});

describe('createRoutedTask 写 tasks.kind', () => {
  it('不传 kind → 按 canonical_task_type 派生（workflow_run → workflow；research → agent）', async () => {
    const pool = makePool();
    // workflow_run 是外部起跑的账本镜像，只以 in_progress 入账（queued 无执行者建单即拒，任务 0a70684f）
    await createRoutedTask(pool, nonCoding({ task: { priority: 'P2', status: 'in_progress' } }));
    expect(insertedValue(pool, 'kind')).toBe('workflow');

    const pool2 = makePool();
    await createRoutedTask(pool2, nonCoding({ requested_task_type: 'research', declared_domain: 'research' }));
    expect(insertedValue(pool2, 'kind')).toBe('agent');
  });

  it('传合法 kind → 原样写入，压过类型缺省', async () => {
    const pool = makePool();
    await createRoutedTask(pool, nonCoding({ task: { priority: 'P2', kind: 'agent', status: 'in_progress' } }));
    expect(insertedValue(pool, 'kind')).toBe('agent');
  });

  it('传非法 kind → 抛 invalid_task_kind，事务回滚，不 INSERT', async () => {
    const pool = makePool();
    let err;
    try {
      await createRoutedTask(pool, nonCoding({ task: { priority: 'P2', kind: 'script' } }));
    } catch (e) { err = e; }
    expect(err?.code).toBe('invalid_task_kind');
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO tasks/.test(sql))).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });
});
