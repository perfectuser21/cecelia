/**
 * Planner Agent Tests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { pool } from './helpers/debt-05-pg.js';
vi.mock('../db.js', async () => ({ default: (await import('./helpers/debt-05-pg.js')).pool }));



describe('Planner Agent', () => {
  beforeAll(async () => {
    await pool.start();
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);

    // 真实路由需要当前仓库和已激活能力投影；夹具只在文件事务内存在。
    const repoPath = fileURLToPath(new URL('../../../..', import.meta.url));
    await pool.query(`UPDATE map_scope_repositories SET adapter_config =
      COALESCE(adapter_config, '{}'::jsonb) || jsonb_build_object('path', $1::text)
      WHERE scope_key = 'cecelia' AND repo = 'cecelia'`, [repoPath]);
    const decision = await pool.query("INSERT INTO decisions (category, topic, decision) VALUES ('testing','planner fixture','current F1') RETURNING id");
    const manifest = await pool.query(`INSERT INTO map_manifest_versions
      (scope_key,version,source_decision_id,manifest,digest,status,activated_at)
      VALUES ('cecelia',900001,$1,'{}',repeat('a',64),'active',NOW()) RETURNING id`, [decision.rows[0].id]);
    const run = await pool.query(`INSERT INTO map_projection_runs
      (scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
      VALUES ('cecelia',$1,repeat('a',64),'{}','planner-test',repeat('b',64),'active',NOW()) RETURNING id`,
      [manifest.rows[0].id]);
    await pool.query(`INSERT INTO map_projection_nodes
      (run_id,node_id,node_type,node_key,name) VALUES ($1,repeat('c',64),'capability','F1','测试当前能力')`, [run.rows[0].id]);
  });

  afterAll(async () => {
    await pool.end();
  });

  // 文件内数据统一由 pool.end() 回滚，包含不可删除的路由收据。

  describe('selectTargetKR', () => {
    it('should return null when no KRs exist', async () => {
      const { selectTargetKR } = await import('../planner.js');
      const result = selectTargetKR({
        keyResults: [],
        activeTasks: [],
        focus: null
      });
      expect(result).toBeNull();
    });

    it('should prefer P0 KR over P1', async () => {
      const { selectTargetKR } = await import('../planner.js');
      const state = {
        keyResults: [
          { id: 'kr-p1', priority: 'P1', progress: 0 },
          { id: 'kr-p0', priority: 'P0', progress: 0 }
        ],
        activeTasks: [],
        focus: null
      };
      const result = selectTargetKR(state);
      expect(result.id).toBe('kr-p0');
    });

    it('should prefer focus-linked KR', async () => {
      const { selectTargetKR } = await import('../planner.js');
      const kr1 = { id: 'kr-1', priority: 'P1', progress: 0 };
      const kr2 = { id: 'kr-2', priority: 'P0', progress: 0 };
      const state = {
        keyResults: [kr1, kr2],
        activeTasks: [],
        focus: {
          focus: {
            key_results: [{ id: 'kr-1' }]
          }
        }
      };
      const result = selectTargetKR(state);
      expect(result.id).toBe('kr-1'); // focus boost > priority
    });
  });

  describe('planNextTask', () => {
    it('should return valid planning result', async () => {
      const { planNextTask } = await import('../planner.js');
      const result = await planNextTask();
      expect(result).toHaveProperty('planned');
      if (result.planned) {
        expect(result).toHaveProperty('task');
        expect(result).toHaveProperty('kr');
        expect(result).toHaveProperty('project');
      } else {
        expect(result).toHaveProperty('reason');
        expect(['no_active_kr', 'no_project_for_kr', 'needs_planning']).toContain(result.reason);
      }
    });
  });

  describe('handlePlanInput - hard constraints', () => {
    it('should reject project without repo_path', async () => {
      const { handlePlanInput } = await import('../planner.js');
      await expect(handlePlanInput({
        project: { title: 'Test Project' }
      })).rejects.toThrow('Hard constraint: Project must have repo_path');
    });

    it('should reject task without project_id', async () => {
      const { handlePlanInput } = await import('../planner.js');
      await expect(handlePlanInput({
        task: { title: 'Test Task' }
      })).rejects.toThrow('Hard constraint: Task must have project_id');
    });

    it('should reject task whose project has no repo_path', async () => {
      // 当前 projects 缺少仓库时必须拒绝创建编码任务。
      const noRepoProjResult = await pool.query(
        "INSERT INTO projects (name, status) VALUES ('no-repo-project', 'active') RETURNING id"
      );
      const noRepoProjectId = noRepoProjResult.rows[0].id;

      const { handlePlanInput } = await import('../planner.js');
      await expect(handlePlanInput({
        task: { title: 'Test Task', project_id: noRepoProjectId }
      })).rejects.toThrow("Task's project must have repo_path");
    });

    it('should reject invalid input', async () => {
      const { handlePlanInput } = await import('../planner.js');
      await expect(handlePlanInput({})).rejects.toThrow('Input must contain one of');
    });

    it('should create objective with KRs', async () => {
      const { handlePlanInput } = await import('../planner.js');
      const result = await handlePlanInput({
        objective: {
          title: 'Test Objective',
          priority: 'P1',
          key_results: [
            { title: 'KR 1', weight: 0.5 },
            { title: 'KR 2', weight: 0.5 }
          ]
        }
      });

      expect(result.level).toBe('mission');
      expect(result.created.goals).toHaveLength(3); // 1 vision + 2 objectives
      // visions don't have type column directly, but metadata has type='mission'
      expect(result.created.goals[0].title).toBeTruthy();
      expect(result.created.goals[1].title).toBeTruthy();

    });

    it('should reject retired project creation and preserve projects truth', async () => {
      const { handlePlanInput } = await import('../planner.js');
      const before = await pool.query('SELECT COUNT(*) AS count FROM projects');
      await expect(handlePlanInput({ project: {
        title: 'Retired Project', repo_path: '/tmp/test-repo', kr_ids: []
      } })).rejects.toThrow('layer_retired');
      expect((await pool.query('SELECT COUNT(*) AS count FROM projects')).rows).toEqual(before.rows);
    });

    it('should create task linked to project with repo_path', async () => {
      // 使用迁移497建立的 projects 真身，完整经过当前编码路由。
      const projResult = await pool.query(
        "INSERT INTO projects (name, status, repo_path) VALUES ('test-proj', 'active', $1) RETURNING id",
        [fileURLToPath(new URL('../../../..', import.meta.url))]
      );
      const projectId = projResult.rows[0].id;
      const { handlePlanInput } = await import('../planner.js');
      const result = await handlePlanInput({
        task: {
          title: 'Test Task',
          project_id: projectId,
          priority: 'P0',
          change_kind: 'bugfix',
          map_scope: ['F1']
        }
      });

      expect(result.level).toBe('task');
      expect(result.created.tasks).toHaveLength(1);
      expect(result.created.tasks[0].status).toBe('queued');
      expect(result.created.tasks[0].priority).toBe('P0');
      const persisted = await pool.query('SELECT project_id, status FROM tasks WHERE id = $1', [result.created.tasks[0].id]);
      expect(persisted.rows).toEqual([{ project_id: projectId, status: 'queued' }]);
    });

    it('rejects scope-shaped input without creating a task', async () => {
      const { handlePlanInput } = await import('../planner.js');
      const before = (await pool.query('SELECT COUNT(*) AS count FROM tasks')).rows;
      await expect(handlePlanInput({ task: {
        title: '旧 Scope 任务', scope_id: '00000000-0000-4000-8000-000000000001'
      } })).rejects.toThrow('Task must have project_id');
      await expect(handlePlanInput({ task: {
        title: '不存在的旧层父项目', project_id: '00000000-0000-4000-8000-000000000001'
      } })).rejects.toThrow('Project not found');
      expect((await pool.query('SELECT COUNT(*) AS count FROM tasks')).rows).toEqual(before);
    });

    it.each(['okr_projects', 'okr_scopes', 'okr_initiatives'])('keeps migration499 protection on %s', async table => {
      await expect(pool.query(`INSERT INTO ${table} (title) VALUES ('禁止恢复旧层')`))
        .rejects.toThrow('layer_retired');
    });

    it('should support dry_run mode', async () => {
      const { handlePlanInput } = await import('../planner.js');
      const result = await handlePlanInput({
        objective: { title: 'Dry Run Objective', priority: 'P2' }
      }, true);

      expect(result.level).toBe('mission');
      expect(result.created.goals).toHaveLength(0); // Nothing created
    });
  });

  describe('getPlanStatus', () => {
    it('should return status structure', async () => {
      const { getPlanStatus } = await import('../planner.js');
      const status = await getPlanStatus();

      expect(status).toHaveProperty('target_kr');
      expect(status).toHaveProperty('target_project');
      expect(status).toHaveProperty('queued_tasks');
      expect(status).toHaveProperty('last_completed');
    });
  });

  // project_kr_links 表已在 migration 185 DROP，对应测试已移除

  describe('generateNextTask (V2: no auto-generation)', () => {
    it('should return null when no queued tasks exist for KR+Project', async () => {
      const { generateNextTask } = await import('../planner.js');

      const projResult = await pool.query(
        "INSERT INTO projects (name, status) VALUES ('empty-test', 'planning') RETURNING id"
      );

      const krResult = await pool.query(
        "INSERT INTO key_results (title, priority, status, progress) VALUES ('Empty KR', 'P0', 'pending', 0) RETURNING *"
      );

      const result = await generateNextTask(
        krResult.rows[0],
        { id: projResult.rows[0].id },
        { recentCompleted: [] }
      );
      expect(result).toBeNull();
    });

    it('should return existing queued task', async () => {
      const { generateNextTask } = await import('../planner.js');

      const projResult = await pool.query(
        "INSERT INTO projects (name, status) VALUES ('queued-test', 'planning') RETURNING id"
      );

      const krResult = await pool.query(
        "INSERT INTO key_results (title, priority, status, progress) VALUES ('Queued KR', 'P0', 'pending', 0) RETURNING *"
      );

      const tResult = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status) VALUES ('Existing Task', 'P0', $1, $2, 'queued') RETURNING id",
        [projResult.rows[0].id, krResult.rows[0].id]
      );

      const result = await generateNextTask(
        krResult.rows[0],
        { id: projResult.rows[0].id },
        { recentCompleted: [] }
      );
      expect(result).not.toBeNull();
      expect(result.title).toBe('Existing Task');
    });
  });

  describe('scoreKRs', () => {
    it('should return scored and sorted KRs', async () => {
      const { scoreKRs } = await import('../planner.js');
      const state = {
        keyResults: [
          { id: 'kr-p1', priority: 'P1', progress: 0 },
          { id: 'kr-p0', priority: 'P0', progress: 0 }
        ],
        activeTasks: [],
        focus: null
      };
      const scored = scoreKRs(state);
      expect(scored).toHaveLength(2);
      expect(scored[0].kr.id).toBe('kr-p0');
      expect(scored[0].score).toBeGreaterThan(scored[1].score);
    });
  });

  describe('planNextTask KR rotation', () => {
    it('rotates to next KR when top has no queued tasks', async () => {
      const { planNextTask } = await import('../planner.js');

      // KR1: 直接写 key_results，planner 从 key_results 查询（goals 表已 DROP）
      const kr1Result = await pool.query(
        "INSERT INTO key_results (title, priority, status, progress) VALUES ('Empty KR', 'P0', 'pending', 0) RETURNING id"
      );

      // KR2: has a queued task
      const kr2Result = await pool.query(
        "INSERT INTO key_results (title, priority, status, progress) VALUES ('Active KR', 'P1', 'pending', 0) RETURNING id"
      );

      // 当前项目通过 projects.kr_id 归属 KR。
      const proj1Result = await pool.query(
        "INSERT INTO projects (name, status, kr_id) VALUES ('rotation-test-1', 'active', $1) RETURNING id",
        [kr1Result.rows[0].id]
      );

      const proj2Result = await pool.query(
        "INSERT INTO projects (name, status, kr_id) VALUES ('rotation-test-2', 'active', $1) RETURNING id",
        [kr2Result.rows[0].id]
      );

      // Add a queued task only for KR2's project
      const tResult = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status) VALUES ('KR2 Task', 'P0', $1, $2, 'queued') RETURNING id",
        [proj2Result.rows[0].id, kr2Result.rows[0].id]
      );

      const result = await planNextTask([kr1Result.rows[0].id, kr2Result.rows[0].id]);

      expect(result.planned).toBe(true);
      expect(result.kr.id).toBe(kr2Result.rows[0].id);
      expect(result.task.title).toBe('KR2 Task');
    });

    it('returns needs_planning when no KRs have queued tasks', async () => {
      const { planNextTask } = await import('../planner.js');

      // 当前 projects.kr_id 直接关联 key_results。
      const krResult = await pool.query(
        "INSERT INTO key_results (title, status) VALUES ('Solo Empty KR', 'pending') RETURNING id"
      );

      const projResult = await pool.query(
        "INSERT INTO projects (name, status, kr_id) VALUES ('empty-plan-test', 'active', $1) RETURNING id",
        [krResult.rows[0].id]
      );

      const result = await planNextTask([krResult.rows[0].id]);

      expect(result.planned).toBe(false);
      expect(result.reason).toBe('needs_planning');
    });
  });
});
