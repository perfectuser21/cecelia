/**
 * Harness v2 M4 — harness-ci-gate 单元测试
 *
 * 覆盖：
 *   - classifyChecks 各种 bucket 组合
 *   - pollPRChecks PASS / FAIL / TIMEOUT / prUrl 缺失 / gh 命令抛错 / 多轮 pending 后 pass
 *
 * 不涉及真 gh CLI；全部通过 opts.exec + opts.sleep 注入 mock。
 */

import { describe, it, expect, vi } from 'vitest';
import { pollPRChecks, classifyChecks } from '../harness-ci-gate.js';

// ─── classifyChecks ────────────────────────────────────────────────────────

describe('classifyChecks', () => {
  it('空列表返回 PENDING', () => {
    expect(classifyChecks([]).overall).toBe('PENDING');
    expect(classifyChecks(null).overall).toBe('PENDING');
    expect(classifyChecks(undefined).overall).toBe('PENDING');
  });

  it('所有 pass → PASS', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'pass' },
      { name: 'L2', bucket: 'pass' },
    ]);
    expect(r.overall).toBe('PASS');
    expect(r.failed).toBeNull();
  });

  it('任一 fail → FAIL 并返回失败项', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'pass' },
      { name: 'L2', bucket: 'fail', link: 'https://x/actions/runs/1/job/2' },
    ]);
    expect(r.overall).toBe('FAIL');
    expect(r.failed.name).toBe('L2');
  });

  it('含 pending → PENDING', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'pass' },
      { name: 'L2', bucket: 'pending' },
    ]);
    expect(r.overall).toBe('PENDING');
  });

  it('skipping 视为 pass', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'pass' },
      { name: 'L2', bucket: 'skipping' },
    ]);
    expect(r.overall).toBe('PASS');
  });

  it('cancelled 视为 FAIL', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'cancel' },
    ]);
    expect(r.overall).toBe('FAIL');
  });

  it('state 字段兜底（没有 bucket）', () => {
    expect(classifyChecks([{ name: 'L1', state: 'SUCCESS' }]).overall).toBe('PASS');
    expect(classifyChecks([{ name: 'L1', state: 'FAILURE' }]).overall).toBe('FAIL');
  });
});

// ─── pollPRChecks helpers ──────────────────────────────────────────────────

/**
 * 构造一个 exec mock。
 *   - 每次收到 "gh pr checks" 按 checksSeq 轮换（最后一个 stick）
 *   - 收到 "gh run view ... --log-failed" 固定返回 failedLog
 */
function buildExec({ checksSeq, failedLog = 'MOCK FAILED LOG' }) {
  let i = 0;
  return (cmd) => {
    if (String(cmd).includes('gh run view')) return failedLog;
    const next = checksSeq[Math.min(i, checksSeq.length - 1)];
    i++;
    return JSON.stringify(next);
  };
}

// ─── pollPRChecks ──────────────────────────────────────────────────────────

describe('pollPRChecks', () => {
  const sleep = async () => { /* 不真 sleep */ };

  it('所有 check pass → PASS', async () => {
    const exec = buildExec({
      checksSeq: [[{ name: 'L1', bucket: 'pass' }]],
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 10000,
    });
    expect(r.status).toBe('PASS');
    expect(Array.isArray(r.checks)).toBe(true);
  });

  it('check fail → FAIL 带 failedCheck + logSnippet', async () => {
    const exec = buildExec({
      checksSeq: [[
        { name: 'L1', bucket: 'pass' },
        { name: 'L2', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/123/job/456' },
      ]],
      failedLog: 'Error: something bad',
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 10000,
    });
    expect(r.status).toBe('FAIL');
    expect(r.failedCheck.name).toBe('L2');
    expect(r.logSnippet).toContain('Error');
  });

  it('pending 超过 deadline → TIMEOUT', async () => {
    const exec = buildExec({
      checksSeq: [[{ name: 'L1', bucket: 'pending' }]],
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 3, // 3ms 立即超时
    });
    expect(r.status).toBe('TIMEOUT');
  });

  it('prUrl 缺失 → FAIL', async () => {
    const r = await pollPRChecks('', { exec: () => '[]', sleep });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toMatch(/prUrl/);
  });

  it('prUrl 非字符串 → FAIL', async () => {
    const r = await pollPRChecks(null, { exec: () => '[]', sleep });
    expect(r.status).toBe('FAIL');
  });

  it('gh 命令抛错 → FAIL', async () => {
    const exec = vi.fn(() => {
      throw new Error('gh: not logged in');
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 100,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toMatch(/gh pr checks 失败/);
  });

  it('pending 两次后 pass → PASS', async () => {
    const exec = buildExec({
      checksSeq: [
        [{ name: 'L1', bucket: 'pending' }],
        [{ name: 'L1', bucket: 'pending' }],
        [{ name: 'L1', bucket: 'pass' }],
      ],
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 10000,
    });
    expect(r.status).toBe('PASS');
  });

  it('fetchLogSnippet 只取最后 4KB', async () => {
    const huge = 'x'.repeat(10000);
    const exec = buildExec({
      checksSeq: [[
        { name: 'L1', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/1/job/2' },
      ]],
      failedLog: huge,
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet.length).toBeLessThanOrEqual(4000);
  });

  it('failedCheck 无 link → logSnippet 空', async () => {
    const exec = buildExec({
      checksSeq: [[{ name: 'L1', bucket: 'fail' }]], // 无 link
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toBe('');
  });
});
