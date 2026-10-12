import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { taskLeaseFixture, seedTask } from '../helpers/task-lease-pg-fixture.js';
import { readFactoryCommanderRoute, updateFactoryCommanderRoute } from '../../lib/factory-commander-route.js';

let fx, taskId, verifyId, runId, delivery;
const body = extra => ({ enabled: true, actor: 'Codex/operator', reason: '独立核验通过后切换', evidence_task_id: taskId, ...extra });
beforeEach(async () => {
  fx = await taskLeaseFixture();
  await fx.pool.query(`CREATE TABLE brain_config(key TEXT PRIMARY KEY,value TEXT,metadata JSONB,updated_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE cecelia_events(id UUID DEFAULT gen_random_uuid(),event_type TEXT,source TEXT,payload JSONB,created_at TIMESTAMPTZ DEFAULT now());`);
  taskId = await seedTask(fx.pool, { status: 'completed', task_type: 'workflow_dispatch' });
  runId = 'wfd-' + taskId.slice(0, 8) + '-1791784544616';
  delivery = {
    source: 'wf-agent-run', task_id: taskId, run_id: runId,
    workflow_key: 'douyin_video_publish.android', contract_key: 'douyin_video_publish',
    claimed_result: 'success', fail_reason: null, lock_released: true,
    readback: { publish_attempts: 1, lock_status: 'free' },
    shell: { preflight: { ok: true, lock_acquired: true, account_verified: false }, cleanup: { ok: true, app_closed: true, lock_status: 'free', outward_attempts: 1 } },
    agent: { exit: '0', delivery_found: true },
    final_evidence: ['lock-acquire', 'lock-release', 'outward-ledger'].map(key => `${runId}-${key}`),
    activities: ['preflight', 'prepare', 'publish', 'verify', 'cleanup'].map(key => ({ key, by: ['preflight','cleanup'].includes(key) ? 'shell' : 'agent', readback: { type: 'evidence', glob: `*${key}*original.json`, expect: { op: '>=', value: 1 } }, evidence_files: [`${runId}-${key}-original.json`] })),
  };
  await fx.pool.query('UPDATE tasks SET payload=$2,result=$3 WHERE id=$1', [taskId,
    { workflow_key: delivery.workflow_key, run_id: runId, acceptance_run: true },
    { delivery, receipt: { exit: 0 }, commander_result: { status: 'completed', launch_exit: 0 } }]);
  await fx.pool.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'workflow_dispatch_reaped',$2)", [taskId, { run_id: runId, delivery: 'shell', status: 'completed', exit: 0 }]);
  verifyId = await seedTask(fx.pool, { status: 'completed', payload: { skill: 'run-verify', factory_verify_of: taskId, factory_verify_run_id: runId } });
  await fx.pool.query('UPDATE tasks SET result=$2 WHERE id=$1', [verifyId, {
    actor: 'Codex/independent-verifier', verification: { stage: 'verify', run_id: runId, verdict: 'pass',
      assertions: [{ claim: '账号、私密作品增量、标题日期与单次动作均成立', result: 'pass', basis: `${runId}-verify-original.json 与原图/XML/系统动作账逐项核对` }],
      overreach: '无', missing: [], claimed_result: 'success', agrees_with_claim: true },
  }]);
});
afterEach(async () => { if (fx) await fx.close(); fx = null; });

async function setDelivery(change) {
  change(delivery);
  await fx.pool.query("UPDATE tasks SET result=jsonb_set(result,'{delivery}',$2) WHERE id=$1", [taskId, delivery]);
}
const eventCount = async () => Number((await fx.pool.query('SELECT count(*) FROM cecelia_events')).rows[0].count);

describe.sequential('固定工厂开关：真实 PG 证据与事务', () => {
  it('默认关闭；完整系统交付+正式独立核验才能开启，并数据库回读与审计', async () => {
    expect((await readFactoryCommanderRoute(fx.pool)).enabled).toBe(false);
    const result = await updateFactoryCommanderRoute(fx.pool, body());
    expect(result).toMatchObject({ enabled: true, changed: true, previous_enabled: false });
    expect(result.metadata).toMatchObject({ actor: 'Codex/operator', evidence_task_id: taskId, verification_task_id: verifyId, run_id: runId });
    expect((await readFactoryCommanderRoute(fx.pool)).enabled).toBe(true);
    const event = (await fx.pool.query('SELECT payload FROM cecelia_events')).rows[0].payload;
    expect(event).toMatchObject({ previous_enabled: false, enabled: true, evidence_task_id: taskId, actor: 'Codex/operator' });
  });
  it('重复与并发开启幂等，只有一次变更事件', async () => {
    const results = await Promise.all([updateFactoryCommanderRoute(fx.pool, body()), updateFactoryCommanderRoute(fx.pool, body())]);
    expect(results.filter(result => result.changed)).toHaveLength(1);
    expect(await eventCount()).toBe(1);
  });
  it('关闭只需明确actor/reason，原证据保留在历史事件', async () => {
    await updateFactoryCommanderRoute(fx.pool, body());
    expect(await updateFactoryCommanderRoute(fx.pool, { enabled: false, actor: 'Codex/operator', reason: "回退 ' 不拼SQL" })).toMatchObject({ enabled: false, previous_enabled: true });
    expect(await eventCount()).toBe(2);
  });
  it.each([{ enabled: 'true' }, { actor: '' }, { reason: '' }, { key: 'unrelated' }, { evidence_task_id: 'bad' }])('非法输入拒绝且不落配置/事件 %j', async invalid => {
    await expect(updateFactoryCommanderRoute(fx.pool, body(invalid))).rejects.toMatchObject({ status: 400 });
    expect((await readFactoryCommanderRoute(fx.pool)).enabled).toBe(false);
    expect(await eventCount()).toBe(0);
  });
  it.each(['source', 'run', 'task', 'cleanup', 'outward', 'activity'])('只有自报success，%s系统证据不符仍拒绝', async mode => {
    await setDelivery(d => {
      if (mode === 'source') d.source = 'reaper_synthesized';
      if (mode === 'run') d.run_id = 'different-run';
      if (mode === 'task') d.task_id = verifyId;
      if (mode === 'cleanup') d.shell.cleanup.ok = false;
      if (mode === 'outward') d.shell.cleanup.outward_attempts = 2;
      if (mode === 'activity') d.activities = d.activities.filter(a => a.key !== 'publish');
    });
    await expect(updateFactoryCommanderRoute(fx.pool, body())).rejects.toMatchObject({ status: 409 });
    expect(await eventCount()).toBe(0);
  });
  it('缺Brain实际shell收割事件不能开启', async () => {
    await fx.pool.query('DELETE FROM task_events');
    await expect(updateFactoryCommanderRoute(fx.pool, body())).rejects.toMatchObject({ status: 409 });
  });
  it.each(['missing', 'foreign-run', 'unknown', 'no-actor'])('独立核验%s不能开启', async mode => {
    if (mode === 'missing') await fx.pool.query('DELETE FROM tasks WHERE id=$1', [verifyId]);
    else {
      const result = (await fx.pool.query('SELECT result FROM tasks WHERE id=$1', [verifyId])).rows[0].result;
      if (mode === 'foreign-run') result.verification.run_id = 'another';
      if (mode === 'unknown') result.verification.assertions[0].result = 'unknown';
      if (mode === 'no-actor') delete result.actor;
      await fx.pool.query('UPDATE tasks SET result=$2 WHERE id=$1', [verifyId, result]);
    }
    await expect(updateFactoryCommanderRoute(fx.pool, body())).rejects.toMatchObject({ status: 409 });
  });
  it('审计写失败必须回滚配置', async () => {
    await fx.pool.query("ALTER TABLE cecelia_events ADD CONSTRAINT force_failure CHECK(event_type='never')");
    await expect(updateFactoryCommanderRoute(fx.pool, body())).rejects.toThrow();
    expect((await readFactoryCommanderRoute(fx.pool)).enabled).toBe(false);
  });
});
