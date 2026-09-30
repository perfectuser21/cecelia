/**
 * project-brief-apply 真库集成（接力棒链 2afa6d69 棒2，决策 ee4842a6/3feeae3e）。
 *
 * 验收：一条真实链上第 2 棒 handoff 带 brief_delta 后，第 3 棒派发 prompt 里是改过的现状
 * （getChainContext + formatChainForPrompt 从 projects.brief 取数，不是第 2 棒那天写的静态 description）。
 * 同时验证 A 档升级：改 goal 不直接生效，落 pending_actions，brief.goal 不变。
 *
 * 连 cecelia_test（本地已跑过 migrate，projects/pending_actions 表已在，迁移 497 已含 brief 列，
 * 不需要本测试自建库）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../recurring-notion-sync.js', () => ({ notionReq: vi.fn(), getToken: () => 'fake-token' }));

import { relayOnComplete } from '../../lib/relay-baton.js';
import { saveHandoff, buildHandoff, getChainContext, formatChainForPrompt } from '../../handoff.js';
import { applyProjectBriefDelta } from '../../lib/project-brief-apply.js';

let pool;
let projectId;
const taskIds = [];
const pendingActionIds = [];

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  const tag = Date.now();
  const p = await pool.query(
    `INSERT INTO projects (name, description, status, brief) VALUES ($1, '真库集成测试项目', 'active', '{}'::jsonb) RETURNING id`,
    [`IT brief 项目 ${tag}`],
  );
  projectId = p.rows[0].id;

  const t2 = await pool.query(
    `INSERT INTO tasks (title, task_type, status, priority, project_id, sequence_no) VALUES ($1, 'dev', 'in_progress', 'P1', $2, 2) RETURNING id`,
    [`IT 第二棒 ${tag}`, projectId],
  );
  taskIds.push(t2.rows[0].id);
  const t3 = await pool.query(
    `INSERT INTO tasks (title, task_type, status, priority, project_id, sequence_no) VALUES ($1, 'dev', 'queued', 'P1', $2, 3) RETURNING id`,
    [`IT 第三棒 ${tag}`, projectId],
  );
  taskIds.push(t3.rows[0].id);
});

afterAll(async () => {
  if (pendingActionIds.length) await pool.query('DELETE FROM pending_actions WHERE id = ANY($1::uuid[])', [pendingActionIds]);
  if (taskIds.length) await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [taskIds]);
  if (projectId) await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
});

describe('brief_delta 全链（真库）', () => {
  it('第 2 棒 completed 且 handoff 带 brief_delta → projects.brief 落库，第 3 棒的链上下文/派发 prompt 能看到改过的现状', async () => {
    const [t2Id, t3Id] = taskIds;

    // 第 2 棒转 completed（终态写入唯一收口之外的直改仅用于测试造数据，不代表生产写法）
    await pool.query(`UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`, [t2Id]);

    const h = buildHandoff({
      task_id: t2Id,
      title: '第二棒',
      verdict: 'PASS',
      done: ['把 API 跑通了'],
      next_steps: ['完成，无下一步'],
      brief_delta: {
        status: '第二棒已完成，API 联调通过，等第三棒接前端',
        add_facts: ['API 联调通过'],
        open_questions: ['要不要给前端加 loading 态？'],
      },
    });
    await saveHandoff({ pool }, h);

    // relayOnComplete 由 afterTerminalTransition 触发（此处等价直调，测的是同一条函数）
    const relay = await relayOnComplete(pool, t2Id);
    expect(relay).not.toBeNull();
    expect(relay.brief?.applied).toBe(true);

    const proj = await pool.query('SELECT brief FROM projects WHERE id = $1', [projectId]);
    expect(proj.rows[0].brief.status).toBe('第二棒已完成，API 联调通过，等第三棒接前端');
    expect(proj.rows[0].brief.facts).toContain('API 联调通过');
    expect(proj.rows[0].brief.open_questions.some((q) => q.text === '要不要给前端加 loading 态？')).toBe(true);

    // 第 3 棒派发 prompt：getChainContext 走 project_id 根路径，brief 是刚才改过的那份
    const ctx = await getChainContext({ pool }, t3Id);
    expect(ctx.root.kind).toBe('project');
    expect(ctx.root.brief.status).toBe('第二棒已完成，API 联调通过，等第三棒接前端');
    const prompt = formatChainForPrompt(ctx);
    expect(prompt).toContain('第二棒已完成，API 联调通过，等第三棒接前端');
    expect(prompt).toContain('API 联调通过');
  });

  it('A 档升级：改 goal 不直接生效，落 pending_actions，brief.goal 不变；批准后才生效', async () => {
    const before = await pool.query('SELECT brief FROM projects WHERE id = $1', [projectId]);
    const oldGoal = before.rows[0].brief.goal || '';

    const result = await applyProjectBriefDelta(pool, {
      projectId,
      rawDelta: { goal: '改成新目标：给前端加 loading 态' },
      taskId: taskIds[0],
    });
    expect(result.escalated).toBe(true);
    expect(result.pending_action_id).toBeTruthy();
    pendingActionIds.push(result.pending_action_id);
    expect(result.brief.goal).toBe(oldGoal); // 没变

    const pa = await pool.query('SELECT action_type, status, params FROM pending_actions WHERE id = $1', [result.pending_action_id]);
    expect(pa.rows[0].action_type).toBe('project_brief_decision');
    expect(pa.rows[0].status).toBe('pending_approval');
    expect(pa.rows[0].params.escalated).toEqual({ goal: '改成新目标：给前端加 loading 态' });

    // 批准（force:true）→ 这次真生效
    const { applyApprovedBriefEscalation } = await import('../../lib/project-brief-apply.js');
    const approved = await applyApprovedBriefEscalation(pool, {
      projectId,
      escalated: { goal: '改成新目标：给前端加 loading 态' },
      taskId: taskIds[0],
    });
    expect(approved.escalated).toBe(false);
    expect(approved.brief.goal).toBe('改成新目标：给前端加 loading 态');
  });
});
