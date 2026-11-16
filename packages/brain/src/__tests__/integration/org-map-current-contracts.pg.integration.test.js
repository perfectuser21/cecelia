import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { privateFixtureDatabase } from '../fixtures/private-fixture-db.js';

const boundary = vi.hoisted(() => ({ db: null, raise: vi.fn(), callLLM: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => boundary.db.query(...args) } }));
vi.mock('../../llm-caller.js', () => ({ callLLM: (...args) => boundary.callLLM(...args) }));
vi.mock('../../decision-executor.js', () => ({ executeDecision: vi.fn(() => { throw Error('禁止外部动作'); }) }));
vi.mock('../../alerting.js', () => ({ raise: (...args) => boundary.raise(...args) }));
vi.mock('../../actions.js', () => ({ updateTask: vi.fn(), createTask: vi.fn() }));
vi.mock('../../quarantine.js', () => ({ handleTaskFailure: vi.fn() }));
vi.mock('../../lib/task-terminal.js', () => ({ finalizeTask: vi.fn() }));
import goals from '../../routes/task-goals.js';
import { selectNextDispatchableTask } from '../../dispatch-helpers.js';
import { collectSystemSnapshot, runHeartbeatInspection } from '../../heartbeat-inspector.js';

let fixture;
afterEach(async () => { boundary.db = null; vi.clearAllMocks(); await fixture?.close(); });
async function setup() {
  fixture = await privateFixtureDatabase('orgcurrent', db => db.query(`
    CREATE TABLE objectives(id uuid PRIMARY KEY,title text,status text,metadata jsonb,custom_props jsonb,updated_at timestamptz);
    CREATE TABLE key_results(LIKE objectives INCLUDING ALL);
    ALTER TABLE key_results ADD COLUMN progress numeric,ADD COLUMN priority text;
    CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,description text,prd_content text,status text,priority text,started_at timestamptz,updated_at timestamptz,payload jsonb DEFAULT '{}',queued_at timestamptz,task_type text,created_at timestamptz DEFAULT now(),metadata jsonb,project_id uuid,goal_id uuid,claimed_by text);
    CREATE TABLE task_dependencies(from_task_id uuid,to_task_id uuid,edge_type text);
    CREATE TABLE harness_gap_dependencies(source_task_id uuid,status text);
    CREATE TABLE cecelia_events(event_type text,created_at timestamptz DEFAULT now());
    CREATE TABLE pending_actions(status text,expires_at timestamptz);
  `));
  boundary.db = fixture.createPool(5);
}
it.each(['objectives', 'key_results'])('%s真实PATCH把NULL metadata变成JSON并保留既有字段', async table => {
  await setup();
  const ids = [randomUUID(), randomUUID()];
  await fixture.db.query(`INSERT INTO ${table}(id,title,metadata) VALUES($1,'NULL',NULL),($2,'已有','{"keep":1,"update":"before"}')`, ids);
  const app = express().use(express.json()).use('/goals', goals);
  for (const id of ids) {
    const response = await request(app).patch(`/goals/${id}`).send({ metadata: { update: 'after', evidence: 'current-contract' } });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }
  expect((await fixture.db.query(`SELECT metadata FROM ${table} WHERE id=$1`, [ids[0]])).rows[0].metadata).toEqual({ update: 'after', evidence: 'current-contract' });
  expect((await fixture.db.query(`SELECT metadata FROM ${table} WHERE id=$1`, [ids[1]])).rows[0].metadata).toEqual({ keep: 1, update: 'after', evidence: 'current-contract' });
});
it('真实selector只取到期/空排期任务，未来最高优先级任务也不提前派', async () => {
  await setup();
  const future = randomUUID(), past = randomUUID(), empty = randomUUID(), unscheduled = randomUUID();
  await fixture.db.query(`INSERT INTO tasks(id,title,status,priority,task_type,payload) VALUES
    ($1,'未来','queued','P0','qiumi_task',jsonb_build_object('next_run_at',(NOW()+interval '1 day')::text)),
    ($2,'到期','queued','P1','qiumi_task',jsonb_build_object('next_run_at',(NOW()-interval '1 day')::text)),
    ($3,'空值','queued','P2','qiumi_task','{"next_run_at":""}'),($4,'未排期','queued','P2','qiumi_task','{}')`, [future, past, empty, unscheduled]);
  expect((await selectNextDispatchableTask(null, [], { onlyTaskTypes: ['qiumi_task'] })).id).toBe(past);
  const remaining = [];
  for (let index = 0; index < 3; index++) {
    const selected = await selectNextDispatchableTask(null, [past, ...remaining], { onlyTaskTypes: ['qiumi_task'] });
    if (selected) remaining.push(selected.id);
  }
  expect(remaining.sort()).toEqual([empty, unscheduled].sort());
  await fixture.db.query("UPDATE tasks SET payload=jsonb_build_object('next_run_at',(NOW()-interval '1 second')::text) WHERE id=$1", [future]);
  expect((await selectNextDispatchableTask(null, [], { onlyTaskTypes: ['qiumi_task'] })).id).toBe(future);
});
it('真实snapshot计数现役Objective；零目标巡检触发mock P0，非零不触发', async () => {
  await setup();
  boundary.callLLM.mockResolvedValue({ text: '{"action":"no_action"}' });
  const active = randomUUID();
  await fixture.db.query("INSERT INTO objectives(id,title,status) VALUES($1,'现役','in_progress'),($2,'完成','completed'),($3,'规划','planned')", [active, randomUUID(), randomUUID()]);
  expect((await collectSystemSnapshot(boundary.db)).active_goals).toBe(1);
  expect(await runHeartbeatInspection(boundary.db)).toMatchObject({ skipped: false });
  expect(boundary.raise).not.toHaveBeenCalled();
  await fixture.db.query("UPDATE objectives SET status='completed' WHERE id=$1", [active]);
  expect((await collectSystemSnapshot(boundary.db)).active_goals).toBe(0);
  expect(await runHeartbeatInspection(boundary.db)).toMatchObject({ skipped: false });
  expect(boundary.raise).toHaveBeenCalledTimes(1);
  expect(boundary.raise.mock.calls[0].slice(0, 2)).toEqual(['P0', 'heartbeat_active_goals_zero']);
});
