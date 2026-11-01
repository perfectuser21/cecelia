/**
 * 接力棒 PR3 投影 —— 棒1（任务 9e785997，决策 ee4842a6/3feeae3e）迁到 projects 真身表：
 *  1. buildProjectProps：Status 映射、Remark 含 n/m 棒 + 待拍板数（root 形状不变，仍是 title/description/status）
 *  2. buildProjectBody：目标/链/待拍板/最近交接四段，≤60 块；真身链接改指向 /api/brain/projects/:id
 *  3. pushProjectRoots：数据源 = projects 表；Notion 页 id / 指纹存 projects.notion_props（不再是 tasks 顶层列）
 *  4. pushPendingDecisions：草案属性 + 项目关系；回存 notion_id
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../project-notion-ingest.js', () => ({ ingestProjectPage: vi.fn(async () => null), pullProjects: vi.fn() }));

vi.mock('../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'tok' }));
vi.mock('../projection/workflow-body.js', () => ({ syncManagedBodyBlock: vi.fn(async () => true) }));

import {
  buildProjectProps, buildProjectBody, buildPendingDecisionProps, pushProjectRoots, pushPendingDecisions, digestOf,
  PROJECT_STATUS_TO_NOTION,
} from '../notion-relay-projection.js';

const ROOT = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '接力棒：任务留痕与长链',
  description: '主理人不说也有人动',
  status: 'in_progress',
  notion_props: null,
  brief: {
    goal: '主理人不说也有人动',
    status: '第一棒已完成，第二棒进行中',
    facts: ['458 真列已落地'],
    open_questions: [{ id: 'q1', text: '要不要拆两条链？', opened_by_task: 't0' }],
    changelog: [{ at: '2026-09-23T01:00:00Z', task_id: 't0', kind: 'status', summary: '现状更新：第二棒进行中' }],
  },
};
const SNAP = {
  children: [
    { id: 'c1', title: '第一棒：脊柱', status: 'completed', sequence_no: 1, last_done: '458 真列落地' },
    { id: 'c2', title: '第二棒：接棒', status: 'in_progress', sequence_no: 2, last_done: null },
  ],
  pending: [{ id: 'd1', topic: '4 张无血管表删列？', priority: 'P2' }],
  log: [{ at: '2026-09-23T01:00:00Z', title: '第一棒：脊柱', verdict: 'PASS', done: ['458 真列落地'] }],
};

describe('buildProjectProps / Body', () => {
  it('项目页展示进行中任务的最新事实、证据和下一步，更新时指纹改变', () => {
    const snap={...SNAP,children:[...SNAP.children.slice(0,1),{...SNAP.children[1],updated_at:'2026-10-31T16:48:35Z',result:{leadgen_103_false_exclusion_progress:{facts:['候选已准备，业务未验'],evidence:{pr:'https://github.com/owner/repo/pull/2352',pilot_run:'https://github.com/owner/repo/actions/runs/123',candidate_run:'https://github.com/owner/repo/actions/runs/456',merged_sha:'123456789abcdef'},next_step:'同一候选预发'}}}]};
    const props=JSON.stringify(buildProjectProps(ROOT,snap));
    const body=JSON.stringify(buildProjectBody(ROOT,snap));
    for(const v of ['候选已准备，业务未验','https://github.com/owner/repo/pull/2352','actions/runs/123','actions/runs/456','123456789abcdef','同一候选预发'])expect(props+body).toContain(v);
    expect(digestOf(buildProjectProps(ROOT,snap),buildProjectBody(ROOT,snap))).not.toBe(digestOf(buildProjectProps(ROOT,SNAP),buildProjectBody(ROOT,SNAP)));
  });
  it('正文保留多个进行中任务，避免摘要只显示最近两项时遗漏第三项', () => {
    const children=Array.from({length:3},(_,i)=>({id:`c${i}`,title:`任务${i}`,status:'in_progress',updated_at:`2026-10-31T16:48:0${i}Z`,result:{facts:[`事实${i}`]}}));
    const snap={...SNAP,children};const props=JSON.stringify(buildProjectProps(ROOT,snap));const body=JSON.stringify(buildProjectBody(ROOT,snap));
    expect(props).not.toContain('事实0');expect(body).toContain('事实0');expect(body).toContain('事实1');expect(body).toContain('事实2');
  });
  it('任务转为阻断后保留事实证据与下一步并如实显示状态', () => {
    const snap={...SNAP,children:[{id:'c',title:'评分异常',status:'blocked',updated_at:'2026-10-31T17:09:57Z',result:{leadgen_103_false_exclusion_progress:{facts:['候选未验收'],evidence:{pr:'https://github.com/o/r/pull/2352'},next_step:'排查'}}}]};
    const output=JSON.stringify(buildProjectProps(ROOT,snap))+JSON.stringify(buildProjectBody(ROOT,snap));
    for(const value of ['已阻断','候选未验收','https://github.com/o/r/pull/2352','排查'])expect(output).toContain(value);
  });
  it('多个业务回执按记录时间选最新，不能依靠 JSON 字段顺序', () => {
    const snap={...SNAP,children:[{id:'c',title:'任务',status:'in_progress',result:{z_old:{facts:['旧事实'],recorded_at:'2026-10-30T00:00:00Z'},a_new:{facts:['新事实'],recorded_at:'2026-10-31T00:00:00Z'}}}]};
    const output=JSON.stringify(buildProjectBody(ROOT,snap));expect(output).toContain('新事实');expect(output).not.toContain('旧事实');
  });
  it('属性：Status 映射、AI Project、Run ID、Remark 含 1/2 棒 + 待拍板 1', () => {
    const p = buildProjectProps(ROOT, SNAP);
    expect(p.Status.status.name).toBe('In Progress');
    expect(p['AI Project'].checkbox).toBe(true);
    expect(p['Run ID'].rich_text[0].text.content).toBe(`brain:${ROOT.id}`);
    expect(p['AI 进展'].rich_text[0].text.content).toContain('1/2 棒完成');
    expect(p['AI 进展'].rich_text[0].text.content).toContain('待拍板 1');
    expect(PROJECT_STATUS_TO_NOTION.blocked).toBe('On Hold');
    expect(PROJECT_STATUS_TO_NOTION.completed).toBe('Completed');
  });
  it('正文：brief（目标/现状/已知事实/未决问题/变更日志）+ 链/待拍板/最近交接、≤60 块，真身链接指向 /api/brain/projects/:id', () => {
    const b = buildProjectBody(ROOT, SNAP);
    const txt = JSON.stringify(b);
    expect(txt).toContain('目标');
    expect(txt).toContain('主理人不说也有人动');
    expect(txt).toContain('现状');
    expect(txt).toContain('第一棒已完成，第二棒进行中');
    expect(txt).toContain('458 真列已落地');
    expect(txt).toContain('要不要拆两条链？');
    expect(txt).toContain('变更日志');
    expect(txt).toContain('现状更新：第二棒进行中');
    expect(txt).toContain('1. ✅ 第一棒：脊柱 — 458 真列落地');
    expect(txt).toContain('2. 🔄 第二棒：接棒');
    expect(txt).toContain('4 张无血管表删列？');
    expect(txt).toContain('已决定');
    expect(txt).toContain('最近交接');
    expect(txt).toContain('/api/brain/projects/' + ROOT.id);
    expect(txt).not.toContain('/api/brain/tasks/' + ROOT.id + '/chain');
    expect(b.length).toBeLessThanOrEqual(60);
  });
  it('digestOf 对同内容稳定、对改动敏感（含 brief 变化，棒2）', () => {
    const a = digestOf(buildProjectProps(ROOT, SNAP), buildProjectBody(ROOT, SNAP));
    expect(a).toBe(digestOf(buildProjectProps(ROOT, SNAP), buildProjectBody(ROOT, SNAP)));
    expect(a).not.toBe(digestOf(buildProjectProps({ ...ROOT, status: 'completed' }, SNAP), buildProjectBody(ROOT, SNAP)));
    const briefChanged = { ...ROOT, brief: { ...ROOT.brief, status: '现状变了' } };
    expect(a).not.toBe(digestOf(buildProjectProps(briefChanged, SNAP), buildProjectBody(briefChanged, SNAP)));
  });
  it('brief 为空壳且无 description（全新项目）→ 渲染占位文案，不报错', () => {
    const b = buildProjectBody({ ...ROOT, brief: {}, description: null }, SNAP);
    const txt = JSON.stringify(b);
    expect(txt).toContain('未写目标');
    expect(txt).toContain('未写现状');
  });

  it('brief.goal 为空但 projects.description 有内容（存量项目未走过 brief_delta）→ 目标退回 description', () => {
    const b = buildProjectBody({ ...ROOT, brief: {} }, SNAP);
    const txt = JSON.stringify(b);
    expect(txt).toContain(ROOT.description);
    expect(txt).not.toContain('未写目标');
    expect(txt).toContain('未写现状'); // 现状没有退回字段，仍是占位
  });
  it('项目填写独立目标后仍保留 description 中的原始项目计划', () => {
    const root={...ROOT,description:'原项目计划：先完成验收，预算80–150分钟',brief:{...ROOT.brief,goal:'智能获客真实可用'}};
    const text=JSON.stringify(buildProjectBody(root,SNAP));
    expect(text).toContain('智能获客真实可用');
    expect(text).toContain('项目计划');
    expect(text).toContain('原项目计划：先完成验收，预算80–150分钟');
  });
});

function poolWith({ roots, snap = SNAP, updates = [] }) {
  return { query: vi.fn(async (sql, params) => {
    if (/FROM projects ORDER BY/.test(sql)) return { rows: roots };
    if (/FROM tasks WHERE project_id = \$1::uuid AND task_type <> 'project'/.test(sql)) return { rows: snap.children };
    if (/FROM decisions\s+WHERE status = 'pending'/.test(sql)) return { rows: snap.pending };
    if (/handoff_log/.test(sql)) return { rows: snap.log.map((e) => ({ entry: e })) };
    if (/UPDATE projects SET/.test(sql)) { updates.push(params); return { rows: [] }; }
    return { rows: [] };
  }) };
}

describe('pushProjectRoots', () => {
  it('无 notion_id → POST 建页（带正文）→ 存 notion_id + 指纹进 projects.notion_props', async () => {
    const updates = [];
    const pool = poolWith({ roots: [ROOT], updates });
    const req = vi.fn(async (t, path, method, body) => {
      if (method === 'POST' && path === '/pages') { expect(body.children[0].toggle.children.length).toBeGreaterThan(4); return { id: 'page-1' }; }
      return {};
    });
    const s = await pushProjectRoots(pool, 'tok', { notionReq: req });
    expect(s).toEqual({ pushed: 1, skipped: 0, failed: 0 });
    expect(updates[0][0]).toBe(ROOT.id);
    expect(updates.find(p => typeof p[2] === 'string' && p[2].length === 40)[1]).toBe('page-1');
    expect(updates.find(p => typeof p[2] === 'string' && p[2].length === 40)[2]).toHaveLength(40);
  });
  it('指纹相同 → 跳过，不碰 Notion', async () => {
    const digest = digestOf(buildProjectProps(ROOT, SNAP), buildProjectBody(ROOT, SNAP));
    const pool = poolWith({ roots: [{ ...ROOT, notion_props: { notion_id: 'page-1', project_digest: digest } }] });
    const req = vi.fn();
    const s = await pushProjectRoots(pool, 'tok', { notionReq: req });
    expect(s.skipped).toBe(1);
    expect(req).not.toHaveBeenCalled();
  });
  it('指纹变了 → PATCH 属性并同步受管正文', async () => {
    const pool = poolWith({ roots: [{ ...ROOT, notion_props: { notion_id: 'page-1', project_digest: 'stale' } }] });
    const calls = [];
    const req = vi.fn(async (t, path, method) => { calls.push(`${method} ${path}`); if (method === 'GET') return { results: [{ id: 'b1' }, { id: 'b2' }] }; return {}; });
    await pushProjectRoots(pool, 'tok', { notionReq: req });
    expect(calls).toEqual(['GET /pages/page-1', 'PATCH /pages/page-1']);
  });
  it('页被删（404）→ 重建新页', async () => {
    const updates = [];
    const pool = poolWith({ roots: [{ ...ROOT, notion_props: { notion_id: 'gone', project_digest: 'stale' } }], updates });
    const req = vi.fn(async (t, path, method) => {
      if (method === 'PATCH' && path === '/pages/gone') throw new Error('Notion 404: Could not find page');
      if (method === 'POST') return { id: 'page-new' };
      return {};
    });
    const s = await pushProjectRoots(pool, 'tok', { notionReq: req });
    expect(s.pushed).toBe(1);
    expect(updates.find(p => typeof p[2] === 'string' && p[2].length === 40)[1]).toBe('page-new');
  });
});

describe('pushPendingDecisions', () => {
  it('草案属性：状态=草案、类型=项目、结论/背景/来源、项目关系；回存 notion_id', async () => {
    const d = { id: 'd1', topic: '删不删列', decision: '（待主理人拍板）', reason: '接力棒提出', context: { task_id: 't1', root_task_id: ROOT.id, project_id: 'proj-1', task_title: '第二棒' }, priority: 'P2', root_notion_id: 'proj-page' };
    const props = buildPendingDecisionProps(d, { rootNotionId: 'proj-page' });
    expect(props['状态'].select.name).toBe('草案');
    expect(props['类型'].select.name).toBe('项目');
    expect(props['背景'].rich_text[0].text.content).toContain('来自任务：第二棒');
    expect(props['项目'].relation[0].id).toBe('proj-page');
    expect(props['来源'].url).toContain('/api/brain/tasks/t1');
    const updates = [];
    const pool = { query: vi.fn(async (sql, params) => { if (/FROM decisions d/.test(sql)) return { rows: [d] }; if (/UPDATE decisions SET notion_id/.test(sql)) { updates.push(params); return { rows: [] }; } return { rows: [] }; }) };
    const req = vi.fn(async () => ({ id: 'dec-page' }));
    const s = await pushPendingDecisions(pool, 'tok', { notionReq: req });
    expect(s).toEqual({ pushed: 1, failed: 0 });
    expect(updates[0]).toEqual(['d1', 'dec-page']);
  });
});
