// Sprint RED — Generator/Publisher 发布运行时权限边界回归
//
// 说明：本文件是 Generator 的 TDD Red 证据（sprints/** 不在 brain vitest include，
// 不进 CI）。永久回归护栏由 Generator 落进 attempt-runner.test.cjs（scripts/** 已入 CI）
// + packages/brain/scripts/smoke/ 新 smoke + smoke ratchet 登记。
//
// 本测试直调真实 attempt-runner.cjs 导出的纯函数断言锚点（禁 mock 被改的边）。
// 锚点未导出时全部 RED；Generator 导出锚点并保持既有行为后转 GREEN。
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runner = require('../../../packages/brain/scripts/fleet-worker/attempt-runner.cjs');
const anchors = runner.__test__ ?? {};

describe('Generator/Publisher 运行时权限边界 [BEHAVIOR]', () => {
  it('resolveRuntimeRequirements 拒绝 caller 降权 postgres 至 false [mismatch]', () => {
    expect(typeof anchors.resolveRuntimeRequirements).toBe('function');
    // server input 权威 {postgres:true} vs caller request {postgres:false} → 降权，拒绝
    expect(() =>
      anchors.resolveRuntimeRequirements({ postgres: true }, { postgres: false }),
    ).toThrow('attempt_runtime_requirements_mismatch');
  });

  it('resolveRuntimeRequirements 等值匹配返回服务端拥有的 postgres:true', () => {
    const resolved = anchors.resolveRuntimeRequirements({ postgres: true }, { postgres: true });
    expect(resolved.postgres).toBe(true);
  });

  it('roleNeedsGitHubCredential generator 为 false（无远端凭据不能 push）', () => {
    expect(typeof anchors.roleNeedsGitHubCredential).toBe('function');
    expect(anchors.roleNeedsGitHubCredential('generator')).toBe(false);
  });

  it('roleNeedsGitHubCredential publisher 为 true（唯一远端发布角色持凭据）', () => {
    expect(anchors.roleNeedsGitHubCredential('publisher')).toBe(true);
  });

  it('roleRetainsCandidate 仅 generator 且退出码 0 保留本地已提交候选', () => {
    expect(typeof anchors.roleRetainsCandidate).toBe('function');
    expect(anchors.roleRetainsCandidate('generator', 0)).toBe(true);
    expect(anchors.roleRetainsCandidate('publisher', 0)).toBe(false);
    expect(anchors.roleRetainsCandidate('generator', 1)).toBe(false);
  });

  it('roleIsRemotePublisher 仅 publisher 为唯一远端发布角色', () => {
    expect(typeof anchors.roleIsRemotePublisher).toBe('function');
    expect(anchors.roleIsRemotePublisher('publisher')).toBe(true);
    expect(anchors.roleIsRemotePublisher('generator')).toBe(false);
  });
});
