import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startCallbackFixture, stopCallbackFixture, sourceTask, callback, readTask, createTaskHttp, forwardedFeaturePatches } from '../../__tests__/helpers/callback-closure-pg.js';

// Planner/合同前段无当前合法成功链；generate/fix/evaluate 历史回执仍有消费者。
// 使用正式schema及真实createTask/路由验证兼容边，不复活冻结OKR或伪造长task_type。
let pool;
beforeAll(async () => { pool = await startCallbackFixture(); });
afterAll(stopCallbackFixture);
describe('历史 Harness callback 兼容与现役入口拒绝', () => {
  for (const taskType of ['harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_initiative']) {
    it(`旧 skill-relay ${taskType} 经真实HTTP建单拒绝，PG无落行`, async () => {
      const title = `callback-retired-${randomUUID()}`;
      const response = await createTaskHttp({ title, task_type: taskType, priority: 'P2', trigger_source: 'manual', change_kind: 'bugfix',
        payload: { harness_runtime: 'kernel-v1', orchestrator: 'skill-relay', repo: 'cecelia' } });
      expect(response.status, JSON.stringify(response.body)).toBe(400);
      expect(response.body.error).toBe('skill-relay is retired; coding mutations use Kernel Harness 2.0');
      expect((await pool.query('SELECT id FROM tasks WHERE title=$1', [title])).rows).toEqual([]);
    });
  }
  for (const taskType of ['harness_generate', 'harness_fix', 'harness_evaluate']) {
    it(`存量 ${taskType} 回执真实落终态，已取消链不能再派生任务`, async () => {
      const planner = await sourceTask('harness_planner');
      await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [planner.id]);
      const plannerBefore = await readTask(planner.id);
      const featureId = randomUUID();
      const task = await sourceTask(taskType, { payload: { planner_task_id: planner.id, feature_id: featureId, harness_mode: true } });
      const before = (await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n;
      const response = await callback(task, { verdict: 'APPROVED', summary: '历史兼容回执' });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.reason).toBe('planner_cancelled');
      const stored = await readTask(task.id);
      expect(stored.status).toBe('completed'); expect(stored.completed_at).toBeInstanceOf(Date);
      expect(stored.payload.feature_id).toBe(featureId);
      if (taskType === 'harness_evaluate') expect(stored.result.verdict).toBe('APPROVED');
      expect(await readTask(planner.id)).toEqual(plannerBefore);
      expect((await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n).toBe(before);
      expect((await pool.query('SELECT processed_at FROM callback_queue WHERE task_id=$1', [task.id])).rows.every(r => r.processed_at)).toBe(true);
    });
  }
  it('不带旧协议的新无头planner由当前执行者闸422拒绝且不落库', async () => {
    const title = `callback-retired-planner-${randomUUID()}`;
    const response = await createTaskHttp({ title, task_type: 'harness_planner', priority: 'P2' });
    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(response.body.reason_code).toBe('no_executor_for_task_type');
    expect(response.body.route).toBe('retired-harness');
    expect((await pool.query('SELECT id FROM tasks WHERE title=$1', [title])).rows).toEqual([]);
  });
  it('历史report经真实HTTP将指定Feature写为done，保留guard并使投影失效', async () => {
    const feature = (await pool.query("INSERT INTO journey_features(name,status,guard_ref,notion_synced_at) VALUES($1,'building','callback-fixture-guard',NOW()) RETURNING *", [`callback-feature-${randomUUID()}`])).rows[0];
    const task = await sourceTask('harness_report', { payload: { feature_id: feature.id } });
    const response = await callback(task, { summary: '真实报告完成' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await readTask(task.id)).status).toBe('completed');
    const stored = (await pool.query('SELECT * FROM journey_features WHERE id=$1', [feature.id])).rows[0];
    expect(stored.status).toBe('done'); expect(stored.notion_synced_at).toBeNull();
    expect(stored.guard_ref).toBe(feature.guard_ref); expect(stored.thickness).toBe(feature.thickness);
  });
  it('report缺feature_id不能写坏邻居Feature', async () => {
    const feature = (await pool.query("INSERT INTO journey_features(name,status) VALUES($1,'building') RETURNING *", [`callback-neighbor-${randomUUID()}`])).rows[0];
    const task = await sourceTask('harness_report');
    const response = await callback(task, { summary: '无Feature报告' });
    expect(response.status).toBe(200); expect((await readTask(task.id)).status).toBe('completed');
    expect((await pool.query('SELECT * FROM journey_features WHERE id=$1', [feature.id])).rows[0]).toEqual(feature);
  });
  it('有头 harness_initiative 账本回执保留 headed_manual，落真实终态且不复活无头子链', async () => {
    const task = await sourceTask('harness_initiative', { payload: { headed_manual: true } });
    const before = (await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n;
    const response = await callback(task, { summary: '有头完成，无自动派生请求' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.new_status).toBe('completed');
    const stored = await readTask(task.id);
    expect(stored.status).toBe('completed'); expect(stored.payload.headed_manual).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n).toBe(before);
  });
});


describe('未取消历史链的真实消费者边界', () => {
  async function feature() {
    return (await pool.query("INSERT INTO journey_features(name,status,thickness,guard_ref,notion_synced_at) VALUES($1,'building','thin','compat-guard',NOW()) RETURNING *", [`callback-compat-${randomUUID()}`])).rows[0];
  }
  async function taskCount() { return (await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n; }
  async function processed(task) {
    const stored = await readTask(task.id);
    expect(stored.status).toBe('completed'); expect(stored.completed_at).toBeInstanceOf(Date);
    const queue = (await pool.query('SELECT processed_at FROM callback_queue WHERE task_id=$1', [task.id])).rows;
    expect(queue.length).toBeGreaterThan(0); expect(queue.every(row => row.processed_at)).toBe(true);
    return stored;
  }
  it('合法未取消planner历史回执收口，真实createTask不能复活合同前段', async () => {
    const target = await feature();
    const task = await sourceTask('harness_planner', { payload: { feature_id: target.id } });
    const before = await taskCount();
    const response = await callback(task, { branch: 'cp-compat-planner', summary: '合法历史Planner完成' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    await processed(task);
    expect(await taskCount()).toBe(before);
    expect((await pool.query('SELECT * FROM journey_features WHERE id=$1', [target.id])).rows[0]).toEqual(target);
  });
  for (const taskType of ['harness_generate', 'harness_fix']) {
    it(`合法历史${taskType}真实委托createTask，后继evaluate保留feature与planner`, async () => {
      const planner = await sourceTask('harness_planner');
      const plannerBefore = await readTask(planner.id);
      const target = await feature();
      const task = await sourceTask(taskType, { payload: { planner_task_id: planner.id, feature_id: target.id, harness_mode: true, sprint_dir: '/tmp/callback-compat', contract_branch: 'cp-compat-contract' } });
      const before = await taskCount();
      const response = await callback(task, { pr_url: 'https://github.com/perfectuser21/cecelia/pull/999999', summary: '合法历史变更回执，进程边界隔离' });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      await processed(task);
      const next = (await pool.query("SELECT * FROM tasks WHERE task_type='harness_evaluate' AND payload->>'planner_task_id'=$1", [planner.id])).rows;
      expect(next).toHaveLength(1);
      expect(next[0].status).toBe('queued');
      expect(next[0].payload).toMatchObject({ feature_id: target.id, planner_task_id: planner.id, harness_mode: true, contract_branch: 'cp-compat-contract' });
      expect(next[0].payload.pr_url).toBe('https://github.com/perfectuser21/cecelia/pull/999999');
      expect(await taskCount()).toBe(before + 1);
      expect(await readTask(planner.id)).toEqual(plannerBefore);
      expect((await pool.query('SELECT * FROM journey_features WHERE id=$1', [target.id])).rows[0]).toEqual(target);
    });
  }
  for (const verdict of ['PASS', 'FAIL']) {
    it(`未取消evaluate ${verdict}经真实journeys路由和PG核对厚度及邻居隔离`, async () => {
      const planner = await sourceTask('harness_planner');
      const plannerBefore = await readTask(planner.id);
      const target = await feature(); const neighbor = await feature();
      const task = await sourceTask('harness_evaluate', { payload: { planner_task_id: planner.id, feature_id: target.id, harness_mode: true } });
      const before = await taskCount();
      const patchBefore = forwardedFeaturePatches.length;
      const response = await callback(task, { verdict, summary: '无PR历史评价回执' });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect((await processed(task)).result.verdict).toBe(verdict);
      const stored = (await pool.query('SELECT * FROM journey_features WHERE id=$1', [target.id])).rows[0];
      expect(stored.thickness).toBe(verdict === 'PASS' ? 'medium' : 'thin');
      expect(stored.status).toBe('building'); expect(stored.guard_ref).toBe('compat-guard');
      if (verdict === 'PASS') {
        expect(stored.notion_synced_at).toBeNull();
        expect(forwardedFeaturePatches.slice(patchBefore)).toEqual([{ path: `/api/brain/journey_features/${target.id}`, body: { thickness: 'medium' }, status: 200 }]);
      } else { expect(stored).toEqual(target); expect(forwardedFeaturePatches).toHaveLength(patchBefore); }
      expect((await pool.query('SELECT * FROM journey_features WHERE id=$1', [neighbor.id])).rows[0]).toEqual(neighbor);
      expect(await taskCount()).toBe(before); // 后继report无执行者，FAIL的fix缺现行编码合同，均不复活旧链。
      expect(await readTask(planner.id)).toEqual(plannerBefore);
    });
  }
  it('evaluate PASS缺feature_id不误写邻居', async () => {
    const planner = await sourceTask('harness_planner'); const neighbor = await feature();
    const task = await sourceTask('harness_evaluate', { payload: { planner_task_id: planner.id, harness_mode: true } });
    const patchBefore = forwardedFeaturePatches.length;
    const response = await callback(task, { verdict: 'PASS', summary: '无Feature历史评价' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await processed(task)).result.verdict).toBe('PASS');
    expect(forwardedFeaturePatches).toHaveLength(patchBefore);
    expect((await pool.query('SELECT * FROM journey_features WHERE id=$1', [neighbor.id])).rows[0]).toEqual(neighbor);
  });
  it('evaluate PASS指向不存在Feature时真实PATCH404，回执仍完成且邻居不变', async () => {
    const planner = await sourceTask('harness_planner'); const neighbor = await feature();
    const missingId = randomUUID();
    const task = await sourceTask('harness_evaluate', { payload: { planner_task_id: planner.id, feature_id: missingId, harness_mode: true } });
    const patchBefore = forwardedFeaturePatches.length;
    const response = await callback(task, { verdict: 'PASS', summary: '历史Feature不存在，回写非致命' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await processed(task)).result.verdict).toBe('PASS');
    expect(forwardedFeaturePatches.slice(patchBefore)).toEqual([{ path: `/api/brain/journey_features/${missingId}`, body: { thickness: 'medium' }, status: 404 }]);
    expect((await pool.query('SELECT * FROM journey_features WHERE id=$1', [neighbor.id])).rows[0]).toEqual(neighbor);
  });

});
