/**
 * 秋米路由决策表（PR3 Task 3）。
 *
 * 全局铁律：
 *  - 便宜闸永远在 Jev 前（命中序列号直接定案，一次网络都不发）
 *  - is_device 不确定不派（fail-closed）：noul 落在 (0.2, 0.8) 或无法解析 → failed，绝不掉进 agent 通道
 *  - 账号只认注册表池内序列号（jev-client 归一化 + pickSerial 二次守池，双保险）
 *
 * Jev 真实响应形状（2026-09-23 实测 TypeSafe /v1/systemone）：
 *  - noul 型（仅 is_device）：{"type":"noul","noul":0.95}，无 confidence
 *  - choice 型：{"type":"choice","choice":"x","confidence":0.05,"probabilities":{...}}
 *    confidence 是边际（top1-top2），不是被选中项的概率 → 采纳规则见「补充二」
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/task-event-log.js', () => ({ recordTaskEventSafe: vi.fn().mockResolvedValue(true) }));
vi.mock('../routing/cheap-gates.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadRegistryPool: vi.fn(),
}));

import { recordTaskEventSafe } from '../lib/task-event-log.js';
import { loadRegistryPool } from '../routing/cheap-gates.js';
import { routeQiumiTask, persistDecision, pickSerial, NOUL_THRESHOLDS } from '../routing/qiumi-router.js';
import { qiumiEnv } from '../routing/env.js';

const env = qiumiEnv({ JEV_API_KEY: 'k' });
const TASK_ID = '11111111-2222-3333-4444-555555555555';

// 注册表三源真身（补充三）：agents 无 serial，手机在 phones，workflows 无 channel
const registry = {
  agents: [
    { name: 'dev', notionId: 'ag-dev' },
    { name: '小白', notionId: 'ag-xiaobai' },
    // 非部门 agent，名字里裹着序列号——registry 没有 agent→serial 映射列，只能子串反查
    { name: 'phone-ANGYVB4227006983', notionId: 'ag-phone1' },
  ],
  phones: [{ serial: 'ANGYVB4227006983', host: 'xian-m4' }, { serial: 'e6c7ef34', host: 'xian-m1' }],
  workflows: [{ name: '朋友圈跟圈', notionId: 'w1' }, { name: '周报生成', notionId: 'w2' }],
};

const choice = (c, prob, margin = 0.9) => ({ type: 'choice', choice: c, confidence: margin, probabilities: { [c]: prob } });
const jevAnswers = (o = {}) => ({
  kind: choice('agent', 0.95),
  is_device: { type: 'noul', noul: 0.02 },
  engine: choice('terra', 0.9),
  department: choice('dev', 0.8),
  account: choice('not_applicable', 0.95),
  workflow_ref: choice('not_applicable', 0.95),
  ...o,
});
const jevOk = (a = jevAnswers()) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ model: 'jev-1.13.0', answers: a }) });

const task = (body, source = {}) => ({
  id: TASK_ID,
  task_type: 'qiumi_task',
  status: 'queued',
  payload: {
    qiumi_source: { title: 'T', remark: '', body, channel: null, relations: { agents: [], workflows: [], skills: [] }, ...source },
  },
});

const pool = { query: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  loadRegistryPool.mockResolvedValue(registry);
  pool.query.mockResolvedValue({ rowCount: 1, rows: [] });
});

describe('routeQiumiTask 决策表', () => {
  it('正文硬指定 Claude → agent/claude，model 查表，run_id 合规，留痕 qiumi_route_decided', async () => {
    const d = await routeQiumiTask(task('用 Claude Code 改一下按钮文案'), {
      pool, env, fetchFn: jevOk(), callLLMFn: vi.fn(), now: () => 1700000000000,
    });
    expect(d).toMatchObject({ outcome: 'agent', engine: 'claude', model: 'claude-cli/claude-sonnet-5', department: 'dev', kind: 'agent' });
    expect(d.runId).toBe('qiumi-11111111-1700000000000');
    expect(d.payloadPatch).toMatchObject({ model: 'claude-cli/claude-sonnet-5', provider: 'openclaw', run_id: d.runId, qiumi_department: 'dev', qiumi_kind: 'agent' });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_decided', expect.objectContaining({ outcome: 'agent', source: 'jev' }));
    // 便宜闸的四项命中结论都要留痕，排查时不用回头重跑便宜闸
    expect(d.payloadPatch.qiumi_route.cheap).toMatchObject({ hardEngine: 'claude', department: null, workflowRef: null, agentRef: null });
  });

  it('无硬约束 → engine 取 Jev 答案', async () => {
    const d = await routeQiumiTask(task('帮我起草一份季度汇报'), {
      pool, env, fetchFn: jevOk(jevAnswers({ engine: choice('codex', 0.88) })), callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'agent', engine: 'codex', model: 'openai/gpt-5.3-codex' });
  });

  it('便宜闸命中序列号 → device，一次 Jev 都不问，patch 含 serial/source=oneoff/headed_manual', async () => {
    const fetchFn = vi.fn();
    const d = await routeQiumiTask(task('用 ANGYVB4227006983 去点赞'), { pool, env, fetchFn, callLLMFn: vi.fn() });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(d).toMatchObject({ outcome: 'device', serial: 'ANGYVB4227006983' });
    expect(d.payloadPatch).toMatchObject({ serial: 'ANGYVB4227006983', source: 'oneoff', headed_manual: true });
    expect(d.payloadPatch.qiumi_route.source).toBe('cheap');
  });

  it('便宜闸只命中关键词无序列号 → 问 Jev 选账号；账号∈池 → device', async () => {
    const fetchFn = jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.99 }, account: choice('e6c7ef34', 0.9) }));
    const d = await routeQiumiTask(task('去朋友圈点个赞'), { pool, env, fetchFn, callLLMFn: vi.fn() });
    expect(fetchFn).toHaveBeenCalled();
    expect(d).toMatchObject({ outcome: 'device', serial: 'e6c7ef34' });
  });

  it('device 分支：便宜闸没命中工作流时，采纳 Jev 的池内 workflow_ref', async () => {
    const d = await routeQiumiTask(task('去朋友圈点个赞'), {
      pool, env,
      fetchFn: jevOk(jevAnswers({
        is_device: { type: 'noul', noul: 0.9 },
        account: choice('e6c7ef34', 0.9),
        workflow_ref: choice('朋友圈跟圈', 0.9),
      })),
      callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'device', serial: 'e6c7ef34', workflowRef: '朋友圈跟圈' });
    expect(d.payloadPatch.qiumi_workflow_ref).toBe('朋友圈跟圈');
  });

  it('device 分支：Jev 的 workflow_ref 未达采纳线 → 不当真，回落 null 并记 defaulted', async () => {
    const d = await routeQiumiTask(task('去朋友圈点个赞'), {
      pool, env,
      fetchFn: jevOk(jevAnswers({
        is_device: { type: 'noul', noul: 0.9 },
        account: choice('e6c7ef34', 0.9),
        workflow_ref: choice('朋友圈跟圈', 0.45, 0.1),
      })),
      callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'device', workflowRef: null });
    expect(d.payloadPatch.qiumi_workflow_ref).toBeNull();
    expect(d.payloadPatch.qiumi_route.defaulted).toContain('workflow_ref');
  });

  it('关键词命中但 Jev 给了池外账号 → fail device_serial_unresolved（fail-closed）', async () => {
    const d = await routeQiumiTask(task('去朋友圈点个赞'), {
      pool, env,
      fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.99 }, account: choice('GHOST_NOT_IN_POOL', 0.99) })),
      callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'device_serial_unresolved' });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_failed', expect.objectContaining({ reason: 'device_serial_unresolved' }));
  });

  it('便宜闸未命中但 noul=0.85 → verdict=true 且账号在池 → device', async () => {
    const d = await routeQiumiTask(task('把这条内容整理好交给同事'), {
      pool, env,
      fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.85 }, account: choice('e6c7ef34', 0.9) })),
      callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'device', serial: 'e6c7ef34' });
  });

  it('noul=0.85 但账号未选且便宜闸无序列号 → fail device_serial_unresolved', async () => {
    const d = await routeQiumiTask(task('把这条内容整理好交给同事'), {
      pool, env, fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.85 } })), callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'device_serial_unresolved' });
    expect(d.detail).toContain('not_applicable');
  });

  it('noul=0.5 → ambiguous → fail device_uncertain，绝不掉进 agent 通道', async () => {
    const d = await routeQiumiTask(task('把这条内容整理好交给同事'), {
      pool, env, fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.5 } })), callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'device_uncertain' });
    expect(d.detail).toContain('p=0.5');
    expect(recordTaskEventSafe).not.toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_decided', expect.anything());
  });

  it('noul 缺失/非数值 → 同样 ambiguous → fail device_uncertain', async () => {
    const d = await routeQiumiTask(task('把这条内容整理好交给同事'), {
      pool, env, fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul' } })), callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'device_uncertain' });
    expect(d.detail).toContain('p=null');
  });

  it('Jev 与 terra 全挂 → fail qiumi_router_unavailable', async () => {
    const d = await routeQiumiTask(task('随便写点什么'), {
      pool, env, fetchFn: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')), callLLMFn: vi.fn().mockRejectedValue(new Error('bridge down')),
    });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'qiumi_router_unavailable' });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_failed', expect.objectContaining({ reason: 'qiumi_router_unavailable' }));
  });

  it('department 不在池 → 回落 main，defaulted 记 department', async () => {
    const d = await routeQiumiTask(task('随便写点什么'), {
      pool, env, fetchFn: jevOk(jevAnswers({ department: choice('ghost', 0.9) })), callLLMFn: vi.fn(),
    });
    expect(d.department).toBe('main');
    expect(d.payloadPatch.qiumi_route.defaulted).toContain('department');
  });

  it('engine 概率 0.4 且边际 0.1 → 未判定，默认 terra 且 defaulted 含 engine', async () => {
    const d = await routeQiumiTask(task('随便写点什么'), {
      pool, env, fetchFn: jevOk(jevAnswers({ engine: choice('codex', 0.4, 0.1) })), callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'agent', engine: 'terra', model: 'openai/gpt-5.6-terra' });
    expect(d.payloadPatch.qiumi_route.defaulted).toContain('engine');
  });

  it('choice 概率不足但边际≥0.2 → 仍采纳（补充二两条采纳线任一成立即可）', async () => {
    const d = await routeQiumiTask(task('随便写点什么'), {
      pool, env, fetchFn: jevOk(jevAnswers({ engine: choice('codex', 0.45, 0.25) })), callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ engine: 'codex' });
    expect(d.payloadPatch.qiumi_route.defaulted).not.toContain('engine');
  });

  it('kind=workflow 且 workflow_ref 在池 → agent 分支带 workflowRef', async () => {
    const d = await routeQiumiTask(task('跑一遍那条既定流程'), {
      pool, env,
      fetchFn: jevOk(jevAnswers({ kind: choice('workflow', 0.9), workflow_ref: choice('周报生成', 0.9) })),
      callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'agent', kind: 'workflow', workflowRef: '周报生成' });
    expect(d.payloadPatch.qiumi_workflow_ref).toBe('周报生成');
  });

  it('便宜闸命中非部门 agent → agentRef 带进 task_events 留痕，不当部门用', async () => {
    const d = await routeQiumiTask(task('随便写点什么', { relations: { agents: ['ag-xiaobai'], workflows: [], skills: [] } }), {
      pool, env, fetchFn: jevOk(), callLLMFn: vi.fn(),
    });
    expect(d.department).toBe('dev');
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_decided', expect.objectContaining({
      cheap: expect.objectContaining({ agentRef: '小白' }),
    }));
    expect(d.payloadPatch.qiumi_route.cheap.agentRef).toBe('小白');
  });

  it('relation 命中的 agent 名裹着序列号 → 子串反查得手机，直接 device 且不问 Jev', async () => {
    const fetchFn = vi.fn();
    const d = await routeQiumiTask(task('把这条内容整理好交给同事', { relations: { agents: ['ag-phone1'], workflows: [], skills: [] } }), {
      pool, env, fetchFn, callLLMFn: vi.fn(),
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(d).toMatchObject({ outcome: 'device', serial: 'ANGYVB4227006983' });
    expect(d.payloadPatch.qiumi_route.cheap.matchedBy).toContain('agentRef:serial');
    expect(d.payloadPatch.qiumi_route.cheap.isDevice).toBe(true);
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_decided', expect.objectContaining({
      outcome: 'device', source: 'cheap', serial: 'ANGYVB4227006983',
    }));
  });

  it('agentRef 反查不到序列号（普通 agent 名）→ 不假装命中，照常交 Jev 选号', async () => {
    const fetchFn = jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.99 }, account: choice('e6c7ef34', 0.9) }));
    const d = await routeQiumiTask(task('去朋友圈点个赞', { relations: { agents: ['ag-xiaobai'], workflows: [], skills: [] } }), {
      pool, env, fetchFn, callLLMFn: vi.fn(),
    });
    expect(fetchFn).toHaveBeenCalled();
    expect(d).toMatchObject({ outcome: 'device', serial: 'e6c7ef34' });
    expect(d.payloadPatch.qiumi_route.cheap.matchedBy).not.toContain('agentRef:serial');
  });

  it('设备阈值唯一真身在 jev-client，本模块只再导出不另立标准', () => {
    expect(NOUL_THRESHOLDS).toEqual({ high: 0.8, low: 0.2 });
  });
});

describe('pickSerial 守池', () => {
  it('池外账号即便高置信也不放行；池内放行；便宜闸序列号优先', () => {
    expect(pickSerial({ serial: null }, { account: { choice: 'GHOST', confidence: 0.9, probabilities: { GHOST: 0.99 } } }, registry)).toBeNull();
    expect(pickSerial({ serial: null }, { account: { choice: 'e6c7ef34', confidence: 0.9, probabilities: { e6c7ef34: 0.99 } } }, registry)).toBe('e6c7ef34');
    expect(pickSerial({ serial: 'ANGYVB4227006983' }, { account: { choice: 'e6c7ef34', confidence: 0.9 } }, registry)).toBe('ANGYVB4227006983');
    expect(pickSerial({ serial: null }, { account: null }, registry)).toBeNull();
  });

  it('agentRef 裹着池内序列号 → 子串反查命中；裹着池外序列号 → 不放行', () => {
    expect(pickSerial({ serial: null, agentRef: 'phone-ANGYVB4227006983' }, { account: null }, registry)).toBe('ANGYVB4227006983');
    expect(pickSerial({ serial: null, agentRef: 'phone-GHOST0000' }, { account: null }, registry)).toBeNull();
    expect(pickSerial({ serial: null, agentRef: '小白' }, { account: null }, registry)).toBeNull();
  });
});

describe('persistDecision', () => {
  // ── device 分支：派生子任务，不是就地改 task_type（补充五）──
  // 就地改会叫醒 tasks 上的 work_routing_task_projection_immutable（迁移 421）：
  // 生产秋米任务全部经 createRoutedTask 入账、必有回执，回执写死 canonical_task_type='qiumi_task'，
  // 一改 task_type 就 RAISE EXCEPTION。所以设备那一段作为独立 device_job 子任务落地。
  const CHILD_ID = '99999999-8888-7777-6666-555555555555';
  const deviceDecision = {
    outcome: 'device', serial: 'e6c7ef34', workflowRef: '朋友圈跟圈', department: null,
    payloadPatch: {
      serial: 'e6c7ef34', source: 'oneoff', headed_manual: true,
      qiumi_workflow_ref: '朋友圈跟圈', qiumi_route: { source: 'cheap' },
    },
  };
  const parentTask = () => ({
    ...task('在 e6c7ef34 上跑一轮'),
    title: '给账号跑一轮',
    description: '正文',
    priority: 'P1',
    project_id: 'proj-1',
    payload: {
      ...task('在 e6c7ef34 上跑一轮').payload,
      notion_page_id: 'page-1',
      tenant_id: 'yueshengyun',
      routing_receipt_id: 'r-1',
      work_kind: 'operations',
      repo: null,
    },
  });
  const childOk = () => vi.fn().mockResolvedValue({ task_id: CHILD_ID, task: { id: CHILD_ID } });

  it('device → 经 createRoutedTask 派生 device_job 子任务（requested_task_type/operations/none，父任务 id 做幂等键）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const createRoutedTaskFn = childOk();
    const childId = await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn });
    expect(childId).toBe(CHILD_ID);
    const [, req] = createRoutedTaskFn.mock.calls[0];
    expect(req.source).toBe('child');
    expect(req.source_id).toContain(TASK_ID);
    expect(req.requested_task_type).toBe('device_job');
    expect(req.mutation_intent).toBe('none');
    expect(req.declared_domain).toBe('operations');
    // 标题不能逐字照抄父任务：建子任务这一刻父任务还是 queued，父子同名会撞
    // idx_tasks_dedup_active（迁移 461，按 title+goal_id+project_id 对活跃任务唯一）
    expect(req.title).toBe('给账号跑一轮（设备 e6c7ef34）');
    expect(req.task).toMatchObject({
      status: 'queued', trigger_source: 'manual', executor_kind: 'headed-session',
      priority: 'P1', project_id: 'proj-1',
    });
  });

  it('device → 子任务 payload 带领单器契约四件套 + 溯源，且继承 notion_page_id（否则撞 458 去重唯一索引）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const createRoutedTaskFn = childOk();
    await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn });
    expect(createRoutedTaskFn.mock.calls[0][1].metadata).toMatchObject({
      serial: 'e6c7ef34', source: 'oneoff', headed_manual: true,
      parent_task_id: TASK_ID, qiumi_workflow_ref: '朋友圈跟圈',
      notion_page_id: 'page-1', tenant_id: 'yueshengyun',
    });
    expect(createRoutedTaskFn.mock.calls[0][1].metadata.qiumi_source).toBeTruthy();
  });

  it('device → 子任务绝不继承 notion_zh_page_id（带上就会拿子任务状态去改同一行中文表）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const createRoutedTaskFn = childOk();
    await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn });
    const meta = createRoutedTaskFn.mock.calls[0][1].metadata;
    // PUSH_QIUMI_QUERY 只认 payload.notion_zh_page_id 非空，不看 task_type：子任务带上它就会
    // 被推送 —— 子 queued 把中文行推回「委派」（下轮当新行二次入账）、子完成抢在父任务前写
    // 「已完成」、子失败写「推迟」并清空 OpenClaw任务号（急停与重排的唯一锚）。
    expect(Object.hasOwn(meta, 'notion_zh_page_id'), '子任务带上中文页 id 会去改同一行中文表').toBe(false);
  });

  it('device → 子任务建好了但父任务挂起写不进去（CAS 0 行）→ 留痕 orphan + 父任务置 failed 出声', async () => {
    // 静默吞掉 = 子任务在跑、父任务还 queued 会被再派一次，同一件活做两遍。
    const query = vi.fn(async (sql) => (
      /delegated_device_job/.test(sql) ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [] }
    ));
    await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn: childOk() });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      { query }, TASK_ID, 'qiumi_device_delegation_orphan',
      expect.objectContaining({ child_id: CHILD_ID }),
    );
    const w = query.mock.calls.find(([sql]) => /SET status = 'failed'/.test(sql));
    expect(w, '父任务没被置 failed——主理人在中文表看不到任何异常').toBeTruthy();
    expect(String(w[1][1])).toMatch(/device_parent_hold_failed/);
  });

  it('device → orphan 置 failed 绝不覆盖主理人刚做的决定（冲突人赢）', async () => {
    // CAS 落空的现实成因就是这个：主理人在 claim 与挂起之间从中文表急停了这行
    // （淘汰→cancelled、阻塞→blocked/owner_hold，见 applyOwnerStops）。
    // 把它改写成 failed = 机器覆盖人，正好反了。
    const query = vi.fn(async (sql) => (
      /delegated_device_job/.test(sql) ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [] }
    ));
    await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn: childOk() });
    const sql = query.mock.calls.find(([s]) => /SET status = 'failed'/.test(s))[0];
    for (const s of ['completed', 'completed_no_pr', 'failed', 'archived', 'cancelled', 'canceled']) {
      expect(sql, `${s} 的行会被改写成 failed`).toMatch(new RegExp(`'${s}'`));
    }
    expect(sql, '主理人「阻塞」拖过来的 owner_hold 行会被改写成 failed')
      .toMatch(/NOT \(status = 'blocked' AND blocked_reason = 'owner_hold'\)/);
  });

  it('device → 父任务挂起成功时不留 orphan 痕、也不置 failed', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn: childOk() });
    expect(recordTaskEventSafe).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'qiumi_device_delegation_orphan', expect.anything(),
    );
    expect(query.mock.calls.some(([sql]) => /SET status = 'failed'/.test(sql))).toBe(false);
  });

  it('device → assigned_to=phone-<serial> 单独一条 UPDATE 写子任务，且不碰 task_type/payload（不叫醒触发器）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn: childOk() });
    const w = query.mock.calls.find(([sql]) => /assigned_to/.test(sql));
    expect(w).toBeTruthy();
    expect(w[1]).toEqual([CHILD_ID, 'phone-e6c7ef34']);
    expect(w[0]).not.toMatch(/task_type/);
    expect(w[0]).not.toMatch(/payload/);
  });

  it('device → 父任务挂 blocked/delegated_device_job、释放 claim、CAS 只认 queued，绝不改父 task_type', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn: childOk() });
    const w = query.mock.calls.find(([sql]) => /delegated_device_job/.test(sql));
    expect(w).toBeTruthy();
    expect(w[0]).toMatch(/SET status = 'blocked'/);
    expect(w[0]).toMatch(/blocked_at = NOW\(\)/);
    expect(w[0]).toMatch(/claimed_by = NULL/);
    expect(w[0]).toMatch(/AND status = 'queued'/);
    expect(w[1][0]).toBe(TASK_ID);
    // 全部 SQL 里都不许出现给父任务改类型的写法——这是本补充的立案理由
    for (const [sql] of query.mock.calls) expect(sql).not.toMatch(/SET task_type/);
  });

  it('device → 父任务 payload 只并 device_task_id/qiumi_route/qiumi_workflow_ref，回执七键与设备语义都不许糊上去', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn: childOk() });
    const w = query.mock.calls.find(([sql]) => /delegated_device_job/.test(sql));
    const patch = JSON.parse(w[1][1]);
    expect(patch).toMatchObject({ device_task_id: CHILD_ID, qiumi_workflow_ref: '朋友圈跟圈' });
    expect(patch.qiumi_route).toBeTruthy();
    // 回执七键：碰一个就 RAISE EXCEPTION（迁移 421 的比对清单）
    for (const k of ['routing_receipt_id', 'work_kind', 'change_kind', 'default_execution_profile',
      'execution_profile_override', 'repo', 'map_scope', 'impact_contract_required']) {
      expect(Object.hasOwn(patch, k)).toBe(false);
    }
    // 设备语义只属于子任务，糊到父任务上会让父任务看起来也是一台手机的活
    for (const k of ['serial', 'source', 'headed_manual']) expect(Object.hasOwn(patch, k)).toBe(false);
  });

  it('device → 留痕 qiumi_device_delegated（带子任务 id 与序列号）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, parentTask(), deviceDecision, { createRoutedTaskFn: childOk() });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(
      { query }, TASK_ID, 'qiumi_device_delegated',
      expect.objectContaining({ child_id: CHILD_ID, serial: 'e6c7ef34' }),
    );
  });

  it('device → 父任务 payload 已有 device_task_id 就不再建第二条子任务（幂等）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const createRoutedTaskFn = childOk();
    const p = parentTask();
    p.payload.device_task_id = CHILD_ID;
    const childId = await persistDecision({ query }, p, deviceDecision, { createRoutedTaskFn });
    expect(childId).toBe(CHILD_ID);
    expect(createRoutedTaskFn, '重复路由建出了第二台手机的活').not.toHaveBeenCalled();
  });

  it('device → 幂等早退也要把父任务重新挂起并释放 claim（人工解闸回 queued 后不能空转）', async () => {
    // 走到这条路 = 父任务眼下又是 queued（有人手工 unblock 把它放回来了），
    // 早退时不重新挂起就等于：子任务还在跑，父任务留在队列里被一轮轮重派，每轮都原地早退。
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const p = parentTask();
    p.payload.device_task_id = CHILD_ID;
    await persistDecision({ query }, p, deviceDecision, { createRoutedTaskFn: childOk() });
    const w = query.mock.calls.find(([sql]) => /delegated_device_job/.test(sql));
    expect(w, '父任务没被重新挂起 → 下一轮 tick 还会把它捞起来').toBeTruthy();
    expect(w[0]).toMatch(/SET status = 'blocked'/);
    expect(w[0]).toMatch(/claimed_by = NULL/);
    expect(w[0]).toMatch(/AND status = 'queued'/);
    expect(JSON.parse(w[1][1]).device_task_id).toBe(CHILD_ID);
  });

  it('agent → 只 merge payload（model/provider/run_id），不动 task_type/status', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, task('x'), {
      outcome: 'agent', engine: 'claude', model: 'claude-cli/claude-sonnet-5', department: 'dev', kind: 'agent',
      workflowRef: null, runId: 'qiumi-11111111-2',
      payloadPatch: { model: 'claude-cli/claude-sonnet-5', provider: 'openclaw', run_id: 'qiumi-11111111-2', qiumi_route: {} },
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET payload = COALESCE\(payload, '\{\}'::jsonb\) \|\| \$2::jsonb/);
    expect(sql).not.toMatch(/task_type|status/);
    expect(JSON.parse(params[1])).toMatchObject({ model: 'claude-cli/claude-sonnet-5', run_id: 'qiumi-11111111-2' });
  });

  it('fail → status=failed + error_message + 释放 claim（只在 queued 时）', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    await persistDecision({ query }, task('x'), { outcome: 'fail', reason: 'device_uncertain', detail: 'p=0.5' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET status = 'failed'/);
    expect(sql).toMatch(/claimed_by = NULL/);
    expect(sql).toMatch(/AND status = 'queued'/);
    expect(params[1]).toBe('device_uncertain: p=0.5');
  });
});
