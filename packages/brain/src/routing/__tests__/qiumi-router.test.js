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

vi.mock('../../lib/task-event-log.js', () => ({ recordTaskEventSafe: vi.fn().mockResolvedValue(true) }));
vi.mock('../cheap-gates.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadRegistryPool: vi.fn(),
}));

import { recordTaskEventSafe } from '../../lib/task-event-log.js';
import { loadRegistryPool } from '../cheap-gates.js';
import { routeQiumiTask, persistDecision, pickSerial, NOUL_THRESHOLDS } from '../qiumi-router.js';
import { qiumiEnv, phoneNodeName } from '../env.js';
import { buildQiumiSource } from '../../lib/qiumi-source.js';

// 测试夹具：phone_registry 行（DB 形状）。生产映射是台账数据（迁移 490 种子 + PUT /api/brain/phone-registry），代码里不写任何一台手机（决策 432172f7）。
const REGISTRY_ROWS = Object.freeze([
  {
    serial: 'ANGYVB4311010223', nickname: '小彩', aliases: ['三号机', '小龙虾'], host: 'xian-m1', profile: 'xiaolongxia', model: 'MAA-AN00',
    douyin_accounts: [{ id: '90915521618', nickname: 'Ai办公室', current: true }, { id: null, nickname: '秦军餐饮', current: false }], enabled: true,
  },
  {
    serial: 'e6c7ef34', nickname: '小白', aliases: ['二号机'], host: 'xian-m1', profile: 'yueshengyun-work', model: 'RMX3478',
    douyin_accounts: [{ id: '37358506855', nickname: 'Ai效率笔记', current: true }], enabled: true,
  },
  {
    serial: 'ANGYVB4402004137', nickname: '小黄', aliases: ['一号机'], host: 'xian-m4', profile: 'legacy', model: 'MAA-AN00',
    douyin_accounts: [{ id: '44997267357', nickname: '人工智能小诺考评', current: true }], enabled: true,
  },
  {
    serial: 'ANGYVB4227006983', nickname: '小蓝', aliases: ['四号机', '金诺机'], host: 'xian-m4', profile: 'jinoshengyuan-work', model: 'MAA-AN00',
    douyin_accounts: [{ id: 'langzi63485', nickname: '躺赢AI学姐', current: true }], enabled: true,
  },
  {
    serial: 'DISABLED0001', nickname: '小紫', aliases: ['五号机'], host: 'xian-m4', profile: 'retired', model: 'OLD-1',
    douyin_accounts: [], enabled: false,
  },
]);

// 既有 device/fail 用例断言的是「device 派生」这条旧路，开关封存后必须显式打开才走得到
const env = qiumiEnv({ JEV_API_KEY: 'k', QIUMI_DEVICE_DELEGATION_ENABLED: 'true' });
// 默认（开关关）：手机活走 agent，见文件末尾「开关关（默认）」describe
const envDefault = qiumiEnv({ JEV_API_KEY: 'k' });
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
    qiumi_source: buildQiumiSource({ title: 'T', remark: '', body, channel: null, ...source }),
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
    // 任务 0d4215f2：模型只认【执行参数】块，不再由 engine 推导（留 null → agent 用自身默认模型）
    expect(d).toMatchObject({ outcome: 'agent', engine: 'claude', model: null, department: 'dev', kind: 'agent' });
    expect(d.runId).toBe('qiumi-11111111-1700000000000');
    expect(d.payloadPatch).toMatchObject({ model: null, provider: 'openclaw', run_id: d.runId, qiumi_department: 'dev', qiumi_kind: 'agent' });
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_decided', expect.objectContaining({ outcome: 'agent', source: 'jev' }));
    // 便宜闸的四项命中结论都要留痕，排查时不用回头重跑便宜闸
    expect(d.payloadPatch.qiumi_route.cheap).toMatchObject({ hardEngine: 'claude', department: null, workflowRef: null, agentRef: null });
  });

  it('无硬约束 → engine 取 Jev 答案', async () => {
    const d = await routeQiumiTask(task('帮我起草一份季度汇报'), {
      pool, env, fetchFn: jevOk(jevAnswers({ engine: choice('codex', 0.88) })), callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'agent', engine: 'codex', model: null });
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
    expect(d).toMatchObject({ outcome: 'agent', engine: 'terra', model: null }); // 0d4215f2：模型不再由 engine 推导
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
    const d = await routeQiumiTask(task('随便写点什么', { agentWorkflowIds: ['ag-xiaobai'] }), {
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
    const d = await routeQiumiTask(task('把这条内容整理好交给同事', { agentWorkflowIds: ['ag-phone1'] }), {
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
    const d = await routeQiumiTask(task('去朋友圈点个赞', { agentWorkflowIds: ['ag-xiaobai'] }), {
      pool, env, fetchFn, callLLMFn: vi.fn(),
    });
    expect(fetchFn).toHaveBeenCalled();
    expect(d).toMatchObject({ outcome: 'device', serial: 'e6c7ef34' });
    // 正向钉住「relation 确实命中了 agent」——否则本用例在"压根没传 agentWorkflowIds"
    // 时也会绿（负向断言 not.toContain 区分不了"查过没中"与"从没查"），
    // 等于测不出任何东西。2026-09-23 实跑验证过这个假绿。
    expect(d.payloadPatch.qiumi_route.cheap.agentRef).toBe('小白');
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

describe('QIUMI_DEVICE_DELEGATION_ENABLED 三态 + phoneNodeName', () => {
  it('缺失 → 关（默认走 agent）', () => {
    expect(qiumiEnv({}).deviceDelegationEnabled).toBe(false);
  });
  it("'1' → 关（只认字面 'true'，与 QIUMI_DISPATCH_ENABLED 同款）", () => {
    expect(qiumiEnv({ QIUMI_DEVICE_DELEGATION_ENABLED: '1' }).deviceDelegationEnabled).toBe(false);
  });
  it("'true' → 开", () => {
    expect(qiumiEnv({ QIUMI_DEVICE_DELEGATION_ENABLED: 'true' }).deviceDelegationEnabled).toBe(true);
  });
  it('phoneNodeName：host 大写 + -PHONE 派生；QIUMI_PHONE_NODE_MAP 可覆盖；无 host → null', () => {
    expect(phoneNodeName('xian-m4', qiumiEnv({}))).toBe('XIAN-M4-PHONE');
    expect(phoneNodeName('xian-m1', qiumiEnv({}))).toBe('XIAN-M1-PHONE');
    expect(phoneNodeName('xian-m4', qiumiEnv({ QIUMI_PHONE_NODE_MAP: '{"xian-m4":"M4-NODE"}' }))).toBe('M4-NODE');
    expect(phoneNodeName(null, qiumiEnv({}))).toBeNull();
  });
});

describe('开关关（默认）：手机活不改道，走 agent 并留痕 device_hint', () => {
  it('便宜闸命中序列号 → agent；Jev 仍问一次（engine/department 要用）；device_hint 带 serial/host/matchedBy；不带 headed_manual', async () => {
    const fetchFn = jevOk();
    const d = await routeQiumiTask(task('用 ANGYVB4227006983 去点赞'), { pool, env: envDefault, fetchFn, callLLMFn: vi.fn() });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint).toMatchObject({ is_device: true, serial: 'ANGYVB4227006983', host: 'xian-m4' });
    expect(d.payloadPatch.qiumi_route.device_hint.matchedBy).toContain('text:serial');
    expect(d.payloadPatch).not.toHaveProperty('headed_manual');
    expect(d.payloadPatch).not.toHaveProperty('serial');
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_decided',
      expect.objectContaining({ outcome: 'agent', device_hint: expect.objectContaining({ serial: 'ANGYVB4227006983' }) }));
  });

  it('noul=0.85 + Jev 账号在池 → agent，device_hint.is_device=true、serial 取 Jev 账号、host 来自注册表', async () => {
    const d = await routeQiumiTask(task('把这条内容整理好交给同事'), {
      pool, env: envDefault,
      fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.85 }, account: choice('e6c7ef34', 0.9) })),
      callLLMFn: vi.fn(),
    });
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint).toMatchObject({ is_device: true, verdict: true, p: 0.85, serial: 'e6c7ef34', host: 'xian-m1' });
  });

  it('noul=0.5（ambiguous）→ agent 不 fail，device_hint.verdict=ambiguous、is_device=false、serial=null', async () => {
    const d = await routeQiumiTask(task('把这条内容整理好交给同事'), {
      pool, env: envDefault, fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.5 } })), callLLMFn: vi.fn(),
    });
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint).toMatchObject({ is_device: false, verdict: 'ambiguous', p: 0.5, serial: null, host: null });
    expect(recordTaskEventSafe).not.toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_failed', expect.anything());
  });

  it('noul=0.02 无手机 → agent，device_hint.is_device=false（不碰真机的活留痕也在）', async () => {
    const d = await routeQiumiTask(task('写一段周报'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint).toMatchObject({ is_device: false, verdict: false, serial: null });
  });

  it('persistDecision(agent) 不调 createRoutedTaskFn，UPDATE payload 含 device_hint', async () => {
    const createRoutedTaskFn = vi.fn();
    const d = await routeQiumiTask(task('用 ANGYVB4227006983 去点赞'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    await persistDecision(pool, task('用 ANGYVB4227006983 去点赞'), d, { createRoutedTaskFn });
    expect(createRoutedTaskFn).not.toHaveBeenCalled();
    const upd = pool.query.mock.calls.find(([sql]) => /SET payload = COALESCE/.test(sql));
    expect(upd).toBeTruthy();
    expect(JSON.parse(upd[1][1]).qiumi_route.device_hint.serial).toBe('ANGYVB4227006983');
  });
});

describe('执行参数与直派（任务 0d4215f2，决策 56328560）', () => {
  const envP = qiumiEnv({ JEV_API_KEY: 'k', QIUMI_MODEL_ALLOWLIST: JSON.stringify(['openai/gpt-6-sol', 'xai/grok-4.7']) });
  const reg2 = { ...registry, agents: [...registry.agents, { name: 'skill-factory', notionId: 'ag-sf' }] };
  const P = (lines) => `【执行参数】\n${lines.join('\n')}\n【执行参数结束】\n在朋友圈给一条他人动态点赞`;
  beforeEach(() => loadRegistryPool.mockResolvedValue(reg2));

  it('写明执行Agent（非部门）→ 直派，不调 Jev，source=explicit，model 为空', async () => {
    const fetchFn = jevOk(); const callLLMFn = vi.fn();
    const d = await routeQiumiTask(task(P(['执行Agent：skill-factory'])), { pool, env: envP, fetchFn, callLLMFn });
    expect(d).toMatchObject({ outcome: 'agent', department: 'skill-factory', engine: 'explicit', model: null, kind: 'agent' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(callLLMFn).not.toHaveBeenCalled();
    expect(d.payloadPatch).toMatchObject({ model: null, qiumi_department: 'skill-factory', provider: 'openclaw', engine: 'explicit' });
    expect(d.payloadPatch.qiumi_route.source).toBe('explicit');
  });

  it('执行Agent 写部门名 → 同样直派', async () => {
    const fetchFn = jevOk();
    const d = await routeQiumiTask(task(P(['执行Agent：dev'])), { pool, env: envP, fetchFn, callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'agent', department: 'dev', engine: 'explicit' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('没写参数块，但 Notion「执行 Agent / Workflow」关联列命中 agent → 直派，不调 Jev', async () => {
    const fetchFn = jevOk();
    const d = await routeQiumiTask(task('写周报', { agentWorkflowIds: ['ag-sf'] }), { pool, env: envP, fetchFn, callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'agent', department: 'skill-factory', engine: 'explicit' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('执行Agent 不在 agent 池也不是部门 → fail exec_agent_unknown，不调 Jev', async () => {
    const fetchFn = jevOk();
    const d = await routeQiumiTask(task(P(['执行Agent：nobody'])), { pool, env: envP, fetchFn, callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'exec_agent_unknown' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('参数块里模型写不出来 → fail exec_params_invalid，detail 带错误码', async () => {
    const d = await routeQiumiTask(task(P(['执行Agent：dev', '模型：agent'])), { pool, env: envP, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'fail', reason: 'exec_params_invalid' });
    expect(d.detail).toContain('unknown_model');
  });

  it('模型 / 超时 / 思考强度 / 验收 / 设备 原样落进 payload', async () => {
    const d = await routeQiumiTask(task(P([
      '执行Agent：skill-factory', '模型：sol', '超时：20分钟', '思考强度：high', '验收：动态下出现本机昵称', '设备：小龙虾',
    ])), { pool, env: envP, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.model).toBe('openai/gpt-6-sol');
    expect(d.payloadPatch).toMatchObject({
      model: 'openai/gpt-6-sol', timeout_sec: 1200, thinking: 'high', acceptance: '动态下出现本机昵称',
    });
    expect(d.payloadPatch.qiumi_route.device_hint.requested).toBe('小龙虾');
  });

  it('没写执行者 → 照常问 Jev 定部门，但 model 为空（不再由 engine 推导）', async () => {
    const fetchFn = jevOk();
    const d = await routeQiumiTask(task('帮我起草一份季度汇报'), { pool, env: envP, fetchFn, callLLMFn: vi.fn() });
    expect(fetchFn).toHaveBeenCalled();
    expect(d).toMatchObject({ outcome: 'agent', department: 'dev', model: null });
    expect(d.payloadPatch.model).toBeNull();
  });

  it('没写执行者但写了模型 → Jev 定部门，模型用参数', async () => {
    const d = await routeQiumiTask(task(P(['模型：grok'])), { pool, env: envP, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'agent', department: 'dev', model: 'xai/grok-4.7' });
  });
});

// 任务类型模型收敛·第一刀（决策 df67a9d6 / e073bdc2）：Jev 判出的 kind 落 tasks.kind 真列，
// department 落 tasks.dept 真列；engine / workflow_ref 按属性约定双写规范键（旧 qiumi_* 键保留）。
describe('kind 真列与属性约定', () => {
  it('agent 分支 payloadPatch 双写 engine / workflow_ref（旧 qiumi_workflow_ref 仍在）', async () => {
    const d = await routeQiumiTask(task('写周报'), {
      pool, env, fetchFn: jevOk(jevAnswers({ workflow_ref: choice('周报生成', 0.9) })), callLLMFn: vi.fn(),
    });
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch).toMatchObject({
      engine: 'terra', workflow_ref: '周报生成', qiumi_workflow_ref: '周报生成', qiumi_kind: 'agent',
    });
  });

  it('persistDecision(agent) 同一条 UPDATE 写 kind=$3、dept=$4（payload 仍是 $2，旧断言不动）', async () => {
    const d = await routeQiumiTask(task('写周报'), { pool, env, fetchFn: jevOk(), callLLMFn: vi.fn() });
    await persistDecision(pool, task('写周报'), d, { createRoutedTaskFn: vi.fn() });
    const upd = pool.query.mock.calls.find(([sql]) => /SET payload = COALESCE/.test(sql));
    expect(upd).toBeTruthy();
    expect(upd[0]).toMatch(/kind = \$3/);
    expect(upd[0]).toMatch(/dept = \$4/);
    expect(upd[1].slice(2)).toEqual(['agent', 'dev']);
  });

  it('Jev 答 kind=workflow → 决策与真列都是 workflow', async () => {
    const d = await routeQiumiTask(task('写周报'), {
      pool, env, fetchFn: jevOk(jevAnswers({ kind: choice('workflow', 0.95) })), callLLMFn: vi.fn(),
    });
    expect(d.kind).toBe('workflow');
    await persistDecision(pool, task('写周报'), d, { createRoutedTaskFn: vi.fn() });
    const upd = pool.query.mock.calls.find(([sql]) => /SET payload = COALESCE/.test(sql));
    expect(upd[1][2]).toBe('workflow');
  });
});

// ─── 手机台账（phone_registry，任务 b923b1f7，决策 432172f7 方案 C）────────────────
// 0929 事故：「小黄手机」「小彩手机（型号 MAA-AN00）」查不到昵称 → agent 卡住或用错手机。
// 台账模式下：唯一命中才定案并把 serial/host/profile/nickname/account 交给 agent；定不下就不派，转 blocked。
describe('手机台账模式：resolvePhone 定案 / 定不下退回', () => {
  const regRegistry = {
    ...registry,
    phoneSource: 'phone_registry',
    phoneRows: REGISTRY_ROWS,
    phones: REGISTRY_ROWS.filter((r) => r.enabled).map((r) => ({ serial: r.serial, host: r.host })),
  };
  beforeEach(() => { loadRegistryPool.mockResolvedValue(regRegistry); });

  it('「设备：小黄手机」→ agent，device_hint 带 serial/host/profile/nickname/account/resolvedBy', async () => {
    const d = await routeQiumiTask(task('设备：小黄手机\n给最新视频点赞'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.outcome).toBe('agent');
    const h = d.payloadPatch.qiumi_route.device_hint;
    expect(h).toMatchObject({
      is_device: true, serial: 'ANGYVB4402004137', host: 'xian-m4', profile: 'legacy', nickname: '小黄',
      account: { id: '44997267357', nickname: '人工智能小诺考评' }, resolvedBy: 'nickname',
    });
    expect(h.matchedBy).toContain('registry:nickname');
  });

  it('抖音号定位 → account 是命中的那个号，不是 current 号', async () => {
    const d = await routeQiumiTask(task('用「秦军餐饮」发一条探店视频'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint).toMatchObject({
      serial: 'ANGYVB4311010223', nickname: '小彩', account: { id: null, nickname: '秦军餐饮' }, resolvedBy: 'douyin_nickname',
    });
  });

  it('开关开 + 台账定案 → device 分支用台账序列号', async () => {
    const d = await routeQiumiTask(task('用一号机发作品'), { pool, env, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'device', serial: 'ANGYVB4402004137' });
  });

  it('只写型号（同型号多台）→ unresolved，不问 Jev、不派；留痕候选', async () => {
    const fetchFn = jevOk();
    const d = await routeQiumiTask(task('用型号 MAA-AN00 的手机点赞'), { pool, env: envDefault, fetchFn, callLLMFn: vi.fn() });
    expect(d.outcome).toBe('unresolved');
    expect(d.reason).toBe('device_unresolved');
    expect(d.detail.reason).toBe('model_only');
    expect(d.detail.candidates.map((c) => c.serial).sort()).toEqual(['ANGYVB4227006983', 'ANGYVB4311010223', 'ANGYVB4402004137']);
    expect(d.note).toMatch(/^⚠️ 手机未确定：请在正文写明手机昵称（.*小黄.*）或抖音账号$/);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(recordTaskEventSafe).toHaveBeenCalledWith(pool, TASK_ID, 'qiumi_route_device_unresolved',
      expect.objectContaining({ reason: 'model_only' }));
  });

  it('设备类（关键词）但一台都对不上 → unresolved（no_match）', async () => {
    const d = await routeQiumiTask(task('去抖音给客户最新视频点赞'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d).toMatchObject({ outcome: 'unresolved', reason: 'device_unresolved' });
    expect(d.detail.reason).toBe('no_match');
  });

  it('两台都点名 → unresolved（ambiguous），写明执行者也不例外', async () => {
    const d = await routeQiumiTask(task('【执行参数】\n执行Agent：media\n【执行参数结束】\n小黄手机和小白手机各发一条'), {
      pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn(),
    });
    expect(d.outcome).toBe('unresolved');
    expect(d.detail.reason).toBe('ambiguous');
  });

  it('便宜闸没判设备、Jev 判设备（noul=0.85）→ 台账模式不采纳 Jev 猜的账号，退回 unresolved', async () => {
    const d = await routeQiumiTask(task('把这条内容整理好交给同事'), {
      pool, env: envDefault,
      fetchFn: jevOk(jevAnswers({ is_device: { type: 'noul', noul: 0.85 }, account: choice('e6c7ef34', 0.9) })),
      callLLMFn: vi.fn(),
    });
    expect(d).toMatchObject({ outcome: 'unresolved', reason: 'device_unresolved' });
    expect(d.detail.jev_verdict).toBe(true);
  });

  it('非设备任务不受影响 → agent，device_hint.is_device=false', async () => {
    const d = await routeQiumiTask(task('写一段周报'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.outcome).toBe('agent');
    expect(d.payloadPatch.qiumi_route.device_hint.is_device).toBe(false);
  });

  it('台账缺失（回退 device_locks）→ 旧行为：设备类定不下仍走 agent，不 unresolved', async () => {
    loadRegistryPool.mockResolvedValue({ ...registry, phoneSource: 'device_locks', phoneRows: [] });
    const d = await routeQiumiTask(task('去抖音给客户最新视频点赞'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    expect(d.outcome).toBe('agent');
  });

  it('persistDecision(unresolved) → blocked + blocked_reason=device_unresolved + blocked_until 为 NULL + 放 claim + CAS queued，detail 写候选', async () => {
    const d = await routeQiumiTask(task('用型号 MAA-AN00 的手机点赞'), { pool, env: envDefault, fetchFn: jevOk(), callLLMFn: vi.fn() });
    pool.query.mockClear();
    await persistDecision(pool, task('用型号 MAA-AN00 的手机点赞'), d);
    const [sql, params] = pool.query.mock.calls.find(([q]) => /UPDATE tasks/.test(q));
    expect(sql).toMatch(/status = 'blocked'/);
    expect(sql).toMatch(/blocked_reason = 'device_unresolved'/);
    expect(sql).toMatch(/blocked_until = NULL/);
    expect(sql).toMatch(/claimed_by = NULL/);
    expect(sql).toMatch(/WHERE id = \$1 AND status = 'queued'/);
    expect(params[0]).toBe(TASK_ID);
    const detail = JSON.parse(params[1]);
    expect(detail.reason).toBe('model_only');
    expect(detail.candidates).toHaveLength(3);
    expect(params[2]).toBe(d.note);
  });
});
