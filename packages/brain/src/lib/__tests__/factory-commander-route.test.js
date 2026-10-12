import express from 'express';
import request from 'supertest';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock('../../db.js', () => ({ default: db }));
import router from '../../routes/factory-ledger.js';
/** 正向合成夹具，不代表生产已成功。
 * 字段来源：zenithjoy 89314cd21db6835a7c4a310210817bfe77940304
 * services/phone-adb-controller/commander/wf-agent-lib.py assemble()：
 * activity 文件名为 <run>-<key>-original.json；final_evidence 是无扩展名的系统证据 ID。
 * Brain lib/workflow-commander-dispatch.js 收割 receipt.exit 与 commander_result.launch_exit。
 * 实际失败任务 c3b13fe4-cc02-4139-abd3-da1df053ca86 delivery/receipt 已核形状：
 * launch_exit=0 只表示外壳启动成功，必须另核 status、业务退出与完整系统证据。
 * run-verify 核验合同另行校验；真实数据库语义见对应 PG 集成测试。
 */
function commanderProofFixture() {
  const taskId = '80000000-0000-4000-8000-000000000001';
  const verifyId = '80000000-0000-4000-8000-000000000002';
  const runId = 'wfd-80000000-1791784544616';
  const task = { id: taskId, task_type: 'workflow_dispatch', status: 'completed',
    payload: { workflow_key: 'douyin_video_publish.android', run_id: runId, acceptance_run: true },
    result: { receipt: { exit: 0 }, commander_result: { status: 'completed', launch_exit: 0 },
      delivery: { source: 'wf-agent-run', task_id: taskId, run_id: runId, workflow_key: 'douyin_video_publish.android', contract_key: 'douyin_video_publish',
        claimed_result: 'success', lock_released: true, readback: { publish_attempts: 1, lock_status: 'free' },
        shell: { preflight: { ok: true, lock_acquired: true }, cleanup: { ok: true, app_closed: true, lock_status: 'free', outward_attempts: 1 } },
        agent: { exit: '0', delivery_found: true },
        final_evidence: ['lock-acquire', 'lock-release', 'outward-ledger'].map(key => `${runId}-${key}`),
        activities: ['preflight', 'prepare', 'publish', 'verify', 'cleanup'].map(key => ({ key,
          by: ['preflight','cleanup'].includes(key) ? 'shell' : 'agent',
          readback: { type: 'evidence', glob: `*${key}*original.json`, expect: { op: '>=', value: 1 } },
          evidence_files: [`${runId}-${key}-original.json`] })),
      },
      factory_judge: { state: 'final', verdict: 'pass', run_id: runId, code: { verdict: 'pass' }, visual: { verdict: 'pass' }, verify_task_id: verifyId },
    } };
  const verificationTask = { id: verifyId, status: 'completed', payload: { skill: 'run-verify' }, result: {
    actor: 'Codex/independent-verifier', verification: { stage: 'verify', run_id: runId, verdict: 'pass', overreach: '无', missing: [],
      claimed_result: 'success', agrees_with_claim: true, assertions: [{ claim: '私密作品与单次动作符合冻结验收', result: 'pass', basis: `${runId}-verify-original.json 原图与系统账` }] },
  } };
  return { taskId, runId, task, verificationTask, reaped: { run_id: runId, status: 'completed', exit: 0, delivery: 'shell' } };
}


const app = express();
app.use(express.json());
app.use('/api/brain', router);
const path = '/api/brain/factory/commander-route';
beforeEach(() => {
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'fixture-internal-token');
  db.query.mockReset().mockResolvedValue({ rows: [] });
  db.connect.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('工厂开关 HTTP 入口', () => {
  it('GET 返回真实默认关闭', async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(false);
  });
  it('未经内部认证不可写', async () => {
    expect((await request(app).put(path).send({ enabled: false, actor: 'operator', reason: '关闭' })).status).toBe(401);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it.each([{ enabled: 'false', actor: 'operator', reason: '关闭' }, { enabled: true, actor: 'operator', reason: '开启', evidence_task_id: ['80000000-0000-4000-8000-000000000001'] }, { enabled: false, actor: 'operator', reason: '关闭', key: 'arbitrary_config' }])('严格输入在进库前拒绝 %j', async body => {
    const response = await request(app).put(path).set('Authorization', 'Bearer fixture-internal-token').send(body);
    expect(response.status).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });
  it.each(['success', 'judge-fail', 'audit-fail'])('HTTP %s 保留真实证据门禁、回读和错误状态', async mode => {
    const fixture = commanderProofFixture();
    if (mode === 'judge-fail') fixture.task.result.factory_judge.verdict = 'fail';
    let config;
    const client = { release: vi.fn(), query: vi.fn(async (sql, params = []) => {
      if (sql.startsWith('SELECT value')) return { rows: config ? [config] : [] };
      if (sql.includes('SELECT id,task_type')) return { rows: [fixture.task] };
      if (sql.includes('SELECT id,status,payload')) return { rows: [fixture.verificationTask] };
      if (sql.includes('SELECT payload FROM task_events')) return { rows: [{ payload: fixture.reaped }] };
      if (sql.includes('INSERT INTO brain_config')) config = { value: params[1], metadata: params[2] };
      if (sql.includes('INSERT INTO cecelia_events') && mode === 'audit-fail') throw new Error('audit storage unavailable');
      return { rows: [] };
    }) };
    db.connect.mockResolvedValue(client);
    const response = await request(app).put(path).set('Authorization', 'Bearer fixture-internal-token')
      .send({ enabled: true, actor: 'Codex/operator', reason: '核验通过', evidence_task_id: fixture.taskId });
    expect(response.status).toBe(mode === 'success' ? 200 : mode === 'judge-fail' ? 409 : 500);
    if (mode === 'success') expect(response.body).toMatchObject({ enabled: true, changed: true, metadata: { verification_task_id: fixture.verificationTask.id } });
    else expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
