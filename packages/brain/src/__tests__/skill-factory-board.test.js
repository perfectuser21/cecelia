/**
 * 技能工厂看板（任务 1b3c0000）：Brain 阶段任务 → Notion「技能工厂看板」，一条流程一行。
 * 计数规则与工位 bin/count_streak.py 一致（决策 5826ddd7 / 6ec463c3 / 1b469079）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseParams, countStreak, stageOf, flowNameOf, flowKey, buildBoardRows, buildBoardProps,
  runSkillFactoryBoardPush, _resetSkillFactoryBoardGate, BOARD_DB_PROPS, BOARD_VESSEL,
} from '../skill-factory-board.js';

const TRIAL_BODY = `【执行参数】
阶段：试跑
使用 skill：skill-explore
树上坐标：新媒体部 · 内容生产 · 内容生产·多平台发布 · 抖音·视频发布（安卓真机）
父任务：76987788（⑦ 样板流程全循环实跑）

【目标】
用 OpenClaw skill-factory 第一次按试跑协议把「抖音视频发布」在真机上做成一次。`;

const trialTask = (over = {}) => ({
  id: 'd4b74ac5-c292-45f0-ad32-84a94b271152', title: '试跑 抖音·视频发布（安卓真机）——技能工厂首个样板',
  status: 'failed', task_type: 'research', description: TRIAL_BODY, parent_task_id: null,
  payload: { agent: 'skill-factory', skill: 'skill-explore', stage: 'trial', parent_task_id: '76987788-eb23-46e5-8908-7f11cfec093c' },
  result: { delivery: { claimed_result: 'blocked', flow_skill_v1: '',
    fail_reason: '设备与账号预检通过，但现有控制器缺少本次必需的视频素材下发受控入口；工位禁止裸ADB，按skill-explore表外故障规则停止。发布次数为0，验收未达成。' } },
  notion_id: '3f5c40c2-ba63-810e-a824-f84bb51c2c7b',
  created_at: '2026-10-10T07:27:41.378Z', updated_at: '2026-10-10T07:38:35.066Z', ...over,
});
const fixTask = {
  id: '8fdeaeb4-f3ca-4ae7-ba88-4916b74111b5', status: 'in_progress', parent_task_id: '76987788-eb23-46e5-8908-7f11cfec093c',
  title: '手机控制器补受控命令：素材下发(media-push+媒体扫描)与中文输入(text-input)，供技能工厂试跑发布类流程',
  created_at: '2026-10-10T07:39:45.448Z', updated_at: '2026-10-10T08:20:00.000Z',
};
const workflow = { id: '25a86421-a774-40d1-8d66-54ee1d87f68d', name: '抖音 · 视频发布（安卓真机）', activities: [], releases: [] };

describe('执行参数解析与连续计数（与 count_streak.py 同规则）', () => {
  it('取【执行参数】块里的键值行，Skill/skill 统一成 skill', () => {
    const p = parseParams('【执行参数】\nSkill：flow-x@1.2\n阶段：验证\n输入: a\n【执行参数结束】\n阶段：别的');
    expect(p).toEqual({ skill: 'flow-x@1.2', '阶段': '验证', '输入': 'a' });
    expect(parseParams('没有参数块')).toEqual({});
  });

  it('从最新往前数：待核验/无法核对跳过，同输入不重复计，外部原因作废，改版清零', () => {
    const runs = [
      { id: 'r0', skill: 'f@1', slice_digest: 'x', input: 'i0', verdict: 'pass' },
      { id: 'r1', skill: 'f@2', slice_digest: 'x', input: 'i1', verdict: 'pass' },
      { id: 'r2', skill: 'f@2', slice_digest: 'x', input: 'i2', verdict: 'fail', external_cause: '掉线' },
      { id: 'r3', skill: 'f@2', slice_digest: 'x', input: 'i1', verdict: 'pass' },
      { id: 'r4', skill: 'f@2', slice_digest: 'x', input: null, verdict: 'pass' },
      { id: 'r5', skill: 'f@2', slice_digest: 'x', input: 'i5', verdict: null },
    ];
    const r = countStreak(runs, 10);
    expect(r.streak).toBe(1);
    expect(r.voided).toEqual(['r2']);
    expect(r.duplicate_input).toEqual(['r1']);
    expect(r.unverifiable).toEqual(['r4']);
    expect(r.pending).toEqual(['r5']);
    expect(r.reset_by).toMatchObject({ run: 'r0' });
    expect(r.reached).toBe(false);
  });

  it('非外部原因失败到此为止', () => {
    const r = countStreak([
      { id: 'a', skill: 's@1', input: '1', verdict: 'pass' },
      { id: 'b', skill: 's@1', input: '2', verdict: 'fail' },
      { id: 'c', skill: 's@1', input: '3', verdict: 'pass' },
    ], 1);
    expect(r).toMatchObject({ streak: 1, reached: true, reset_by: { run: 'b', reason: '失败（非外部原因）' } });
  });
});

describe('阶段、流程名与身份', () => {
  it('payload.stage 英文与【执行参数】阶段中文都认；重跑归沉淀；探路之类不认', () => {
    expect(stageOf({ payload: { stage: 'trial' } }, {})).toBe('试跑');
    expect(stageOf({ payload: {} }, { '阶段': '验证' })).toBe('验证');
    expect(stageOf({ payload: {} }, { '阶段': '重跑' })).toBe('沉淀');
    expect(stageOf({ payload: {} }, { '阶段': '探路。使用 skill：skill-explore' })).toBe(null);
  });
  it('流程名取树上坐标最后一段（段间是带空格的 ·，名字里的 · 不拆）；身份按去空白后的名字稳定', () => {
    expect(flowNameOf(trialTask(), parseParams(TRIAL_BODY))).toBe('抖音·视频发布（安卓真机）');
    expect(flowKey('抖音·视频发布（安卓真机）')).toBe(flowKey('抖音 · 视频发布（安卓真机）'));
    expect(flowKey('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

const text = p => (p?.rich_text || p?.title || []).map(t => t.text.content).join('');

describe('看板行', () => {
  it('抖音·视频发布：试跑 / blocked（取 claimed_result）/ 卡点一句话 + 修复单 / 不计数 / 未拆 Activity', () => {
    const rows = buildBoardRows({ stageTasks: [trialTask()], children: [], followups: [fixTask], workflows: [workflow] });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.flow).toBe('抖音·视频发布（安卓真机）');
    expect(r.workflowId).toBe(workflow.id);
    const p = buildBoardProps(r);
    expect(text(p['流程'])).toBe('抖音·视频发布（安卓真机）');
    expect(text(p['树上坐标'])).toBe('新媒体部 · 内容生产 · 内容生产·多平台发布 · 抖音·视频发布（安卓真机）');
    expect(p['当前阶段'].select.name).toBe('试跑');
    expect(p['最近运行结果'].select.name).toBe('blocked');
    expect(text(p['卡点'])).toBe('设备与账号预检通过，但现有控制器缺少本次必需的视频素材下发受控入口；修复中：手机控制器补受控命令：素材下发(media-push+媒体扫描)与中文输入(te…（进行中）');
    expect(text(p['连续通过'])).toBe('试跑阶段不计数');
    expect(text(p['skill@版本'])).toBe('整流程 skill 未产出（本阶段用 skill-explore）');
    expect(text(p['裁判结论'])).toBe('还没拆成 Activity，暂无裁判');
    expect(text(p['生产版本'])).toBe('还没拆成 Activity，暂无生产版本');
    expect(p['阶段任务'].url).toBe('https://www.notion.so/3f5c40c2ba63810ea824f84bb51c2c7b');
    expect(text(p['阶段任务ID'])).toBe(trialTask().id);
    expect(p['最近更新'].date.start).toBe('2026-10-10T08:20:00.000Z');
    expect(text(p['Brain ID'])).toBe(flowKey('抖音·视频发布（安卓真机）'));
    expect(Object.keys(p).sort()).toEqual(Object.keys(BOARD_DB_PROPS).sort());
  });

  it('同一流程多张阶段任务取最新一张；执行单（带计数阶段任务）与审计单不当阶段任务', () => {
    const verify = { ...trialTask(), id: 'v-1', status: 'in_progress', created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z',
      payload: {}, result: null, description: TRIAL_BODY.replace('阶段：试跑', '阶段：验证\nK：10') };
    const run = { ...verify, id: 'run-1', parent_task_id: 'v-1', description: '【执行参数】\n阶段：验证\n计数阶段任务：v-1\nSkill：flow@3\n输入：a\n处置表片指纹：abc' };
    const rows = buildBoardRows({ stageTasks: [trialTask(), verify, run], children: [], followups: [], workflows: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe('验证');
    expect(rows[0].stageTask.id).toBe('v-1');
  });

  it('验证阶段按子任务数 x/K；审计单按 source_task_id 配对；skill 版本取最新执行单；运行结果看最新执行单', () => {
    const verify = { ...trialTask(), id: 'v-1', status: 'in_progress', payload: {}, result: null,
      description: TRIAL_BODY.replace('阶段：试跑', '阶段：验证\nK：10') };
    const run = (id, input, at, status = 'completed') => ({ id, task_type: 'qiumi_task', parent_task_id: 'v-1', status, created_at: at, updated_at: at, result: null,
      description: `【执行参数】\n阶段：验证\n计数阶段任务：v-1\nSkill：flow-douyin@3\n输入：${input}\n处置表片指纹：abc` });
    const audit = (src, verdict, at) => ({ id: `a-${src}`, task_type: 'audit', parent_task_id: 'v-1', created_at: at, updated_at: at,
      payload: { source_task_id: src }, result: { verification: { verdict } } });
    const children = [run('r1', 'x', '2026-10-11T01:00:00Z'), run('r2', 'y', '2026-10-11T02:00:00Z'),
      audit('r1', 'pass', '2026-10-11T01:30:00Z'), audit('r2', 'pass', '2026-10-11T02:30:00Z')];
    const [r] = buildBoardRows({ stageTasks: [verify], children, followups: [], workflows: [] });
    const p = buildBoardProps(r);
    expect(text(p['连续通过'])).toBe('2/10');
    expect(text(p['skill@版本'])).toBe('flow-douyin@3');
    expect(p['最近运行结果'].select.name).toBe('success');
    expect(text(p['裁判结论'])).toBe('树上没找到这个流程');
  });

  it('试跑交付的 flow_skill_v1 是整份 skill 正文 → skill@版本 只取 frontmatter 的 name@version（生产实测整篇正文被塞进单元格）', () => {
    const skillDoc = '---\nname: android-douyin-private-video\nversion: 1.0.0\nlayer: business\ndescription: |\n  在任务指定安卓真机…\n---\n# 安卓抖音私密视频发布\n\n## 说明书\n很长的正文';
    const done = trialTask({ status: 'completed', result: { delivery: { claimed_result: 'success', flow_skill_v1: skillDoc, fail_reason: null } } });
    const [r] = buildBoardRows({ stageTasks: [done], children: [], followups: [], workflows: [workflow] });
    const p = buildBoardProps(r);
    expect(text(p['skill@版本'])).toBe('android-douyin-private-video@1.0.0');
    expect(p['最近运行结果'].select.name).toBe('success');
    const noFront = trialTask({ result: { delivery: { flow_skill_v1: 'x'.repeat(500) } } });
    expect(text(buildBoardProps(buildBoardRows({ stageTasks: [noFront], children: [], followups: [], workflows: [] })[0])['skill@版本']).length).toBeLessThanOrEqual(81);
  });

  it('子任务读不到（children=null）→「无法计数」，不当 0', () => {
    const verify = { ...trialTask(), id: 'v-1', payload: {}, description: TRIAL_BODY.replace('阶段：试跑', '阶段：验证') };
    const [r] = buildBoardRows({ stageTasks: [verify], children: null, followups: [], workflows: [] });
    expect(text(buildBoardProps(r)['连续通过'])).toBe('无法计数');
  });

  it('已拆 Activity 的流程：裁判结论按裁决汇总，生产版本按生产指针汇总', () => {
    const wf = { ...workflow, activities: [
      { id: 'a1', verdict: 'converged' }, { id: 'a2', verdict: 'diverged' }, { id: 'a3', verdict: null },
    ], releases: [{ activity_id: 'a1', version_no: 2, ever_converged: true }, { activity_id: 'a2', version_no: 1, ever_converged: false }] };
    const [r] = buildBoardRows({ stageTasks: [trialTask()], children: [], followups: [], workflows: [wf] });
    const p = buildBoardProps(r);
    expect(text(p['裁判结论'])).toBe('3 个 Activity：收敛 1 · 发散 1 · 未裁判 1');
    expect(text(p['生产版本'])).toBe('3 个 Activity 中 2 个有生产版（收敛过 1，冷启动 1）');
  });
});

function fakePool({ registered = true, links = [] } = {}) {
  const linkRows = [...links];
  const query = vi.fn(async (sql, params = []) => {
    if (/FROM notion_projection_map/.test(sql)) return { rows: registered ? [{ notion_db_id: 'db-board' }] : [] };
    if (/SELECT[\s\S]*FROM projection_links/.test(sql)) return { rows: linkRows.filter(l => l.entity_id === params[0]) };
    if (/INSERT INTO projection_links/.test(sql)) {
      const i = linkRows.findIndex(l => l.entity_id === params[0]);
      const row = { entity_id: params[0], external_id: params[1], content_hash: params[2] };
      if (i >= 0) linkRows[i] = row; else linkRows.push(row);
      return { rows: [], rowCount: 1 };
    }
    if (/DELETE FROM projection_links/.test(sql)) { const i = linkRows.findIndex(l => l.entity_id === params[0]); if (i >= 0) linkRows.splice(i, 1); return { rows: [] }; }
    return { rows: [] };
  });
  return { query, linkRows };
}
const source = async () => ({ stageTasks: [trialTask()], children: [], followups: [fixTask], workflows: [workflow] });

describe('推送：登记才推、幂等不重复建页', () => {
  beforeEach(() => _resetSkillFactoryBoardGate());

  it('库没登记 → 安静跳过，不碰 Notion', async () => {
    const notionReq = vi.fn();
    const r = await runSkillFactoryBoardPush(fakePool({ registered: false }), { notionReq, getToken: () => 't', loadSource: source });
    expect(r).toEqual({ skipped: 'db_not_registered' });
    expect(notionReq).not.toHaveBeenCalled();
  });

  it('首轮按 Brain ID 查不到 → 建一页；第二轮内容没变 → 不写；内容变了 → PATCH 同一页', async () => {
    const pool = fakePool();
    const notionReq = vi.fn(async (_t, path, method) => {
      if (path.endsWith('/query')) return { results: [], has_more: false };
      if (method === 'POST') return { id: 'page-1' };
      return { id: 'page-1' };
    });
    const deps = { notionReq, getToken: () => 't', loadSource: source };
    expect((await runSkillFactoryBoardPush(pool, deps)).created).toBe(1);
    expect(notionReq.mock.calls.filter(c => c[2] === 'POST' && c[1] === '/pages')).toHaveLength(1);
    expect(notionReq.mock.calls.find(c => c[1] === '/pages')[3].parent).toEqual({ database_id: 'db-board' });
    _resetSkillFactoryBoardGate();
    notionReq.mockClear();
    expect((await runSkillFactoryBoardPush(pool, deps)).unchanged).toBe(1);
    expect(notionReq).not.toHaveBeenCalled();
    _resetSkillFactoryBoardGate();
    const changed = async () => ({ ...(await source()), followups: [] });
    expect((await runSkillFactoryBoardPush(pool, { ...deps, loadSource: changed })).updated).toBe(1);
    expect(notionReq.mock.calls.filter(c => c[2] === 'PATCH').map(c => c[1])).toEqual(['/pages/page-1']);
  });

  it('没有链接但库里已有同 Brain ID 的页 → 认领该页 PATCH，不新建', async () => {
    const pool = fakePool();
    const notionReq = vi.fn(async (_t, path) => (path.endsWith('/query') ? { results: [{ id: 'page-old' }], has_more: false } : { id: 'page-old' }));
    const r = await runSkillFactoryBoardPush(pool, { notionReq, getToken: () => 't', loadSource: source });
    expect(r.updated).toBe(1);
    expect(notionReq.mock.calls.some(c => c[1] === '/pages' && c[2] === 'POST')).toBe(false);
    expect(pool.linkRows[0].external_id).toBe('page-old');
  });

  it('链接指向的页已被删（404）→ 清链接按 Brain ID 重找/重建', async () => {
    const pool = fakePool({ links: [{ entity_id: flowKey('抖音·视频发布（安卓真机）'), external_id: 'page-gone', content_hash: 'stale' }] });
    const notionReq = vi.fn(async (_t, path, method) => {
      if (path === '/pages/page-gone') throw new Error('Notion PATCH /pages/page-gone → 404: object_not_found');
      if (path.endsWith('/query')) return { results: [], has_more: false };
      return { id: method === 'POST' ? 'page-new' : 'x' };
    });
    const r = await runSkillFactoryBoardPush(pool, { notionReq, getToken: () => 't', loadSource: source });
    expect(r.created).toBe(1);
    expect(pool.linkRows[0].external_id).toBe('page-new');
  });

  it('5 分钟内重复调用自 gate 跳过；登记查询用 vessel', async () => {
    const pool = fakePool();
    const notionReq = vi.fn(async (_t, path) => (path.endsWith('/query') ? { results: [], has_more: false } : { id: 'p' }));
    let t = 1_000_000;
    const deps = { notionReq, getToken: () => 't', loadSource: source, now: () => t };
    await runSkillFactoryBoardPush(pool, deps);
    t += 60_000;
    expect(await runSkillFactoryBoardPush(pool, deps)).toEqual({ skipped: true });
    expect(pool.query.mock.calls.find(c => /notion_projection_map/.test(c[0]))[1]).toEqual([BOARD_VESSEL]);
  });
});
