import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const drainId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const ready = {
  protocol: 'brain-process-drain-v1', drain_id: drainId, draining: true,
  safe_to_swap: true, remaining: 0, blockers: [], independent_task_count: 105,
};
const busy = { ...ready, safe_to_swap: false, remaining: 1, blockers: [{ kind: 'local_execution', task_id: 'local' }] };
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

function actualHelpers() {
  const entry = readFileSync(join(root, 'scripts/brain-deploy.sh'), 'utf8');
  const module = join(root, 'scripts/lib/brain-drain-client.sh');
  if (existsSync(module)) {
    assert.match(entry, /source\s+"\$SCRIPT_DIR\/lib\/brain-drain-client\.sh"/);
    assert.doesNotMatch(entry, /^drain_before_swap\(\)/m);
    return readFileSync(module, 'utf8');
  }
  const from = entry.indexOf('drain_cancel_with_retry() {');
  const to = entry.indexOf('\n# ── 参数解析', from);
  assert.ok(from >= 0 && to > from, '必须读取当前部署入口里的真实排空函数');
  return entry.slice(from, to);
}

function exercise(scenario = {}, command = 'drain_before_swap') {
  const directory = mkdtempSync(join(tmpdir(), 'brain-drain-client-'));
  try {
    const callsPath = join(directory, 'calls.json');
    writeFileSync(callsPath, '[]');
    const curl = join(directory, 'curl.mjs');
    writeFileSync(curl, `import fs from 'node:fs';
const s=JSON.parse(process.env.SCENARIO),args=process.argv.slice(2);
const url=args.find(x=>x.startsWith('http'))||'';
const dataAt=args.findIndex(x=>['--data','--data-raw','--data-binary','-d'].includes(x));
const call={url,args,body:dataAt<0?null:args[dataAt+1]};
const calls=JSON.parse(fs.readFileSync(process.env.CALLS,'utf8'));calls.push(call);
fs.writeFileSync(process.env.CALLS,JSON.stringify(calls));
let value;
if(url.endsWith('/tick/status')){if(s.healthFail)process.exit(7);value={enabled:true};}
else if(url.endsWith('/tick/drain-cancel')){if(s.cancelHttpFail)process.exit(22);value=s.cancelResponse??{success:true};}
else if(url.endsWith('/tick/drain-status')){if(s.pollHttpFail)process.exit(22);value=s.poll??JSON.parse(process.env.READY);}
else if(url.endsWith('/tick/drain')){if(s.postHttpFail)process.exit(s.postHttpFail);value=s.post??JSON.parse(process.env.BUSY);}
else process.exit(91);
process.stdout.write(typeof value==='string'?value:JSON.stringify(value));
`);
    writeFileSync(join(directory, 'curl'), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(curl)} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(directory, 'docker'), `#!/bin/sh
case "$DOCKER_STATE" in
  failed) exit 1;;
esac
if [ "$1" = container ] && [ "$2" = ls ]; then
  [ "$DOCKER_STATE" = absent ] || echo cecelia-node-brain
elif [ "$1" = inspect ]; then
  case "$DOCKER_STATE" in
    running) echo running;;
    stopped) echo exited;;
    *) echo restarting;;
  esac
else
  exit 1
fi
`, { mode: 0o755 });
    const harness = join(directory, 'run.sh');
    writeFileSync(harness, `#!/bin/bash\nset -uo pipefail\nDRY_RUN=false\nDRAIN_TIMEOUT_SECS=5\nSCRIPT_DIR=${shellQuote(join(root, 'scripts'))}\nROOT_DIR=${shellQuote(root)}\nsend_bark() { :; }\n${actualHelpers()}\nif ${command} ${shellQuote(drainId)}; then\n  echo 'SWAP_REACHED'\nelse\n  status=$?\n  echo 'SWAP_BLOCKED'\n  exit "$status"\nfi\n`);
    const result = spawnSync('/bin/bash', [harness], {
      encoding: 'utf8', timeout: 15000,
      env: { PATH: `${directory}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: directory,
        SCENARIO: JSON.stringify(scenario), CALLS: callsPath, READY: JSON.stringify(ready),
        BUSY: JSON.stringify(busy), DOCKER_STATE: scenario.dockerState ?? 'running' },
    });
    assert.equal(result.error, undefined);
    return { ...result, calls: JSON.parse(readFileSync(callsPath, 'utf8')) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function rejected(result) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /SWAP_REACHED/);
  assert.match(result.stdout, /SWAP_BLOCKED/);
}

test('同一代进程协议明确就绪，才允许走到切换', () => {
  const result = exercise();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /SWAP_REACHED/);
  assert.equal(result.calls.filter(x => x.url.endsWith('/tick/drain-cancel')).length, 0);
});

for (const [name, scenario] of [
  ['旧容器仍运行但HTTP不可达', { healthFail: true }],
  ['POST网络结果未知', { postHttpFail: 7 }],
  ['POST返回401', { postHttpFail: 22 }],
  ['POST是畸形JSON', { post: '{broken' }],
  ['POST缺新进程协议', { post: { remaining: 0 } }],
  ['POST表示已有其它暂停', { post: { ...busy, already_draining: true } }],
  ['容器状态查询失败', { dockerState: 'failed' }],
  ['旧容器正在重启，归属未知', { dockerState: 'restarting' }],
  ['状态查询HTTP失败', { pollHttpFail: true }],
  ['状态是畸形JSON', { poll: '{broken' }],
  ['状态只有旧计数', { poll: { remaining: 0 } }],
  ['状态来自另一代排空', { poll: { ...ready, drain_id: otherId } }],
  ['零计数但明确不安全', { poll: { ...ready, safe_to_swap: false } }],
  ['已取消暂停却返回零', { poll: { ...ready, draining: false } }],
  ['零计数仍有未知阻塞', { poll: { ...ready, blockers: [{ kind: 'unknown' }] } }],
  ['剩余数量类型错误', { poll: { ...ready, remaining: '0' } }],
  ['真实本机执行始终未结束', { poll: busy }],
]) {
  test(`${name}不能进入切换`, () => rejected(exercise(scenario)));
}

test('已取得排空身份后失败，只请求解除自己这一代暂停', () => {
  const result = exercise({ poll: busy });
  rejected(result);
  const cancellations = result.calls.filter(x => x.url.endsWith('/tick/drain-cancel'));
  assert.ok(cancellations.length > 0);
  for (const call of cancellations) assert.equal(JSON.parse(call.body).drain_id, drainId);
});

test('HTTP200但取消结果不是success不能当恢复成功', () => {
  rejected(exercise({ cancelResponse: { success: false } }, 'drain_cancel_with_retry'));
});

test('取消请求全部失败必须返回失败', () => {
  rejected(exercise({ cancelHttpFail: true }, 'drain_cancel_with_retry'));
});

test('取消响应若携带另一代身份，不能当恢复成功', () => {
  rejected(exercise({ cancelResponse: { success: true, drain_id: otherId } }, 'drain_cancel_with_retry'));
});

for (const state of ['absent', 'stopped']) {
  test(`实际容器${state}已经确认，才可无需排空启动`, () => {
    const result = exercise({ dockerState: state, healthFail: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.calls.length, 0);
  });
}

test('取消得到明确success才完成恢复', () => {
  const result = exercise({}, 'drain_cancel_with_retry');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
