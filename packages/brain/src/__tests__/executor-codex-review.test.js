/** 现役Codex启动与回调接线；prompt和路由由真实消费者测试覆盖。 */
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
  describe('triggerCodexReview: codex CLI 调用', () => {
    it('使用 /opt/homebrew/bin/codex 路径', () => {
      expect(executorSrc).toContain('/opt/homebrew/bin/codex');
    });

    it('spawn 使用 codex exec 参数（非 claude CLI）', () => {
      expect(executorSrc).toContain("spawn(codexBin, ['exec'");
      expect(executorSrc).not.toContain("'--dangerously-skip-permissions'");
    });

    it('使用独立锁目录 codex-review-locks', () => {
      expect(executorSrc).toContain('codex-review-locks');
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

  it('error handler 清理 lockFile', () => {
    // handler 内必须有 unlinkSync(lockFile) 调用
    const errorHandlerIdx = executorSrc.indexOf("child.on('error'");
    const snippet = executorSrc.slice(errorHandlerIdx, errorHandlerIdx + 600);
    expect(snippet).toContain('unlinkSync(lockFile)');
  });

  it('error handler 回调 execution-callback 且 status=AI Failed', () => {
    const errorHandlerIdx = executorSrc.indexOf("child.on('error'");
    const snippet = executorSrc.slice(errorHandlerIdx, errorHandlerIdx + 600);
    expect(snippet).toContain('AI Failed');
    expect(snippet).toContain('execution-callback');
  });
});
