import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
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

test('detectQuotaWall: quota 正则收窄——只命中真撞墙短语，不误判任务书提到 quota 一词', () => {
  assert.equal(detectQuotaWall('quota exceeded'), true);
  assert.equal(detectQuotaWall('本任务和 quota 配置表无关'), false);
});

test('buildCommand: codex 用 CODEX_HOME + exec --cd --sandbox workspace-write', () => {
  const c = buildCommand('codex', { home: '/h/.codex-team1' }, '任务书', '/w');
  assert.equal(c.cmd, 'codex');
  assert.deepEqual(c.args, ['exec', '--cd', '/w', '--sandbox', 'workspace-write', '--skip-git-repo-check', '任务书']);
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
  assert.equal(r.vendor, null);
  assert.equal(r.account, null);
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

test('ACCOUNT_POOL: Codex 只有 broker slot，不暴露 team/raw home authority', () => {
  const names = ACCOUNT_POOL.map((a) => `${a.vendor}:${a.name}`);
  assert.deepEqual(names, ['codex:codex-slot', 'claude:account2', 'grok:grok']);
  assert.equal(ACCOUNT_POOL.filter((a) => a.vendor === 'codex').length, 1);
  assert.equal(ACCOUNT_POOL[0].home, process.env.CODEX_SLOT_HOME || '');
  assert.equal(USABLE_THRESHOLD, 90);
});

test('parseArgs: 完整参数解析', async () => {
  const { parseArgs } = await import('./dispatch-worker.mjs');
  const d = mkdtempSync(pjoin(tmpdir(), 'dw-'));
  const got = parseArgs(['--brief', '干活', '--dir', d, '--vendor', 'codex', '--max-retries', '3']);
  assert.equal(got.brief, '干活');
  assert.equal(got.dir, d);
  assert.equal(got.vendor, 'codex');
  assert.equal(got.maxRetries, 3);
});

test('parseArgs: brief 是存在的文件路径时读文件内容', async () => {
  const { parseArgs } = await import('./dispatch-worker.mjs');
  const d = mkdtempSync(pjoin(tmpdir(), 'dw-'));
  const f = pjoin(d, 'brief.md');
  writeFileSync(f, '任务书全文');
  const got = parseArgs(['--brief', f, '--dir', d]);
  assert.equal(got.brief, '任务书全文');
});

test('parseArgs: 默认 vendor=auto maxRetries=2', async () => {
  const { parseArgs } = await import('./dispatch-worker.mjs');
  const d = mkdtempSync(pjoin(tmpdir(), 'dw-'));
  const got = parseArgs(['--brief', 'b', '--dir', d]);
  assert.equal(got.vendor, 'auto');
  assert.equal(got.maxRetries, 2);
});

test('parseArgs: 缺 brief 或 dir 不存在 → throw', async () => {
  const { parseArgs } = await import('./dispatch-worker.mjs');
  assert.throws(() => parseArgs(['--dir', '/tmp']), /--brief/);
  assert.throws(() => parseArgs(['--brief', 'b', '--dir', '/不存在的路径xx']), /--dir/);
});
