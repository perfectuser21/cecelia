/**
 * shepherd.js — 终态任务保护 + mergeable=UNKNOWN 修复回归测试
 *
 * 三个回归场景：
 * 1. failed/completed 任务不被 shepherd 主 SELECT 选中（防 re-queue）
 * 2. 主 SELECT 的 re-queue UPDATE 带终态状态守卫（双重防护）
 * 3. ciStatus='ci_passed' + mergeable='UNKNOWN' 应触发合并尝试（非无限轮询等待）
 *    GitHub 对还没计算出 mergeability 的 OPEN PR 正常返回 UNKNOWN，
 *    必须当成"尝试合并，让 GitHub 返回真实错误"而非"永远等待"。
 *
 * 相关历史 PR：同 task+PR+SHA 唯一 run 控制面修复。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  quarantineTask: vi.fn().mockResolvedValue({ success: true }),
}));

import { spawnSync } from 'child_process';
import { shepherdOpenPRs } from '../shepherd.js';

// ─── 场景 1: 主 SELECT WHERE 排除终态任务 ──────────────────────────────────
describe('shepherd 主 SELECT 排除终态任务', () => {
  it('SELECT WHERE 应排除 failed 状态', async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({ rows: [] });
    await shepherdOpenPRs({ query: queryMock });
    const sql = queryMock.mock.calls[0][0];
    // 修复前：只排除 quarantined 和 cancelled；failed 和 completed 会被选中
    // 修复后：必须也排除 failed 和 completed
    expect(sql).toMatch(/'failed'/);
  });

  it('SELECT WHERE 应排除 completed 状态', async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({ rows: [] });
    await shepherdOpenPRs({ query: queryMock });
    const sql = queryMock.mock.calls[0][0];
    expect(sql).toMatch(/'completed'/);
  });

  it('failed 任务即使有 pr_url 也不被 shepherd 选中从而不被 re-queue', async () => {
    // 模拟：仅一个 failed 任务，shepherd SELECT 不应拿到它
    // 修复后：rows 永远为 []（因为 SELECT 排除了 failed）
    const queryMock = vi.fn().mockResolvedValueOnce({ rows: [] }); // 空结果
    const result = await shepherdOpenPRs({ query: queryMock });
    // 验证：processed=0，没有执行任何 gh CLI 调用
    expect(result.processed).toBe(0);
    expect(spawnSync).not.toHaveBeenCalled();
  });
});

// ─── 场景 2: re-queue UPDATE 终态状态守卫 ─────────────────────────────────
describe('shepherd re-queue UPDATE 终态守卫', () => {
  beforeEach(() => vi.mocked(spawnSync).mockReset());

  it('CI 失败重排 UPDATE SQL 应含终态排除条件以防止 completed/failed 任务被回退到 queued', async () => {
    // 让 checkPrStatus 返回 ci_failed，触发 re-queue 路径
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE' }), stderr: '' }) // state+mergeable
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE', status: 'COMPLETED' }] }), stderr: '' }); // checks

    const updates = [];
    const queryMock = vi.fn(async (sql, params) => {
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            id: 'task-failed-1',
            title: 'test',
            pr_url: 'https://github.com/x/y/pull/10',
            pr_status: 'open',
            retry_count: 0,
            payload: {},
          }],
        };
      }
      updates.push({ sql, params });
      return { rowCount: 1 };
    });

    await shepherdOpenPRs({ query: queryMock });

    // 找到 re-queue 的 UPDATE（SET status='queued'）
    const requeueUpdate = updates.find(u =>
      /UPDATE\s+tasks/i.test(u.sql) &&
      /status\s*=\s*'queued'/i.test(u.sql)
    );
    // 修复前：re-queue UPDATE 没有 WHERE 终态守卫，completed/failed 任务可被回退到 queued
    // 修复后：必须含 AND status NOT IN (terminal states)
    expect(requeueUpdate).toBeDefined();
    // WHERE 子句必须排除终态状态
    expect(requeueUpdate.sql).toMatch(/status\s+NOT\s+IN|status\s*!=|status\s*<>/i);
  });
});

// ─── 场景 3: mergeable=UNKNOWN 应尝试合并而非无限等待 ─────────────────────
describe('shepherd mergeable=UNKNOWN 触发合并尝试', () => {
  beforeEach(() => vi.mocked(spawnSync).mockReset());

  it('ciStatus=ci_passed + mergeable=UNKNOWN 应调用 executeMerge（非无限轮询等待）', async () => {
    // GitHub 对 OPEN PR 在未计算 mergeability 时返回 UNKNOWN
    // 修复前：此路径进入 else-if(mergeable !== MERGEABLE) → 只 log + set pr_status=ci_passed → 无限循环
    // 修复后：UNKNOWN 应与 MERGEABLE 同等处理，尝试 auto-merge
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'OPEN', mergeable: 'UNKNOWN' }), stderr: '' }) // state+mergeable
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] }), stderr: '' }) // CI checks
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // executeMerge 成功
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN' }), stderr: '' }); // reload 后已 MERGED

    const updates = [];
    const queryMock = vi.fn(async (sql, params) => {
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            id: 'task-unknown-mergeable',
            title: 'test ci_passed + UNKNOWN',
            pr_url: 'https://github.com/x/y/pull/99',
            pr_status: 'ci_passed',
            retry_count: 0,
            payload: {},
          }],
        };
      }
      updates.push({ sql, params });
      return { rowCount: 1 };
    });

    const result = await shepherdOpenPRs({ query: queryMock });

    // executeMerge 应被调用（第三次 spawnSync 调用是 gh pr merge）
    const [cmd, args] = vi.mocked(spawnSync).mock.calls[2];
    expect(cmd).toBe('gh');
    expect(args).toContain('merge');
    // 应进入 merged 计数
    expect(result.merged).toBeGreaterThanOrEqual(1);
  });

  it('ciStatus=ci_passed + mergeable=CONFLICTING 不应尝试合并', async () => {
    // CONFLICTING 是真实的合并冲突，不应强行 merge
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'OPEN', mergeable: 'CONFLICTING' }), stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }] }), stderr: '' });

    const updates = [];
    const queryMock = vi.fn(async (sql, params) => {
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            id: 'task-conflicting',
            title: 'test ci_passed + CONFLICTING',
            pr_url: 'https://github.com/x/y/pull/100',
            pr_status: 'open',
            retry_count: 0,
            payload: {},
          }],
        };
      }
      updates.push({ sql, params });
      return { rowCount: 1 };
    });

    await shepherdOpenPRs({ query: queryMock });

    // gh pr merge 不应被调用
    const mergeCalls = vi.mocked(spawnSync).mock.calls.filter(c =>
      Array.isArray(c[1]) && c[1].includes('merge')
    );
    expect(mergeCalls).toHaveLength(0);
  });
});
