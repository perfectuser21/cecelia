/**
 * cleanup-lock — 跨进程 worktree 清理互斥锁单测
 *
 * 用 mkdir(2) 原子语义实现（跨 macOS/Linux），不依赖 flock(1)
 *
 * 验收：
 * - 同时 acquire 仅 1 个成功
 * - release 后下个 acquire 立即成功
 * - 持锁超过 stale 阈值后被新 acquire 强夺（避免 crash 锁泄漏）
 * - withLock 包裹的 fn 异常时锁仍释放
 * - timeout 后 acquire 失败返回 false（不抛）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmdirSync, mkdirSync, utimesSync } from 'fs';
import {
  acquireLock,
  releaseLock,
  withLock,
  LOCK_DIR_DEFAULT,
} from '../cleanup-lock.js';

const TEST_LOCK = '/tmp/cecelia-cleanup-test.lock';

function cleanupTestLock() {
  if (existsSync(TEST_LOCK)) {
    try { rmdirSync(TEST_LOCK); } catch { /* ignore */ }
  }
}

describe('cleanup-lock', () => {
  beforeEach(cleanupTestLock);
  afterEach(cleanupTestLock);

  it('LOCK_DIR_DEFAULT 是 /tmp/cecelia-cleanup.lock', () => {
    expect(LOCK_DIR_DEFAULT).toBe('/tmp/cecelia-cleanup.lock');
  });

  it('acquire → release 顺序正常', async () => {
    const ok = await acquireLock({ lockDir: TEST_LOCK });
    expect(ok).toBe(true);
    expect(existsSync(TEST_LOCK)).toBe(true);
    releaseLock({ lockDir: TEST_LOCK });
    expect(existsSync(TEST_LOCK)).toBe(false);
  });

  it('已持锁时立即 acquire（timeout 0）失败返回 false', async () => {
    mkdirSync(TEST_LOCK);
    const ok = await acquireLock({ lockDir: TEST_LOCK, timeoutMs: 100, retryMs: 50 });
    expect(ok).toBe(false);
  });

  it('release 后能再次 acquire', async () => {
    expect(await acquireLock({ lockDir: TEST_LOCK })).toBe(true);
    releaseLock({ lockDir: TEST_LOCK });
    expect(await acquireLock({ lockDir: TEST_LOCK })).toBe(true);
    releaseLock({ lockDir: TEST_LOCK });
  });

  it('stale 锁（mtime > staleMs）被强夺', async () => {
    mkdirSync(TEST_LOCK);
    // 把 mtime 改到 5 分钟前
    const oldTime = new Date(Date.now() - 5 * 60 * 1000);
    utimesSync(TEST_LOCK, oldTime, oldTime);

    const ok = await acquireLock({
      lockDir: TEST_LOCK,
      timeoutMs: 200,
      retryMs: 50,
      staleMs: 60 * 1000,  // 60s 阈值
    });
    expect(ok).toBe(true);
    releaseLock({ lockDir: TEST_LOCK });
  });

  it('withLock 正常路径执行 fn 并释放', async () => {
    let called = false;
    await withLock({ lockDir: TEST_LOCK }, async () => {
      called = true;
      expect(existsSync(TEST_LOCK)).toBe(true);
    });
    expect(called).toBe(true);
    expect(existsSync(TEST_LOCK)).toBe(false);
  });

  it('withLock fn 抛异常时锁仍释放', async () => {
    await expect(
      withLock({ lockDir: TEST_LOCK }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(existsSync(TEST_LOCK)).toBe(false);
  });

  it('withLock acquire 失败时 fn 不执行返回 null', async () => {
    mkdirSync(TEST_LOCK);
    let called = false;
    const result = await withLock(
      { lockDir: TEST_LOCK, timeoutMs: 100, retryMs: 50 },
      async () => { called = true; return 'ok'; }
    );
    expect(called).toBe(false);
    expect(result).toBe(null);
  });
});
