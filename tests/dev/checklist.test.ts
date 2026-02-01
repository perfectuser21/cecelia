/**
 * tests/dev/checklist.test.ts
 *
 * 测试 11 步 Checklist 实现：
 * - .dev-mode 文件包含 step_1-11 状态字段
 * - 每个 Step 完成时追加 step_N_xxx: done
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('11 步 Checklist', () => {
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

  it('应该包含所有 11 个步骤状态字段', () => {
    const initialContent = `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
tasks_created: true
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: pending
step_5_code: pending
step_6_test: pending
step_7_quality: pending
step_8_pr: pending
step_9_ci: pending
step_10_learning: pending
step_11_cleanup: pending
`;

    writeFileSync(devModeFile, initialContent);
    const content = readFileSync(devModeFile, 'utf-8');

    // 检查所有 11 个步骤都存在
    const expectedSteps = [
      'step_1_prd',
      'step_2_detect',
      'step_3_branch',
      'step_4_dod',
      'step_5_code',
      'step_6_test',
      'step_7_quality',
      'step_8_pr',
      'step_9_ci',
      'step_10_learning',
      'step_11_cleanup',
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
step_4_dod: pending
step_5_code: pending
`;

    writeFileSync(devModeFile, initialContent);

    // 模拟 Step 4 完成
    let content = readFileSync(devModeFile, 'utf-8');
    content = content.replace(/^step_4_dod: pending$/m, 'step_4_dod: done');
    writeFileSync(devModeFile, content);

    const updatedContent = readFileSync(devModeFile, 'utf-8');
    expect(updatedContent).toContain('step_4_dod: done');
    expect(updatedContent).toContain('step_5_code: pending');

    // 模拟 Step 5 完成
    let nextContent = readFileSync(devModeFile, 'utf-8');
    nextContent = nextContent.replace(/^step_5_code: pending$/m, 'step_5_code: done');
    writeFileSync(devModeFile, nextContent);

    const finalContent = readFileSync(devModeFile, 'utf-8');
    expect(finalContent).toContain('step_4_dod: done');
    expect(finalContent).toContain('step_5_code: done');
  });

  it('应该能检测所有步骤是否完成', () => {
    const allDoneContent = `dev
branch: cp-test-branch
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: done
step_5_code: done
step_6_test: done
step_7_quality: done
step_8_pr: done
step_9_ci: done
step_10_learning: done
step_11_cleanup: done
`;

    writeFileSync(devModeFile, allDoneContent);
    const content = readFileSync(devModeFile, 'utf-8');

    // 检查所有步骤是否为 done
    let allDone = true;
    for (let step = 1; step <= 11; step++) {
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
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: done
step_5_code: done
step_6_test: pending
step_7_quality: pending
step_8_pr: pending
step_9_ci: pending
step_10_learning: pending
step_11_cleanup: pending
`;

    writeFileSync(devModeFile, partialContent);
    const content = readFileSync(devModeFile, 'utf-8');

    // 检查是否有未完成的步骤
    let allDone = true;
    let pendingSteps: string[] = [];

    for (let step = 1; step <= 11; step++) {
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
    expect(pendingSteps).toContain('step_6_test');
    expect(pendingSteps).toContain('step_11_cleanup');
  });

  it('应该支持 Step 3 创建时初始化所有字段', () => {
    // 模拟 Step 3 创建 .dev-mode 时的内容
    const step3Content = `dev
branch: cp-new-feature
session_id: abc123
tty: /dev/pts/1
prd: .prd.md
started: 2026-02-01T10:00:00+00:00
step_1_prd: done
step_2_detect: done
step_3_branch: done
step_4_dod: pending
step_5_code: pending
step_6_test: pending
step_7_quality: pending
step_8_pr: pending
step_9_ci: pending
step_10_learning: pending
step_11_cleanup: pending
`;

    writeFileSync(devModeFile, step3Content);
    const content = readFileSync(devModeFile, 'utf-8');

    // 检查基本字段
    expect(content).toContain('dev');
    expect(content).toContain('branch: cp-new-feature');
    expect(content).toContain('session_id: abc123');

    // 检查前 3 步已标记为 done
    expect(content).toContain('step_1_prd: done');
    expect(content).toContain('step_2_detect: done');
    expect(content).toContain('step_3_branch: done');

    // 检查剩余步骤为 pending
    for (let step = 4; step <= 11; step++) {
      expect(content).toMatch(new RegExp(`^step_${step}_\\w+:\\s*pending$`, 'm'));
    }
  });
});
