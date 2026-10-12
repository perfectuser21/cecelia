import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeaseGuard, markPhoneLeaseLost } from './us-price-lease.mjs';

const conflict = () => Object.assign(new Error('HTTP 409 lease_lost'), { status: 409 });
test('远端停止仅传精确owner，失败或错回执不得声称收尾成功', async () => {
  const owner = 'price' + 'a'.repeat(64);
  await assert.rejects(markPhoneLeaseLost('../other', () => assert.fail()), /invalid/);
  await markPhoneLeaseLost(owner, async (cmd, args, input) => {
    assert.equal(cmd, 'ssh'); assert.ok(args.includes('xian-m4')); assert.equal(JSON.parse(input), owner);
    return { code: 0, stdout: JSON.stringify({ owner, stopped: true }) };
  });
  await assert.rejects(markPhoneLeaseLost(owner, async () => ({ code: 1 })), /停止标记失败/);
  await assert.rejects(markPhoneLeaseLost(owner, async () => ({ code: 0, stdout: '{"owner":"other","stopped":true}' })), /回读不符/);
});
test('409 永久停止后续业务，收尾只调用一次且可等待', async () => {
  let lost = false, cleanup = 0, actions = 0;
  const guard = createLeaseGuard({ taskId: 't', owner: 'o', heartbeatMs: 100000,
    request: async () => { if (lost) throw conflict(); return { ok: true }; },
    onLost: async () => { cleanup++; await new Promise(r => setTimeout(r, 5)); },
  });
  try {
    await guard.run(async () => { actions++; });
    lost = true;
    await assert.rejects(guard.run(async () => { actions++; }), /lease_lost/);
    lost = false;
    await assert.rejects(guard.run(async () => { actions++; }), /lease_lost/);
    await guard.settle();
    assert.equal(actions, 1); assert.equal(cleanup, 1); assert.equal(guard.lost, true);
  } finally { await guard.close(); }
});
test('在途业务完成后丢失租约，不接受结果、不启动fallback或终态回写', async () => {
  let release; const done = new Promise(r => { release = r; });
  let conflictNow = false, starts = 0;
  const guard = createLeaseGuard({ taskId: 't', owner: 'o', heartbeatMs: 100000,
    request: async () => { if (conflictNow) throw conflict(); return { ok: true }; }, onLost: async () => release(),
  });
  try {
    const work = guard.run(async () => { starts++; await done; return 'obsolete'; });
    await new Promise(r => setTimeout(r, 0));
    conflictNow = true; await assert.rejects(guard.check(), /lease_lost/);
    await assert.rejects(work, /lease_lost/);
    await assert.rejects(guard.run(async () => { starts++; }), /lease_lost/);
    assert.equal(starts, 1);
  } finally { await guard.close(); }
});
test('网络失败和404保守拒绝新动作，重新确认所属后恢复，租期耗尽则收尾', async () => {
  let now = 0, unavailable = true, stopped = 0;
  const guard = createLeaseGuard({ taskId: 't', owner: 'o', leaseSeconds: 30, heartbeatMs: 100000, now: () => now,
    request: async () => { if (unavailable) throw new Error('HTTP 404'); return { ok: true }; },
    onLost: async () => { stopped++; },
  });
  try {
    await assert.rejects(guard.run(async () => assert.fail('未经确认的业务')), /404/);
    unavailable = false; await guard.check(); assert.equal(guard.lost, false);
    unavailable = true; now = 31000;
    await assert.rejects(guard.check(), /lease_lost/); await guard.settle();
    assert.equal(stopped, 1);
  } finally { await guard.close(); }
});
test('收尾失败必须返回具体错误，不能未处理拒绝或冒充已安全收尾', async () => {
  const guard = createLeaseGuard({ taskId: 't', owner: 'o', heartbeatMs: 100000,
    request: async () => { throw conflict(); }, onLost: async () => { throw new Error('stop-marker unavailable'); },
  });
  await assert.rejects(guard.check(), /lease_lost/);
  await assert.rejects(guard.close(), /stop-marker unavailable/);
});
