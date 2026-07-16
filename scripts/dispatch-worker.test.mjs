import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectQuotaWall, buildCommand, pickAccounts, dispatchWithRotation,
  ACCOUNT_POOL, USABLE_THRESHOLD,
} from './dispatch-worker.mjs';

test('detectQuotaWall: 命中 07-16 实测 codex 撞墙原文', () => {
  assert.equal(detectQuotaWall('ERROR: Your workspace is out of credits. Add credits to continue.'), true);
});

test('detectQuotaWall: 命中 rate limit / usage limit / 429', () => {
  assert.equal(detectQuotaWall('You have hit your RATE LIMIT for this window'), true);
  assert.equal(detectQuotaWall('usage limit reached, resets at 07:18'), true);
  assert.equal(detectQuotaWall('HTTP error 429 from upstream'), true);
});

test('detectQuotaWall: 正常输出与空输入不误报', () => {
  assert.equal(detectQuotaWall('段2完成，node test.js 全绿'), false);
  assert.equal(detectQuotaWall(''), false);
  assert.equal(detectQuotaWall(null), false);
});

test('buildCommand: codex 用 CODEX_HOME + exec --cd --sandbox workspace-write', () => {
  const c = buildCommand('codex', { home: '/h/.codex-team1' }, '任务书', '/w');
  assert.equal(c.cmd, 'codex');
  assert.deepEqual(c.args, ['exec', '--cd', '/w', '--sandbox', 'workspace-write', '任务书']);
  assert.equal(c.env.CODEX_HOME, '/h/.codex-team1');
  assert.equal(c.cwd, '/w');
});

test('buildCommand: claude 用真身路径 + CLAUDE_CONFIG_DIR（绝不用裸 claude）', () => {
  const c = buildCommand('claude', { home: '/h/.claude-account2' }, '任务书', '/w');
  assert.equal(c.cmd, '/opt/homebrew/bin/claude');
  assert.deepEqual(c.args, ['-p', '--dangerously-skip-permissions', '任务书']);
  assert.equal(c.env.CLAUDE_CONFIG_DIR, '/h/.claude-account2');
  assert.equal(c.cwd, '/w');
});

test('buildCommand: grok 用 -p --cwd --always-approve', () => {
  const c = buildCommand('grok', { home: '/h/.grok' }, '任务书', '/w');
  assert.ok(c.cmd.endsWith('/.grok/bin/grok'));
  assert.deepEqual(c.args, ['-p', '任务书', '--cwd', '/w', '--always-approve']);
  assert.equal(c.cwd, '/w');
});

test('buildCommand: 未知 vendor 抛错', () => {
  assert.throws(() => buildCommand('gemini', { home: '/h' }, 'b', '/w'), /unknown vendor/);
});

const U = (vendor, name, usable, usedPercent) => ({ account: { vendor, name, home: `/h/${name}` }, usable, usedPercent });

test('pickAccounts: used_percent 升序，过滤不可用', () => {
  const got = pickAccounts([U('codex','team2',false,100), U('codex','team1',true,0), U('claude','account2',true,13)], { vendor: 'auto' });
  assert.deepEqual(got.map((u) => u.account.name), ['team1', 'account2']);
});

test('pickAccounts: grok 恒可用垫底（usedPercent=Infinity）', () => {
  const got = pickAccounts([U('grok','grok',true,Infinity), U('codex','team1',true,50)], { vendor: 'auto' });
  assert.deepEqual(got.map((u) => u.account.name), ['team1', 'grok']);
});

test('pickAccounts: vendor 偏好过滤', () => {
  const got = pickAccounts([U('codex','team1',true,0), U('claude','account2',true,13)], { vendor: 'claude' });
  assert.deepEqual(got.map((u) => u.account.name), ['account2']);
});

test('dispatchWithRotation: 撞墙换下家，第二家成功', async () => {
  const calls = [];
  const outputs = [
    { output: 'ERROR: Your workspace is out of credits.', exitCode: 0 },
    { output: '完成', exitCode: 0 },
  ];
  const r = await dispatchWithRotation({
    candidates: [U('codex','team2',true,80), U('codex','team1',true,0)],
    brief: 'b', dir: '/w', maxRetries: 2,
    runWorker: async (account) => { calls.push(account.name); return outputs.shift(); },
  });
  assert.deepEqual(calls, ['team2', 'team1']);
  assert.equal(r.ok, true);
  assert.equal(r.account, 'team1');
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].quota_wall, true);
});

test('dispatchWithRotation: 全池撞墙 → pool_exhausted', async () => {
  const r = await dispatchWithRotation({
    candidates: [U('codex','team1',true,0), U('codex','team2',true,80)],
    brief: 'b', dir: '/w', maxRetries: 2,
    runWorker: async () => ({ output: 'quota exceeded', exitCode: 0 }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pool_exhausted');
  assert.equal(r.exit_code, 1);
});

test('dispatchWithRotation: 非零退出且非撞墙 → 不换账号原样返回', async () => {
  let calls = 0;
  const r = await dispatchWithRotation({
    candidates: [U('codex','team1',true,0), U('codex','team2',true,80)],
    brief: 'b', dir: '/w', maxRetries: 2,
    runWorker: async () => { calls++; return { output: '任务本身失败了', exitCode: 3 }; },
  });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
  assert.equal(r.exit_code, 3);
});

test('dispatchWithRotation: maxRetries 限制尝试次数（maxRetries+1 家）', async () => {
  let calls = 0;
  const r = await dispatchWithRotation({
    candidates: [U('codex','team1',true,0), U('codex','team2',true,10), U('grok','grok',true,Infinity)],
    brief: 'b', dir: '/w', maxRetries: 1,
    runWorker: async () => { calls++; return { output: 'out of credits', exitCode: 0 }; },
  });
  assert.equal(calls, 2);
  assert.equal(r.reason, 'pool_exhausted');
});

test('ACCOUNT_POOL: 含本机四账号，claude 只有 account2（account1 是 controller 主线）', () => {
  const names = ACCOUNT_POOL.map((a) => `${a.vendor}:${a.name}`);
  assert.deepEqual(names, ['codex:team1', 'codex:team2', 'claude:account2', 'grok:grok']);
  assert.equal(USABLE_THRESHOLD, 90);
});
