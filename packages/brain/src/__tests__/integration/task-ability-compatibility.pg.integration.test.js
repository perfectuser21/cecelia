import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { privateFixtureDatabase } from '../fixtures/private-fixture-db.js';
import { createRoutedTask } from '../../work-routing-store.js';

let fixture;
afterEach(async () => { await fixture?.close(); });
it('现行真实建单writer保留兼容ability_id，原297 FK精确拒绝不存在挂片且事务回滚', async () => {
  fixture = await privateFixtureDatabase('orgability', async db => {
    // 最小schema只承接真实writer，不模拟新六层；FK直接应用原297迁移。
    await db.query(`
      CREATE TABLE journey_features(id uuid PRIMARY KEY);
      CREATE TABLE tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,description text,priority text,task_type text,status text,
        project_id uuid,area_id uuid,goal_id uuid,location text,payload jsonb,trigger_source text,domain text,okr_initiative_id uuid,blocked_at timestamptz,
        tags text[],prd_content text,execution_profile text,owner_role text,delivery_type text,created_by text,dept text,phase text,executor_kind text,
        parent_task_id uuid,sequence_no int,kind text,blocked_reason text,blocked_detail jsonb
      );
      CREATE TABLE initiative_runs(current_task_id uuid,orchestrator_version text);
      CREATE TABLE work_routing_receipts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid,source text,source_id text,work_kind text,change_kind text,pipeline text,canonical_task_type text,
        default_execution_profile text,execution_profile_override text,repo text,map_scope jsonb,impact_contract_required boolean,orchestrator text,router_version text,
        route_reason text,evidence jsonb,map_scope_validation_version text,direct_contract_seed jsonb,anchor_generation int DEFAULT 0,created_at timestamptz
      );
      CREATE TABLE cecelia_events(event_type text,source text,payload jsonb);
    `);
    await db.query(readFileSync(new URL('../../../migrations/297_tasks_ability_id.sql', import.meta.url), 'utf8'));
  });
  const ability = randomUUID();
  await fixture.db.query('INSERT INTO journey_features VALUES($1)', [ability]);
  const input = id => ({ source: 'api', source_id: randomUUID(), title: '兼容关联验真', mutation_intent: 'read_only', requested_task_type: 'research', task: { ability_id: id } });
  const result = await createRoutedTask(fixture.db, input(ability), []);
  expect((await fixture.db.query('SELECT ability_id FROM tasks WHERE id=$1', [result.task_id])).rows).toEqual([{ ability_id: ability }]);
  const count = (await fixture.db.query('SELECT COUNT(*)::int count FROM tasks')).rows[0].count;
  await expect(createRoutedTask(fixture.db, input(randomUUID()), [])).rejects.toMatchObject({ code: '23503', constraint: 'tasks_ability_id_fkey' });
  expect((await fixture.db.query('SELECT COUNT(*)::int count FROM tasks')).rows[0].count).toBe(count);
  // 当前约束ON DELETE SET NULL同样保留；历史挂片删除不能留下悬空关联。
  await fixture.db.query('DELETE FROM journey_features WHERE id=$1', [ability]);
  expect((await fixture.db.query('SELECT ability_id FROM tasks WHERE id=$1', [result.task_id])).rows).toEqual([{ ability_id: null }]);
});
