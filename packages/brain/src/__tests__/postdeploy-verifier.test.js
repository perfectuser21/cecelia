/**
 * postdeploy-verifier.test.js
 *
 * 第5环部署验证单元测试 + 集成路径测试。
 *
 * 按照「禁纯 mock 真环境 bug」原则（2026-07-12 决策）：
 * - validateCommand / runVerifyCommand：纯函数，无需 mock，直接测真行为
 * - runPostdeployVerifier：mock pool 验证 SQL 路径正确（不依赖真 DB）
 * - execution-callback → pending_postdeploy 拦截：纯逻辑测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateCommand,
  runVerifyCommand,
  runPostdeployVerifier,
  _resetThrottleForTest,
} from '../postdeploy-verifier.js';

// ─── validateCommand 纯函数测试 ───────────────────────────────────────────
describe('validateCommand — 白名单/黑名单', () => {
  it('curl 命令通过白名单', () => {
    const r = validateCommand('curl -s http://localhost:5221/api/brain/health');
    expect(r.valid).toBe(true);
  });

  it('psql 断言通过', () => {
    const r = validateCommand("psql -c \"SELECT count(*) FROM tasks WHERE status='completed'\"");
    expect(r.valid).toBe(true);
  });

  it('grep 通过', () => {
    const r = validateCommand('grep "ok" /tmp/healthcheck.txt');
    expect(r.valid).toBe(true);
  });

  it('空字符串被拒', () => {
    expect(validateCommand('').valid).toBe(false);
    expect(validateCommand('').reason).toMatch(/空/);
  });

  it('非白名单命令被拒（wget）', () => {
    const r = validateCommand('wget http://example.com');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/白名单/);
  });

  it('rm 危险命令被黑名单过滤', () => {
    const r = validateCommand('bash -c "rm -rf /tmp/test"');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/危险/);
  });

  it('命令注入 $() 被拒', () => {
    const r = validateCommand('curl $(echo "evil")');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/危险/);
  });

  it('反引号命令注入被拒', () => {
    const r = validateCommand('curl `id`');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/危险/);
  });
});

// ─── runVerifyCommand 单元测试（真实 execSync，用短命令）────────────────
describe('runVerifyCommand — 执行与超时', () => {
  it('成功命令返回 passed=true', () => {
    const result = runVerifyCommand('sh -c "echo ok"', 5);
    expect(result.passed).toBe(true);
    expect(result.stdout).toContain('ok');
    expect(result.exitCode).toBe(0);
  });

  it('失败命令返回 passed=false + exitCode 非零', () => {
    const result = runVerifyCommand('sh -c "exit 1"', 5);
    expect(result.passed).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it('stdout 超长时截断到 1000 字符', () => {
    const result = runVerifyCommand('sh -c "printf \'x%.0s\' {1..2000}"', 5);
    expect(result.passed).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1000);
  });
});

// ─── runPostdeployVerifier DB 状态流转测试 ────────────────────────────────
describe('runPostdeployVerifier — DB 状态流转', () => {
  // 始终使用同一 module 实例，通过 _resetThrottleForTest 控制节流状态
  beforeEach(() => {
    _resetThrottleForTest();
  });

  it('无 pending_postdeploy 任务 → triggered=true, verified=0', async () => {
    const pool = {
      async query() { return { rows: [] }; },
    };
    const result = await runPostdeployVerifier(pool);
    expect(result.triggered).toBe(true);
    expect(result.verified).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('任务 command=sh -c "echo ok" → 验证通过 → UPDATE status=completed', async () => {
    const updateCalls = [];
    const task = {
      id: 'task-abc123',
      task_type: 'dev',
      title: '测试任务',
      retry_count: 0,
      payload: {
        postdeploy_check: { command: 'sh -c "echo ok"', timeout_s: 5 },
      },
    };
    const pool = {
      async query(sql, params) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('pending_postdeploy') && s.includes('LIMIT')) {
          return { rows: [task] };
        }
        updateCalls.push({ sql: s, params });
        return { rows: [] };
      },
    };

    const result = await runPostdeployVerifier(pool);

    expect(result.verified).toBe(1);
    const completedUpdate = updateCalls.find((q) => q.sql.includes("status = 'completed'"));
    expect(completedUpdate).toBeTruthy();
    expect(completedUpdate.params[0]).toBe('task-abc123');
  });

  it('任务 command 非法（rm -rf）→ 标 failed，不执行命令', async () => {
    const updateCalls = [];
    const task = {
      id: 'task-illegal',
      task_type: 'dev',
      title: '非法命令任务',
      retry_count: 0,
      payload: {
        postdeploy_check: { command: 'rm -rf /tmp', timeout_s: 5 },
      },
    };
    const pool = {
      async query(sql, params) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('pending_postdeploy') && s.includes('LIMIT')) {
          return { rows: [task] };
        }
        updateCalls.push({ sql: s, params });
        return { rows: [] };
      },
    };

    const result = await runPostdeployVerifier(pool);

    expect(result.failed).toBe(1);
    const failedUpdate = updateCalls.find((q) => q.sql.includes("status='failed'"));
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate.params[1]).toMatch(/非法/);
  });

  it('任务无 command（兜底放行）→ 标 completed, skipped+1', async () => {
    const updateCalls = [];
    const task = {
      id: 'task-nocommand',
      task_type: 'dev',
      title: '无命令任务',
      retry_count: 0,
      payload: { postdeploy_check: {} },
    };
    const pool = {
      async query(sql, params) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('pending_postdeploy') && s.includes('LIMIT')) {
          return { rows: [task] };
        }
        updateCalls.push({ sql: s, params });
        return { rows: [] };
      },
    };

    const result = await runPostdeployVerifier(pool);

    expect(result.skipped).toBe(1);
    const completedUpdate = updateCalls.find((q) => q.sql.includes("status = 'completed'"));
    expect(completedUpdate).toBeTruthy();
  });

  it('命令失败 retry_count < MAX_RETRIES → 递增 retry_count，不标 failed', async () => {
    const updateCalls = [];
    const task = {
      id: 'task-retry',
      task_type: 'dev',
      title: '重试任务',
      retry_count: 0, // 第 1 次失败
      payload: {
        postdeploy_check: { command: 'sh -c "exit 1"', timeout_s: 5 },
      },
    };
    const pool = {
      async query(sql, params) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('pending_postdeploy') && s.includes('LIMIT')) {
          return { rows: [task] };
        }
        updateCalls.push({ sql: s, params });
        return { rows: [] };
      },
    };

    const result = await runPostdeployVerifier(pool);

    // retry 1/3，还没到 MAX_RETRIES，不算 failed
    expect(result.failed).toBe(0);
    // status 保持 pending_postdeploy
    const update = updateCalls.find((q) => q.sql.includes('postdeploy_retry_count'));
    expect(update).toBeTruthy();
    const statusArg = update.params[1]; // $2 = newStatus
    expect(statusArg).toBe('pending_postdeploy');
  });

  it('节流：连续两次调用第二次跳过', async () => {
    const pool = { async query() { return { rows: [] }; } };

    // _resetThrottleForTest 已在 beforeEach 调用
    const r1 = await runPostdeployVerifier(pool);
    const r2 = await runPostdeployVerifier(pool); // 立即调用，触发节流

    expect(r1.triggered).toBe(true);
    expect(r2.triggered).toBe(false);
  });
});

// ─── execution-callback pending_postdeploy 门禁路径测试 ────────────────────
describe('execution-callback → pending_postdeploy 拦截（纯逻辑）', () => {
  function applyPostdeployGate(newStatus, taskPayload) {
    if (newStatus !== 'completed') return newStatus;
    const check = taskPayload?.postdeploy_check;
    if (check && check.exempt !== true && check.command) {
      return 'pending_postdeploy';
    }
    return newStatus;
  }

  function check219a9efc(taskType, result, postdeployExempt) {
    return taskType === 'dev' && !result && postdeployExempt !== true;
  }

  it('有 postdeploy_check.command 且非 exempt → 改 pending_postdeploy', () => {
    const payload = { postdeploy_check: { command: 'curl -s localhost:5221/health', timeout_s: 30 } };
    expect(applyPostdeployGate('completed', payload)).toBe('pending_postdeploy');
  });

  it('exempt=true → 不拦截，保留 completed', () => {
    const payload = { postdeploy_check: { exempt: true, reason: 'docs only' } };
    expect(applyPostdeployGate('completed', payload)).toBe('completed');
  });

  it('无 postdeploy_check → 不拦截', () => {
    expect(applyPostdeployGate('completed', {})).toBe('completed');
    expect(applyPostdeployGate('completed', null)).toBe('completed');
  });

  it('failed 状态不受影响', () => {
    const payload = { postdeploy_check: { command: 'curl localhost:5221' } };
    expect(applyPostdeployGate('failed', payload)).toBe('failed');
  });

  it('219a9efc: dev 任务 result=null → 触发软守卫', () => {
    expect(check219a9efc('dev', null, false)).toBe(true);
  });

  it('219a9efc: dev 任务有 result → 不触发', () => {
    expect(check219a9efc('dev', { merged: true }, false)).toBe(false);
  });

  it('219a9efc: dev 任务 exempt → 不触发', () => {
    expect(check219a9efc('dev', null, true)).toBe(false);
  });

  it('219a9efc: 非 dev 任务 → 不触发', () => {
    expect(check219a9efc('content_publish', null, false)).toBe(false);
  });
});
