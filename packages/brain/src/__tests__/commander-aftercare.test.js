import { describe, it, expect } from 'vitest';

let finishEscortAftercare;
try { ({ finishEscortAftercare } = await import('../commander-aftercare.js')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

const id = '11111111-2222-4333-8444-555555555555';
const context = () => ({ tag: 'cmd-test', host: 'fixture-host', escortId: id,
  nonce: 'unique-finalize-token', finalized: true, requestedAt: '2026-10-02T03:00:00.000Z' });
const receipt = (ctx) => ({ schema_version: 1, run_tag: ctx.tag, host: ctx.host,
  escort_id: ctx.escortId, nonce: ctx.nonce, finalize_verified: true,
  status: 'completed', actor: 'work-commander', at: '2026-10-02T03:00:01.000Z',
  facts: ['真实终态已读回'], evidence: ['/receipt.json'] });
const tickWindow = { lastRunAtMs: Date.parse('2026-10-02T03:00:00.000Z'), lastDurationMs: 2000 };

function fixture() {
  const ctx = context(), events = []; let time = 0, ack = null, busy = true, enabled = true;
  const deps = {
    now: () => time, timeoutMs: 100, pollMs: 10,
    sleep: async (ms) => { time += ms; },
    readJobs: async () => [{ id, name: `escort-${ctx.host}-${ctx.tag}`, schedule: { kind: 'every' }, enabled, state: { ...tickWindow, runningAtMs: busy ? 1 : undefined, lastRunStatus: 'ok' } }],
    readReceipt: async () => ack,
    requestTick: async () => { events.push('request'); },
    recordAftercare: async () => { events.push('record'); },
    quiesceJob: async () => { enabled = false; events.push('disable'); },
    removeJob: async () => { events.push('remove'); },
  };
  return { ctx, deps, events, setAck: (v) => { ack = v; }, setBusy: (v) => { busy = v; } };
}
async function run(f) {
  expect(typeof finishEscortAftercare, '必须提供通用售后后下岗协调器').toBe('function');
  return finishEscortAftercare(f.ctx, f.deps);
}

describe('Commander finalize→售后证据→tick结束→下岗', () => {
  it('已有售后回执但tick仍运行：不取消当前tick，超时保留陪跑', async () => {
    const f = fixture(); f.setAck(receipt(f.ctx));
    expect((await run(f)).status).toBe('retained');
    expect(f.events).not.toContain('remove');
  });
  it('tick空闲但未写售后：只请求一次末轮，不把入队当售后成功', async () => {
    const f = fixture(); f.setBusy(false);
    expect((await run(f)).status).toBe('retained');
    expect(f.events).toEqual(['request']);
  });
  it('当前tick结束后请求末轮；售后完成且末轮退出才记账注销', async () => {
    const f = fixture();
    f.deps.sleep = async () => { f.setBusy(false); };
    f.deps.requestTick = async () => { f.events.push('request'); f.setAck(receipt(f.ctx)); };
    expect((await run(f)).status).toBe('retired');
    expect(f.events).toEqual(['request', 'record', 'disable', 'remove']);
  });
  it('非本run或旧nonce的售后文件不能允许下岗', async () => {
    const f = fixture(); f.setBusy(false); f.setAck({ ...receipt(f.ctx), nonce: 'previous-run' });
    expect((await run(f)).status).toBe('retained');
    expect(f.events).not.toContain('remove');
  });
  it('Brain售后留痕失败：不注销', async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    f.deps.recordAftercare = async () => { throw Error('brain unavailable'); };
    expect((await run(f)).status).toBe('retained');
    expect(f.events).not.toContain('remove');
  });
  it('记账期间tick重新运行：二次身份/在途核验阻止删除', async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    f.deps.recordAftercare = async () => { f.events.push('record'); f.setBusy(true); };
    expect((await run(f)).status).toBe('retained');
    expect(f.events).not.toContain('remove');
  });
  it('同名重名或网关读不到：不猜ID、不发末轮、不删除', async () => {
    for (const jobs of [null, [{ id, name: 'escort-fixture-host-cmd-test', state: {} },
      { id: 'other', name: 'escort-fixture-host-cmd-test', state: {} }]]) {
      const f = fixture(); f.deps.readJobs = async () => jobs;
      expect((await run(f)).status).toBe('retained');
      expect(f.events).toEqual([]);
    }
  });
  it('未确认finalize：没有售后或注销副作用', async () => {
    const f = fixture(); f.ctx.finalized = false;
    expect((await run(f)).status).toBe('retained');
    expect(f.events).toEqual([]);
  });
  it('网关禁用未生效：不能在list与rm间让周期tick抢跑', async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    f.deps.quiesceJob = async () => {};
    expect((await run(f)).status).toBe('retained');
    expect(f.events).not.toContain('remove');
  });
  it('运输未中断抢跑tick时，等成功结束才删', async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    const disable = f.deps.quiesceJob;
    f.deps.quiesceJob = async () => { await disable(); f.setBusy(true); };
    f.deps.sleep = async () => { expect(f.events).not.toContain('remove'); f.setBusy(false); };
    expect((await run(f)).status).toBe('retired');
    expect(f.events).toEqual(['record', 'disable', 'remove']);
  });
  it('运输禁用取消了抢跑tick：error状态必须保留，不能伪记成功下岗', async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    const read = f.deps.readJobs, disable = f.deps.quiesceJob; let cancelled = false;
    f.deps.quiesceJob = async () => { await disable(); cancelled = true; };
    f.deps.readJobs = async () => (await read()).map(job => cancelled
      ? { ...job, state: { lastRunStatus: 'error', lastError: 'Cron job disabled by operator.' } } : job);
    expect(await run(f)).toEqual({ status: 'retained', reason: 'last-tick-not-successful' });
    expect(f.events).toEqual(['record', 'disable']);
  });
  it('超时清掉running标记不能冒充自然成功退出', async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    const read = f.deps.readJobs;
    f.deps.readJobs = async () => (await read()).map(job => ({ ...job, state: { lastRunStatus: 'error' } }));
    expect((await run(f)).status).toBe('retained');
    expect(f.events).not.toContain('record');
    expect(f.events).not.toContain('remove');
  });

  for (const initiallyCancelled of [false, true]) it(`禁用取消抢跑tick后限次重跑真实售后（从${initiallyCancelled ? '保留现场' : '首次协调'}开始）`, async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    const read = f.deps.readJobs, disable = f.deps.quiesceJob;
    let cancelled = initiallyCancelled, recovered = false, enabled = !initiallyCancelled;
    f.deps.readJobs = async () => (await read()).map(job => ({ ...job, enabled,
      state: cancelled ? { lastRunStatus: 'error', lastError: 'Cron job disabled by operator.' }
        : { ...tickWindow, lastRunStatus: 'ok' } }));
    f.deps.quiesceJob = async () => { await disable(); enabled = false; cancelled = !recovered; };
    f.deps.resumeJob = async () => { f.events.push('enable'); enabled = true; };
    f.deps.requestTick = async () => { f.events.push('request'); recovered = true; cancelled = false; };
    expect((await run(f)).status).toBe('retired');
    expect(f.events).toEqual(initiallyCancelled
      ? ['enable', 'request', 'record', 'disable', 'remove']
      : ['record', 'disable', 'enable', 'request', 'record', 'disable', 'remove']);
  });

  it('持续抢跑取消最多恢复两次，不无限重拉或伪造下岗', async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    const read = f.deps.readJobs; let enabled = false, cancelled = true;
    f.deps.readJobs = async () => (await read()).map(job => ({ ...job, enabled,
      state: cancelled ? { lastRunStatus: 'error', lastError: 'Cron job disabled by operator.' }
        : { ...tickWindow, lastRunStatus: 'ok' } }));
    f.deps.resumeJob = async () => { f.events.push('enable'); enabled = true; };
    f.deps.requestTick = async () => { f.events.push('request'); cancelled = false; };
    f.deps.quiesceJob = async () => { f.events.push('disable'); enabled = false; cancelled = true; };
    expect((await run(f)).status).toBe('retained');
    expect(f.events.filter(x => x === 'enable')).toHaveLength(2);
    expect(f.events).not.toContain('remove');
  });

  for (const failure of ['old-nonce', 'other-error', 'replaced-id']) it(`取消恢复守卫拒绝${failure}`, async () => {
    const f = fixture(); f.setBusy(false); f.setAck({ ...receipt(f.ctx),
      nonce: failure === 'old-nonce' ? 'old' : f.ctx.nonce });
    const read = f.deps.readJobs;
    f.deps.readJobs = async () => (await read()).map(job => ({ ...job, enabled: false,
      state: { lastRunStatus: 'error', lastError: failure === 'other-error' ? 'timeout' : 'Cron job disabled by operator.' } }));
    f.deps.resumeJob = async () => { f.events.push('enable'); };
    if (failure === 'replaced-id') f.deps.resumeJob = async () => {
      f.events.push('enable'); f.deps.readJobs = async () => [{ id: 'other', name: `escort-${f.ctx.host}-${f.ctx.tag}`, schedule: { kind: 'every' }, enabled: true, state: {} }];
    };
    expect((await run(f)).status).toBe('retained');
    expect(f.events).not.toContain('request'); expect(f.events).not.toContain('remove');
    if (failure !== 'replaced-id') expect(f.events).not.toContain('enable');
  });

  for (const at of [undefined, 'invalid', '2026-10-02T03:00:01', '2026-10-02T02:59:59Z', '2026-10-02T03:00:03Z']) it(`旧回执或无有效末轮时间不得被运输ok冒充售后：${at}`, async () => {
    const f = fixture(); f.setBusy(false); f.setAck({ ...receipt(f.ctx), at });
    expect((await run(f)).status).toBe('retained');
    expect(f.events).not.toContain('record'); expect(f.events).not.toContain('remove');
  });

  it('禁用后末轮已变化，不能复用之前tick的售后', async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    const read = f.deps.readJobs, disable = f.deps.quiesceJob; let changed = false;
    f.deps.quiesceJob = async () => { await disable(); changed = true; };
    f.deps.readJobs = async () => (await read()).map(job => changed
      ? { ...job, state: { ...job.state, lastRunAtMs: tickWindow.lastRunAtMs + 5000 } } : job);
    expect((await run(f)).status).toBe('retained'); expect(f.events).not.toContain('remove');
  });

  it('禁用间新tick真正写售后并自然结束：最终新回执再次Brain留痕后才注销', async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    const read = f.deps.readJobs, disable = f.deps.quiesceJob; let changed = false;
    const recorded = [];
    f.deps.recordAftercare = async ack => { f.events.push('record'); recorded.push(ack.at); };
    f.deps.quiesceJob = async () => { await disable(); changed = true;
      f.setAck({ ...receipt(f.ctx), at: '2026-10-02T03:00:06.000Z' }); };
    f.deps.readJobs = async () => (await read()).map(job => changed
      ? { ...job, state: { ...job.state, lastRunAtMs: tickWindow.lastRunAtMs + 5000 } } : job);
    const result = await run(f); expect(result.status).toBe('retired');
    expect(result.receipt.at).toBe('2026-10-02T03:00:06.000Z');
    expect(recorded).toEqual(['2026-10-02T03:00:01.000Z', '2026-10-02T03:00:06.000Z']);
    expect(f.events).toEqual(['record', 'disable', 'record', 'remove']);
  });

  for (const window of [{}, { lastRunAtMs: -1, lastDurationMs: 2000 },
    { ...tickWindow, lastDurationMs: -1 }, { ...tickWindow, lastDurationMs: Infinity },
    { ...tickWindow, lastRunAtMs: '1790900000000' }, { ...tickWindow, lastDurationMs: 1.5 }]) it(`末轮时间字段非法则保留：${JSON.stringify(window)}`, async () => {
    const f = fixture(); f.setBusy(false); f.setAck(receipt(f.ctx));
    const read = f.deps.readJobs;
    f.deps.readJobs = async () => (await read()).map(job => ({ ...job, state: { lastRunStatus: 'ok', ...window } }));
    expect((await run(f)).status).toBe('retained'); expect(f.events).not.toContain('remove');
  });
});
