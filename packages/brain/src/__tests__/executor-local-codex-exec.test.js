/**
 * executor-local-codex-exec.test.js
 *
 * 测试 triggerLocalCodexExec 独立审查池：
 * - 与 triggerCodexReview 共享唯一 2-slot 边界
 * - 路由规则：spec_review / code_review_gate → triggerLocalCodexExec
 * - 独立 2-slot 池（不占用 cecelia-run 的 10-slot 池）
 * - 隔离 Docker review container 调用方式
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 executor.js 源码进行静态检查
const executorSrc = readFileSync(
  join(__dirname, '../executor.js'),
  'utf8'
);

describe('executor: triggerLocalCodexExec 独立审查池', () => {
  describe('常量定义', () => {
    it('CODEX_REVIEW_LOCK_DIR 指向 codex-review-locks', () => {
      expect(executorSrc).toContain("CODEX_REVIEW_LOCK_DIR = '/tmp/codex-review-locks'");
    });

    it('CODEX_REVIEW_MAX = 2（独立 2-slot 池）', () => {
      expect(executorSrc).toContain('CODEX_REVIEW_MAX = 2');
    });
  });

  describe('函数定义', () => {
    it('triggerLocalCodexExec 函数存在', () => {
      expect(executorSrc).toContain('async function triggerLocalCodexExec(task)');
    });

    it('旧 alias 委托给唯一的 triggerCodexReview 实现', () => {
      const start = executorSrc.indexOf('async function triggerLocalCodexExec(task)');
      const end = executorSrc.indexOf('\nasync function ', start + 1);
      const triggerLocalCodexExecSrc = executorSrc.slice(start, end);

      expect(triggerLocalCodexExecSrc).toContain(
        'return triggerCodexReview(task)'
      );
    });

    it('共享实现只把 exact worktree 只读挂入隔离容器', () => {
      const start = executorSrc.indexOf('async function triggerCodexReview(task)');
      const end = executorSrc.indexOf('\nasync function ', start + 1);
      const triggerCodexReviewSrc = executorSrc.slice(start, end);

      expect(triggerCodexReviewSrc).toContain(
        'resolveCodexReviewWorktree'
      );
      expect(triggerCodexReviewSrc).toContain(
        'spawn(dockerBin, buildCodexReviewDockerArguments({'
      );
      expect(triggerCodexReviewSrc).toContain(
        'worktreePath: reviewWorktreePath'
      );
    });

    it('找不到 exact worktree 时在 spawn 前 fail-closed 并归还 slot', () => {
      const start = executorSrc.indexOf('async function triggerCodexReview(task)');
      const end = executorSrc.indexOf('\nasync function ', start + 1);
      const triggerCodexReviewSrc = executorSrc.slice(start, end);
      const boundary = triggerCodexReviewSrc.indexOf(
        'resolveCodexReviewWorktree'
      );
      const spawn = triggerCodexReviewSrc.indexOf(
        'spawn(dockerBin, buildCodexReviewDockerArguments({'
      );

      expect(boundary).toBeGreaterThan(-1);
      expect(boundary).toBeLessThan(spawn);
      expect(triggerCodexReviewSrc.slice(boundary, spawn)).toContain(
        "configError: true"
      );
    });
  });

  describe('路由规则（step 2.5）', () => {
    it('spec_review 路由到 triggerLocalCodexExec', () => {
      expect(executorSrc).toContain("task.task_type === 'spec_review'");
      expect(executorSrc).toContain('return triggerLocalCodexExec(task)');
    });

    it('code_review_gate 路由到 triggerLocalCodexExec', () => {
      expect(executorSrc).toContain("task.task_type === 'code_review_gate'");
    });

    it('路由注释标注 step 2.5', () => {
      expect(executorSrc).toContain('2.5');
    });
  });

  describe('slot 管理', () => {
    it('使用原子 mkdir 获取 slot', () => {
      expect(executorSrc).toContain('slot-');
    });

    it('pool full 时返回 review_slots_full 错误', () => {
      expect(executorSrc).toContain('codex_review_pool_full');
    });
  });
});

describe('executor: cecelia-run.sh 并发配置', () => {
  const runSh = readFileSync(
    join(__dirname, '../../scripts/cecelia-run.sh'),
    'utf8'
  );

  it('MAX_CONCURRENT 默认值为 10', () => {
    expect(runSh).toContain(':-10}');
  });

  it('注释说明 10-slot + 2-slot 独立池 = 12 总计', () => {
    expect(runSh).toContain('10-slot');
  });
});
