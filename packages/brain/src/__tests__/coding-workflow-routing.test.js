/**
 * 编码单改投 coding_workflow runner（车道 A2，任务 eb9094ee）— 失败复现
 *
 * 背景：A1 关掉了无头 harness_initiative 的 kernel 派发（dispatcher drain 标 failed=retired_harness_kernel），
 * 但 work-router 仍把所有 coding_mutation 落成 harness_initiative，relay-baton 编码子单、GP 签字实现单
 * 建出来就被 drain 掉，无头编码事实上无人执行。本组断言：
 *  1. 无头编码单 canonical=coding_workflow，形状能被 runner plan.mjs pickCandidates 选中；
 *  2. 有头账本行（headed_manual / 非 queued|blocked / executor_kind=headed-session）仍是 harness_initiative；
 *  3. runner 不支持的仓库：无头建单抛 runner_repo_unsupported，有头照建；
 *  4. 仓库支持判定只有一个源（scripts/coding-workflow/repos.json，经 runner/lib/repos.mjs 读），Brain 与 runner 同读，Brain 镜像带上它。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { routeWork, runnerRepoOf, selectPipeline } from '../work-router.js';
import { createRoutedTask } from '../work-routing-store.js';
import { materializeNextSteps } from '../lib/relay-baton.js';
import { pickCandidates } from '../../scripts/coding-workflow/runner/lib/plan.mjs';

const brainRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = 'a'.repeat(40);
const ROOT = '11111111-1111-4111-8111-111111111111';
const FACTS = [
  { repo: 'cecelia', scope_key: 'cecelia', aliases: ['perfectuser21/cecelia'] },
  { repo: 'zenithjoy-workspace', scope_key: 'zenithjoy', aliases: ['perfectuser21/zenithjoy-workspace'] },
];

function codingRequest(overrides = {}) {
  return {
    source: 'api',
    source_id: 'req-default',
    title: '修一个 bug',
    mutation_intent: 'write',
    declared_change_kind: 'bugfix',
    repo_hint: 'cecelia',
    map_scope_hint: ['F1'],
    branch: 'cp-10120000-fix',
    base_sha: SHA,
    decided_at: '2026-10-12T00:00:00.000Z',
    ...overrides,
  };
}

/** createRoutedTask 用的最小假库：只认建单链路上的几条 SQL。 */
function fakeDb() {
  const tasks = [];
  const receipts = [];
  return {
    tasks,
    receipts,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return { rows: [] };
      if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };
      if (/FROM work_routing_receipts r/.test(s)) return { rows: [] };
      if (/SELECT id FROM tasks WHERE id = \$1::uuid/.test(s)) return { rows: [{ id: params[0] }] };
      if (/COALESCE\(MAX\(sequence_no\), 0\) \+ 1/.test(s)) return { rows: [{ n: 1 }] };
      if (/WITH authoritative_scope AS/.test(s)) return { rows: (params[1] ?? []).map((k) => ({ node_key: k })) };
      if (/INSERT INTO tasks/.test(s)) {
        const row = {
          id: `task-${tasks.length + 1}`,
          title: params[0],
          task_type: params[3],
          status: params[4],
          payload: JSON.parse(params[9]),
          claimed_by: null,
          executor_kind: params[23],
          created_at: '2026-10-12T00:00:00.000Z',
        };
        tasks.push(row);
        return { rows: [{ ...row }] };
      }
      if (/INSERT INTO work_routing_receipts/.test(s)) {
        receipts.push({ task_id: params[0], pipeline: params[5], canonical_task_type: params[6], orchestrator: params[12] });
        return { rows: [{ id: `receipt-${receipts.length}` }] };
      }
      if (/UPDATE tasks SET payload = payload/.test(s)) {
        const task = tasks.find((t) => t.id === params[0]);
        task.payload = { ...task.payload, ...JSON.parse(params[1]) };
        return { rows: [] };
      }
      if (/INSERT INTO cecelia_events/.test(s)) return { rows: [] };
      throw new Error(`unexpected SQL: ${s}`);
    },
  };
}

describe('selectPipeline：无头编码改投 coding_workflow', () => {
  it('无头 coding_mutation → canonical=coding_workflow，orchestrator=coding-workflow-runner，不进 kernel', () => {
    for (const change_kind of ['new_capability', 'capability_change', 'bugfix', 'parameter_only']) {
      expect(selectPipeline({ work_kind: 'coding_mutation', change_kind })).toMatchObject({
        pipeline: 'coding_workflow',
        canonical_task_type: 'coding_workflow',
        orchestrator: 'coding-workflow-runner',
        impact_contract_required: false,
        change_kind,
      });
    }
  });

  it('有头账本行 → 仍是 harness_initiative（有头 /dev 记账不受影响）', () => {
    expect(selectPipeline({ work_kind: 'coding_mutation', change_kind: 'bugfix', headed: true })).toMatchObject({
      pipeline: 'harness',
      canonical_task_type: 'harness_initiative',
    });
  });
});

describe('routeWork：有头判定与 runner 仓库判定', () => {
  it('无头 + cecelia（含 GitHub 别名）→ coding_workflow', () => {
    expect(routeWork(codingRequest(), FACTS)).toMatchObject({ canonical_task_type: 'coding_workflow', repo: 'cecelia' });
    expect(routeWork(codingRequest({ repo_hint: 'https://github.com/perfectuser21/cecelia.git' }), FACTS))
      .toMatchObject({ canonical_task_type: 'coding_workflow' });
    expect(routeWork(codingRequest({ task: { status: 'blocked' } }), FACTS))
      .toMatchObject({ canonical_task_type: 'coding_workflow' });
  });

  it('headed_manual 字符串/布尔、非 queued|blocked、executor_kind=headed-session → harness_initiative', () => {
    expect(routeWork(codingRequest({ metadata: { headed_manual: 'true' } }), FACTS))
      .toMatchObject({ canonical_task_type: 'harness_initiative' });
    expect(routeWork(codingRequest({ task: { payload: { headed_manual: true } } }), FACTS))
      .toMatchObject({ canonical_task_type: 'harness_initiative' });
    expect(routeWork(codingRequest({ task: { status: 'in_progress' } }), FACTS))
      .toMatchObject({ canonical_task_type: 'harness_initiative' });
    expect(routeWork(codingRequest({ task: { executor_kind: 'headed-session' } }), FACTS))
      .toMatchObject({ canonical_task_type: 'harness_initiative' });
  });

  it('kernel 续跑单（planner recovery 后继，kernel_continuation）仍是 harness_initiative，不受 runner 仓库限制', () => {
    expect(routeWork(codingRequest({ kernel_continuation: true }), FACTS))
      .toMatchObject({ canonical_task_type: 'harness_initiative', pipeline: 'harness' });
    expect(routeWork(codingRequest({ kernel_continuation: true, repo_hint: 'zenithjoy-workspace' }), FACTS))
      .toMatchObject({ canonical_task_type: 'harness_initiative' });
  });

  it('runner 不支持的仓库：无头抛 runner_repo_unsupported（带 code），有头照建 harness_initiative', () => {
    const headless = codingRequest({ repo_hint: 'zenithjoy-workspace' });
    let caught = null;
    try { routeWork(headless, FACTS); } catch (error) { caught = error; }
    expect(caught?.message).toBe('runner_repo_unsupported');
    expect(caught?.code).toBe('runner_repo_unsupported');
    expect(routeWork({ ...headless, metadata: { headed_manual: 'true' } }, FACTS))
      .toMatchObject({ canonical_task_type: 'harness_initiative', repo: 'zenithjoy-workspace' });
  });
});

describe('createRoutedTask：建出的编码单能被 runner 认领', () => {
  it('无头编码单 → task_type=coding_workflow + payload.coding_workflow=true，pickCandidates 选中', async () => {
    const db = fakeDb();
    const routed = await createRoutedTask(db, {
      ...codingRequest({ source_id: 'pick-1' }),
      requested_task_type: 'dev',
      metadata: { orchestrator: 'skill-relay', harness_runtime: 'kernel-v1' },
      task: { status: 'queued' },
    }, FACTS);
    expect(routed.task.task_type).toBe('coding_workflow');
    expect(routed.task.payload).toMatchObject({ coding_workflow: true, repo: 'cecelia', orchestrator: 'coding-workflow-runner' });
    expect(routed.task.payload.harness_runtime).toBeUndefined();
    expect(db.receipts[0]).toMatchObject({ pipeline: 'coding_workflow', canonical_task_type: 'coding_workflow' });
    expect(pickCandidates(db.tasks).map((t) => t.id)).toEqual([routed.task.id]);
  });

  it('有头账本行 → harness_initiative + kernel 投影字段不变，runner 不认领', async () => {
    const db = fakeDb();
    await createRoutedTask(db, {
      ...codingRequest({ source_id: 'headed-1' }),
      requested_task_type: 'dev',
      metadata: { headed_manual: 'true' },
      task: { status: 'queued' },
    }, FACTS);
    expect(db.tasks[0]).toMatchObject({ task_type: 'harness_initiative' });
    expect(db.tasks[0].payload).toMatchObject({ orchestrator: 'skill-relay', harness_runtime: 'kernel-v1' });
    expect(db.tasks[0].payload.coding_workflow).toBeUndefined();
    expect(pickCandidates(db.tasks)).toEqual([]);
  });
});

describe('A4：harness_initiative 只当有头账本类型——建单入口拒无头', () => {
  it('kernel 续跑单（无头 queued harness_initiative）经 createRoutedTask 建单即拒 no_executor_for_task_type，不落行', async () => {
    const db = fakeDb();
    let caught = null;
    try {
      await createRoutedTask(db, {
        ...codingRequest({ source_id: 'kc-1', kernel_continuation: true }),
        requested_task_type: 'dev',
        task: { status: 'queued' },
      }, FACTS);
    } catch (error) { caught = error; }
    expect(caught?.code).toBe('no_executor_for_task_type');
    expect(caught?.route).toBe('retired-harness-kernel');
    expect(db.tasks).toEqual([]);
  });

  it('有头账本行（headed_manual 字符串 / 布尔、以 in_progress 入账）照常建 harness_initiative', async () => {
    for (const [i, extra] of [
      { metadata: { headed_manual: 'true' }, task: { status: 'queued' } },
      { task: { status: 'queued', payload: { headed_manual: true } } },
      { task: { status: 'in_progress' } },
    ].entries()) {
      const db = fakeDb();
      await createRoutedTask(db, { ...codingRequest({ source_id: `headed-a4-${i}` }), requested_task_type: 'dev', ...extra }, FACTS);
      expect(db.tasks[0]).toMatchObject({ task_type: 'harness_initiative' });
    }
  });
});

describe('relay-baton：handoff 编码子单改投 coding_workflow', () => {
  it('dispatch_headless 编码步 → 子单 coding_workflow 且 runner 可认领；非支持仓库进 skipped', async () => {
    const db = fakeDb();
    const create = (_pool, req) => createRoutedTask(db, req, FACTS);
    const parent = { id: '33333333-3333-4333-8333-333333333333', title: '上一棒', priority: 'P1', parent_task_id: ROOT, payload: { repo: 'cecelia', map_scope: ['F1'] } };
    const out = await materializeNextSteps({ query: async () => ({ rows: [] }) }, parent, {
      next_steps: [{ kind: 'dispatch_headless', title: '改代码', change_kind: 'bugfix' }],
    }, { createRoutedTask: create });
    expect(out.skipped).toEqual([]);
    expect(db.tasks[0]).toMatchObject({ task_type: 'coding_workflow' });
    expect(db.tasks[0].payload).toMatchObject({ coding_workflow: true, requested_task_type: 'coding_workflow' });
    expect(pickCandidates(db.tasks)).toHaveLength(1);

    const zj = { ...parent, id: '44444444-4444-4444-8444-444444444444', payload: { repo: 'zenithjoy-workspace', map_scope: ['F1'] } };
    const out2 = await materializeNextSteps({ query: async () => ({ rows: [] }) }, zj, {
      next_steps: [{ kind: 'dispatch_headless', title: '改 zj 代码', change_kind: 'bugfix' }],
    }, { createRoutedTask: create });
    expect(out2.skipped[0]).toMatchObject({ kind: 'dispatch_headless', error: 'runner_repo_unsupported' });
  });
});

describe('仓库支持判定单一来源', () => {
  it('repos.json 是唯一来源：已启用的 cecelia 及其别名支持，登记但未启用的 zenithjoy 不支持', async () => {
    const { enabledRepos } = await import('../../scripts/coding-workflow/runner/lib/repos.mjs');
    expect(enabledRepos({}).map((r) => r.key)).toEqual(['cecelia']);
    expect(runnerRepoOf('cecelia')).toBe('cecelia');
    expect(runnerRepoOf('perfectuser21/cecelia')).toBe('cecelia');
    expect(runnerRepoOf('https://github.com/perfectuser21/cecelia.git')).toBe('cecelia');
    expect(runnerRepoOf('zenithjoy-workspace')).toBeNull();
    expect(runnerRepoOf(null)).toBeNull();
  });

  it('work-router 与 runner plan.mjs 都经 runner/lib/repos.mjs 读 repos.json，不各写一份', () => {
    const router = readFileSync(join(brainRoot, 'src/work-router.js'), 'utf8');
    const plan = readFileSync(join(brainRoot, 'scripts/coding-workflow/runner/lib/plan.mjs'), 'utf8');
    expect(router).toContain("from '../scripts/coding-workflow/runner/lib/repos.mjs'");
    expect(plan).toContain("from './repos.mjs'");
    expect(router).not.toMatch(/new Set\(\['cecelia'/);
  });

  it('Brain 镜像带上 repos.json 与读表模块（work-router 运行时依赖），构建期验证导入', () => {
    const dockerfile = readFileSync(join(brainRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/^COPY\s+packages\/brain\/scripts\/coding-workflow\/repos\.json\s+\.\/scripts\/coding-workflow\/\s*$/m);
    expect(dockerfile).toMatch(/^COPY\s+packages\/brain\/scripts\/coding-workflow\/runner\/lib\/repos\.mjs\s+\.\/scripts\/coding-workflow\/runner\/lib\/\s*$/m);
    expect(dockerfile).toContain("await import('./src/work-router.js')");
  });
});
