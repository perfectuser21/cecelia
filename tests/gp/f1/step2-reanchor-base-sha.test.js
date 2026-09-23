// F1「工厂 · 开发闭环」步骤 2「合同即法律」—— 边：派发预检 ↔ 派发时重锚定 base_sha
//
// 案卷（任务 d9c405e2 / 决策 49035988）：地图 revision 前进后，路由收据还锚在旧 base_sha，
// 预检直接抛 map_revision_mismatch，任务停在队列里每 tick 重撞，靠人手改库才能解。
// 修：分支尚无产出时，插一条接班收据（supersedes_receipt_id + anchor_generation+1）把锚
// 快进到地图 revision，合同随新锚签发；分支已有产出（initiative_runs 有行）→ needs_rebase，
// 交人工 rebase，一个字都不许写库。
//
// 为什么守卫必须落在这条边上：两个模块各自单测都全绿——预检的单测把 reanchor 注入成
// vi.fn（邻居被 mock），reanchor 的单测自己造 map/receipt（预检不在场）。边上的矛盾
// （接班收据的路由身份、写库顺序、needs_rebase 的零写库）只有两个真零件串起来才撞得出。
// 所以这里真 import map-impact-contract.js 与 base-sha-reanchor.js，两个都不 mock；
// 只注入非被改模块当替身（地图读取/权威锁/合同持久化），真 reanchor 跑在一个按 SQL
// 正则路由的 mock pg client 上（这是 client 对象，不是模块 mock，合规）。
import { describe, it, expect, vi } from 'vitest';
import { ensureMapImpactPreflight } from '../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js';
import { reanchorReceiptIfEmptyBranch } from '../../../packages/brain/src/orchestrator/preflight/base-sha-reanchor.js';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const TASK_ID = '88888888-8888-4888-8888-888888888888';
const RECEIPT_ID = '66666666-6666-4666-8666-666666666666';
const NEXT_RECEIPT_ID = '77777777-7777-4777-8777-777777777777';

const authority = {
  manifest_version_id: '11111111-1111-4111-8111-111111111111',
  manifest_digest: 'b'.repeat(64),
  projection_run_id: '22222222-2222-4222-8222-222222222222',
  projection_digest: 'c'.repeat(64),
  fact_revisions: { cecelia: NEW },
};
const freshMap = {
  ...authority,
  freshness: {
    status: 'fresh',
    repos: { cecelia: { status: 'fresh', source_revision: NEW, reason_code: null } },
  },
};
const radius = {
  ...authority,
  freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: NEW } } },
  affected_business_nodes: [{ node_type: 'capability', node_key: 'F1', name: '开发闭环' }],
  must_run_assertions: [{
    assertion_ref: 'src/router.test.js',
    journey_step_link_id: '55555555-5555-4555-8555-555555555555',
    assertion_revision: 1,
  }],
};
// 旧锚收据：base_sha 停在 OLD，地图已走到 NEW。
const receipt = {
  id: RECEIPT_ID,
  task_id: TASK_ID,
  source: 'api',
  source_id: 'route-1',
  work_kind: 'coding_mutation',
  change_kind: 'bugfix',
  pipeline: 'harness',
  canonical_task_type: 'harness_initiative',
  default_execution_profile: 'hotfix-v1',
  execution_profile_override: null,
  repo: 'cecelia',
  map_scope: ['F1'],
  impact_contract_required: true,
  orchestrator: 'skill-relay',
  router_version: 'v2',
  route_reason: 'coding',
  evidence: { base_sha: OLD, branch: 'cp-route-api-1' },
  map_scope_validation_version: 'active-business-node-v1',
  direct_contract_seed: null,
  anchor_generation: 1,
  has_v2_run: false,
  superseded: false,
};

// 真 reanchor 跑在这个 client 上：按 SQL 正则路由，收据 INSERT 的 RETURNING 行
// 完全由入参回放（不是写死常量），所以列位错了立刻在断言里暴露。
function mockClient({ hasAnyRun = false } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/AS has_any_run/.test(sql)) return { rows: [{ has_any_run: hasAnyRun }] };
      if (/INSERT INTO work_routing_receipts/.test(sql)) {
        return {
          rows: [{
            ...receipt,
            id: NEXT_RECEIPT_ID,
            work_kind: params[3],
            change_kind: params[4],
            repo: params[9],
            map_scope: JSON.parse(params[10]),
            evidence: JSON.parse(params[15]),
            supersedes_receipt_id: params[18],
            anchor_generation: params[19],
          }],
        };
      }
      if (/UPDATE tasks/.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO cecelia_events/.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO task_events/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  return { client, calls };
}

// 只替身「非被改模块」：地图读取服务 + 合同持久化。reanchorReceipt 不注入，
// 让 map-impact-contract 走默认实现，即真的 base-sha-reanchor。
function deps() {
  return {
    resolveScopeKey: vi.fn(async () => 'cecelia'),
    lockMapProjectionAuthority: vi.fn(async () => authority),
    readMap: vi.fn(async () => freshMap),
    readRadius: vi.fn(async () => radius),
    persistContract: vi.fn(async (_c, input) => ({
      contract: { id: 'impact-1', status: 'active' }, input,
    })),
  };
}

const writeCalls = (calls) => calls.filter((c) => /INSERT INTO|UPDATE tasks/.test(c.sql));

describe('F1 step2 — 派发预检的 base_sha 重锚定（真模块串真模块）', () => {
  it('被改模块都是真零件，没有替身', () => {
    expect(typeof ensureMapImpactPreflight).toBe('function');
    expect(typeof reanchorReceiptIfEmptyBranch).toBe('function');
  });

  it('旧锚 + 地图前进 + 分支无产出 → 插接班收据、同步 tasks、双留痕，合同签在新锚上', async () => {
    const { client, calls } = mockClient({ hasAnyRun: false });
    const d = deps();
    const result = await ensureMapImpactPreflight(client, {
      task: { id: TASK_ID, payload: {}, metadata: {} },
      receipt,
      createdSource: 'kernel_dispatch',
    }, d);

    // 写库顺序：先 INSERT 收据（421 触发器按最新收据比对），后 UPDATE tasks，再两条留痕
    expect(writeCalls(calls).map((c) => c.sql.match(/INSERT INTO \w+|UPDATE tasks/)[0])).toEqual([
      'INSERT INTO work_routing_receipts',
      'UPDATE tasks',
      'INSERT INTO cecelia_events',
      'INSERT INTO task_events',
    ]);

    // 产出探测用的是 DB 事实（kernel-v1 候选不 push，git 看不到）
    expect(calls.some((c) => /AS has_any_run/.test(c.sql) && c.params[0] === TASK_ID)).toBe(true);

    const insert = calls.find((c) => /INSERT INTO work_routing_receipts/.test(c.sql));
    expect(insert.params[0]).toBe(TASK_ID);
    expect(insert.params[18]).toBe(RECEIPT_ID); // supersedes_receipt_id
    expect(insert.params[19]).toBe(2); // anchor_generation
    expect(JSON.parse(insert.params[15])).toMatchObject({
      base_sha: NEW, prev_base_sha: OLD, branch: 'cp-route-api-1',
      reanchor_reason: 'map_revision_advanced',
    });

    // 接班收据（INSERT 的 RETURNING 行）被预检原样接住：只换锚，不换路由身份
    expect(result.receipt).toMatchObject({
      id: NEXT_RECEIPT_ID,
      repo: 'cecelia',
      map_scope: ['F1'],
      change_kind: 'bugfix',
      work_kind: 'coding_mutation',
      anchor_generation: 2,
      supersedes_receipt_id: RECEIPT_ID,
      base_sha: NEW,
    });
    expect(result.receipt.evidence).toMatchObject({ base_sha: NEW, prev_base_sha: OLD });

    // tasks 的 payload/metadata 同步：新收据 id + 新锚 + 快进计数
    const update = calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(JSON.parse(update.params[1])).toMatchObject({
      routing_receipt_id: NEXT_RECEIPT_ID, base_sha: NEW,
    });
    expect(JSON.parse(update.params[2])).toMatchObject({ base_sha_fastforward_count: 1 });

    // 合同即法律：签发的合同锚在新 revision 上
    expect(d.persistContract).toHaveBeenCalledOnce();
    expect(d.persistContract.mock.calls[0][1]).toMatchObject({ base_revision: NEW });
    expect(d.persistContract.mock.calls[0][1].contract_body.freshness_evidence.mapper_revision)
      .toBe(NEW);
  });

  it('分支已有产出（initiative_runs 有行）→ needs_rebase 上抛，且一个字都不写库', async () => {
    const { client, calls } = mockClient({ hasAnyRun: true });
    const d = deps();
    await expect(ensureMapImpactPreflight(client, {
      task: { id: TASK_ID, payload: {}, metadata: {} },
      receipt,
      createdSource: 'kernel_dispatch',
    }, d)).rejects.toMatchObject({
      code: 'needs_rebase',
      detail: { task_id: TASK_ID, old_base_sha: OLD, new_base_sha: NEW },
    });
    expect(writeCalls(calls)).toHaveLength(0);
    expect(d.persistContract).not.toHaveBeenCalled();
  });
});
