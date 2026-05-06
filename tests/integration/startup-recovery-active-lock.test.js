/**
 * startup-recovery-active-lock.test.js — W7.3 Bug #E 集成测试
 *
 * 用真实 tmp 目录验证 cleanupStaleWorktrees 不再误清正在使用的 worktree。
 * 5/6 事故：Brain 启动 → cleanupStaleWorktrees 把 4 个 cp-* worktree 全删了，
 * 因为它们不在 git worktree list（agent worktrees 通常在不同 git repo 别名下）。
 *
 * 修复后：worktree 含 .dev-lock 或 .dev-mode.* 且 mtime 在 24h 内 → 跳过删除。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { cleanupStaleWorktrees, hasActiveDevLock } from '../../packages/brain/src/startup-recovery.js';

describe('cleanupStaleWorktrees 保护活跃 lock（W7.3 Bug #E）', () => {
  let testRoot;
  let worktreeBase;

  beforeEach(() => {
    testRoot = join(os.tmpdir(), `cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    worktreeBase = join(testRoot, 'worktrees');
    mkdirSync(worktreeBase, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('[BEHAVIOR] worktree 含活跃 .dev-lock → 不被清理', async () => {
    const wt = join(worktreeBase, 'cp-active');
    mkdirSync(wt);
    writeFileSync(
      join(wt, '.dev-lock'),
      JSON.stringify({ owner: 'session-x', created_at: new Date().toISOString() })
    );

    // repoRoot = testRoot 让 git worktree prune/list 失败但不抛（指向无 .git 的目录）
    const stats = await cleanupStaleWorktrees({ repoRoot: testRoot, worktreeBase });

    // worktree 必须还在（保护生效）
    expect(existsSync(wt)).toBe(true);
    // 至少一次 skip 计数（具体值依 git list 失败时是否走到 scan）
    expect(stats.skipped_active_lock).toBeGreaterThanOrEqual(1);
    expect(stats.removed).toBe(0);
  });

  it('[BEHAVIOR] worktree 含 .dev-mode.cp-xyz 24h 内修改 → 不被清理', async () => {
    const wt = join(worktreeBase, 'cp-active2');
    mkdirSync(wt);
    writeFileSync(
      join(wt, '.dev-mode.cp-xyz'),
      JSON.stringify({ branch: 'cp-xyz', stage: 'step_2_implementation' })
    );

    const stats = await cleanupStaleWorktrees({ repoRoot: testRoot, worktreeBase });

    expect(existsSync(wt)).toBe(true);
    expect(stats.skipped_active_lock).toBeGreaterThanOrEqual(1);
    expect(stats.removed).toBe(0);
  });

  it('worktree 含 .dev-lock 但 mtime 超过 24h → 视为残留可清理', async () => {
    const wt = join(worktreeBase, 'cp-stale-lock');
    mkdirSync(wt);
    const lockPath = join(wt, '.dev-lock');
    writeFileSync(lockPath, '{}');
    // 设置 mtime 为 25h 前
    const oldTime = (Date.now() - 25 * 3600 * 1000) / 1000;
    utimesSync(lockPath, oldTime, oldTime);

    const stats = await cleanupStaleWorktrees({ repoRoot: testRoot, worktreeBase });

    // 24h 外的 lock 不再保护，正常清理路径接管
    expect(stats.skipped_active_lock).toBe(0);
    // 注意：repoRoot 不是 git repo 所以 prune 会报错；但 scan 仍然执行 → wt 应被删除
    expect(existsSync(wt)).toBe(false);
    expect(stats.removed).toBe(1);
  });

  it('worktree 无 lock → 该清理就清理（保护逻辑不影响普通 stale 路径）', async () => {
    const wt = join(worktreeBase, 'plain-stale-wt');
    mkdirSync(wt);
    writeFileSync(join(wt, 'README.md'), 'stale data');

    const stats = await cleanupStaleWorktrees({ repoRoot: testRoot, worktreeBase });

    expect(existsSync(wt)).toBe(false);
    expect(stats.skipped_active_lock).toBe(0);
    expect(stats.removed).toBe(1);
  });
});

describe('hasActiveDevLock（W7.3 Bug #E）', () => {
  let testRoot;

  beforeEach(() => {
    testRoot = join(os.tmpdir(), `hasactive-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('.dev-lock 24h 内 → true', () => {
    writeFileSync(join(testRoot, '.dev-lock'), '{}');
    expect(hasActiveDevLock(testRoot)).toBe(true);
  });

  it('.dev-mode.<branch> 24h 内 → true', () => {
    writeFileSync(join(testRoot, '.dev-mode.cp-test'), 'data');
    expect(hasActiveDevLock(testRoot)).toBe(true);
  });

  it('worktree 不存在 → false（不抛）', () => {
    expect(hasActiveDevLock(join(testRoot, 'nonexistent'))).toBe(false);
  });

  it('worktree 存在但无任何 lock 文件 → false', () => {
    expect(hasActiveDevLock(testRoot)).toBe(false);
  });

  it('.dev-lock 超过 24h → false', () => {
    const p = join(testRoot, '.dev-lock');
    writeFileSync(p, '{}');
    const oldTime = (Date.now() - 25 * 3600 * 1000) / 1000;
    utimesSync(p, oldTime, oldTime);
    expect(hasActiveDevLock(testRoot)).toBe(false);
  });
});
