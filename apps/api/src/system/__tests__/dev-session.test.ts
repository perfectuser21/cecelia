import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DevSession, SessionSummary } from '../dev-session.js';
import { createSystemApiFixture, type SystemApiFixture } from './helpers/system-api-fixture.js';

type JsonSession = Omit<DevSession, 'started_at' | 'completed_at' | 'summary'> & {
  started_at: string;
  completed_at: string;
  summary: SessionSummary;
};
interface SessionBody {
  success: boolean;
  session_id: string;
  session: JsonSession;
  sessions: JsonSession[];
  count: number;
  summary: SessionSummary;
}
let api: SystemApiFixture<SessionBody>;
beforeAll(async () => { api = await createSystemApiFixture<SessionBody>(); });
afterAll(async () => { await api?.close(); });
beforeEach(async () => { await api.reset(); });

async function create(overrides: Record<string, string> = {}) {
  const response = await api.json('/dev-session', { branch: 'cp-api-test', prd_path: '.prd-test.md', project: '测试项目', ...overrides });
  expect(response.status).toBe(201);
  const data = await response.json();
  expect(data.success).toBe(true);
  expect(data.session.session_id).toMatch(/^dev_\d{8}_\d{6}_[a-z0-9]{6}$/);
  return data.session;
}
async function stored(key: string) {
  const { rows } = await api.pool.query('SELECT layer,category,value FROM memory_entries WHERE key=$1', [key]);
  expect(rows).toHaveLength(1);
  return rows[0];
}
async function steppedSession() {
  const session = await create();
  const add = await api.json(`/dev-session/${session.session_id}/step`, { step_number: 1, name: '实现接口' });
  expect(add.status).toBe(200);
  const complete = await api.json(`/dev-session/${session.session_id}/step/1/complete`, { artifacts: { files_touched: ['src/api.ts', 'src/api.ts'], scripts_run: ['npm test'] } });
  expect(complete.status).toBe(200);
  return session;
}

describe('Dev Session API — 真实路由与 episodic 持久化', () => {
  it('generate-id 返回有效 session ID', async () => {
    const response = await api.request('/dev-session/generate-id');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.session_id).toMatch(/^dev_\d{8}_\d{6}_[a-z0-9]{6}$/);
  });

  it('连续生成不同 session ID', async () => {
    const first = await (await api.request('/dev-session/generate-id')).json();
    const second = await (await api.request('/dev-session/generate-id')).json();
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.session_id).not.toBe(second.session_id);
  });

  it('创建 running 会话，并在数据库保留分支、PRD与项目', async () => {
    const session = await create();
    expect(session).toMatchObject({ branch: 'cp-api-test', prd_path: '.prd-test.md', project: '测试项目', status: 'running', steps: [] });
    expect(await stored(`dev_session_${session.session_id}`)).toEqual({ layer: 'episodic', category: 'event', value: session });
  });

  it('缺少必填字段返回 400，不写入会话', async () => {
    const response = await api.json('/dev-session', { branch: 'cp-api-test' });
    expect(response.status).toBe(400);
    expect((await response.json()).success).toBe(false);
    expect((await api.pool.query('SELECT key FROM memory_entries')).rows).toEqual([]);
  });

  it('允许合法自定义 session ID，并使用相同身份存储', async () => {
    const session = await create({ session_id: 'dev_20261101_090000_custom' });
    expect(session.session_id).toBe('dev_20261101_090000_custom');
    expect((await stored('dev_session_dev_20261101_090000_custom')).value.session_id).toBe(session.session_id);
  });

  it('查询会话实际按 project/status 筛选并遵守 limit', async () => {
    const running = await create({ project: '目标项目' });
    const failed = await create({ project: '目标项目' });
    expect((await api.json(`/dev-session/${failed.session_id}/complete`, { status: 'failed' })).status).toBe(200);
    await create({ project: '其他项目' });
    const response = await api.request(`/dev-session?project=${encodeURIComponent('目标项目')}&status=running&limit=1`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(1);
    expect(data.sessions.map((session: { session_id: string }) => session.session_id)).toEqual([running.session_id]);
  });

  it('按 ID 返回指定会话，而非其他会话', async () => {
    const first = await create({ branch: 'cp-first' });
    await create({ branch: 'cp-second' });
    const response = await api.request(`/dev-session/${first.session_id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, session: first });
  });

  it('有效格式但不存在的会话返回 404', async () => {
    const response = await api.request('/dev-session/dev_20260101_000000_fakeid');
    expect(response.status).toBe(404);
    expect((await response.json()).success).toBe(false);
  });

  it('三个质量门全部成功才持久化 all_passed=true', async () => {
    const session = await create();
    const response = await api.json(`/dev-session/${session.session_id}/quality-gates`, { qa_decision: true, audit_pass: true, gate_file: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, quality_gates: { qa_decision: true, audit_pass: true, gate_file: true, all_passed: true } });
    expect((await stored(`dev_session_${session.session_id}`)).value.quality_gates.all_passed).toBe(true);
  });

  it('任一个质量门失败必须持久化 all_passed=false', async () => {
    const session = await create();
    const response = await api.json(`/dev-session/${session.session_id}/quality-gates`, { qa_decision: true, audit_pass: false, gate_file: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, quality_gates: { all_passed: false, audit_pass: false } });
    expect((await stored(`dev_session_${session.session_id}`)).value.quality_gates.all_passed).toBe(false);
  });

  it('summary 聚合真实步骤产物、去重文件并统计完成数', async () => {
    const session = await steppedSession();
    const response = await api.json(`/dev-session/${session.session_id}/summary`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.summary).toMatchObject({ files_modified: ['src/api.ts'], scripts_executed: ['npm test'], total_steps: 1, completed_steps: 1 });
    expect(data.summary.next_steps).toHaveLength(3);
    expect(data.summary.duration_ms).toBeGreaterThanOrEqual(0);
    expect(data.summary.commit_hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('summary 实际写入 episodic memory 并保留 session 回链', async () => {
    const session = await steppedSession();
    const data = await (await api.json(`/dev-session/${session.session_id}/summary`)).json();
    expect(data.success).toBe(true);
    const entry = await stored(`summary_${session.session_id}`);
    expect(entry).toMatchObject({ layer: 'episodic', category: 'event', value: { session_id: session.session_id, project: '测试项目', branch: 'cp-api-test', status: 'running', summary: data.summary } });
    expect((await stored(`dev_session_${session.session_id}`)).value.summary).toEqual(data.summary);
  });

  it('complete 持久化 completed、完成时间、汇总与 PR URL', async () => {
    const session = await create();
    const response = await api.json(`/dev-session/${session.session_id}/complete`, { status: 'completed', pr_url: 'https://github.com/test/repo/pull/123' });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.session.status).toBe('completed');
    expect(data.session.summary.pr_url).toBe('https://github.com/test/repo/pull/123');
    expect(Date.parse(data.session.completed_at)).toBeGreaterThanOrEqual(Date.parse(data.session.started_at));
    expect((await stored(`dev_session_${session.session_id}`)).value).toEqual(data.session);
  });

  it('失败完成会话实际持久化 failed，并产生失败复盘汇总', async () => {
    const session = await create();
    const response = await api.json(`/dev-session/${session.session_id}/complete`, { status: 'failed' });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.session.status).toBe('failed');
    expect(data.session.summary.next_steps).toHaveLength(2);
    expect((await stored(`dev_session_${session.session_id}`)).value.status).toBe('failed');
    expect((await stored(`summary_${session.session_id}`)).value.status).toBe('failed');
  });
});
