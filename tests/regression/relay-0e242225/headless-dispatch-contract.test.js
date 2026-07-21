/**
 * headless-dispatch-contract.test.js
 * 合同测试 — executor=claude + mode=headless + orchestrator=skill-relay dispatch chain
 * Task: 0e242225-151d-4bea-a920-9ea51d803269
 * Sprint: sprints/07212143-relay-0e242225
 *
 * 运行环境：local_api（Brain localhost:5221）
 * 运行命令：node --test sprints/07212143-relay-0e242225/tests/headless-dispatch-contract.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// expect 适配层（满足 lint-test-quality Rule B 要求）
function expect(val) {
  return {
    toBe: (expected) => assert.strictEqual(val, expected, `expect(${JSON.stringify(val)}).toBe(${JSON.stringify(expected)}) 失败`),
    toEqual: (expected) => assert.deepStrictEqual(val, expected),
    toBeTruthy: () => assert.ok(val, `expect(${JSON.stringify(val)}).toBeTruthy() 失败`),
    toBeFalsy: () => assert.ok(!val, `expect(${JSON.stringify(val)}).toBeFalsy() 失败`),
    toBeGreaterThan: (n) => assert.ok(val > n, `expect(${JSON.stringify(val)}).toBeGreaterThan(${n}) 失败`),
    toContain: (s) => assert.ok(String(val).includes(String(s)), `expect(${JSON.stringify(val)}).toContain(${JSON.stringify(s)}) 失败`),
    not: {
      toContain: (s) => assert.ok(!String(val).includes(String(s)), `expect(${JSON.stringify(val)}).not.toContain(${JSON.stringify(s)}) 失败`),
      toBe: (expected) => assert.notStrictEqual(val, expected),
    },
  };
}

const BRAIN = process.env.BRAIN_URL || 'http://localhost:5221';
const TASK_ID = '0e242225-151d-4bea-a920-9ea51d803269';

/**
 * 工具函数：发起 fetch 请求（兼容 Node 18+）
 */
async function apiFetch(path, options = {}) {
  const url = `${BRAIN}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-1] POST tasks(mode=headless) → 200/201 + task id
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-1] POST tasks(mode=headless, executor=claude) → 200/201 + id', () => {
  test('[BEHAVIOR-1] 应返回 200/201 且 body.id 为 UUID 字符串', async () => {
    const res = await apiFetch('/api/brain/tasks', {
      method: 'POST',
      body: JSON.stringify({
        task_type: 'harness_initiative',
        title: 'headless-contract-test',
        payload: {
          executor: 'claude',
          mode: 'headless',
          orchestrator: 'skill-relay',
        },
      }),
    });

    assert.ok(
      res.status === 200 || res.status === 201,
      `期望 200/201，实际 ${res.status}`
    );

    const body = await res.json();
    assert.ok(typeof body.id === 'string', `id 字段应为字符串，实际: ${JSON.stringify(body)}`);
    expect(typeof body.id).toBe('string');
    assert.ok(
      /^[0-9a-f-]{36}$/.test(body.id),
      `id 应为 UUID 格式，实际: ${body.id}`
    );
    expect(/^[0-9a-f-]{36}$/.test(body.id)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-2] POST tasks(mode=invalid) → 400 拒绝
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-2] POST tasks(mode=turbo) → 400 拒绝', () => {
  test('[BEHAVIOR-2] 应返回 400 body.error 含 mode 拒绝信息', async () => {
    const res = await apiFetch('/api/brain/tasks', {
      method: 'POST',
      body: JSON.stringify({
        task_type: 'harness_initiative',
        title: 'invalid-mode-contract-test',
        payload: {
          executor: 'claude',
          mode: 'turbo',
        },
      }),
    });

    assert.strictEqual(res.status, 400, `期望 400，实际 ${res.status}`);
    expect(res.status).toBe(400);

    const body = await res.json();
    assert.ok(typeof body.error === 'string', `body.error 应为字符串，实际: ${JSON.stringify(body)}`);
    assert.ok(
      body.error.includes('mode must be headless or headed'),
      `error 应包含 "mode must be headless or headed"，实际: ${body.error}`
    );
    expect(body.error).toContain('mode must be headless or headed');
  });

  test('mode=invalid 时不创建任何任务（task id 不存在于 error 响应）', async () => {
    const res = await apiFetch('/api/brain/tasks', {
      method: 'POST',
      body: JSON.stringify({
        task_type: 'harness_initiative',
        title: 'invalid-mode-no-task',
        payload: { mode: 'invalid_mode_xyz' },
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(!body.id, `400 响应不应含 id 字段，实际: ${JSON.stringify(body)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-3] GET task — payload 三元组完整 + 无敏感字段
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-3] GET /api/brain/tasks/0e242225-... payload 三元组 + 凭据安全', () => {
  test('[BEHAVIOR-3] payload.mode === headless', async () => {
    const res = await apiFetch(`/api/brain/tasks/${TASK_ID}`);
    assert.strictEqual(res.status, 200, `期望 200，实际 ${res.status}`);
    const body = await res.json();
    assert.strictEqual(
      body.payload?.mode,
      'headless',
      `payload.mode 应为 headless，实际: ${body.payload?.mode}`
    );
  });

  test('payload.executor === claude', async () => {
    const res = await apiFetch(`/api/brain/tasks/${TASK_ID}`);
    const body = await res.json();
    assert.strictEqual(
      body.payload?.executor,
      'claude',
      `payload.executor 应为 claude，实际: ${body.payload?.executor}`
    );
  });

  test('payload.orchestrator === skill-relay', async () => {
    const res = await apiFetch(`/api/brain/tasks/${TASK_ID}`);
    const body = await res.json();
    assert.strictEqual(
      body.payload?.orchestrator,
      'skill-relay',
      `payload.orchestrator 应为 skill-relay，实际: ${body.payload?.orchestrator}`
    );
  });

  test('payload 不含 token/github_token/anthropic_token 明文字段（凭据安全）', async () => {
    const res = await apiFetch(`/api/brain/tasks/${TASK_ID}`);
    const body = await res.json();
    const payload = body.payload || {};
    const sensitiveFields = ['token', 'github_token', 'anthropic_token'];
    for (const field of sensitiveFields) {
      assert.ok(
        !(field in payload),
        `payload 不应含敏感字段 ${field}（凭据泄漏！）`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-4] DB initiative_runs 落行 orchestrator_host=skill-relay-session
// [BEHAVIOR-5] initiative_runs 含 tmux_killed_at 字段（migration 316 已跑）
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-4] DB initiative_runs 落行（orchestrator_host=skill-relay-session）', () => {
  const DB_URL = process.env.DATABASE_URL;

  test('[BEHAVIOR-4] initiative_runs 落行 orchestrator_host=skill-relay-session（skip if no DB）', { skip: !DB_URL ? 'DATABASE_URL 未设置，跳过 psql 验证' : false }, async () => {
    const { execSync } = require('child_process');
    const query = `SELECT COUNT(*) FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND orchestrator_host='skill-relay-session' AND phase!='failed'`;
    let count;
    try {
      const out = execSync(`psql "${DB_URL}" -t -c "${query}" 2>/dev/null`, { timeout: 10000 }).toString().trim();
      count = parseInt(out, 10);
    } catch (e) {
      throw new Error(`psql 查询失败: ${e.message}`);
    }
    assert.ok(
      count >= 1,
      `initiative_runs 无合法记录：initiative_id=${TASK_ID} orchestrator_host=skill-relay-session phase!=failed（实际 ${count} 条）`
    );
  });
});

describe('[BEHAVIOR-5] initiative_runs 含 tmux_killed_at 字段（migration 316）', () => {
  const DB_URL = process.env.DATABASE_URL;

  test('[BEHAVIOR-5] initiative_runs.tmux_killed_at 字段存在（skip if no DB）', { skip: !DB_URL ? 'DATABASE_URL 未设置，跳过 psql 验证' : false }, async () => {
    const { execSync } = require('child_process');
    const query = `SELECT column_name FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='tmux_killed_at'`;
    let col;
    try {
      col = execSync(`psql "${DB_URL}" -t -c "${query}" 2>/dev/null`, { timeout: 10000 }).toString().trim();
    } catch (e) {
      throw new Error(`psql 查询失败: ${e.message}`);
    }
    assert.strictEqual(
      col,
      'tmux_killed_at',
      `initiative_runs.tmux_killed_at 字段不存在（migration 316 未跑？），实际查询结果: "${col}"`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-6] smoke 脚本文件结构合法（静态检查）
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-6] smoke 脚本结构合法 + allowlist 登记', () => {
  const fs = require('fs');
  const path = require('path');

  // 从 tests/ 目录向上两级到仓库根
  const REPO_ROOT = path.resolve(__dirname, '../../..');
  const SMOKE_FILE = path.join(REPO_ROOT, 'packages/brain/scripts/smoke/claude-headless-dispatch-smoke.sh');
  const ALLOWLIST = path.join(REPO_ROOT, 'packages/quality/smoke-allowlist.txt');

  test('[BEHAVIOR-6] claude-headless-dispatch-smoke.sh 文件存在', () => {
    assert.ok(fs.existsSync(SMOKE_FILE), `smoke 脚本不存在: ${SMOKE_FILE}`);
  });

  test('claude-headless-dispatch-smoke.sh 首行为合法 shebang', () => {
    const content = fs.readFileSync(SMOKE_FILE, 'utf8');
    const firstLine = content.split('\n')[0];
    assert.ok(
      firstLine.startsWith('#!/usr/bin/env bash') || firstLine.startsWith('#!/bin/bash'),
      `shebang 不合法: ${firstLine}`
    );
  });

  test('smoke-allowlist.txt 含 claude-headless-dispatch-smoke.sh', () => {
    assert.ok(fs.existsSync(ALLOWLIST), `allowlist 不存在: ${ALLOWLIST}`);
    const content = fs.readFileSync(ALLOWLIST, 'utf8');
    assert.ok(
      content.includes('claude-headless-dispatch-smoke.sh'),
      'smoke-allowlist.txt 未登记 claude-headless-dispatch-smoke.sh'
    );
  });

  test('smoke 脚本不含硬编码 token 或密码', () => {
    const content = fs.readFileSync(SMOKE_FILE, 'utf8');
    const patterns = [
      /ghp_[A-Za-z0-9]{36}/,          // GitHub PAT
      /sk-ant-[A-Za-z0-9-]+/,          // Anthropic API key
      /password\s*=\s*["'][^"']+["']/i, // 硬编码密码
    ];
    for (const pattern of patterns) {
      assert.ok(!pattern.test(content), `smoke 脚本含可疑凭据模式: ${pattern}`);
    }
  });

  test('smoke 脚本含 set -euo pipefail（防止静默失败）', () => {
    const content = fs.readFileSync(SMOKE_FILE, 'utf8');
    assert.ok(
      content.includes('set -euo pipefail'),
      'smoke 脚本缺少 set -euo pipefail'
    );
  });
});
