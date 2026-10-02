import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../script-managed-executor.js', () => ({
  usesManagedScript: vi.fn(), prepareManagedScript: vi.fn(), triggerManagedScript: vi.fn(),
  reapManagedScripts: vi.fn(async () => ({ reaped: 0, completed: 0, failed: 0, retried: 0 })),
}));
import { reapManagedScripts } from '../script-managed-executor.js';
import { reapScriptRuns } from '../script-executor.js';

function rows(count) {
  return Array.from({ length: count }, (_, i) => {
    const id = `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`;
    return { id, payload: { host_id: 'us-mac-m4', script_run_id: `script-${id}-a1` } };
  });
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(items) {
  return { query: vi.fn(async (_sql, params = []) => {
    const after = params[0];
    const sorted = [...items.filter(row => !after || row.id > after), ...items.filter(row => after && row.id <= after)];
    return { rows: sorted.slice(0, 10) };
  }) };
}

afterEach(() => vi.clearAllMocks());

describe('legacy收割容量与轮转', () => {
  it('最多4个SSH在途，前一个慢连接不阻塞同批其余连接', async () => {
    const callbacks = [];
    const execFileFn = vi.fn((_cmd, _args, _opts, cb) => { callbacks.push(cb); });
    const running = reapScriptRuns(fixture(rows(10)), { execFileFn });
    await flush();
    const initial = execFileFn.mock.calls.length;
    // 先清理所有测试自有pending，再断言；红测也不留下挂起调用。
    while (callbacks.length) { callbacks.shift()(null, 'NO_EXIT\n'); await flush(); }
    await running;
    expect(initial).toBe(4);
    expect(execFileFn).toHaveBeenCalledTimes(10);
    expect(execFileFn.mock.calls.every(call => call[2].timeout === 20_000)).toBe(true);
  });

  it('前10个长期运行任务不能永久饿死第11项；游标参数绑定并允许绕回', async () => {
    const items = rows(11), pool = fixture(items), seen = [];
    const execFileFn = (_cmd, args, _opts, cb) => { seen.push(args.at(-1)); cb(null, 'NO_EXIT\n'); };
    await reapScriptRuns(pool, { execFileFn });
    await reapScriptRuns(pool, { execFileFn });
    expect(seen.some(command => command.includes(items[10].payload.script_run_id))).toBe(true);
    expect(pool.query.mock.calls[1][1]).toEqual([items[9].id]);
    expect(pool.query.mock.calls[0][0]).toContain('id > $1::uuid');
    expect(seen.filter(command => command.includes(items[0].payload.script_run_id))).toHaveLength(2);
  });

  it('managed远端调用未结束仍开始legacy SSH，合并入口等待二者真实结束', async () => {
    let release;
    reapManagedScripts.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const execFileFn = vi.fn((_cmd, _args, _opts, cb) => cb(null, 'NO_EXIT\n'));
    const running = reapScriptRuns(fixture(rows(1)), { execFileFn });
    await flush();
    const legacyCalls = execFileFn.mock.calls.length;
    release({ reaped: 0, completed: 0, failed: 0, retried: 0 });
    await running;
    expect(legacyCalls).toBe(1);
  });

  it('同pool并发收割复用同一个在途lane，不重复读取或结算同task', async () => {
    let finish;
    const pool=fixture(rows(1));
    const execFileFn=vi.fn((_cmd,_args,_opts,cb)=>{ finish=cb; });
    const first=reapScriptRuns(pool,{execFileFn});
    const second=reapScriptRuns(pool,{execFileFn});
    await flush();
    expect(execFileFn).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledTimes(1);
    finish(null,'NO_EXIT\n');
    await Promise.all([first,second]);
    const next=reapScriptRuns(pool,{execFileFn});
    await flush();
    expect(execFileFn).toHaveBeenCalledTimes(2);
    finish(null,'NO_EXIT\n'); await next;
  });
});
