import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({ db: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: db }));
vi.mock('../actions.js', () => ({ createTask: vi.fn() }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: vi.fn(async () => null) }));
vi.mock('../learning.js', () => ({ searchRelevantLearnings: vi.fn(async () => []) }));

import { shouldTriggerReview, processReviewResult } from '../review-gate.js';
import { reviewProjectCompletion, executePlanAdjustment } from '../progress-reviewer.js';
import { diagnoseKR } from '../task-router.js';
import { findRelatedProject } from '../entity-linker.js';
import { _searchSemanticMemory } from '../memory-retriever.js';
import SimilarityService from '../similarity.js';
import { generateCompareReport, getCompareMetrics } from '../project-compare.js';
import { preparePrompt } from '../executor.js';

const project = { id: 'project-new', name: '接力 项目', title: '接力 项目', status: 'active', kr_id: 'kr-new', created_at: new Date(), updated_at: new Date() };
const oldTables = /\bokr_(?:projects|scopes|initiatives)\b/;

beforeEach(() => {
  db.query.mockReset();
  db.query.mockImplementation(async (sql) => {
    if (oldTables.test(sql)) throw new Error('冻结表不含新项目');
    if (/FROM projects\b/.test(sql)) return { rows: /ANY\(\$1/.test(sql) ? [project, { ...project, id: 'project-other' }] : [project] };
    if (/FROM key_results\b/.test(sql)) return { rows: [{ id: 'kr-new', title: '接力目标', status: 'in_progress' }] };
    if (/COUNT\(/i.test(sql)) return { rows: [{ total: '1', completed: '0' }] };
    if (/SELECT 1 FROM tasks WHERE project_id/.test(sql)) return { rows: [{ id: 'child' }] };
    return { rows: [] };
  });
});

describe('新 projects 真身对按需入口可见（d8ca5e1e 永久回归）', () => {
  it('审查项目直接识别挂 project_id 的子任务', async () => {
    expect(await shouldTriggerReview(db, 'project', project.id)).toBe(true);
  });

  it('审查通过只激活 projects，不读写退役子层', async () => {
    db.query.mockImplementation(async (sql) => {
      if (oldTables.test(sql)) throw new Error('layer_retired');
      return { rows: /SELECT id, entity_type/.test(sql) ? [{ id: 'review', entity_type: 'project', entity_id: project.id }] : [] };
    });
    await processReviewResult(db, 'review-task', 'approved', {});
    expect(db.query.mock.calls.some(([sql]) => /UPDATE projects SET status/.test(sql))).toBe(true);
  });

  it('完成审查直接统计 Project 下的任务', async () => {
    expect(await reviewProjectCompletion(db, project.id)).toMatchObject({ found: true, projectName: project.name, taskCount: 1 });
    expect(db.query.mock.calls.every(([sql]) => !oldTables.test(sql))).toBe(true);
  });

  it('计划调整写入 projects 真身', async () => {
    await executePlanAdjustment(db, { plan_adjustment: true, adjustments: [{ project_id: project.id, time_budget_days: 3 }] });
    expect(db.query.mock.calls[0][0]).toContain('UPDATE projects');
  });

  it('KR 诊断能看到新项目，按 project_id 收集任务', async () => {
    const result = await diagnoseKR('kr-new', db);
    expect(result.projects[0]).toMatchObject({ id: project.id, name: project.name });
    expect(db.query.mock.calls.every(([sql]) => !oldTables.test(sql))).toBe(true);
  });

  it('实体链接仅查询一个 projects 参数', async () => {
    expect(await findRelatedProject('接力')).toMatchObject({ id: project.id, name: project.name });
    expect(db.query.mock.calls[0][1]).toHaveLength(1);
  });

  it('语义记忆能返回仅在 projects 存在的新项目', async () => {
    const result = await _searchSemanticMemory(db, '接力 项目', 'chat');
    expect(result.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id, source: 'project' })]));
  });

  it('相似度候选使用 project 类型并读 projects', async () => {
    const result = await new SimilarityService(db).getAllActiveEntities();
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.id, level: 'project' })]));
  });

  it('项目报告与指标均从 projects 读取', async () => {
    const ids = [project.id, 'project-other'];
    expect((await generateCompareReport({ project_ids: ids })).projects[0].name).toBe(project.name);
    expect((await getCompareMetrics({ project_ids: ids })).projects[0].name).toBe(project.name);
    expect(db.query.mock.calls.every(([sql]) => !oldTables.test(sql))).toBe(true);
  });

  it('实际生成的拆解提示使用四层结构及 Project→Task', async () => {
    const prompt = await preparePrompt({ title: '拆解：接力', description: '拆解目标', goal_id: 'kr-new', payload: { decomposition: 'true' } });
    expect(prompt).toContain('Objective → Key Result → Project → Task');
    expect(prompt).not.toMatch(/create-initiative|okr_projects|6 层架构|必须指向 Initiative/);
    expect(prompt).toContain('"project_id": "<Project ID>"');
  });

  it.each(['project_plan', 'scope_plan', 'initiative_plan'])('无项目的 %s 先生成 Project，不使用空 ID', async (task_type) => {
    const prompt = await preparePrompt({ task_type, title: '拆解目标', goal_id: 'kr-new' });
    expect(prompt).toContain('POST /api/brain/action/create-project');
    expect(prompt).not.toContain('GET /api/brain/projects/，');
  });

  it('继续任务优先当前 Project，旧 payload 的子层 ID 不进入提示', async () => {
    const prompt = await preparePrompt({ title: '继续拆解', project_id: project.id, goal_id: 'kr-new',
      payload: { decomposition: 'continue', initiative_id: 'frozen-initiative' } });
    expect(prompt).toContain(`"project_id": "${project.id}"`);
    expect(prompt).not.toContain('frozen-initiative');
  });
});
