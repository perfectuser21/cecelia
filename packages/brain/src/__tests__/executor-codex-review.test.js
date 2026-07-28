/**
 * executor-codex-review.test.js
 *
 * 测试 triggerCodexReview 独立审查加固：
 * - REVIEW_TASK_TYPES 路由到 triggerCodexReview
 * - buildPrompt 对 spec_review 和 code_review_gate 的内容
 * - spawn 使用隔离 Docker review container
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 executor.js 源码进行静态检查（避免 mock 复杂性）
const executorSrc = readFileSync(
  join(__dirname, '../executor.js'),
  'utf8'
);

describe('executor: Codex 独立审查加固', () => {
  describe('REVIEW_TASK_TYPES', () => {
    it('包含 spec_review 和 code_review_gate', () => {
      expect(executorSrc).toContain("'spec_review'");
      expect(executorSrc).toContain("'code_review_gate'");
    });

    it('REVIEW_TASK_TYPES 路由到 triggerCodexReview', () => {
      expect(executorSrc).toContain('REVIEW_TASK_TYPES.includes');
      expect(executorSrc).toContain('triggerCodexReview');
    });
  });

  describe('triggerCodexReview: isolated container', () => {
    it('只预检 Docker client，不在 Brain 容器直接执行 Codex', () => {
      expect(executorSrc).toContain("process.env.DOCKER_BIN || '/usr/bin/docker'");
    });

    it('spawn 使用固定的最小权限容器参数', () => {
      expect(executorSrc).toContain(
        'spawn(dockerBin, buildCodexReviewDockerArguments({'
      );
      expect(executorSrc).not.toContain("'--dangerously-skip-permissions'");
    });

    it('将已验证 worktree/auth/image 交给专用容器，不继承 Brain cwd/env', () => {
      const start = executorSrc.indexOf('async function triggerCodexReview(task)');
      const end = executorSrc.indexOf('\nasync function ', start + 1);
      const triggerCodexReviewSrc = executorSrc.slice(start, end);

      expect(triggerCodexReviewSrc).toContain(
        'resolveCodexReviewWorktree'
      );
      expect(triggerCodexReviewSrc).toContain(
        'resolveCodexReviewAuthFile'
      );
      expect(triggerCodexReviewSrc).toContain(
        'resolveCodexReviewImage'
      );
      expect(triggerCodexReviewSrc).toContain(
        'spawn(dockerBin, buildCodexReviewDockerArguments({'
      );
      expect(triggerCodexReviewSrc).toContain(
        "cwd: '/'"
      );
      expect(triggerCodexReviewSrc).toContain(
        'env: buildCodexReviewDockerEnvironment'
      );
      expect(triggerCodexReviewSrc).not.toContain(
        "'--sandbox', 'danger-full-access'"
      );
    });

    it('使用独立锁目录 codex-review-locks', () => {
      expect(executorSrc).toContain('codex-review-locks');
    });
  });

  describe('buildPrompt: prompt 内容完整性', () => {
    it('spec_review buildPrompt 读取 taskCardContent', () => {
      expect(executorSrc).toContain('taskCardContent');
    });

    it('spec_review 使用 readFileSync 读取文件', () => {
      expect(executorSrc).toContain('readFileSync');
    });

    it('code_review_gate 用无 shell 的 git diff 从 exact worktree 取完整改动', () => {
      expect(executorSrc).toContain("'--no-ext-diff'");
      expect(executorSrc).toContain("'origin/main..HEAD'");
      expect(executorSrc).toContain('execFileSync');
    });
  });

  describe('回调机制', () => {
    it('execution-callback 回调存在', () => {
      expect(executorSrc).toContain('execution-callback');
    });

    it('verdict 解析存在', () => {
      expect(executorSrc).toContain('verdict');
    });
  });
});

describe('triggerCodexReview: spawn error handler', () => {
  it('child.on("error") handler 存在 — 防止 ENOENT 成为 Uncaught Exception', () => {
    expect(executorSrc).toContain("child.on('error'");
  });

  it('error handler 清理原子 slot 目录', () => {
    const errorHandlerIdx = executorSrc.indexOf("child.on('error'");
    const snippet = executorSrc.slice(errorHandlerIdx, errorHandlerIdx + 600);
    expect(snippet).toContain('finalizeCodexReview');
    expect(executorSrc).toContain(
      'rm(slotPath, { recursive: true, force: true })'
    );
  });

  it('error handler 写 durable callback_queue 且 status=AI Failed', () => {
    const errorHandlerIdx = executorSrc.indexOf("child.on('error'");
    const snippet = executorSrc.slice(errorHandlerIdx, errorHandlerIdx + 2_600);
    expect(snippet).toContain('AI Failed');
    expect(executorSrc).toContain('INSERT INTO callback_queue');
  });
});

describe('executor: buildPrompt case 路由', () => {
  it("spec_review 有专属路由处理", () => {
    // 重构后用 routes 对象，由 _prepareSpecReviewPrompt 处理
    expect(executorSrc).toContain("spec_review");
    expect(executorSrc).toContain("_prepareSpecReviewPrompt");
  });

  it("code_review_gate 有专属路由处理", () => {
    // 重构后用 routes 对象，由 _prepareCodeReviewGatePrompt 处理
    expect(executorSrc).toContain("code_review_gate");
    expect(executorSrc).toContain("_prepareCodeReviewGatePrompt");
  });
});
