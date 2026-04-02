import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

/**
 * PR Review 阻塞门禁测试
 *
 * 验证 detect-review-issues.js 和 pr-review.yml 的正确行为：
 * 1. detect-review-issues.js：stdin 包含🔴时 exit 1，不含时 exit 0
 * 2. pr-review.yml 不再使用 hustcer/deepseek-review，改为直接调 OpenRouter API
 * 3. devloop-check.sh 包含 check_divergence_count 函数
 */

const ROOT_DIR = join(__dirname, '../../../..');
const DETECT_SCRIPT = join(ROOT_DIR, 'scripts/devgate/detect-review-issues.js');
const PR_REVIEW_WORKFLOW = join(ROOT_DIR, '.github/workflows/pr-review.yml');
const DEVLOOP_CHECK = resolve(__dirname, '../../../../packages/engine/lib/devloop-check.sh');

describe('detect-review-issues.js — 严重问题检测', () => {
  it('A1: 脚本文件必须存在', () => {
    expect(existsSync(DETECT_SCRIPT), `${DETECT_SCRIPT} 应存在`).toBe(true);
  });

  it('A2: stdin 包含🔴时 exit code = 1（阻塞合并）', () => {
    const result = spawnSync('node', [DETECT_SCRIPT], {
      input: '审查结果：🔴 严重漏洞，存在 SQL 注入风险',
      encoding: 'utf8',
      cwd: ROOT_DIR,
    });
    expect(result.status).toBe(1);
  });

  it('A3: stdin 不含🔴时 exit code = 0（允许合并）', () => {
    const result = spawnSync('node', [DETECT_SCRIPT], {
      input: '🟢 代码质量良好，无严重问题',
      encoding: 'utf8',
      cwd: ROOT_DIR,
    });
    expect(result.status).toBe(0);
  });

  it('A4: stdin 含🟡但不含🔴时 exit code = 0（建议优化不阻塞）', () => {
    const result = spawnSync('node', [DETECT_SCRIPT], {
      input: '🟡 建议优化：可以提取公共函数',
      encoding: 'utf8',
      cwd: ROOT_DIR,
    });
    expect(result.status).toBe(0);
  });

  it('A5: stdin 为空时 exit code = 0（空审查通过）', () => {
    const result = spawnSync('node', [DETECT_SCRIPT], {
      input: '',
      encoding: 'utf8',
      cwd: ROOT_DIR,
    });
    expect(result.status).toBe(0);
  });

  it('A6: 多行输入含🔴时 exit code = 1', () => {
    const result = spawnSync('node', [DETECT_SCRIPT], {
      input: '🟢 测试覆盖率良好\n🟡 可以简化逻辑\n🔴 密钥硬编码，严重安全漏洞',
      encoding: 'utf8',
      cwd: ROOT_DIR,
    });
    expect(result.status).toBe(1);
  });
});

describe('pr-review.yml — workflow 配置验证', () => {
  it('B1: workflow 文件必须存在', () => {
    expect(existsSync(PR_REVIEW_WORKFLOW), `${PR_REVIEW_WORKFLOW} 应存在`).toBe(true);
  });

  it('B2: workflow 必须在 pull_request 时触发', () => {
    const content = readFileSync(PR_REVIEW_WORKFLOW, 'utf8');
    expect(content).toContain('pull_request');
  });

  it('B3: workflow 必须有 pull-requests: write 权限', () => {
    const content = readFileSync(PR_REVIEW_WORKFLOW, 'utf8');
    expect(content).toContain('pull-requests: write');
  });

  it('B4: workflow 不得使用 hustcer/deepseek-review Action', () => {
    const content = readFileSync(PR_REVIEW_WORKFLOW, 'utf8');
    expect(content).not.toContain('hustcer/deepseek-review');
  });

  it('B5: workflow 必须调用 openrouter.ai API', () => {
    const content = readFileSync(PR_REVIEW_WORKFLOW, 'utf8');
    expect(content).toContain('openrouter.ai');
  });

  it('B6: workflow 必须引用 detect-review-issues 脚本', () => {
    const content = readFileSync(PR_REVIEW_WORKFLOW, 'utf8');
    expect(content).toContain('detect-review-issues');
  });
});

// v16.0.0: divergence_count 门禁已删除（Engine重构）
describe.skip('devloop-check.sh — check_divergence_count 函数存在性', () => {
  it('C1: devloop-check.sh 必须包含 check_divergence_count 函数', () => {
    expect(existsSync(DEVLOOP_CHECK), `${DEVLOOP_CHECK} 应存在`).toBe(true);
    const content = readFileSync(DEVLOOP_CHECK, 'utf8');
    expect(content).toContain('check_divergence_count');
  });
});
