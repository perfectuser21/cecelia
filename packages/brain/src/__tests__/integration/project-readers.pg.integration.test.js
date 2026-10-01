import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pool from '../../db.js';
import { shouldTriggerReview, createReviewTask, processReviewResult } from '../../review-gate.js';
import { triggerCompletedDecompositionReview } from '../../decomposition-review-trigger.js';
import { reviewProjectCompletion } from '../../progress-reviewer.js';
import { diagnoseKR } from '../../task-router.js';
import { findRelatedProject } from '../../entity-linker.js';
import { _searchSemanticMemory } from '../../memory-retriever.js';
import SimilarityService from '../../similarity.js';
import { generateCompareReport, getCompareMetrics } from '../../project-compare.js';
import { preparePrompt } from '../../executor.js';
import diagnoseRoutes from '../../routes/task-router-diagnose.js';
import intentMatchRoutes from '../../routes/intent-match.js';
import tasksRoutes from '../../routes/tasks.js';
import taskTasksRoutes from '../../routes/task-tasks.js';
import MemoryService from '../../services/memory-service.js';
import { actionHandlers } from '../../decision-executor.js';

vi.mock('../../openai-client.js', () => ({ generateEmbedding: vi.fn(async () => null) }));
vi.mock('../../learning.js', () => ({ searchRelevantLearnings: vi.fn(async () => []) }));

const krId = randomUUID();
const projectId = randomUUID();
const otherProjectId = randomUUID();
const keyword = `reader${randomUUID().replaceAll('-', '')}`;
let client;
let querySpy;

beforeAll(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  querySpy = vi.spyOn(pool, 'query').mockImplementation((...args) => client.query(...args));
  await client.query(`INSERT INTO key_results(id,title,status,current_value,target_value)
    VALUES($1,$2,'in_progress',0,100)`, [krId, keyword]);
  await client.query(`INSERT INTO projects(id,name,status,kr_id,created_at,metadata)
    VALUES($1,$2,'active',$3,NOW()-INTERVAL '10 days','{"time_budget_days":14}')`, [projectId, keyword, krId]);
  await client.query(`INSERT INTO projects(id,name,status) VALUES($1,$2,'planning')`, [otherProjectId, `${keyword}other`]);
  await client.query(`INSERT INTO tasks(id,title,status,task_type,project_id,goal_id,completed_at)
    VALUES($1,$2,'completed','data',$3,$4,NOW()-INTERVAL '2 days')`, [randomUUID(), `${keyword}已完成`, projectId, krId]);
  await client.query(`INSERT INTO tasks(id,title,status,task_type,project_id,goal_id)
    VALUES($1,$2,'queued','dev',$3,$4)`, [randomUUID(), `${keyword}待执行`, projectId, krId]);
  // migration 497 保留并回填旧根：它与 projects 同 id，但不是可执行子任务。
  await client.query(`INSERT INTO tasks(id,title,status,task_type,project_id,goal_id)
    VALUES($1,$2,'in_progress','project',$1,$3)`, [projectId, `${keyword}旧根投影`, krId]);
});

afterAll(async () => {
  querySpy?.mockRestore();
  if (client) {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
});

describe('真实 PostgreSQL：仅存在 projects 的新项目贯穿按需入口', () => {
  it('真实任务可触发审查，完成时间来自子任务', async () => {
    expect(await shouldTriggerReview(pool, 'project', projectId)).toBe(true);
    const review = await reviewProjectCompletion(pool, projectId);
    expect(review).toMatchObject({ found: true, taskCount: 2, taskCompleted: 1, budgetDays: 14, actualDays: 8 });
  });

  it('KR 诊断直接统计新项目的完成与在途任务', async () => {
    const result = await diagnoseKR(krId, pool);
    expect(result.projects[0]).toMatchObject({ id: projectId, task_count: 2, active_task_count: 1, completed_task_count: 1 });
    expect(result.summary.diagnosis).toBe('healthy');
  });

  it('实体链接与语义记忆均识别新项目', async () => {
    expect((await findRelatedProject(keyword)).id).toBe(projectId);
    const memory = await _searchSemanticMemory(pool, keyword, 'chat');
    expect(memory.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: projectId, source: 'project' })]));
  });

  it('项目详情不被同 ID 的遗留 tasks 根投影遮蔽', async () => {
    expect(await new MemoryService(pool).getDetail(projectId)).toMatchObject({ level: 'project', title: keyword });
  });

  it('相似匹配返回 Project，项目报告与指标读到真实任务', async () => {
    const candidates = await new SimilarityService(pool).getAllActiveEntities();
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ id: projectId, level: 'project' })]));
    const ids = [projectId, otherProjectId];
    const report = await generateCompareReport({ project_ids: ids });
    expect(report.projects.find(p => p.id === projectId).task_stats.total).toBe(2);
    const metrics = await getCompareMetrics({ project_ids: ids });
    expect(metrics.projects.find(p => p.id === projectId).name).toBe(keyword);
  });

  it('拆解提示读到真实项目时间上下文且沿四层结构登记', async () => {
    const prompt = await preparePrompt({ title: '拆解项目', description: keyword, goal_id: krId, payload: { decomposition: 'true' } });
    expect(prompt).toContain(keyword);
    expect(prompt).toContain('预算 14 天');
    expect(prompt).toContain('Objective → Key Result → Project → Task');
    expect(prompt).not.toContain('create-initiative');
  });

  it('两个真实 HTTP 按需入口都能读取新项目', async () => {
    const app = express();
    app.use(express.json());
    app.use('/diagnose', diagnoseRoutes);
    app.use('/intent', intentMatchRoutes);
    const diagnosis = await request(app).get(`/diagnose/diagnose/${krId}`);
    expect(diagnosis.status).toBe(200);
    expect(diagnosis.body.projects[0].task_counts).toMatchObject({ total: 2, queued: 1, completed: 1 });
    const intent = await request(app).post('/intent/match').send({ query: keyword });
    expect(intent.status).toBe(200);
    expect(intent.body.matched_projects).toEqual(expect.arrayContaining([expect.objectContaining({ id: projectId })]));
  });

  it('真实拆解完成、修正再审、复用确认门与 KR 放行贯穿同一 Project', async () => {
    const createRecordedTask = async task => {
      const id = randomUUID();
      await pool.query(`INSERT INTO tasks(id,title,status,task_type,project_id,goal_id,payload)
        VALUES($1,$2,'queued',$3,$4,$5,$6)`, [id, task.title, task.task_type, task.project_id, task.goal_id, task.payload]);
      return { task: { id } };
    };
    const decompId = randomUUID();
    // 同 KR 最新项目并非本次目标；本棒显式选定较旧项目进行复用。
    await pool.query('UPDATE projects SET kr_id=$1 WHERE id=$2', [krId, otherProjectId]);
    await pool.query(`INSERT INTO tasks(id,title,status,task_type,goal_id,payload)
      VALUES($1,'项目拆解','completed','dev',$2,'{"decomposition":"true"}')`, [decompId, krId]);
    const patchApp = express();
    patchApp.use(express.json());
    // 与 server.js 相同顺序：嵌套兼容路由 → Brain 真路由 → Tasks fallback。
    patchApp.use('/api/brain/tasks/tasks', taskTasksRoutes);
    patchApp.use('/api/brain', tasksRoutes);
    patchApp.use('/api/brain/tasks', taskTasksRoutes);
    const saved = await request(patchApp).patch(`/api/brain/tasks/${decompId}`)
      .send({ result: { decomposition_project_id: projectId } });
    expect(saved.status).toBe(200);
    const selection = (await pool.query('SELECT result,success_metrics FROM tasks WHERE id=$1', [decompId])).rows[0];
    expect(selection.result.decomposition_project_id).toBe(projectId);
    expect(selection.success_metrics?.decomposition_project_id).toBeUndefined();
    await pool.query("UPDATE key_results SET status = 'decomposing' WHERE id = $1", [krId]);
    const createReview = (db, params) => createReviewTask(db, params, createRecordedTask);
    expect(await triggerCompletedDecompositionReview(pool, decompId, { createReview }))
      .toMatchObject({ reviewed: true, project_id: projectId });
    const first = (await pool.query(`SELECT id,task_id FROM decomp_reviews WHERE entity_id=$1 AND verdict IS NULL`, [projectId])).rows[0];
    const confirmation = (await pool.query(`SELECT id FROM pending_actions WHERE params->>'kr_id'=$1 AND status='pending_approval'`, [krId])).rows[0];
    await pool.query("UPDATE tasks SET status='completed' WHERE id=$1", [first.task_id]);
    await processReviewResult(pool, first.task_id, 'needs_revision', { issue: '补验收边界' }, createRecordedTask);
    const revision = (await pool.query(`SELECT id,project_id,goal_id FROM tasks WHERE payload->>'review_id'=$1 AND task_type='project_plan'`, [first.id])).rows[0];
    expect(revision).toMatchObject({ project_id: projectId, goal_id: krId });
    await pool.query("UPDATE tasks SET status='completed' WHERE id=$1", [revision.id]);
    expect(await triggerCompletedDecompositionReview(pool, revision.id, { createReview }))
      .toMatchObject({ reviewed: true, project_id: projectId });
    const second = (await pool.query(`SELECT task_id FROM decomp_reviews WHERE entity_id=$1 AND verdict IS NULL`, [projectId])).rows[0];
    expect(second.task_id).not.toBe(first.task_id);
    const refreshed = (await pool.query('SELECT id,params,context FROM pending_actions WHERE id=$1', [confirmation.id])).rows[0];
    expect(refreshed.params.project_id).toBe(projectId);
    expect(refreshed.context.decomposition_task_id).toBe(revision.id);
    expect(refreshed.context.tasks).not.toContain(`${keyword}旧根投影`);
    await pool.query("UPDATE tasks SET status='completed' WHERE id=$1", [second.task_id]);
    await processReviewResult(pool, second.task_id, 'approved', {});
    expect((await pool.query('SELECT status FROM projects WHERE id=$1', [projectId])).rows[0].status).toBe('active');
    expect(await actionHandlers.okr_decomp_review({ kr_id: krId }, {})).toMatchObject({ success: true, kr_id: krId });
    expect((await pool.query('SELECT status FROM key_results WHERE id=$1', [krId])).rows[0].status).toBe('ready');
  });
});
