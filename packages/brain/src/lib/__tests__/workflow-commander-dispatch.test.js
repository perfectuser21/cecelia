/**
 * Brain 主动派 workflow 给 work-commander（任务 f38e7cc2，决策 23cc0951 / 3c98fb36 / e8f872cb）。
 *
 * 新 task_type workflow_dispatch：Brain 认领 → 按 config/factory-workflows.json 的 commander 登记解析出
 * 能力/机器/profile/serial/biz → 领 Brain 设备锁 → ssh MMV 起 `openclaw agent --agent work-commander`，
 * 调度单经 stdin 作为消息 → 收割读 ~/brain-runs/<run_id>.exit + COMMANDER_RESULT 行 → 终态 + 放锁。
 * 与外部 run 镜像（workflow_run）互不干扰：tick 主派发不碰、镜像判据不收、Commander 看门狗不接。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  WORKFLOW_DISPATCH_TASK_TYPE,
  resolveCommanderOrder,
  buildCommanderMessage,
  parseCommanderResult,
  dispatchWorkflowCommanderTasks,
  reapWorkflowCommanderRuns,
} from '../workflow-commander-dispatch.js';
import { TASK_TYPE_REGISTRY, TICK_DISPATCH_EXCLUDED } from '../task-type-registry.js';
import { EXTERNAL_RUN_MIRROR_TASK_TYPES } from '../external-mirror-liveness.js';
import { resolveWorkflowConfig } from '../factory-workflow-config.js';

const CFG = {
  workflow_key: 'douyin_video_publish.android',
  device: { node: 'XIAN-M4-PHONE', profile: 'xiaolongxia', serial: 'ANGYVB4311010223', ssh_host: 'xian-m4' },
  commander: { capability: 'douyin_video_publish', biz: 'Ai办公室', timeout_min: 40 },
  publish_hours: [9, 23],
  brief: ['只私密发布', '单次点发布'],
  acceptance: '私密作品数 +1',
};
const resolveConfig = (k) => (k === CFG.workflow_key ? CFG : null);
// 上海 10:00
const IN_HOURS = () => new Date('2026-10-12T02:00:00Z');
// 上海 23:30
const OFF_HOURS = () => new Date('2026-10-11T15:30:00Z');

function task(over = {}) {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    task_type: WORKFLOW_DISPATCH_TASK_TYPE,
    status: 'queued',
    title: '发一条抖音私密作品',
    description: '小彩 Ai办公室账号，仅私密',
    priority: 'P1',
    payload: { workflow_key: CFG.workflow_key },
    ...over,
  };
}

/** 假 pool：按 SQL 正则回放，记录全部调用。 */
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

describe('task_type 注册：workflow_dispatch 不与镜像语义冲突', () => {
  it('登记为 workflow 型 openclaw-agent 执行面，tick 主派发排除（由专属 job 派发）', () => {
    const e = TASK_TYPE_REGISTRY[WORKFLOW_DISPATCH_TASK_TYPE];
    expect(e).toBeTruthy();
    expect(e.kind).toBe('workflow');
    expect(e.surface).toBe('openclaw-agent');
    expect(e.executor).toBe('openclaw-agent');
    expect(e.db).toBe(true);
    expect(e.tick_dispatchable).toBe(false);
    expect(TICK_DISPATCH_EXCLUDED).toContain(WORKFLOW_DISPATCH_TASK_TYPE);
  });
  it('不是外部 run 镜像（commander-watchdog / lost-deadline / 活性豁免都不收它）', () => {
    expect(EXTERNAL_RUN_MIRROR_TASK_TYPES).not.toContain(WORKFLOW_DISPATCH_TASK_TYPE);
  });
});

describe('resolveCommanderOrder', () => {
  it('按 workflow 登记解析出调度单：<能力> <机器> <profile> <serial> <biz>', () => {
    const r = resolveCommanderOrder(task(), { resolveConfig });
    expect(r.ok).toBe(true);
    expect(r.order).toBe('douyin_video_publish xian-m4 xiaolongxia ANGYVB4311010223 Ai办公室');
    expect(r.serial).toBe('ANGYVB4311010223');
    expect(r.timeoutSec).toBe(40 * 60);
  });
  it('真配置：抖音·视频发布（安卓真机）登记了 commander 调度单', () => {
    const r = resolveCommanderOrder(task(), { resolveConfig: (k) => resolveWorkflowConfig(k) });
    expect(r.ok).toBe(true);
    expect(r.order).toBe('douyin_video_publish xian-m4 xiaolongxia ANGYVB4311010223 Ai办公室');
  });
  it('未登记 workflow / 缺 commander 项 → 不猜，返回缺什么', () => {
    expect(resolveCommanderOrder(task({ payload: { workflow_key: 'nope' } }), { resolveConfig }).error).toMatch(/未在 config\/factory-workflows.json 登记/);
    expect(resolveCommanderOrder(task({ payload: {} }), { resolveConfig }).error).toMatch(/workflow_key/);
    const noBiz = { ...CFG, commander: { capability: 'douyin_video_publish' } };
    expect(resolveCommanderOrder(task(), { resolveConfig: () => noBiz }).error).toMatch(/biz/);
  });
  it('字段含空白/引号等非法字符 → 拒绝（调度单会被 Commander 拼进 shell）', () => {
    const bad = { ...CFG, commander: { ...CFG.commander, biz: 'a b' } };
    expect(resolveCommanderOrder(task(), { resolveConfig: () => bad }).error).toMatch(/非法/);
    const bad2 = { ...CFG, device: { ...CFG.device, profile: "x';rm" } };
    expect(resolveCommanderOrder(task(), { resolveConfig: () => bad2 }).error).toMatch(/非法/);
  });
  it('payload.commander_args 只放行白名单旗标', () => {
    const ok = resolveCommanderOrder(task({ payload: { workflow_key: CFG.workflow_key, commander_args: ['--allow-missing'] } }), { resolveConfig });
    expect(ok.order.endsWith(' --allow-missing')).toBe(true);
    const bad = resolveCommanderOrder(task({ payload: { workflow_key: CFG.workflow_key, commander_args: ['--push', '1;reboot'] } }), { resolveConfig });
    expect(bad.error).toMatch(/commander_args/);
  });
});

describe('buildCommanderMessage', () => {
  it('消息含调度单、Brain 任务号、run_id、正文纪律与 COMMANDER_RESULT 回写约定', () => {
    const r = resolveCommanderOrder(task(), { resolveConfig });
    const m = buildCommanderMessage(task(), r, 'wfd-aaaaaaaa-1');
    expect(m).toContain('调度单：douyin_video_publish xian-m4 xiaolongxia ANGYVB4311010223 Ai办公室');
    expect(m).toContain('aaaaaaaa-1111-2222-3333-444444444444');
    expect(m).toContain('wfd-aaaaaaaa-1');
    expect(m).toContain('只私密发布');
    expect(m).toContain('COMMANDER_RESULT');
    expect(m).toContain('小彩 Ai办公室账号，仅私密');
  });
});

describe('parseCommanderResult', () => {
  it('取最后一个 COMMANDER_RESULT 行的 JSON', () => {
    const r = parseCommanderResult('blah\nCOMMANDER_RESULT {"status":"failed"}\nmore\nCOMMANDER_RESULT {"status":"completed","tag":"T1","evidence":["e1"]}');
    expect(r).toEqual({ status: 'completed', tag: 'T1', evidence: ['e1'] });
  });
  it('没有或 JSON 坏 → null', () => {
    expect(parseCommanderResult('nothing')).toBeNull();
    expect(parseCommanderResult('COMMANDER_RESULT {bad')).toBeNull();
    expect(parseCommanderResult(null)).toBeNull();
  });
});

describe('dispatchWorkflowCommanderTasks', () => {
  const select=rows=>[/FROM tasks[\s\S]*status = 'queued'/,()=>({rows})];
  it('新运行委托公共Runner，保留task身份，禁止SSH业务Commander',async()=>{
    const t=task(),pool=fakePool([select([t])]),common=vi.fn(async()=>({dispatched:true})),ssh=vi.fn();
    const out=await dispatchWorkflowCommanderTasks(pool,{resolveConfig,now:IN_HOURS,workflowCommonDispatch:common,sshDispatch:ssh});
    expect(out.dispatched).toBe(1);expect(common).toHaveBeenCalledWith(pool,t);expect(ssh).not.toHaveBeenCalled();
  });
  it('代码设备闸忙时保留等待，不切换账号或启动旧Commander',async()=>{
    const t=task(),pool=fakePool([select([t])]),ssh=vi.fn();
    const out=await dispatchWorkflowCommanderTasks(pool,{resolveConfig,now:IN_HOURS,workflowCommonDispatch:async()=>({waiting:true,gate:{pass:false}}),sshDispatch:ssh});
    expect(out.waiting).toBe(1);expect(out.dispatched).toBe(0);expect(ssh).not.toHaveBeenCalled();
  });
  it('缺正式source保持queued并记录缺口，不猜合同',async()=>{
    const t=task(),pool=fakePool([select([t])]),recordEvent=vi.fn(),ssh=vi.fn();
    const out=await dispatchWorkflowCommanderTasks(pool,{resolveConfig,now:IN_HOURS,workflowCommonDispatch:async()=>{throw Error('workflow_common_profile_unavailable');},recordEvent,sshDispatch:ssh});
    expect(out.waiting).toBe(1);expect(recordEvent).toHaveBeenCalledWith(pool,t.id,'workflow_common_preflight_rejected',{reason:'workflow_common_profile_unavailable'});expect(ssh).not.toHaveBeenCalled();
  });
  it('发布时段外不启动公共Runner、不领锁',async()=>{
    const pool=fakePool([select([task()])]),common=vi.fn(),lockGate=vi.fn();
    const out=await dispatchWorkflowCommanderTasks(pool,{resolveConfig,now:OFF_HOURS,workflowCommonDispatch:common,lockGate});
    expect(out.skipped).toBe(1);expect(common).not.toHaveBeenCalled();expect(lockGate).not.toHaveBeenCalled();
  });
  it('未知transport回执继续inspect，不放锁重发',async()=>{
    const t=task(),pool=fakePool([select([t])]),releaseLock=vi.fn();
    const out=await dispatchWorkflowCommanderTasks(pool,{resolveConfig,now:IN_HOURS,workflowCommonDispatch:async()=>({status:'unknown',next_action:'inspect'}),releaseLock});
    expect(out.waiting).toBe(1);expect(releaseLock).not.toHaveBeenCalled();
  });
});

describe('reapWorkflowCommanderRuns', () => {
  const row = { id: 'aaaaaaaa-1111-2222-3333-444444444444', run_id: 'wfd-aaaaaaaa-1', payload: {} };
  const inflight = [/FROM tasks[\s\S]*status = 'in_progress'/, () => ({ rows: [row] })];

  it('exit 0 + COMMANDER_RESULT completed → completed（带证据）+ 放锁', async () => {
    const pool = fakePool([inflight]);
    const releaseLock = vi.fn(async () => 1);
    const out = await reapWorkflowCommanderRuns(pool, {
      releaseLock,
      sshProbe: async () => 'EXIT=0\n{"finalAssistantVisibleText":"已发起 TAG=T1\\nCOMMANDER_RESULT {\\"status\\":\\"completed\\",\\"tag\\":\\"T1\\",\\"evidence\\":[\\"T1-outward-ledger\\"]}"}',
    });
    expect(out.completed).toBe(1);
    const fin = pool.calls.find((c) => /status = 'completed'/.test(c.sql));
    expect(fin).toBeTruthy();
    expect(JSON.stringify(fin.params)).toContain('T1-outward-ledger');
    expect(releaseLock).toHaveBeenCalledWith(row.id);
  });

  it('exit 0 但没有 COMMANDER_RESULT → failed(commander_result_missing) + 放锁', async () => {
    const pool = fakePool([inflight]);
    const releaseLock = vi.fn(async () => 1);
    const out = await reapWorkflowCommanderRuns(pool, { releaseLock, sshProbe: async () => 'EXIT=0\n{"finalAssistantVisibleText":"done"}' });
    expect(out.failed).toBe(1);
    expect(JSON.stringify(pool.calls.find((c) => /status = 'failed'/.test(c.sql)).params)).toContain('commander_result_missing');
    expect(releaseLock).toHaveBeenCalled();
  });

  it('COMMANDER_RESULT blocked / exit≠0 → failed', async () => {
    const pool = fakePool([inflight]);
    await reapWorkflowCommanderRuns(pool, { releaseLock: async () => 1, sshProbe: async () => 'EXIT=0\n{"finalAssistantVisibleText":"COMMANDER_RESULT {\\"status\\":\\"blocked\\",\\"summary\\":\\"账号不符\\"}"}' });
    expect(JSON.stringify(pool.calls.find((c) => /status = 'failed'/.test(c.sql)).params)).toContain('commander_blocked');
    const pool2 = fakePool([inflight]);
    await reapWorkflowCommanderRuns(pool2, { releaseLock: async () => 1, sshProbe: async () => 'EXIT=1\nboom' });
    expect(JSON.stringify(pool2.calls.find((c) => /status = 'failed'/.test(c.sql)).params)).toContain('openclaw_agent_exit_1');
  });

  it('还在跑（NO_EXIT）/ ssh 失败 → 不动', async () => {
    const pool = fakePool([inflight]);
    const releaseLock = vi.fn();
    await reapWorkflowCommanderRuns(pool, { releaseLock, sshProbe: async () => 'NO_EXIT' });
    await reapWorkflowCommanderRuns(pool, { releaseLock, sshProbe: async () => { throw new Error('x'); } });
    expect(pool.calls.some((c) => /UPDATE tasks/.test(c.sql))).toBe(false);
    expect(releaseLock).not.toHaveBeenCalled();
  });
});
