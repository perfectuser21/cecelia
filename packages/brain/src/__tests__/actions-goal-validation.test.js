import { assertScratchConfig, assertScratchIdentity } from './helpers/debt-04-scratch.js';
assertScratchConfig();
/**
 * Actions - goal_id Validation Tests
 * Tests for goal_id requirement enforcement in createTask()
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';

// isolate:false 修复：延迟导入，确保获取真实 pool 而非其他文件残留的 mock
let pool, client, createTask;
const CODING_ROUTE = {
  source: 'api',
  declared_change_kind: 'bugfix',
  repo_hint: 'cecelia',
  map_scope_hint: ['F0'],
  base_sha: 'a'.repeat(40),
};

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
  await assertScratchIdentity(pool);
  createTask = (await import('../actions.js')).createTask;
  client = await pool.connect();
});

afterAll(async () => {
  client?.release();
  await pool?.end();
});

async function createTestTask(params) {
  return createTask({
    ...CODING_ROUTE,
    source_id: crypto.randomUUID(),
    ...params,
    db: client,
  });
}

describe('createTask - goal_id validation', () => {
  let testGoalId;

  beforeEach(async () => {
    await client.query('BEGIN');
    // 正式路由要求现役scope；夹具与任务共享事务，ROLLBACK完整清理。
    const scope = `debt-04-${crypto.randomUUID()}`;
    const decision = crypto.randomUUID();
    const manifest = crypto.randomUUID();
    const run = crypto.randomUUID();
    const digest = 'a'.repeat(64);
    await client.query("INSERT INTO decisions(id,category,topic,decision) VALUES($1,'testing','debt-04','fixture')", [decision]);
    await client.query(`INSERT INTO map_scope_repositories(scope_key,repo,adapter_key)
      VALUES($1,'cecelia','test-v1') ON CONFLICT (repo) DO UPDATE SET scope_key=EXCLUDED.scope_key`, [scope]);
    await client.query(`INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at)
      VALUES($1,$2,1,$3,$4,$5,'active',NOW())`, [manifest,scope,decision,{scope_key:scope,schema_version:1,source_decision_id:decision},digest]);
    await client.query(`INSERT INTO map_projection_runs(id,scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
      VALUES($1,$2,$3,$4,'{}','test-v1',$4,'active',NOW())`, [run,scope,manifest,digest]);
    await client.query(`INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name)
      VALUES($1,$2,'capability','F0','debt-04 fixture')`, [run,digest]);
    // Create a test goal for valid tasks
    const goalResult = await client.query(`
      INSERT INTO key_results (title, status, priority)
      VALUES ('Test Goal', 'pending', 'P1')
      RETURNING id
    `);
    testGoalId = goalResult.rows[0].id;
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  describe('goal_id required validation', () => {
    it('should throw error when goal_id is missing for dev task', async () => {
      await expect(
        createTestTask({
          title: 'Test Task - Dev',
          description: 'Test task without goal_id',
          priority: 'P1',
          task_type: 'dev',
          trigger_source: 'okr_tick'
        })
      ).rejects.toThrow('goal_id is required');
    });

    it('should throw error when goal_id is missing for review task', async () => {
      await expect(
        createTestTask({
          title: 'Test Task - Review',
          description: 'Test task without goal_id',
          priority: 'P1',
          task_type: 'review',
          trigger_source: 'brain_auto'
        })
      ).rejects.toThrow('goal_id is required');
    });

    it('should throw error when goal_id is missing for talk task', async () => {
      await expect(
        createTestTask({
          title: 'Test Task - Talk',
          description: 'Test task without goal_id',
          priority: 'P1',
          task_type: 'talk',
          trigger_source: 'okr_tick'
        })
      ).rejects.toThrow('goal_id is required');
    });

    it('should accept task when goal_id is provided', async () => {
      const result = await createTestTask({
        title: 'Test Task - Valid',
        description: 'Test task with goal_id',
        priority: 'P1',
        task_type: 'dev',
        goal_id: testGoalId,
        trigger_source: 'okr_tick'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBe(testGoalId);
    });
  });

  describe('system task exemptions', () => {
    it('exploratory task (concept removed) now requires goal_id like any other type', async () => {
      // exploratory 已从 systemTypes 移除，不再豁免 goal_id 要求，应抛出错误
      await expect(
        createTestTask({
          title: 'Test Task - Exploratory',
          description: 'Exploratory task',
          priority: 'P1',
          task_type: 'exploratory',
          trigger_source: 'brain_auto'
        })
      ).rejects.toThrow('goal_id is required');
    });

    it('should allow research task without goal_id', async () => {
      const result = await createTestTask({
        title: 'Test Task - Research',
        description: 'Research task',
        priority: 'P1',
        task_type: 'research',
        trigger_source: 'brain_auto'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });

    it('should allow manual trigger without goal_id', async () => {
      const result = await createTestTask({
        title: 'Test Task - Manual',
        description: 'Manual trigger task',
        priority: 'P1',
        task_type: 'dev',
        trigger_source: 'manual'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });

    it('should allow test trigger without goal_id', async () => {
      const result = await createTestTask({
        title: 'Test Task - Test Trigger',
        description: 'Test trigger task',
        priority: 'P1',
        task_type: 'dev',
        trigger_source: 'test'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });

    it('should allow watchdog trigger without goal_id', async () => {
      const result = await createTestTask({
        title: 'Test Task - Watchdog',
        description: 'Watchdog task',
        priority: 'P1',
        task_type: 'dev',
        trigger_source: 'watchdog'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });

    it('should allow circuit_breaker trigger without goal_id', async () => {
      const result = await createTestTask({
        title: 'Test Task - Circuit Breaker',
        description: 'Circuit breaker task',
        priority: 'P1',
        task_type: 'dev',
        trigger_source: 'circuit_breaker'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });
  });

  describe('okr_tick flow validation', () => {
    it('should require goal_id for okr_tick triggered dev task', async () => {
      await expect(
        createTestTask({
          title: 'Test Task - OKR Dev',
          description: 'OKR triggered dev task',
          priority: 'P0',
          task_type: 'dev',
          trigger_source: 'okr_tick'
        })
      ).rejects.toThrow('goal_id is required');
    });

    it('should accept okr_tick task with goal_id', async () => {
      const result = await createTestTask({
        title: 'Test Task - OKR Valid',
        description: 'OKR triggered task with goal_id',
        priority: 'P0',
        task_type: 'dev',
        goal_id: testGoalId,
        trigger_source: 'okr_tick',
        payload: {
          decomposition: 'true',
          kr_id: testGoalId,
          kr_goal: 'Test goal'
        }
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBe(testGoalId);
      expect(result.task.trigger_source).toBe('okr_tick');
    });
  });

  describe('error message quality', () => {
    it('should include task_type and trigger_source in error message', async () => {
      try {
        await createTestTask({
          title: 'Test Task - Error Message',
          description: 'Test error message quality',
          priority: 'P1',
          task_type: 'qa',
          trigger_source: 'brain_auto'
        });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).toContain('task_type="qa"');
        expect(err.message).toContain('trigger_source="brain_auto"');
      }
    });
  });

  describe('execution_callback_harness exemption', () => {
    it('should allow harness_fix without goal_id when triggered by execution_callback_harness', async () => {
      // Bug fix: execution_callback_harness was missing from systemSources,
      // causing harness_generate → harness_fix auto-creation to silently fail
      const result = await createTestTask({
        title: 'Test Task - Harness Fix',
        description: 'Harness fix auto-created by Brain execution callback',
        priority: 'P1',
        task_type: 'harness_fix',
        trigger_source: 'execution_callback_harness',
        payload: { sprint_dir: 'sprints/sprint-1', harness_mode: true, fix_round: 1 }
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
      // 现役路由把旧harness输入归入coding_workflow，保留无goal豁免。
      expect(result.task.task_type).toBe('coding_workflow');
      expect(result.task.trigger_source).toBe('execution_callback_harness');
      const receipt = await client.query('SELECT canonical_task_type FROM work_routing_receipts WHERE task_id=$1', [result.task.id]);
      expect(receipt.rows).toEqual([{ canonical_task_type: 'coding_workflow' }]);
    });

    it('should allow harness_fix without goal_id when triggered by execution_callback_harness (duplicate check)', async () => {
      const result = await createTestTask({
        title: 'Test Task - Harness Fix 2',
        description: 'Harness fix auto-created by Brain execution callback',
        priority: 'P1',
        task_type: 'harness_fix',
        trigger_source: 'execution_callback_harness',
        payload: { sprint_dir: 'sprints/sprint-1', harness_mode: true, fix_round: 2 }
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
      // 现役路由把旧harness输入归入coding_workflow，保留无goal豁免。
      expect(result.task.task_type).toBe('coding_workflow');
      expect(result.task.trigger_source).toBe('execution_callback_harness');
      const receipt = await client.query('SELECT canonical_task_type FROM work_routing_receipts WHERE task_id=$1', [result.task.id]);
      expect(receipt.rows).toEqual([{ canonical_task_type: 'coding_workflow' }]);
    });
  });
});
