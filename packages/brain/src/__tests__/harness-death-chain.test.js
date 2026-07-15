// harness-death-chain.test.js
// TDD Red — 三条死因全链用例
// 注意：commit 1 时实现文件不存在，import 会 fail → Red 状态

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeath } from '../harness-death-classifier.js';

// ─── Mock helpers ───────────────────────────────────────────────────────────

function makeDbStub() {
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
    _calls: calls,
  };
}

function makeSpawnStub() {
  const calls = [];
  return {
    fn: async (opts) => {
      calls.push(opts);
      return { exitCode: 0 };
    },
    _calls: calls,
  };
}

// ─── 用例 1：OOM 全链 ────────────────────────────────────────────────────────

test('OOM 全链: exitCode=137 → cause=oom → oom_upgrade', async (t) => {
  // S1: 证据
  const evidence = { exitCode: 137, stdoutTail: null, tmuxPane: null };

  // S2: 分类
  const result = classifyDeath(evidence);
  assert.equal(result.cause, 'oom', '分类应为 oom');
  assert.equal(result.action, 'oom_upgrade', 'action 应为 oom_upgrade');

  // S3: 路由模拟
  const spawnStub = makeSpawnStub();
  const dbStub = makeDbStub();

  const out = { oom_upgraded: false };

  if (result.cause === 'oom') {
    // 路由 → spawnFn 收到 memoryTier='oom_upgrade'
    await spawnStub.fn({ memoryTier: 'oom_upgrade' });
    // 回写 DB stub
    await dbStub.query('UPDATE tasks SET oom_upgraded=$1 WHERE id=$2', [true, 'task-1']);
    out.oom_upgraded = true;
  }

  // 验收
  assert.equal(out.oom_upgraded, true, 'oom_upgraded 应被回写为 true');
  assert.equal(spawnStub._calls.length, 1, 'spawnFn 应被调用一次');
  assert.equal(spawnStub._calls[0].memoryTier, 'oom_upgrade', 'spawnFn 收到 memoryTier=oom_upgrade');
  assert.equal(dbStub._calls.length, 1, 'DB stub 应被调用一次');
});

// ─── 用例 2：CI red 全链 ─────────────────────────────────────────────────────

test('CI red 全链: stdoutTail 含 CI_RED → cause=ci_red → 正常重点火', async (t) => {
  // S1: 证据
  const evidence = { exitCode: 0, stdoutTail: 'CI_RED detected', tmuxPane: null };

  // S2: 分类
  const result = classifyDeath(evidence);
  assert.equal(result.cause, 'ci_red', '分类应为 ci_red');
  assert.equal(result.action, 'ci_red_refire', 'action 应为 ci_red_refire');

  // S3: 路由模拟
  const spawnStub = makeSpawnStub();
  const out = { resumed: 0 };

  if (result.cause === 'ci_red') {
    // 正常重点火，无 memoryTier
    await spawnStub.fn({ taskId: 'task-2' });
    out.resumed++;
  }

  // 验收
  assert.equal(out.resumed, 1, 'resumed 应为 1');
  assert.equal(spawnStub._calls.length, 1, 'spawnFn 应被调用一次');
  assert.equal(spawnStub._calls[0].memoryTier, undefined, '无 memoryTier');
});

// ─── 用例 3：unknown 全链 ────────────────────────────────────────────────────

test('unknown 全链: exitCode=1 空 tail → cause=unknown → log_only 不触发 spawn', async (t) => {
  // S1: 证据
  const evidence = { exitCode: 1, stdoutTail: '', tmuxPane: null };

  // S2: 分类
  const result = classifyDeath(evidence);
  assert.equal(result.cause, 'unknown', '分类应为 unknown');
  assert.equal(result.action, 'log_only', 'action 应为 log_only');

  // S3: 路由模拟
  const spawnStub = makeSpawnStub();
  const out = { resumed: 0 };
  const logs = [];

  if (result.action === 'log_only') {
    // log_only → 不触发 spawnFn
    logs.push(`cause=${result.cause} action=${result.action}`);
    // out.resumed 不变
  } else {
    await spawnStub.fn({ taskId: 'task-3' });
    out.resumed++;
  }

  // 验收
  assert.equal(out.resumed, 0, 'resumed 不应增加');
  assert.equal(spawnStub._calls.length, 0, 'spawnFn 不应被调用');
  assert.ok(logs.some(l => l.includes('cause=unknown') && l.includes('action=log_only')),
    'log 应包含 cause=unknown action=log_only');
});
