import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { probeCodexReviewLock, CODEX_REVIEW_LOCK_DIR } from '../codex-review-liveness.js';

// codex-review 活性 SSOT（决策 9befa9c3，issue f1d6840f）：
// lock 由 triggerCodexReview spawn 前写入、error/exit handler 删除——存在即在跑。
describe('probeCodexReviewLock', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'codex-lock-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('lock 存在且新鲜 → alive', () => {
    writeFileSync(path.join(dir, 'task-1.lock'),
      JSON.stringify({ taskId: 'task-1', startedAt: new Date().toISOString() }));
    expect(probeCodexReviewLock('task-1', { lockDir: dir })).toBe('alive');
  });

  it('lock 超龄（>maxAgeMinutes）→ dead', () => {
    const old = new Date(Date.now() - 120 * 60 * 1000).toISOString();
    writeFileSync(path.join(dir, 'task-2.lock'),
      JSON.stringify({ taskId: 'task-2', startedAt: old }));
    expect(probeCodexReviewLock('task-2', { lockDir: dir, maxAgeMinutes: 90 })).toBe('dead');
  });

  it('lock 缺失 → dead（exit handler 已收尸或容器重启，双确认流程给出回队出路）', () => {
    expect(probeCodexReviewLock('task-3', { lockDir: dir })).toBe('dead');
  });

  it('lock 存在但内容损坏 → alive（写入竞态，保守视为在跑）', () => {
    writeFileSync(path.join(dir, 'task-4.lock'), '{broken');
    expect(probeCodexReviewLock('task-4', { lockDir: dir })).toBe('alive');
  });

  it('默认 lockDir 为 /tmp/codex-review-locks（与 executor 写入点一致）', () => {
    expect(CODEX_REVIEW_LOCK_DIR).toBe('/tmp/codex-review-locks');
  });
});
