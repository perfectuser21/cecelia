/**
 * TDD Red — per-branch 预览环境 CI workflow 文件验证
 *
 * 测试在 Generator 实现以下文件之前必然 FAIL（文件不存在）：
 *   - .github/workflows/preview-deploy.yml
 *   - .github/workflows/preview-cleanup.yml
 *   - scripts/preview-deploy.sh
 *   - scripts/preview-cleanup.sh
 *
 * Round 2 新增：
 *   - health check 步骤验证（Step 5）
 *   - main branch 过滤验证
 *   - --print-port CLI 接口验证（与 Scenario 2 对齐）
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// 从 sprints/06291830-review-env/tests/ 到 repo root 需要 ../../..
const ROOT = join(import.meta.dirname ?? __dirname, '../../..');

const DEPLOY_WF   = join(ROOT, '.github/workflows/preview-deploy.yml');
const CLEANUP_WF  = join(ROOT, '.github/workflows/preview-cleanup.yml');
const DEPLOY_SH   = join(ROOT, 'scripts/preview-deploy.sh');
const CLEANUP_SH  = join(ROOT, 'scripts/preview-cleanup.sh');

describe('per-branch 预览环境 — workflow 文件存在性 [BEHAVIOR]', () => {
  it('preview-deploy.yml 必须存在', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true); // RED: 文件未创建
  });

  it('preview-cleanup.yml 必须存在', () => {
    expect(existsSync(CLEANUP_WF)).toBe(true); // RED: 文件未创建
  });

  it('scripts/preview-deploy.sh 必须存在', () => {
    expect(existsSync(DEPLOY_SH)).toBe(true); // RED: 文件未创建
  });

  it('scripts/preview-cleanup.sh 必须存在', () => {
    expect(existsSync(CLEANUP_SH)).toBe(true); // RED: 文件未创建
  });
});

describe('preview-deploy.yml 触发器配置 [BEHAVIOR]', () => {
  it('必须包含 pull_request trigger', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true);
    const content = readFileSync(DEPLOY_WF, 'utf8');
    expect(content).toMatch(/pull_request/);
  });

  it('必须包含 opened 和 synchronize 事件类型', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true);
    const content = readFileSync(DEPLOY_WF, 'utf8');
    expect(content).toMatch(/opened/);
    expect(content).toMatch(/synchronize/);
  });

  it('必须包含 pull-requests: write 权限', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true);
    const content = readFileSync(DEPLOY_WF, 'utf8');
    expect(content).toMatch(/pull-requests.*write/);
  });

  it('必须包含 PR comment 写入步骤（github-script 或等效）', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true);
    const content = readFileSync(DEPLOY_WF, 'utf8');
    expect(content).toMatch(/github-script|create-comment|comment/i);
  });

  it('必须包含 failure() 条件的错误评论步骤（error path — NFR）', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true);
    const content = readFileSync(DEPLOY_WF, 'utf8');
    expect(content).toMatch(/failure\(\)/);
  });

  it('必须包含 SSH 部署步骤', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true);
    const content = readFileSync(DEPLOY_WF, 'utf8');
    expect(content).toMatch(/ssh|appleboy\/ssh-action/i);
  });

  it('必须包含 preview URL health check 步骤（curl HTTP 200，在 PR comment 之前）[Step 5]', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true);
    const content = readFileSync(DEPLOY_WF, 'utf8');
    // health check：curl 到预览端口，或含 healthcheck 关键字
    expect(content).toMatch(/curl.*\$PORT|curl.*PREVIEW_PORT|health.check|healthcheck|curl.*http.*[0-9]/i);
  });

  it('main 分支推送不应触发 preview-deploy（PR-only trigger 或 branches-ignore）', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true);
    const content = readFileSync(DEPLOY_WF, 'utf8');
    // 如果有 push: trigger 且有 branches: 但没有 branches-ignore，则 main 不应在 branches 列表里
    const hasPushTrigger = /^  push:/.test(content);
    if (hasPushTrigger) {
      const hasBranchesIgnore = /branches-ignore/.test(content);
      if (!hasBranchesIgnore) {
        // push 有 branches 过滤时，main 不应在允许列表
        expect(content).not.toMatch(/branches:\s*\n\s*-\s*main\b/);
      }
    }
    // 无论如何必须有 pull_request（PR 事件本身限制 head branch，main 作为 base 不触发 head）
    expect(content).toMatch(/pull_request/);
  });
});

describe('preview-cleanup.yml 触发器配置 [BEHAVIOR]', () => {
  it('必须包含 pull_request trigger', () => {
    expect(existsSync(CLEANUP_WF)).toBe(true);
    const content = readFileSync(CLEANUP_WF, 'utf8');
    expect(content).toMatch(/pull_request/);
  });

  it('必须包含 closed 事件类型（PR merge 或 close 均触发）', () => {
    expect(existsSync(CLEANUP_WF)).toBe(true);
    const content = readFileSync(CLEANUP_WF, 'utf8');
    expect(content).toMatch(/closed/);
  });
});

describe('scripts/preview-deploy.sh 端口逻辑 + --print-port CLI 接口 [BEHAVIOR]', () => {
  it('必须包含端口范围约束（8000-8999）', () => {
    expect(existsSync(DEPLOY_SH)).toBe(true);
    const content = readFileSync(DEPLOY_SH, 'utf8');
    expect(content).toMatch(/8[0-9]{3}|PORT.*8000|% 1000/);
  });

  it('必须实现 --print-port CLI 接口（Step 3 契约）', () => {
    expect(existsSync(DEPLOY_SH)).toBe(true);
    const content = readFileSync(DEPLOY_SH, 'utf8');
    expect(content).toMatch(/--print-port/);
  });

  it('--print-port 执行输出必须是 4 位数字且在 8000-8999 范围', () => {
    expect(existsSync(DEPLOY_SH)).toBe(true);
    const output = execSync(`bash "${DEPLOY_SH}" --print-port "cp-test-feature-abc"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    expect(output).toMatch(/^[0-9]{4}$/);
    const port = parseInt(output, 10);
    expect(port).toBeGreaterThanOrEqual(8000);
    expect(port).toBeLessThanOrEqual(8999);
  });

  it('--print-port 对同一 branch 必须幂等（两次输出相同）', () => {
    expect(existsSync(DEPLOY_SH)).toBe(true);
    const BRANCH = 'cp-test-idempotent-xyz';
    const port1 = execSync(`bash "${DEPLOY_SH}" --print-port "${BRANCH}"`, { encoding: 'utf8' }).trim();
    const port2 = execSync(`bash "${DEPLOY_SH}" --print-port "${BRANCH}"`, { encoding: 'utf8' }).trim();
    expect(port1).toBe(port2);
  });
});
