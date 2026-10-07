import { describe, test, expect } from 'vitest';
import { mkdtemp, copyFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const cli = fileURLToPath(new URL('../../../scripts/activity-contract-run.js', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/activity-runtime/activity.mjs', import.meta.url));
const failure = { empty_ok: [], retryable: ['timeout', 'transient'], fatal: ['invalid'], needs_human: { cases: ['blocked'] } };
const activity = (key, order, overrides = {}) => ({ key, order, budget: { max_duration_s: 5, heartbeat_s: 1 }, failure,
  runtime: { phase: 'batch_end', protocol: 'json-stdio-v1', entry: 'activity.mjs', argv: [key], on_failure: 'stop_run', ...overrides } });
const grouped = (key, order, when) => activity(key, order, { phase: 'per_item',
  per_item: { group: 'records', items: '$.records', input: 'record', identity: 'id', ...(when ? { when } : {}) } });

async function run(activities, extraInput = {}, cancel = false, badSink = false) {
  const cwd = await mkdtemp(join(tmpdir(), 'cecelia-activity-'));
  await copyFile(fixture, join(cwd, 'activity.mjs'));
  await mkdir(join(cwd, 'nested'));
  await copyFile(fixture, join(cwd, 'nested', 'activity.mjs'));
  await mkdir(join(cwd, '_nested'));
  await copyFile(fixture, join(cwd, '_nested', '_activity.mjs'));
  const trace = join(cwd, 'trace.jsonl');
  const receipt = join(cwd, 'receipt.json');
  const childPid = join(cwd, 'child.pid');
  const input = { run_tag: 'offline-run', trace, child_pid: childPid, records: [{ id: 'a' }, { id: 'b', reject: true }], fragments: [], ...extraInput };
  try {
    const child = spawn(process.execPath, [cli, '--cwd', cwd, '--receipt', badSink ? join(cwd, 'activity.mjs', 'receipt.json') : receipt], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ contract: { workflow: 'offline-example', activities }, input }));
    const finished = new Promise(resolve => child.on('close', resolve));
    if (cancel) {
      for (let i = 0; i < 100; i++) {
        try { if ((await readFile(trace, 'utf8')).includes('safe-stop')) break; } catch {}
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      child.kill('SIGTERM');
    }
    const code = await finished;
    const parse = async path => JSON.parse(await readFile(path, 'utf8'));
    let result = null, durable = null, events = [], pid = null;
    try { result = JSON.parse(stdout); } catch {}
    try { durable = await parse(receipt); } catch {}
    try { events = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse); } catch {}
    try { pid = Number(await readFile(childPid, 'utf8')); } catch {}
    return { code, result, durable, events, stderr, pid };
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('opt-in契约CLI真实子进程闭环', () => {
  test('按order逐条目判定→门条件采集，跨活动传产物/指标/证据并落回执', async () => {
    const r = await run([activity('deliver', 4), grouped('collect', 2, { path: '$item.state', equals: 'approved' }),
      activity('batch', 3), grouped('inspect', 1)]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.events.map(x => [x.action, x.record])).toEqual([['inspect', 'a'], ['collect', 'a'], ['inspect', 'b'], ['batch', undefined], ['deliver', undefined]]);
    expect(r.result.outputs.delivered).toEqual([{ id: 'a:fragment', owner: 'a', scored: true }]);
    expect(r.result.outputs.records.map(x => x.state)).toEqual(['approved', 'refused']);
    expect(r.result.metrics.deliver.delivered).toBe(1);
    expect(r.result.evidence).toHaveLength(5);
    expect(r.durable).toEqual(r.result);
  });
  test('删评分活动只改contract仍保留未评分产物', async () => {
    const r = await run([grouped('inspect', 1), grouped('collect', 2, { path: '$item.state', equals: 'approved' }), activity('deliver', 3)]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.result.outputs.delivered).toEqual([{ id: 'a:fragment', owner: 'a' }]);
  });
  test.each(['nested/activity.mjs', '_nested/_activity.mjs'])('支持cwd下面的安全相对路径入口%s', async entry => {
    const r = await run([activity('deliver', 1, { entry })]);
    expect(r.code, r.stderr).toBe(0);
  });
  test('各活动预算独立传入，不把组预算相加', async () => {
    const first = grouped('inspect', 1), second = grouped('collect', 2);
    first.budget.max_duration_s = 3; second.budget.max_duration_s = 7;
    const r = await run([first, second]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.events.map(x => x.budget.max_duration_s)).toEqual([3, 7, 3, 7]);
  });
  test('显式映射区分原输入/累计上下文/当前条目', async () => {
    const a = grouped('inspect', 1);
    a.runtime.input = { run_tag: '$input.run_tag', trace: '$input.trace', record: '$item' };
    const r = await run([a]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.events[0].input.fragments).toBeUndefined();
    expect(r.events[0].input.record.id).toBe('a');
  });
  test('partial不丢产物，continue把产物交下一活动', async () => {
    const r = await run([activity('partial', 1, { on_failure: 'continue' }), activity('deliver', 2)]);
    expect(r.code, r.stderr).toBe(2);
    expect(r.result.status).toBe('partial');
    expect(r.result.outputs.delivered).toEqual([{ id: 'retained', owner: 'partial' }]);
  });
  test('fatal停主链且所有finalize依次照跑', async () => {
    const r = await run([activity('fatal', 1), activity('deliver', 2), activity('finalize', 3, { phase: 'finalize' }),
      { ...activity('finalize', 4, { phase: 'finalize' }), key: 'final_cleanup' }]);
    expect(r.code, r.stderr).toBe(2);
    expect(r.events.map(x => x.action)).toEqual(['fatal', 'finalize', 'finalize']);
    expect(r.result.outputs.fragments).toEqual([{ id: 'retained', owner: 'partial' }]);
    expect(r.result.outputs.cleanup).toBe(true);
  });
  test('retryable显式最多重试一次，保留两次产物和证据', async () => {
    const a = activity('retry', 1, { max_attempts: 2, input: { run_tag: '$input.run_tag', trace: '$input.trace', attempt: '$.attempt' } });
    // attempt由执行器元数据覆盖，不能由输入伪造。
    delete a.runtime.input;
    const r = await run([a]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.events).toHaveLength(2);
    expect(r.result.activities[0].attempts).toHaveLength(2);
    expect(r.result.evidence).toHaveLength(2);
    expect(r.result.activities[0].attempts[0].outputs.fragments[0].id).toBe('attempt:1');
  });
  test('fatal/needs_human不重试', async () => {
    const r = await run([activity('fatal', 1, { max_attempts: 2 })]);
    expect(r.code, r.stderr).toBe(2);
    expect(r.events).toHaveLength(1);
  });
  test('超时TERM触发清理，保留清理JSON/partial并执行finalize', async () => {
    const a = activity('timeout', 1, { cleanup_grace_s: 1 }); a.budget.max_duration_s = 1;
    const r = await run([a, activity('finalize', 2, { phase: 'finalize' })]);
    expect(r.code, r.stderr).toBe(2);
    expect(r.events.some(x => x.cleanup)).toBe(true);
    expect(r.result.outputs.fragments).toEqual([{ id: 'before-timeout' }]);
    expect(r.result.activities[0].attempts[0].reason_code).toBe('activity_timeout');
    expect(r.result.outputs.cleanup).toBe(true);
  }, 10000);
  test('清理无响应在grace后终结整棵子进程树', async () => {
    const a = activity('hang', 1, { cleanup_grace_s: 1 }); a.budget.max_duration_s = 1;
    const r = await run([a, activity('finalize', 2, { phase: 'finalize' })]);
    expect(r.code, r.stderr).toBe(1);
    expect(r.pid).toBeGreaterThan(0);
    expect(() => process.kill(r.pid, 0)).toThrow();
    expect(r.result.outputs.cleanup).toBe(true);
  }, 10000);
  test.each(['fatal', 'needs_human'])('%s即使continue也停主链且不重试', async action => {
    const r = await run([activity(action, 1, { on_failure: 'continue', max_attempts: 2 }),
      activity('deliver', 2), activity('finalize', 3, { phase: 'finalize' })]);
    expect(r.code, r.stderr).toBe(2);
    expect(r.events.map(x => x.action)).toEqual([action, 'finalize']);
  });
  test('未声明failure类别即使continue也停主链', async () => {
    const a = activity('partial', 1, { on_failure: 'continue' }); a.failure = { ...failure, retryable: [] };
    const r = await run([a, activity('deliver', 2), activity('finalize', 3, { phase: 'finalize' })]);
    expect(r.code, r.stderr).toBe(2);
    expect(r.events.map(x => x.action)).toEqual(['partial', 'finalize']);
    expect(r.result.activities[0].reason_code).toBe('undeclared_failure_class');
  });
  test('取消仅通知活动根，子动作在安全边界自行退出并保留JSON，然后finalize', async () => {
    const r = await run([activity('safe_stop', 1, { argv: ['safe-stop'], cleanup_grace_s: 1 }), activity('deliver', 2),
      activity('finalize', 3, { phase: 'finalize' })], {}, true);
    expect(r.code, r.stderr).toBe(2);
    expect(r.events.some(x => x.action === 'child_term')).toBe(false);
    expect(r.events.filter(x => !x.cleanup).map(x => x.action)).toEqual(['safe-stop', 'finalize']);
    expect(r.result.outputs.fragments).toEqual([{ id: 'safely-retained' }]);
    expect(r.result.activities[0].attempts[0].reason_code).toBe('run_cancelled');
    expect(r.durable).toEqual(r.result);
  }, 10000);
  test.each([false, true])('事件写入失败%s次后产物保留且所有finalize仍执行', async always => {
    const cwd = await mkdtemp(join(tmpdir(), 'activity-sink-failure-'));
    try {
      await copyFile(fixture, join(cwd, 'activity.mjs'));
      const { runActivityContract } = await import('../activity-runtime.js');
      let rejected = false;
      const r = await runActivityContract({ workflow: 'offline-example', activities: [activity('partial', 1, { max_attempts: 2 }),
        activity('deliver', 2), activity('finalize', 3, { phase: 'finalize' })] },
      { run_tag: 'offline-example', trace: join(cwd, 'trace'), fragments: [] }, { cwd, onEvent: async event => {
        if ((event.event_type === 'ACTIVITY_FINISHED' && !rejected) || (always && rejected)) {
          rejected = true; throw new Error('receipt-store-unavailable');
        }
      } });
      expect(r.status).toBe('partial');
      expect(r.reason_code).toBe('event_sink_failed');
      expect(r.outputs.fragments).toEqual([{ id: 'retained', owner: 'partial' }]);
      expect(r.outputs.cleanup).toBe(true);
      expect(r.activities.map(x => x.key)).toEqual(['partial', 'finalize']);
      expect(r.activities[0].attempts).toHaveLength(1);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  test('CLI最终receipt写失败仍输出唯一JSON和已执行finalize产物', async () => {
    const r = await run([activity('finalize', 1, { phase: 'finalize' })], {}, false, true);
    expect(r.code).toBe(1);
    expect(r.result).not.toBeNull();
    expect(r.result.reason_code).toBe('event_sink_failed');
    expect(r.result.outputs.cleanup).toBe(true);
    expect(r.events.map(x => x.action)).toEqual(['finalize']);
  });
  test.each([
    ['legacy shell说明不是JSON协议', a => { delete a.runtime.protocol; }],
    ['重复order', a => { a.order = 2; }],
    ['未知失败策略', a => { a.runtime.on_failure = 'guess'; }],
    ['不支持无限retry', a => { a.runtime.max_attempts = 99; }],
    ['缺预算', a => { delete a.budget; }],
    ['绝对入口', a => { a.runtime.entry = '/tmp/activity.mjs'; }],
    ['越界入口', a => { a.runtime.entry = '../activity.mjs'; }],
    ['schema未声明cjs入口', a => { a.runtime.entry = 'activity.cjs'; }],
  ])('拒绝%s且不启动活动', async (_, mutate) => {
    const a = activity('inspect', 1); mutate(a);
    const r = await run([a, activity('deliver', 2)]);
    expect(r.code).toBe(1);
    expect(r.events).toEqual([]);
    expect(r.result.reason_code).toBe('invalid_contract');
  });
  test.each(['malformed', 'wrongrun'])('拒绝活动%s伪成功并运行收尾', async action => {
    const r = await run([activity(action, 1), activity('finalize', 2, { phase: 'finalize' })]);
    expect(r.code, r.stderr).toBe(1);
    expect(r.result.status).toBe('failed');
    expect(r.result.outputs.cleanup).toBe(true);
  });
  test.each(['poison', 'drift'])('拒绝%s污染且不部分合并无效结果', async action => {
    const a = action === 'drift' ? grouped(action, 1) : activity(action, 1);
    const r = await run([a, activity('deliver', 2), activity('finalize', 3, { phase: 'finalize' })]);
    expect(r.code, r.stderr).toBe(1);
    expect(r.result.outputs.fragments).toBeUndefined();
    expect(r.events.map(x => x.action)).toEqual([action, 'finalize']);
  });
});
