/**
 * recurring-engine — 定时引擎复活（任务 3d0db274）回归测试
 *
 * 事故：recurring_tasks 自 2026-05 停摆（最后一个实例 05-09）。根因五条：
 *   ① checkRecurringTasks 只挂在废弃的 tick-runner.executeTick，现役 scheduler-jobs 没登记；
 *   ② matchesCron 要求当前分钟恰好命中 + 用服务器本地时区（us-vps=UTC，北京 22:00 永远对不上）；
 *   ③ source_id 用 now 而不是时间点，防不住重复；
 *   ④ 建单不透传 assigned_to/due_at/过期；
 *   ⑤ escalation 降级把 recurring 当系统自产，批量暂停主理人排的定时单。
 *
 * 这里用一个「有状态的假库」按 SQL 特征分派，验证引擎的到点 / 基线 / 迟到 / CAS / 叠单 / 透传 / 过期 / 落后告警。
 * SQL 本身的正确性由 integration/recurring-engine.pg.integration.test.js 在真 PostgreSQL 上验证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

import {
  DEFAULT_TIMEZONE,
  matchesCron,
  nextSlotAfter,
  runRecurringTasksJob,
  isValidCron,
  __resetRecurringAlertStateForTest,
} from '../recurring.js';

// 北京 22:00 = UTC 14:00
const SLOT_0929 = '2026-09-29T14:00:00.000Z';
const SLOT_0930 = '2026-09-30T14:00:00.000Z';
const at = (iso) => new Date(iso);

/** 有状态假库：recurring_tasks 模板 + tasks 实例，按 SQL 特征分派 */
function makeFakeDb({ templates = [], tasks = [] } = {}) {
  const state = {
    // 模板默认非编码类型（research）：编码类（dev）必须带 map_scope，否则 buildMutationRoute 按设计拒建
    templates: templates.map((t) => ({
      is_active: true, skip_streak: 0, last_run_status: null, last_run_at: null,
      created_at: '2026-01-01T00:00:00.000Z', recurrence_type: 'cron', ...t,
      template: { task_type: 'research', ...(t.template || {}) },
    })),
    tasks: tasks.map((t) => ({ ...t })),
    taskFieldUpdates: [],
  };
  const byId = (id) => state.templates.find((t) => t.id === id);
  const iso = (v) => (v == null ? null : new Date(v).toISOString());

  const query = vi.fn(async (sql, params = []) => {
    const s = String(sql);
    if (/^\s*SELECT/i.test(s) && s.includes('FROM recurring_tasks') && s.includes('next_run_at IS NULL OR next_run_at <= $1')) {
      const now = new Date(params[0]).getTime();
      const rows = state.templates
        .filter((t) => t.is_active && (t.next_run_at == null || new Date(t.next_run_at).getTime() <= now))
        .map((t) => ({ ...t, next_run_at: t.next_run_at ? new Date(t.next_run_at) : null, next_run_at_raw: iso(t.next_run_at) }));
      return { rows };
    }
    if (/^\s*SELECT/i.test(s) && s.includes('FROM recurring_tasks') && s.includes('next_run_at < $1')) {
      const th = new Date(params[0]).getTime();
      return { rows: state.templates.filter((t) => t.is_active && t.next_run_at && new Date(t.next_run_at).getTime() < th)
        .map((t) => ({ id: t.id, title: t.title, next_run_at: new Date(t.next_run_at) })) };
    }
    if (s.includes('UPDATE recurring_tasks') && s.includes('next_run_at IS NULL')) {
      const t = byId(params[1]);
      if (t && t.is_active && t.next_run_at == null) { t.next_run_at = iso(params[0]); return { rows: [{ id: t.id }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }
    if (s.includes('UPDATE recurring_tasks') && s.includes('last_run_at = $2')) {
      const t = byId(params[2]);
      if (t && t.is_active && iso(t.next_run_at) === iso(params[3])) {
        t.next_run_at = iso(params[0]); t.last_run_at = iso(params[1]);
        return { rows: [{ id: t.id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (s.includes('UPDATE recurring_tasks') && s.includes("'missed'")) {
      const t = byId(params[1]);
      if (t && t.is_active && iso(t.next_run_at) === iso(params[2])) {
        t.next_run_at = iso(params[0]); t.last_run_status = 'missed';
        return { rows: [{ id: t.id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (s.includes("'skipped_overlap'")) {
      const t = byId(params[0]);
      t.last_run_status = 'skipped_overlap'; t.skip_streak = (t.skip_streak || 0) + 1;
      return { rows: [{ skip_streak: t.skip_streak }], rowCount: 1 };
    }
    if (s.includes("last_run_status = 'created'")) {
      const t = byId(params[0]); t.last_run_status = 'created'; t.skip_streak = 0;
      return { rows: [], rowCount: 1 };
    }
    if (s.includes("last_run_status = 'error'")) {
      const t = byId(params[0]); t.last_run_status = 'error';
      return { rows: [], rowCount: 1 };
    }
    if (/FROM tasks/.test(s) && s.includes('recurring_task_id')) {
      const hit = state.tasks.find((x) => x.payload?.recurring_task_id === params[0]
        && ['queued', 'in_progress', 'paused', 'blocked'].includes(x.status));
      return { rows: hit ? [{ id: hit.id, status: hit.status }] : [] };
    }
    if (s.includes('UPDATE tasks') && s.includes('assigned_to')) {
      state.taskFieldUpdates.push({ id: params[0], assigned_to: params[1], due_at: params[2] });
      return { rows: [], rowCount: 1 };
    }
    if (s.includes('UPDATE tasks') && s.includes('unclaimed_expired')) {
      const now = new Date(params[0]).getTime();
      const hit = state.tasks.filter((x) => x.trigger_source === 'recurring' && ['queued', 'paused'].includes(x.status)
        && x.payload?.expires_at && new Date(x.payload.expires_at).getTime() <= now);
      for (const x of hit) { x.status = 'cancelled'; x.blocked_reason = 'unclaimed_expired'; }
      return { rows: hit.map((x) => ({ id: x.id, title: x.title })), rowCount: hit.length };
    }
    throw new Error(`fake db: unexpected SQL: ${s.slice(0, 120)}`);
  });
  return { query, state, byId };
}

let raiseFn;
let taskSeq = 0;

beforeEach(() => {
  vi.clearAllMocks();
  __resetRecurringAlertStateForTest();
  raiseFn = vi.fn().mockResolvedValue(undefined);
  taskSeq = 0;
  mockCreateTask.mockImplementation(async (args) => ({ success: true, task: { id: `task-${++taskSeq}`, title: args.title } }));
});

describe('时区与 cron 计算（固定 Asia/Shanghai，模板可覆盖）', () => {
  it('默认时区是 Asia/Shanghai', () => {
    expect(DEFAULT_TIMEZONE).toBe('Asia/Shanghai');
  });

  it('北京 22:00 = UTC 14:00：带时区的 matchesCron 按北京时间判定', () => {
    expect(matchesCron('0 22 * * *', at(SLOT_0929), 'Asia/Shanghai')).toBe(true);
    expect(matchesCron('0 22 * * *', at('2026-09-29T22:00:00Z'), 'Asia/Shanghai')).toBe(false);
  });

  it('nextSlotAfter：北京 18:00 之后下一个 22:00 是当天 UTC 14:00；恰在 14:00 则顺延到次日', () => {
    const rt = { recurrence_type: 'cron', cron_expression: '0 22 * * *', template: {} };
    expect(nextSlotAfter(rt, at('2026-09-29T10:00:00Z')).toISOString()).toBe(SLOT_0929);
    expect(nextSlotAfter(rt, at(SLOT_0929)).toISOString()).toBe(SLOT_0930);
  });

  it('template.timezone 可覆盖默认时区', () => {
    const rt = { recurrence_type: 'cron', cron_expression: '0 22 * * *', template: { timezone: 'UTC' } };
    expect(nextSlotAfter(rt, at('2026-09-29T10:00:00Z')).toISOString()).toBe('2026-09-29T22:00:00.000Z');
  });

  it('weekly：北京周一 09:00（2026-09-29 是周二）→ 下周一 UTC 01:00', () => {
    const rt = { recurrence_type: 'weekly', cron_expression: '0 9 * * 1', template: {} };
    expect(nextSlotAfter(rt, at('2026-09-29T03:00:00Z')).toISOString()).toBe('2026-10-05T01:00:00.000Z');
  });

  it('interval：cron_expression 存分钟数', () => {
    const rt = { recurrence_type: 'interval', cron_expression: '90', template: {} };
    expect(nextSlotAfter(rt, at(SLOT_0929)).toISOString()).toBe('2026-09-29T15:30:00.000Z');
  });

  it('isValidCron 拒绝非法表达式', () => {
    expect(isValidCron('0 22 * * *')).toBe(true);
    expect(isValidCron('*/15 9-18 * * 1-5')).toBe(true);
    expect(isValidCron('0 22 * *')).toBe(false);
    expect(isValidCron('abc 22 * * *')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });
});

describe('基线：首次启用只算下一个时间点，不建单', () => {
  it('next_run_at 为空时哪怕恰好在北京 22:00 也不触发，只写 next_run_at=次日 22:00', async () => {
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: '晚间复盘', cron_expression: '0 22 * * *', next_run_at: null }] });
    const r = await runRecurringTasksJob(db, { now: at(SLOT_0929), raiseFn });
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(db.byId('rt-1').next_run_at).toBe(SLOT_0930);
    expect(r.baseline).toBe(1);
    expect(r.created).toHaveLength(0);
  });
});

describe('到点：now >= next_run_at 即到点（不再要求当前分钟命中）', () => {
  it('北京 22:07（迟 7 分钟、在 30 分钟窗口内）照样建单，source_id 用时间点', async () => {
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: '晚间复盘', cron_expression: '0 22 * * *', next_run_at: SLOT_0929 }] });
    const r = await runRecurringTasksJob(db, { now: at('2026-09-29T14:07:00Z'), raiseFn });
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const args = mockCreateTask.mock.calls[0][0];
    expect(args.source_id).toBe(`recurring:rt-1:${SLOT_0929}`);
    expect(args.trigger_source).toBe('recurring');
    expect(args.db).toBe(db);
    const t = db.byId('rt-1');
    expect(t.next_run_at).toBe(SLOT_0930);
    expect(t.last_run_at).toBe(SLOT_0929);
    expect(t.last_run_status).toBe('created');
    expect(t.skip_streak).toBe(0);
    expect(r.created).toHaveLength(1);
  });

  it('未到点不动', async () => {
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: 'x', cron_expression: '0 22 * * *', next_run_at: SLOT_0930 }] });
    const r = await runRecurringTasksJob(db, { now: at(SLOT_0929), raiseFn });
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(r.created).toHaveLength(0);
    expect(db.byId('rt-1').next_run_at).toBe(SLOT_0930);
  });
});

describe('迟到超窗：missed + P2 告警 + 推进，不建单', () => {
  it('迟 45 分钟 > 默认 30 → missed，不建单，next_run_at 推到次日，发 P2', async () => {
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: '晚间复盘', cron_expression: '0 22 * * *', next_run_at: SLOT_0929 }] });
    const r = await runRecurringTasksJob(db, { now: at('2026-09-29T14:45:00Z'), raiseFn });
    expect(mockCreateTask).not.toHaveBeenCalled();
    const t = db.byId('rt-1');
    expect(t.last_run_status).toBe('missed');
    expect(t.next_run_at).toBe(SLOT_0930);
    expect(r.missed).toBe(1);
    expect(raiseFn).toHaveBeenCalledWith('P2', expect.stringContaining('rt-1'), expect.stringContaining('晚间复盘'));
  });

  it('template.catchup_minutes=60 时迟 45 分钟仍建单', async () => {
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: 'x', cron_expression: '0 22 * * *', next_run_at: SLOT_0929, template: { catchup_minutes: 60 } }] });
    await runRecurringTasksJob(db, { now: at('2026-09-29T14:45:00Z'), raiseFn });
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockCreateTask.mock.calls[0][0].source_id).toBe(`recurring:rt-1:${SLOT_0929}`);
  });

  it('停机多日错过多个时间点：只补最近一次（最近一次在窗口内就建 1 张）', async () => {
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: '每小时', cron_expression: '0 * * * *', next_run_at: '2026-09-26T14:00:00.000Z' }] });
    await runRecurringTasksJob(db, { now: at('2026-09-29T14:05:00Z'), raiseFn });
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockCreateTask.mock.calls[0][0].source_id).toBe(`recurring:rt-1:${SLOT_0929}`);
    expect(db.byId('rt-1').next_run_at).toBe('2026-09-29T15:00:00.000Z');
  });

  it('停机多日且最近一次也超窗：只记一次 missed、只告警一次', async () => {
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: 'x', cron_expression: '0 22 * * *', next_run_at: '2026-09-26T14:00:00.000Z' }] });
    await runRecurringTasksJob(db, { now: at('2026-09-29T15:00:00Z'), raiseFn });
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(raiseFn.mock.calls.filter((c) => String(c[1]).includes('missed'))).toHaveLength(1);
    expect(db.byId('rt-1').next_run_at).toBe(SLOT_0930);
  });
});

describe('防重复：CAS 占位抢到才建单', () => {
  it('并发两次调用同一时间点只建 1 张', async () => {
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: 'x', cron_expression: '0 22 * * *', next_run_at: SLOT_0929 }] });
    const now = at('2026-09-29T14:00:30Z');
    await Promise.all([runRecurringTasksJob(db, { now, raiseFn }), runRecurringTasksJob(db, { now, raiseFn })]);
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
  });

  it('同一轮跑两次（第二次 next_run_at 已推进）不重复建单', async () => {
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: 'x', cron_expression: '0 22 * * *', next_run_at: SLOT_0929 }] });
    const now = at('2026-09-29T14:00:30Z');
    await runRecurringTasksJob(db, { now, raiseFn });
    await runRecurringTasksJob(db, { now, raiseFn });
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
  });
});

describe('防叠单：同模板已有未完结实例就跳过，连续 3 次告警', () => {
  it('已有 paused 实例 → skipped_overlap，streak+1，不建单', async () => {
    const db = makeFakeDb({
      templates: [{ id: 'rt-1', title: 'x', cron_expression: '0 22 * * *', next_run_at: SLOT_0929 }],
      tasks: [{ id: 'old-1', status: 'paused', trigger_source: 'recurring', payload: { recurring_task_id: 'rt-1' } }],
    });
    const r = await runRecurringTasksJob(db, { now: at('2026-09-29T14:00:30Z'), raiseFn });
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(db.byId('rt-1').last_run_status).toBe('skipped_overlap');
    expect(db.byId('rt-1').skip_streak).toBe(1);
    expect(db.byId('rt-1').next_run_at).toBe(SLOT_0930);
    expect(r.skipped_overlap).toBe(1);
    expect(raiseFn.mock.calls.filter((c) => String(c[1]).includes('skip'))).toHaveLength(0);
  });

  it('连续 3 次叠单跳过发告警；之后成功建单 streak 归 0', async () => {
    const db = makeFakeDb({
      templates: [{ id: 'rt-1', title: '晚间复盘', cron_expression: '0 22 * * *', next_run_at: SLOT_0929 }],
      tasks: [{ id: 'old-1', status: 'blocked', trigger_source: 'recurring', payload: { recurring_task_id: 'rt-1' } }],
    });
    for (const day of ['29', '30']) {
      await runRecurringTasksJob(db, { now: at(`2026-09-${day}T14:00:30Z`), raiseFn });
    }
    expect(raiseFn.mock.calls.filter((c) => String(c[1]).includes('skip'))).toHaveLength(0);
    await runRecurringTasksJob(db, { now: at('2026-10-01T14:00:30Z'), raiseFn });
    expect(db.byId('rt-1').skip_streak).toBe(3);
    expect(raiseFn.mock.calls.filter((c) => String(c[1]).includes('skip'))).toHaveLength(1);

    db.state.tasks[0].status = 'completed';
    await runRecurringTasksJob(db, { now: at('2026-10-02T14:00:30Z'), raiseFn });
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(db.byId('rt-1').skip_streak).toBe(0);
    expect(db.byId('rt-1').last_run_status).toBe('created');
  });
});

describe('字段透传', () => {
  it('task_type/priority/dept/payload/assigned_to/due_at/expires_at 全部带进实例', async () => {
    const db = makeFakeDb({
      templates: [{
        id: 'rt-1', title: '晚间复盘', cron_expression: '0 22 * * *', next_run_at: SLOT_0929, priority: 'P1',
        template: {
          title: '晚间复盘（模板标题）', task_type: 'research', priority: 'P0', dept: 'ops',
          payload: { foo: 1 }, assigned_to: 'alex', due_offset_minutes: 90, expires_after_minutes: 120,
        },
      }],
    });
    await runRecurringTasksJob(db, { now: at('2026-09-29T14:00:30Z'), raiseFn });
    const args = mockCreateTask.mock.calls[0][0];
    // 标题带北京时间点：tasks 的 (title) WHERE cancelled 唯一索引要求同模板各实例标题不同
    expect(args.title).toBe('晚间复盘（模板标题） · 2026-09-29 22:00');
    expect(args.task_type).toBe('research');
    expect(args.priority).toBe('P0');
    expect(args.dept).toBe('ops');
    expect(args.payload).toMatchObject({
      foo: 1, recurring_task_id: 'rt-1', recurring_slot: SLOT_0929, expires_at: '2026-09-29T16:00:00.000Z',
    });
    expect(db.state.taskFieldUpdates).toEqual([{ id: 'task-1', assigned_to: 'alex', due_at: '2026-09-29T15:30:00.000Z' }]);
  });

  it('未设 due_offset_minutes 时 due_at=时间点；未设过期则 payload 无 expires_at；template.payload 盖不掉 recurring_task_id', async () => {
    const db = makeFakeDb({
      templates: [{ id: 'rt-1', title: 'x', cron_expression: '0 22 * * *', next_run_at: SLOT_0929, template: { payload: { recurring_task_id: 'evil' } } }],
    });
    await runRecurringTasksJob(db, { now: at('2026-09-29T14:00:30Z'), raiseFn });
    const args = mockCreateTask.mock.calls[0][0];
    expect(args.payload.recurring_task_id).toBe('rt-1');
    expect(args.payload).not.toHaveProperty('expires_at');
    expect(db.state.taskFieldUpdates[0]).toEqual({ id: 'task-1', assigned_to: null, due_at: SLOT_0929 });
  });
});

describe('过期：无人认领的定时实例到期取消', () => {
  it('queued/paused 且 payload.expires_at 已过 → cancelled(unclaimed_expired) + 告警；进行中与未到期不动', async () => {
    const db = makeFakeDb({
      tasks: [
        { id: 'a', title: '过期排队', status: 'queued', trigger_source: 'recurring', payload: { expires_at: '2026-09-29T13:00:00Z' } },
        { id: 'b', title: '过期暂停', status: 'paused', trigger_source: 'recurring', payload: { expires_at: '2026-09-29T13:00:00Z' } },
        { id: 'c', title: '进行中', status: 'in_progress', trigger_source: 'recurring', payload: { expires_at: '2026-09-29T13:00:00Z' } },
        { id: 'd', title: '未到期', status: 'queued', trigger_source: 'recurring', payload: { expires_at: '2026-09-29T20:00:00Z' } },
        { id: 'e', title: '手工单', status: 'queued', trigger_source: 'manual', payload: { expires_at: '2026-09-29T13:00:00Z' } },
      ],
    });
    const r = await runRecurringTasksJob(db, { now: at(SLOT_0929), raiseFn });
    const st = Object.fromEntries(db.state.tasks.map((t) => [t.id, t.status]));
    expect(st).toEqual({ a: 'cancelled', b: 'cancelled', c: 'in_progress', d: 'queued', e: 'queued' });
    expect(r.expired).toBe(2);
    expect(raiseFn).toHaveBeenCalledWith('P2', 'recurring_instance_expired', expect.stringContaining('过期排队'));
  });
});

describe('单条模板失败不影响其他模板 + 落后告警', () => {
  it('非法时区的模板抛错被隔离，其余模板照常建单', async () => {
    const db = makeFakeDb({
      templates: [
        { id: 'bad', title: '坏模板', cron_expression: '0 22 * * *', next_run_at: SLOT_0929, template: { timezone: 'Mars/Olympus' } },
        { id: 'good', title: '好模板', cron_expression: '0 22 * * *', next_run_at: SLOT_0929 },
      ],
    });
    const r = await runRecurringTasksJob(db, { now: at('2026-09-29T14:00:30Z'), raiseFn });
    expect(r.errors).toBe(1);
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockCreateTask.mock.calls[0][0].source_id).toBe(`recurring:good:${SLOT_0929}`);
  });

  it('建单失败：时间点已占用、标 error、发告警，不抛出', async () => {
    mockCreateTask.mockRejectedValueOnce(new Error('routing down'));
    const db = makeFakeDb({ templates: [{ id: 'rt-1', title: 'x', cron_expression: '0 22 * * *', next_run_at: SLOT_0929 }] });
    const r = await runRecurringTasksJob(db, { now: at('2026-09-29T14:00:30Z'), raiseFn });
    expect(r.errors).toBe(1);
    expect(db.byId('rt-1').last_run_status).toBe('error');
    expect(db.byId('rt-1').next_run_at).toBe(SLOT_0930);
    expect(raiseFn).toHaveBeenCalledWith('P2', expect.stringContaining('rt-1'), expect.stringContaining('routing down'));
  });

  it('处理后仍落后 >10 分钟的模板告警一次（去重），不重复轰炸', async () => {
    const db = makeFakeDb({
      templates: [{ id: 'bad', title: '坏模板', cron_expression: '0 22 * * *', next_run_at: SLOT_0929, template: { timezone: 'Mars/Olympus' } }],
    });
    await runRecurringTasksJob(db, { now: at('2026-09-29T14:20:00Z'), raiseFn });
    await runRecurringTasksJob(db, { now: at('2026-09-29T14:21:00Z'), raiseFn });
    const lag = raiseFn.mock.calls.filter((c) => String(c[1]).includes('lag'));
    expect(lag).toHaveLength(1);
    expect(lag[0][2]).toContain('坏模板');
  });
});

describe('旧入口 checkRecurringTasks 仍可用（返回建单列表）', () => {
  it('委托给 runRecurringTasksJob，返回 created 数组', async () => {
    const { checkRecurringTasks } = await import('../recurring.js');
    const pool = (await import('../db.js')).default;
    const fake = makeFakeDb({ templates: [{ id: 'rt-1', title: 'x', cron_expression: '0 22 * * *', next_run_at: SLOT_0929 }] });
    pool.query.mockImplementation(fake.query);
    const created = await checkRecurringTasks(at('2026-09-29T14:00:30Z'));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ recurring_task_id: 'rt-1', slot: SLOT_0929 });
  });
});
