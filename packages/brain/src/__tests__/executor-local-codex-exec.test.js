/**
 * executor-local-codex-exec.test.js
 *
 * 测试 triggerLocalCodexExec 独立审查池：
 * - REVIEW_LOCK_DIR 和 MAX_REVIEW_SLOTS 常量
 * - 路由规则：spec_review / code_review_gate → triggerLocalCodexExec
 * - 独立 2-slot 池（不占用 cecelia-run 的 10-slot 池）
 * - codex-bin exec 调用方式
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
    it('REVIEW_LOCK_DIR 指向 codex-review-locks', () => {
      expect(executorSrc).toContain("REVIEW_LOCK_DIR = '/tmp/codex-review-locks'");
    });

    it('MAX_REVIEW_SLOTS = 2（独立 2-slot 池）', () => {
      expect(executorSrc).toContain('MAX_REVIEW_SLOTS = 2');
    });
  });

  describe('函数定义', () => {
    it('triggerLocalCodexExec 函数存在', () => {
      expect(executorSrc).toContain('async function triggerLocalCodexExec(task)');
    });

    it('使用 codex-bin exec 模式（通过 shell 脚本启动）', () => {
      // triggerLocalCodexExec 通过 bash 脚本调用 codex-bin exec
      expect(executorSrc).toContain("codex-bin");
      expect(executorSrc).toContain("exec --model");
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
      expect(executorSrc).toContain('review_slots_full');
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
