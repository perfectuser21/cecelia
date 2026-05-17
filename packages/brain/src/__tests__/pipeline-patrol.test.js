import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _parseDevMode, _checkStuck, _scanDevModeFiles, STAGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from '../pipeline-patrol.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

describe('pipeline-patrol', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `pp-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('parseDevMode', () => {
    it('解析标准 .dev-mode 文件', () => {
      const filePath = path.join(tmpDir, '.dev-mode.cp-test');
      writeFileSync(filePath, `dev
branch: cp-test
task_card: .task-cp-test.md
started: 2026-03-21T08:00:00+08:00
step_0_worktree: done
step_1_spec: done
step_2_code: pending
step_3_integrate: pending
step_4_ship: pending
`);
      const parsed = _parseDevMode(filePath);
      expect(parsed).not.toBeNull();
      expect(parsed.branch).toBe('cp-test');
      expect(parsed.started).toBeInstanceOf(Date);
      expect(parsed.steps.step_0_worktree).toBe('done');
      expect(parsed.steps.step_1_spec).toBe('done');
      expect(parsed.steps.step_2_code).toBe('pending');
      expect(parsed.currentStage).toBe('step_2_code');
    });

    it('解析含 retry_count 和 last_block_reason 的文件', () => {
      const filePath = path.join(tmpDir, '.dev-mode.cp-retry');
      writeFileSync(filePath, `dev
branch: cp-retry
started: 2026-03-21T08:00:00+08:00
step_0_worktree: done
step_1_spec: done
step_2_code: done
step_3_integrate: pending
retry_count: 5
last_block_reason: CI 失败 (failure)
`);
      const parsed = _parseDevMode(filePath);
      expect(parsed.retry_count).toBe(5);
      expect(parsed.last_block_reason).toBe('CI 失败 (failure)');
      expect(parsed.currentStage).toBe('step_3_integrate');
    });

    it('解析 cleanup_done: true 的文件', () => {
      const filePath = path.join(tmpDir, '.dev-mode.cp-done');
      writeFileSync(filePath, `dev
branch: cp-done
cleanup_done: true
step_0_worktree: done
step_1_spec: done
step_2_code: done
step_3_integrate: done
step_4_ship: done
`);
      const parsed = _parseDevMode(filePath);
      expect(parsed.cleanup_done).toBe(true);
    });

    it('所有 step 都 done 时 currentStage 为 null', () => {
      const filePath = path.join(tmpDir, '.dev-mode.cp-alldone');
      writeFileSync(filePath, `dev
branch: cp-alldone
step_0_worktree: done
step_1_spec: done
step_2_code: done
step_3_integrate: done
step_4_ship: done
`);
      const parsed = _parseDevMode(filePath);
      expect(parsed.currentStage).toBeNull();
    });

    it('不存在的文件返回 null', () => {
      const parsed = _parseDevMode('/nonexistent/path/.dev-mode.xyz');
      expect(parsed).toBeNull();
    });
  });

  describe('checkStuck', () => {
    it('cleanup_done 不算卡住', () => {
      const result = _checkStuck({
        currentStage: 'step_2_code',
        cleanup_done: true,
        mtime: new Date(Date.now() - 60 * 60 * 1000),
      });
      expect(result.stuck).toBe(false);
    });

    it('无 currentStage 不算卡住', () => {
      const result = _checkStuck({
        currentStage: null,
        cleanup_done: false,
        mtime: new Date(Date.now() - 60 * 60 * 1000),
      });
      expect(result.stuck).toBe(false);
    });

    it('step_2_code 超过 20 分钟算卡住', () => {
      const result = _checkStuck({
        currentStage: 'step_2_code',
        cleanup_done: false,
        mtime: new Date(Date.now() - 25 * 60 * 1000), // 25 分钟前
        started: null,
      });
      expect(result.stuck).toBe(true);
      expect(result.elapsedMs).toBeGreaterThan(20 * 60 * 1000);
    });

    it('step_3_integrate 在 30 分钟时不算卡住（阈值 90 分钟）', () => {
      const result = _checkStuck({
        currentStage: 'step_3_integrate',
        cleanup_done: false,
        mtime: new Date(Date.now() - 30 * 60 * 1000), // 30 分钟前
        started: null,
      });
      expect(result.stuck).toBe(false);
    });

    it('step_3_integrate 超过 90 分钟算卡住', () => {
      const result = _checkStuck({
        currentStage: 'step_3_integrate',
        cleanup_done: false,
        mtime: new Date(Date.now() - 95 * 60 * 1000), // 95 分钟前
        started: null,
      });
      expect(result.stuck).toBe(true);
    });

    it('step_4_ship 超过 15 分钟算卡住', () => {
      const result = _checkStuck({
        currentStage: 'step_4_ship',
        cleanup_done: false,
        mtime: new Date(Date.now() - 20 * 60 * 1000), // 20 分钟前
        started: null,
      });
      expect(result.stuck).toBe(true);
    });

    it('无 timestamp 不算卡住', () => {
      const result = _checkStuck({
        currentStage: 'step_2_code',
        cleanup_done: false,
        mtime: null,
        started: null,
      });
      expect(result.stuck).toBe(false);
      expect(result.reason).toBe('no_timestamp');
    });
  });

  describe('scanDevModeFiles', () => {
    it('扫描目录中的 .dev-mode.* 文件', () => {
      writeFileSync(path.join(tmpDir, '.dev-mode.cp-branch1'), 'dev\nbranch: cp-branch1');
      writeFileSync(path.join(tmpDir, '.dev-mode.cp-branch2'), 'dev\nbranch: cp-branch2');
      writeFileSync(path.join(tmpDir, '.dev-lock.cp-branch1'), 'lock');
      writeFileSync(path.join(tmpDir, 'regular-file.txt'), 'data');

      const results = _scanDevModeFiles(tmpDir);
      expect(results).toHaveLength(2);
      expect(results.map(r => r.branch).sort()).toEqual(['cp-branch1', 'cp-branch2']);
    });

    it('空目录返回空数组', () => {
      const emptyDir = path.join(tmpDir, 'empty');
      mkdirSync(emptyDir, { recursive: true });
      const results = _scanDevModeFiles(emptyDir);
      expect(results).toHaveLength(0);
    });

    it('不存在的目录返回空数组', () => {
      const results = _scanDevModeFiles('/nonexistent/path');
      expect(results).toHaveLength(0);
    });
  });

  describe('STAGE_TIMEOUT_MS 常量', () => {
    it('Stage 1/2 阈值为 20 分钟', () => {
      expect(STAGE_TIMEOUT_MS.step_1_spec).toBe(20 * 60 * 1000);
      expect(STAGE_TIMEOUT_MS.step_2_code).toBe(20 * 60 * 1000);
    });

    it('Stage 3 阈值为 90 分钟', () => {
      expect(STAGE_TIMEOUT_MS.step_3_integrate).toBe(90 * 60 * 1000);
    });

    it('Stage 4 阈值为 15 分钟', () => {
      expect(STAGE_TIMEOUT_MS.step_4_ship).toBe(15 * 60 * 1000);
    });

    it('默认阈值为 20 分钟', () => {
      expect(DEFAULT_TIMEOUT_MS).toBe(20 * 60 * 1000);
    });
  });
});
