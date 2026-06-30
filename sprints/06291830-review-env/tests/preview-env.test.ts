/**
 * TDD Red — per-branch 预览环境 CI workflow 文件验证
 *
 * 测试在 Generator 实现以下文件之前必然 FAIL（文件不存在）：
 *   - .github/workflows/preview-deploy.yml
 *   - .github/workflows/preview-cleanup.yml
 *   - scripts/preview-deploy.sh
 *   - scripts/preview-cleanup.sh
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

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

describe('scripts/preview-deploy.sh 端口逻辑 [BEHAVIOR]', () => {
  it('必须包含端口范围约束（8000-8999）', () => {
    expect(existsSync(DEPLOY_SH)).toBe(true);
    const content = readFileSync(DEPLOY_SH, 'utf8');
    // 端口范围：8000-8999，由 hash % 1000 + 8000 产生
    expect(content).toMatch(/8[0-9]{3}|PORT.*8000|% 1000/);
  });
});
