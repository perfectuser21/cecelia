import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPhoneRpaDispatch, resetPhoneRpaDispatchForTest } from '../phone-rpa-dispatch.js';

const since = '2026-10-08T00:00:00.000Z';
const config = { enabled: true, since, devices: ['小蓝'] };
const phone = (agent = 'skill-factory', device = '小蓝') => ({
  id: 'phone', task_type: 'qiumi_task', status: 'queued', claimed_by: null,
  created_at: '2026-10-08T00:01:00.000Z',
  payload: { source: 'notion_gtd', headed_manual: false, notion_zh_page_id: '3f3c40c2-ba63-8194-96ae-efed0d406431', qiumi_source: {
    body: `【执行参数】\n执行Agent：${agent}\n设备：${device}\n【执行参数结束】\n读取抖音账号`,
  } },
});
function fixture(tasks, configuration = config) {
  const query = vi.fn(async (sql) => ({ rows: sql.includes('FROM working_memory')
    ? [{ value_json: configuration }] : sql.includes('FROM phone_registry')
      ? [{ serial: 'blue', nickname: '小蓝', enabled: true }] : tasks }));
  const dispatch = vi.fn(async () => ({ status: 202, body: { execution_state: 'accepted' } }));
  return { pool: { query }, deps: { dispatch, now: () => Date.parse('2026-10-08T00:10:00.000Z'), anchor: () => ({ blocked: false }) }, dispatch };
}
beforeEach(resetPhoneRpaDispatchForTest);
describe('phone-rpa-dispatch：关闭全局 Tick 也只接显式授权的新手机任务', () => {
  it('独立启用后只派 skill-factory + 白名单设备，不接开发/普通/人工任务或旧任务', async () => {
    const old = { ...phone(), id: 'old', created_at: '2026-10-07T00:00:00.000Z' };
    const headed = phone(); headed.payload.headed_manual = true;
    const otherSource = phone(); otherSource.payload.source = 'api';
    const claimed = { ...phone(), claimed_by: 'someone' };
    const blocked = { ...phone(), status: 'blocked' };
    const f = fixture([phone('dev'), phone('main'), phone('skill-factory', '小黄'), old, headed,
      otherSource, claimed, blocked, { ...phone(), task_type: 'dev' }, phone()]);
    expect(await runPhoneRpaDispatch(f.pool, f.deps)).toMatchObject({ dispatched: 1 });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
    expect(f.dispatch.mock.calls[0][0].payload.qiumi_source.body).toContain('执行Agent：skill-factory');
  });
  it.each([{}, { ...config, enabled: false }, { ...config, since: 'invalid' },
    { ...config, since: '2027-01-01T00:00:00Z' }, { ...config, devices: [] }])('配置无授权/错误时不查队列、不派发：%j', async (c) => {
    const f = fixture([phone()], c);
    expect(await runPhoneRpaDispatch(f.pool, f.deps)).toMatchObject({ dispatched: 0 });
    expect(f.pool.query).toHaveBeenCalledTimes(1);
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('执行前重读开关，关闭后不继续派发', async () => {
    const f = fixture([phone()]); let reads = 0;
    f.pool.query.mockImplementation(async (sql) => ({ rows: sql.includes('FROM working_memory')
      ? [{ value_json: ++reads === 1 ? config : { ...config, enabled: false } }]
      : sql.includes('FROM phone_registry') ? [{ serial: 'blue', nickname: '小蓝', enabled: true }] : [phone()] }));
    await runPhoneRpaDispatch(f.pool, f.deps);
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('保留锚点闸与到期条件；未来任务和锚点阻断不能执行', async () => {
    const f = fixture([{ ...phone(), next_run_at: '2026-10-08T01:00:00Z' }, phone()]);
    f.deps.anchor = () => ({ blocked: true });
    await runPhoneRpaDispatch(f.pool, f.deps);
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('配置中的设备不存在或昵称重复，不能派发', async () => {
    const f = fixture([phone()], { ...config, devices: ['未知手机'] });
    expect(await runPhoneRpaDispatch(f.pool, f.deps)).toMatchObject({ skipped: 'unknown_or_ambiguous_device', dispatched: 0 });
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it('路由耗时期间关闭开关或移除设备，启动守卫拒绝启动', async () => {
    for (const changed of [{ ...config, enabled: false }, { ...config, devices: ['小黄'] }]) {
      resetPhoneRpaDispatchForTest();
      const f = fixture([phone()]); let reads = 0;
      f.pool.query.mockImplementation(async (sql) => ({ rows: sql.includes('FROM working_memory')
        ? [{ value_json: ++reads < 3 ? config : changed }] : sql.includes('FROM phone_registry')
          ? [{ serial: 'blue', nickname: '小蓝', enabled: true }, { serial: 'yellow', nickname: '小黄', enabled: true }] : [phone()] }));
      f.dispatch.mockImplementation(async (task, _pool, deps) => {
        const current = { ...task, claimed_by: 'our-owner', payload: { ...task.payload,
          qiumi_department: 'skill-factory', qiumi_route: { device_hint: { serial: 'blue' } } } };
        expect(await deps.beforeStart(current)).toBe(false);
        return { status: 409 };
      });
      expect(await runPhoneRpaDispatch(f.pool, f.deps)).toMatchObject({ dispatched: 0 });
      expect(f.dispatch).toHaveBeenCalledTimes(1);
    }
  });
  it.each([{ serial: 'yellow', nickname: '小黄' }, { serial: 'blue', nickname: '小黄' }])('两台均获授权时，缓存错误设备也不能启动：%j', async (hint) => {
    const f = fixture([phone()], { ...config, devices: ['小蓝', '小黄'] });
    f.pool.query.mockImplementation(async (sql) => ({ rows: sql.includes('FROM working_memory')
      ? [{ value_json: { ...config, devices: ['小蓝', '小黄'] } }] : sql.includes('FROM phone_registry')
        ? [{ serial: 'blue', nickname: '小蓝', enabled: true }, { serial: 'yellow', nickname: '小黄', enabled: true }] : [phone()] }));
    f.dispatch.mockImplementation(async (task, _pool, deps) => {
      expect(await deps.beforeStart({ ...task, claimed_by: 'our-owner', payload: { ...task.payload,
        qiumi_department: 'skill-factory', qiumi_route: { device_hint: hint } } })).toBe(false);
      return { status: 409 };
    });
    expect(await runPhoneRpaDispatch(f.pool, f.deps)).toMatchObject({ dispatched: 0 });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
  it('同一轮仍在派发时不重入；未知派发不重新启动原任务', async () => {
    const f = fixture([phone()]); let finish;
    f.dispatch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = runPhoneRpaDispatch(f.pool, f.deps);
    await vi.waitFor(() => expect(f.dispatch).toHaveBeenCalledTimes(1));
    expect(await runPhoneRpaDispatch(f.pool, f.deps)).toMatchObject({ dispatched: 0 });
    finish({ status: 202, body: { execution_state: 'unknown' } });
    expect(await first).toMatchObject({ dispatched: 1 });
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });
});
