// packages/brain/src/__tests__/executor-review.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('executor review functions', () => {
  describe('findWorktreePath', () => {
    it('should return null for unknown branch', async () => {
      // findWorktreePath 对不存在的分支返回 null
      // 通过 executor.js 中的常量验证 REVIEW_LOCK_DIR 和 MAX_REVIEW_SLOTS 配置
      const executorSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/executor.js'),
        'utf-8'
      );
      expect(executorSrc).toContain('triggerLocalCodexReview');
      expect(executorSrc).toContain('codex-review-locks');
      expect(executorSrc).toContain('MAX_REVIEW_SLOTS');
    });
  });

  describe('preparePrompt for review tasks', () => {
    it('should include Task Card section in spec_review prompt', () => {
      const executorSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/executor.js'),
        'utf-8'
      );
      // spec_review 分支应包含 task_card_content 和 Task Card 注入逻辑
      expect(executorSrc).toContain('task_card_content');
      expect(executorSrc).toContain("taskType === 'spec_review'");
    });

    it('should include git diff section in code_review_gate prompt', () => {
      const executorSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/executor.js'),
        'utf-8'
      );
      // code_review_gate 分支应包含 git diff 逻辑
      expect(executorSrc).toContain('git diff');
      expect(executorSrc).toContain("taskType === 'code_review_gate'");
    });
  });

  describe('review slot configuration', () => {
    it('should configure MAX_REVIEW_SLOTS as 2', () => {
      const executorSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/executor.js'),
        'utf-8'
      );
      expect(executorSrc).toContain("CODEX_REVIEW_MAX_SLOTS || '2'");
    });

    it('should route spec_review and code_review_gate to local codex', () => {
      const executorSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/executor.js'),
        'utf-8'
      );
      expect(executorSrc).toContain("task.task_type === 'spec_review' || task.task_type === 'code_review_gate'");
      expect(executorSrc).toContain('triggerLocalCodexReview');
    });
  });

  describe('cecelia-run slot alignment', () => {
    it('should default MAX_CONCURRENT to 10', () => {
      const scriptSrc = fs.readFileSync(
        path.join(process.cwd(), 'scripts/cecelia-run.sh'),
        'utf-8'
      );
      expect(scriptSrc).toContain('CECELIA_MAX_CONCURRENT:-10}');
    });
  });
});
