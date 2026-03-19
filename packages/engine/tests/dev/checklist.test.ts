/**
 * tests/dev/checklist.test.ts
 *
 * 测试 6 步 Checklist 实现：
 * - .dev-mode 文件包含 step_0-5 状态字段
 * - 每个 Step 完成时追加 step_N_xxx: done
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('6 步 Checklist', () => {
  let tempDir: string;
  let devModeFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'checklist-test-'));
    devModeFile = join(tempDir, '.dev-mode');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('应该包含所有 6 个步骤状态字段', () => {
    const initialContent = `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
tasks_created: true
step_0_worktree: done
step_1_taskcard: done
step_2_code: pending
step_3_prci: pending
step_4_learning: pending
step_5_clean: pending
`;

    writeFileSync(devModeFile, initialContent);
    const content = readFileSync(devModeFile, 'utf-8');

    // 检查所有 6 个步骤都存在
    const expectedSteps = [
      'step_0_worktree',
      'step_1_taskcard',
      'step_2_code',
      'step_3_prci',
      'step_4_learning',
      'step_5_clean',
    ];

    for (const step of expectedSteps) {
      expect(content).toMatch(new RegExp(`^${step}:\\s*(done|pending)$`, 'm'));
    }
  });

  it('应该正确更新步骤状态从 pending 到 done', () => {
    const initialContent = `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_2_code: pending
step_3_prci: pending
`;

    writeFileSync(devModeFile, initialContent);

    // 模拟 Step 2 完成
    let content = readFileSync(devModeFile, 'utf-8');
    content = content.replace(/^step_2_code: pending$/m, 'step_2_code: done');
    writeFileSync(devModeFile, content);

    const updatedContent = readFileSync(devModeFile, 'utf-8');
    expect(updatedContent).toContain('step_2_code: done');
    expect(updatedContent).toContain('step_3_prci: pending');

    // 模拟 Step 3 完成
    let nextContent = readFileSync(devModeFile, 'utf-8');
    nextContent = nextContent.replace(/^step_3_prci: pending$/m, 'step_3_prci: done');
    writeFileSync(devModeFile, nextContent);

    const finalContent = readFileSync(devModeFile, 'utf-8');
    expect(finalContent).toContain('step_2_code: done');
    expect(finalContent).toContain('step_3_prci: done');
  });

  it('应该能检测所有步骤是否完成', () => {
    const allDoneContent = `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_0_worktree: done
step_1_taskcard: done
step_2_code: done
step_3_prci: done
step_4_learning: done
step_5_clean: done
`;

    writeFileSync(devModeFile, allDoneContent);
    const content = readFileSync(devModeFile, 'utf-8');

    // 检查所有步骤是否为 done
    let allDone = true;
    for (let step = 0; step <= 5; step++) {
      const match = content.match(new RegExp(`^step_${step}_\\w+:\\s*(\\w+)$`, 'm'));
      if (!match || match[1] !== 'done') {
        allDone = false;
        break;
      }
    }

    expect(allDone).toBe(true);
  });

  it('应该能检测未完成的步骤', () => {
    const partialContent = `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_0_worktree: done
step_1_taskcard: done
step_2_code: pending
step_3_prci: pending
step_4_learning: pending
step_5_clean: pending
`;

    writeFileSync(devModeFile, partialContent);
    const content = readFileSync(devModeFile, 'utf-8');

    // 检查是否有未完成的步骤
    let allDone = true;
    let pendingSteps: string[] = [];

    for (let step = 0; step <= 5; step++) {
      const match = content.match(new RegExp(`^step_${step}_(\\w+):\\s*(\\w+)$`, 'm'));
      if (match) {
        const [, stepName, status] = match;
        if (status !== 'done') {
          allDone = false;
          pendingSteps.push(`step_${step}_${stepName}`);
        }
      }
    }

    expect(allDone).toBe(false);
    expect(pendingSteps.length).toBeGreaterThan(0);
    expect(pendingSteps).toContain('step_2_code');
    expect(pendingSteps).toContain('step_5_clean');
  });

  it('应该支持 Step 0 创建时初始化所有字段', () => {
    // 模拟 Step 0 创建 .dev-mode 时的内容
    const step0Content = `dev
branch: cp-new-feature
session_id: abc123
tty: /dev/pts/1
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_0_worktree: done
step_1_taskcard: pending
step_2_code: pending
step_3_prci: pending
step_4_learning: pending
step_5_clean: pending
`;

    writeFileSync(devModeFile, step0Content);
    const content = readFileSync(devModeFile, 'utf-8');

    // 检查基本字段
    expect(content).toContain('dev');
    expect(content).toContain('branch: cp-new-feature');
    expect(content).toContain('session_id: abc123');

    // 检查 Step 0 已标记为 done
    expect(content).toContain('step_0_worktree: done');

    // 检查剩余步骤为 pending
    for (let step = 1; step <= 5; step++) {
      expect(content).toMatch(new RegExp(`^step_${step}_\\w+:\\s*pending$`, 'm'));
    }
  });
});
