/**
 * 熟化即 workflow（决策 2186700a / 26df670a，任务 c0fe7e30）：工厂执行单改走 Brain → Commander → 外壳 → Codex。
 *
 * - 调度单带 --run-id / --task-id，外壳 runner 按 run_id 落盘 ~/wf-agent-runs/<run_id>/delivery.json（系统产出）；
 * - 收割顺带读 delivery.json → result.delivery，陪跑 skill 版本记进 result 与 task_runs；
 * - 自动裁判按合同 readback 检查每个活动的证据（Commander 不判）；
 * - 推进器经 brain_config 开关 factory_commander_route_enabled 改建 workflow_dispatch（默认关，行为不变）；
 * - factory-dispatcher 不领 workflow_dispatch，核验单仍归它。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveCommanderOrder,
  buildCommanderMessage,
  orderWithRun,
  parseDeliveryBlock,
  dispatchWorkflowCommanderTasks,
  reapWorkflowCommanderRuns,
} from '../workflow-commander-dispatch.js';
import { computeCodeVerdict, judgeTask, globToRegExp } from '../factory-judge.js';
import { buildExecSpec } from '../factory-pusher.js';
import { isFactoryCommanderRouteEnabled, runFactoryPusher } from '../factory-cycle.js';
import { resolveWorkflowConfig } from '../factory-workflow-config.js';
import { isFactoryTask } from '../../../scripts/factory-dispatcher/factory-dispatcher.js';

const cfg = resolveWorkflowConfig('douyin_video_publish.android');
const TASK_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const RUN_ID = 'wfd-aaaaaaaa-1760000000000';
const LEDGER_ID = '1b5a0be0-f0b2-4960-af44-f09790a039c1';
const IN_HOURS = () => new Date('2026-10-12T02:00:00Z');

function fakePool(handlers = []) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      for (const [re, fn] of handlers) if (re.test(String(sql))) return fn(params);
      return { rows: [], rowCount: 0 };
    }),
  };
}
const wfTask = (over = {}) => ({
  id: TASK_ID, task_type: 'workflow_dispatch', status: 'queued', title: 't', description: 'd', priority: 'P1',
  payload: { workflow_key: 'douyin_video_publish.android' }, ...over,
});
/** finalizeTask 写 tasks 终态那一句（params 里带 commander_result） */
const finalCall = (pool) => pool.calls.find((c) => /UPDATE tasks/.test(c.sql) && JSON.stringify(c.params || []).includes('commander_result'));

const ACTIVITIES = [
  { key: 'preflight', by: 'shell', readback: { type: 'evidence', glob: '*preflight*original.json', expect: { op: '>=', value: 1 } }, evidence_files: [`${RUN_ID}-preflight-original.json`] },
  { key: 'publish', by: 'agent', readback: { type: 'evidence', glob: '*publish*original.json', expect: { op: '>=', value: 1 } }, evidence_files: [`${RUN_ID}-publish-original.json`] },
  { key: 'cleanup', by: 'shell', readback: { type: 'evidence', glob: '*cleanup*original.json', expect: { op: '>=', value: 1 } }, evidence_files: [`${RUN_ID}-cleanup-original.json`] },
];
const delivery = (over = {}) => ({
  run_id: RUN_ID, tag: 'cmd10121000', workflow_key: 'douyin_video_publish.android', contract_key: 'douyin_video_publish',
  claimed_result: 'success', lock_released: true, fail_reason: null,
  side_effects: [{ action: 'publish', reversible: false }],
  readback: { publish_attempts: 1, lock_status: 'free' },
  final_evidence: [`${RUN_ID}-outward-ledger`, `${RUN_ID}-lock-acquire`, `${RUN_ID}-lock-release`],
  activities: ACTIVITIES, commander_skill: { name: 'wf-douyin_video_publish', version: '0.1.0' }, ...over,
});

describe('调度单带 run_id / task_id', () => {
  it('orderWithRun：<五项> --run-id <run> --task-id <task> [commander_args]', () => {
    const r = resolveCommanderOrder(wfTask({ payload: { workflow_key: 'douyin_video_publish.android', commander_args: ['--dry-run'] } }), { resolveConfig: resolveWorkflowConfig });
    expect(orderWithRun(r, RUN_ID, TASK_ID)).toBe(`douyin_video_publish xian-m4 xiaolongxia ANGYVB4311010223 Ai办公室 --run-id ${RUN_ID} --task-id ${TASK_ID} --dry-run`);
  });
  it('消息里的调度单带 run/task，并要求 COMMANDER_RESULT 写陪跑 skill（commander_skill）', () => {
    const r = resolveCommanderOrder(wfTask(), { resolveConfig: resolveWorkflowConfig });
    const m = buildCommanderMessage(wfTask(), r, RUN_ID);
    expect(m).toContain(`调度单：douyin_video_publish xian-m4 xiaolongxia ANGYVB4311010223 Ai办公室 --run-id ${RUN_ID} --task-id ${TASK_ID}`);
    expect(m).toContain('"commander_skill"');
    expect(m).toMatch(/第〇节/);
  });
  it('派发时 payload.commander_order 记带 run/task 的完整调度单', async () => {
    const t = wfTask();
    const pool = fakePool([
      [/FROM tasks[\s\S]*status = 'queued'/, () => ({ rows: [t] })],
      [/UPDATE tasks SET claimed_by = \$2/, () => ({ rows: [t], rowCount: 1 })],
    ]);
    let input = '';
    await dispatchWorkflowCommanderTasks(pool, {
      resolveConfig: resolveWorkflowConfig, now: IN_HOURS, lockGate: async () => ({ pass: true }), target: 'mmv',
      sshDispatch: async (_a, i) => { input = i; return 'DISPATCHED'; },
    });
    const pay = pool.calls.find((c) => /jsonb_build_object\('run_id'/.test(c.sql));
    expect(pay.params[2]).toBe(`douyin_video_publish xian-m4 xiaolongxia ANGYVB4311010223 Ai办公室 --run-id ${pay.params[1]} --task-id ${TASK_ID}`);
    expect(input).toContain(`--run-id ${pay.params[1]}`);
  });
});

describe('收割读外壳 delivery.json', () => {
  const block = (obj) => `===WFD_DELIVERY_BEGIN===\n${JSON.stringify(obj)}\n===WFD_DELIVERY_END===\n`;
  it('parseDeliveryBlock：抽出分隔块并从日志尾剥掉；run_id 不符 / JSON 坏 → null', () => {
    const text = `${block(delivery())}{"finalAssistantVisibleText":"x"}`;
    const p = parseDeliveryBlock(text, RUN_ID);
    expect(p.delivery.run_id).toBe(RUN_ID);
    expect(p.rest).not.toContain('WFD_DELIVERY');
    expect(p.rest).toContain('finalAssistantVisibleText');
    expect(parseDeliveryBlock(text, 'wfd-other-1').delivery).toBeNull();
    expect(parseDeliveryBlock('no block', RUN_ID).delivery).toBeNull();
    expect(parseDeliveryBlock('===WFD_DELIVERY_BEGIN===\n{bad\n===WFD_DELIVERY_END===\n', RUN_ID).delivery).toBeNull();
  });
  const row = { id: TASK_ID, run_id: RUN_ID, payload: { factory_dispatch: true, factory_ledger_id: LEDGER_ID } };
  const inflight = [/FROM tasks[\s\S]*status = 'in_progress'/, () => ({ rows: [row] })];
  const commanderLine = 'COMMANDER_RESULT {\\"status\\":\\"completed\\",\\"tag\\":\\"cmd10121000\\",\\"evidence\\":[\\"e1\\"],\\"commander_skill\\":{\\"name\\":\\"wf-douyin_video_publish\\",\\"version\\":\\"0.1.0\\"}}';
  const deps = (probe) => ({ releaseLock: async () => 1, target: 'mmv', sshProbe: probe });

  it('探测命令同一次 ssh 顺带 cat delivery.json（带分隔标记）', async () => {
    const pool = fakePool([inflight]);
    let cmd = '';
    await reapWorkflowCommanderRuns(pool, deps(async (args) => { cmd = args[args.length - 1]; return 'NO_EXIT'; }));
    expect(cmd).toContain(`~/wf-agent-runs/${RUN_ID}/delivery.json`);
    expect(cmd).toContain('WFD_DELIVERY_BEGIN');
  });
  it('有 delivery → result.delivery 合并、commander_skill 记进 result 与 task_runs', async () => {
    const pool = fakePool([inflight]);
    const out = await reapWorkflowCommanderRuns(pool, deps(async () => `EXIT=0\n${block(delivery())}{"finalAssistantVisibleText":"${commanderLine}"}`));
    expect(out.completed).toBe(1);
    const s = JSON.stringify(finalCall(pool).params);
    expect(s).toContain('\\"delivery\\"');
    expect(s).toContain(`${RUN_ID}-publish-original.json`);
    expect(s).toContain('wf-douyin_video_publish');
    const run = pool.calls.find((c) => /UPDATE task_runs/.test(c.sql));
    expect(JSON.stringify(run.params)).toContain('wf-douyin_video_publish');
  });
  it('commander_skill 缺省时取 delivery 的；都没有记 null；非工厂单无 delivery 文件照旧', async () => {
    const pool = fakePool([inflight]);
    await reapWorkflowCommanderRuns(pool, deps(async () => `EXIT=0\n${block(delivery())}{"finalAssistantVisibleText":"COMMANDER_RESULT {\\"status\\":\\"completed\\"}"}`));
    expect(JSON.stringify(finalCall(pool).params)).toMatch(/commander_skill\\":\{\\"name\\":\\"wf-douyin_video_publish/);
    const pool2 = fakePool([[/FROM tasks[\s\S]*status = 'in_progress'/, () => ({ rows: [{ ...row, payload: {} }] })]]);
    await reapWorkflowCommanderRuns(pool2, deps(async () => 'EXIT=0\n{"finalAssistantVisibleText":"COMMANDER_RESULT {\\"status\\":\\"completed\\"}"}'));
    const s2 = JSON.stringify(finalCall(pool2).params);
    expect(s2).toContain('commander_skill\\":null');
    expect(s2).not.toContain('\\"delivery\\"');
  });
  it('工厂单没有 delivery.json（例如起跑前就失败）→ 收割补一份标明来源的失败交付，裁判能计、推进器不空转', async () => {
    const pool = fakePool([inflight]);
    await reapWorkflowCommanderRuns(pool, deps(async () => 'EXIT=0\n{"finalAssistantVisibleText":"COMMANDER_RESULT {\\"status\\":\\"failed\\",\\"launch_exit\\":4}"}'));
    const s = JSON.stringify(finalCall(pool).params);
    expect(s).toContain('reaper_synthesized');
    expect(s).toContain('claimed_result\\":\\"failed');
    expect(s).toContain(`run_id\\":\\"${RUN_ID}`);
  });
});

describe('裁判按合同 readback 检查活动证据', () => {
  it('globToRegExp：* / ? 整串匹配，其他字符按字面', () => {
    expect(globToRegExp('*preflight*original.json').test('wfd-a-1-preflight-original.json')).toBe(true);
    expect(globToRegExp('*preflight*original.json').test('wfd-a-1-preflight-original.json.bak')).toBe(false);
    expect(globToRegExp('a?c.json').test('abc.json')).toBe(true);
    expect(globToRegExp('a.c').test('abc')).toBe(false);
  });
  it('每个活动证据满足 expect → pass，且每个活动一条 readback:<key> check', () => {
    const v = computeCodeVerdict({ taskStatus: 'completed', delivery: delivery(), expectedOutward: 1, requireEvidence: true, requireActivities: true });
    expect(v.verdict).toBe('pass');
    expect(v.checks.filter((c) => c.name.startsWith('readback:')).map((c) => c.name)).toEqual(['readback:preflight', 'readback:publish', 'readback:cleanup']);
  });
  it('某活动证据名不匹配 → 该活动 check 失败、整体 fail', () => {
    const acts = ACTIVITIES.map((a) => (a.key === 'publish' ? { ...a, evidence_files: [`${RUN_ID}-publish-shot.jpg`] } : a));
    const v = computeCodeVerdict({ taskStatus: 'completed', delivery: delivery({ activities: acts }), requireActivities: true });
    expect(v.verdict).toBe('fail');
    expect(v.checks.find((c) => c.name === 'readback:publish').pass).toBe(false);
  });
  it('expect 支持 == / = / >', () => {
    const one = (op, value) => [{ key: 'x', readback: { type: 'evidence', glob: '*.json', expect: { op, value } }, evidence_files: ['a.json'] }];
    const chk = (acts) => computeCodeVerdict({ taskStatus: 'completed', delivery: delivery({ activities: acts }) }).checks.find((c) => c.name === 'readback:x').pass;
    expect(chk(one('==', 2))).toBe(false);
    expect(chk(one('=', 1))).toBe(true);
    expect(chk(one('>', 0))).toBe(true);
  });
  it('requireActivities 而交付没有 activities → contract_readback 失败；不要求时旧交付不受影响', () => {
    const d = delivery({ activities: undefined });
    expect(computeCodeVerdict({ taskStatus: 'completed', delivery: d, requireActivities: true }).checks.find((c) => c.name === 'contract_readback').pass).toBe(false);
    expect(computeCodeVerdict({ taskStatus: 'completed', delivery: d }).checks.some((c) => c.name === 'contract_readback')).toBe(false);
  });
  it('judgeTask：workflow_dispatch 执行单 + dispatch_via=commander → 要求活动读回', async () => {
    const writes = [];
    const store = {
      findLedger: vi.fn(async () => ({ id: LEDGER_ID, stage: 3, workflow_key: 'douyin_video_publish.android' })),
      getTask: vi.fn(), writeJudge: vi.fn(async (id, j) => writes.push(j)),
    };
    const t = {
      id: TASK_ID, task_type: 'workflow_dispatch', status: 'completed', title: 'x',
      payload: { factory_dispatch: true, factory_ledger_id: LEDGER_ID, workflow_key: 'douyin_video_publish.android', factory: { stage: '3', workflow_key: 'douyin_video_publish.android', device: cfg.device } },
      result: { delivery: delivery({ activities: undefined }) },
    };
    const out = await judgeTask(t, { store, resolveConfig: resolveWorkflowConfig, log: () => {}, createTask: vi.fn(), recordRun: vi.fn(async () => ({})) });
    expect(out.verdict).toBe('fail');
    expect(writes[0].code.checks.find((c) => c.name === 'contract_readback').pass).toBe(false);
  });
});

describe('推进器经开关改建 workflow_dispatch', () => {
  const L = {
    id: LEDGER_ID, workflow_key: 'douyin_video_publish.android', workflow_name: '抖音 · 视频发布（安卓真机）',
    stage: 3, validation_mode: 'use_while_validate', window_k: 3, recent_runs: [], recent_pass: 0, recent_total: 0,
    candidate_version: 'android-douyin-private-video@1.0.8', production_version: null, blocked_kind: 'none',
    next_action: null, stage_changed_at: '2026-10-11T09:00:00Z',
  };
  it('配置登记 dispatch_via=commander；Commander 调度单时限 55 分钟', () => {
    expect(cfg.dispatch_via).toBe('commander');
    expect(cfg.commander.timeout_min).toBe(55);
  });
  it('开关关（默认）→ 仍建 skill_factory_run，正文锁纪律仍是派发器代领（旧路径不变）', () => {
    const spec = buildExecSpec({ ledger: L, cfg, stage: 3, skill: 'android-douyin-private-video@1.0.8', round: 1 });
    expect(spec.task_type).toBe('skill_factory_run');
    expect(spec.description).toContain('派发器代领');
    expect(spec.payload.workflow_key).toBeUndefined();
  });
  it('开关开 → workflow_dispatch，payload 带 workflow_key 与工厂字段；锁纪律换成外壳代领；factory-dispatcher 不领它', () => {
    const spec = buildExecSpec({ ledger: L, cfg, stage: 3, skill: 'android-douyin-private-video@1.0.8', round: 2, commanderRoute: true });
    expect(spec.task_type).toBe('workflow_dispatch');
    expect(spec.payload).toMatchObject({ workflow_key: 'douyin_video_publish.android', factory_dispatch: true, factory_ledger_id: L.id, factory: { stage: '3', round: 2 } });
    expect(spec.description).toContain('外壳');
    expect(spec.description).not.toContain('派发器代领');
    expect(spec.description).toContain('wf-agent-runs');
    expect(spec.description).toMatch(/run_id 由 workflow-commander-dispatch 生成/);
    expect(isFactoryTask({ ...spec, status: 'queued' })).toBe(false);
  });
  it('没登记 commander 的 workflow 开关开也照旧', () => {
    const plain = { ...cfg, dispatch_via: undefined, commander: undefined };
    expect(buildExecSpec({ ledger: L, cfg: plain, stage: 3, skill: 's', round: 1, commanderRoute: true }).task_type).toBe('skill_factory_run');
  });
  it('isFactoryCommanderRouteEnabled：默认关，brain_config true 才开，读不到按关', async () => {
    const db = (v) => ({ query: vi.fn(async () => ({ rows: v === undefined ? [] : [{ value: v }] })) });
    expect(await isFactoryCommanderRouteEnabled(db())).toBe(false);
    expect(await isFactoryCommanderRouteEnabled(db('false'))).toBe(false);
    expect(await isFactoryCommanderRouteEnabled(db('true'))).toBe(true);
    expect(await isFactoryCommanderRouteEnabled(db('"true"'))).toBe(true);
    expect(await isFactoryCommanderRouteEnabled({ query: async () => { throw new Error('x'); } })).toBe(false);
  });
  it('runFactoryPusher 把 commanderRoute 传给建单', async () => {
    const createTask = vi.fn(async () => ({ task: { id: 'cccccccc-1111-4222-8333-444444444444' } }));
    const store = {
      listLedgers: vi.fn(async () => [L]), inFlight: vi.fn(async () => null), countRounds: vi.fn(async () => 0),
      consecutiveFails: vi.fn(async () => 0), tickets: vi.fn(async () => ({ done: 0, total: 0 })),
    };
    const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
    await runFactoryPusher(fakeDb, { store, createTask, resolveConfig: resolveWorkflowConfig, now: () => new Date('2026-10-11T06:00:00Z'), commanderRoute: true });
    expect(createTask.mock.calls[0][0].task_type).toBe('workflow_dispatch');
  });
});
