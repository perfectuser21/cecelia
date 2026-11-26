import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../../..');
const sha = 'a'.repeat(40), old = 'b'.repeat(40);
const request = '11111111-1111-4111-8111-111111111111';
const image = `sha256:${'c'.repeat(64)}`;
const valid = {
  settled: true,
  settlement: { outcome: 'success', git_sha: sha, image_id: image, deployment_id: request, confirmed_at: '2026-10-21T00:00:00Z' },
  status: 'success', sha, git_sha: sha, request_id: request, isolated: true, image_id: image,
};
const waitScript = 'bash scripts/ci/gate3-wait-deploy.sh "$BRAIN_URL" "$GITHUB_SHA"';
const triggerScript = 'bash scripts/ci/gate3-trigger-deploy.sh "$BRAIN_URL" "$GITHUB_SHA"';
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture({ readyAt = 0, sleepTimes = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-budget-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'bin'));
  const bin = (name, body) => writeFileSync(join(dir, 'bin', name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  for (const name of ['clock', 'polls', 'sleeps']) writeFileSync(join(dir, name), '0');
  writeFileSync(join(dir, 'sleep-times'), sleepTimes.join('\n'));
  writeFileSync(join(dir, 'sleep-args'), '');
  writeFileSync(join(dir, 'git-calls'), '');
  bin('date', 'cat "$FIXTURE/clock"');
  // 跳过虚拟时间中没有状态变化的区间；生产脚本的间隔、次数及截止预算保持原值。
  bin('sleep', `n=$(cat "$FIXTURE/clock"); call=$(cat "$FIXTURE/sleeps")
echo "$1" >> "$FIXTURE/sleep-args"
next=$(sed -n "$((call + 1))p" "$FIXTURE/sleep-times")
echo $((call + 1)) > "$FIXTURE/sleeps"
if [[ -n "$next" ]]; then echo "$next"; else echo $((n + \${1%.*})); fi > "$FIXTURE/clock"`);
  bin('git', `printf '%s\\n' "$*" >> "$FIXTURE/git-calls"
if (( GIT_DELAY_SECONDS > 0 )); then
  n=$(cat "$FIXTURE/clock"); echo $((n + GIT_DELAY_SECONDS)) > "$FIXTURE/clock"; exit 0
fi
[[ "$GIT_CONTAINS" == 1 ]]`);
  bin('curl', `n=$(cat "$FIXTURE/polls"); echo $((n + 1)) > "$FIXTURE/polls"
printf '%s\\n' "$@" > "$FIXTURE/curlargs-$n"
clock=$(cat "$FIXTURE/clock"); echo $((clock + HTTP_SECONDS)) > "$FIXTURE/clock"
body="$PENDING"; (( n >= READY_AT )) && body="$VALID"
# 变异移除循环保护时，以可观测的失败响应收尾；每个用例仍独立断言请求次数/时刻。
(( n < 8 )) || body='{"status":"failed","error":"fixture request limit exceeded"}'
out=''; format=''
while (($#)); do case "$1" in -o) out="$2"; shift;; -w) format="$2"; shift;; esac; shift; done
if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
case "$format" in '') :;; '%{http_code}') printf '200';; '\\n%{http_code}') printf '\\n200';; *) exit 64;; esac`);
  bin('status', 'exec curl fixture');
  bin('trigger', 'echo 202');
  return {
    dir,
    env: {
      ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, FIXTURE: dir,
      READY_AT: String(readyAt), PENDING: JSON.stringify({ status: 'running', git_sha: old }), VALID: JSON.stringify(valid),
      BRAIN_URL: 'http://fixture.invalid', EXPECTED_SHA: sha, GITHUB_SHA: sha, REPO_DIR: dir,
      // 与 main CD 一致；兼容祖先用例单独显式关闭精确模式，避免继承宿主环境改变覆盖路径。
      REQUIRE_EXACT_SHA: '1', POLL_INTERVAL_S: '', MAX_POLLS: '', MAX_RETRIGGER: '',
      STATUS_CMD: '', TRIGGER_CMD: join(dir, 'bin/trigger'), HTTP_SECONDS: '0', GIT_DELAY_SECONDS: '0', GIT_CONTAINS: '0',
    },
  };
}

function number(f, name) {
  return Number(readFileSync(join(f.dir, name), 'utf8'));
}

function args(f, poll = 0) {
  return readFileSync(join(f.dir, `curlargs-${poll}`), 'utf8').trim().split('\n');
}

function option(values, name) {
  expect(values).toContain(name);
  return values[values.indexOf(name) + 1];
}

function run(script, f, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', script], { cwd: root, env: { ...f.env, ...extra }, timeout: 5000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

describe('deployment-time-budget：正式发布入口的有限预算与状态判定', () => {
  it('默认预算允许35分钟冷构建后同SHA成功', async () => {
    const f = fixture({ readyAt: 1, sleepTimes: [2100] });
    const result = await run(waitScript, f);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(number(f, 'clock')).toBe(2100);
    expect(number(f, 'polls')).toBe(2);
    expect(readFileSync(join(f.dir, 'git-calls'), 'utf8')).toBe('');
  });

  it('95分钟总截止独立于轮询次数上限，仍running必须失败', async () => {
    const f = fixture({ readyAt: 10000, sleepTimes: [5690] });
    const result = await run(waitScript, f, { MAX_POLLS: '10000' });
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(number(f, 'clock')).toBe(5700);
    expect(number(f, 'polls')).toBe(2);
  });

  it('HTTP耗时计入总截止，请求上限90秒且末次只使用剩余25秒', async () => {
    const f = fixture({ readyAt: 10000, sleepTimes: [5675] });
    const result = await run(waitScript, f, { HTTP_SECONDS: '15', MAX_POLLS: '10000' });
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(number(f, 'clock')).toBe(5700);
    expect(number(f, 'polls')).toBe(2);
    expect([option(args(f, 0), '--max-time'), option(args(f, 1), '--max-time')]).toEqual(['90', '25']);
  });

  it('最后一次等待只使用截止前剩余5秒', async () => {
    const f = fixture({ readyAt: 10000, sleepTimes: [5695] });
    expect((await run(waitScript, f)).status).toBe(1);
    expect(number(f, 'clock')).toBe(5700);
    expect(number(f, 'polls')).toBe(2);
    expect(option(args(f, 1), '--max-time')).toBe('5');
    expect(readFileSync(join(f.dir, 'sleep-args'), 'utf8')).toBe('10\n5\n');
  });

  it('轮询次数先耗尽时立即失败，不依赖95分钟截止', async () => {
    const f = fixture({ readyAt: 10000 });
    expect((await run(waitScript, f, { MAX_POLLS: '3' })).status).toBe(1);
    expect(number(f, 'polls')).toBe(3);
    expect(number(f, 'clock')).toBe(30);
  });

  it.each([5700, 5701])('HTTP返回成功但耗时%d秒已到总截止，仍必须失败', async seconds => {
    const f = fixture();
    expect((await run(waitScript, f, { HTTP_SECONDS: String(seconds) })).status).toBe(1);
    expect(number(f, 'polls')).toBe(1);
    expect(number(f, 'clock')).toBe(seconds);
  });

  it('精确SHA模式拒绝后代成功收据，不发起祖先查询', async () => {
    const f = fixture();
    f.env.VALID = JSON.stringify({ ...valid, git_sha: old, settlement: { ...valid.settlement, git_sha: old } });
    expect((await run(waitScript, f, { GIT_CONTAINS: '1', MAX_RETRIGGER: '0' })).status).toBe(1);
    expect(readFileSync(join(f.dir, 'git-calls'), 'utf8')).toBe('');
    expect(number(f, 'polls')).toBe(1);
  });

  it('兼容模式祖先查询跨总截止时间不得返回成功', async () => {
    const f = fixture();
    f.env.VALID = JSON.stringify({ ...valid, git_sha: old, settlement: { ...valid.settlement, git_sha: old } });
    expect((await run(waitScript, f, { REQUIRE_EXACT_SHA: '0', GIT_DELAY_SECONDS: '5701' })).status).toBe(1);
    expect(readFileSync(join(f.dir, 'git-calls'), 'utf8')).toContain('merge-base --is-ancestor');
    expect(number(f, 'clock')).toBeGreaterThan(5700);
    expect(number(f, 'polls')).toBe(1);
  });

  it.each([
    { suffix: '', maximum: '60', connect: '30' },
    { suffix: ' 7', maximum: '7', connect: '7' },
  ])('触发请求$suffix使用预算$maximum秒并携带目标SHA', async ({ suffix, maximum, connect }) => {
    const f = fixture();
    expect((await run(triggerScript + suffix, f)).status).toBe(0);
    const values = args(f);
    expect(option(values, '--max-time')).toBe(maximum);
    expect(option(values, '--connect-timeout')).toBe(connect);
    expect(JSON.parse(option(values, '-d')).sha).toBe(sha);
    expect(number(f, 'polls')).toBe(1);
  });

  it('注入状态命令仍遵守同一总截止预算', async () => {
    const f = fixture({ readyAt: 10000, sleepTimes: [5700] });
    expect((await run(waitScript, f, { STATUS_CMD: join(f.dir, 'bin/status'), MAX_POLLS: '10000' })).status).toBe(1);
    expect(number(f, 'clock')).toBe(5700);
    expect(number(f, 'polls')).toBe(1);
  });
});
