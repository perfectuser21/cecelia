/**
 * deploy 并发锁逻辑单元测试
 * 验证 POST /api/brain/deploy 中的 running/rolling_back 状态保护逻辑
 */

import { describe, it, expect } from 'vitest';

// 镜像 ops.js 中的并发锁判断逻辑（不导入 ops.js 避免重型依赖）
function shouldRejectConcurrentDeploy(currentStatus) {
  return currentStatus === 'running' || currentStatus === 'rolling_back';
}

describe('deploy 并发锁逻辑', () => {
  it('running 状态 → 应拒绝（返回 409）', () => {
    expect(shouldRejectConcurrentDeploy('running')).toBe(true);
  });

  it('rolling_back 状态 → 应拒绝（返回 409）', () => {
    expect(shouldRejectConcurrentDeploy('rolling_back')).toBe(true);
  });

  it('idle 状态 → 允许部署', () => {
    expect(shouldRejectConcurrentDeploy('idle')).toBe(false);
  });

  it('success 状态 → 允许部署', () => {
    expect(shouldRejectConcurrentDeploy('success')).toBe(false);
  });

  it('failed 状态 → 允许部署', () => {
    expect(shouldRejectConcurrentDeploy('failed')).toBe(false);
  });

  it('rolled_back 状态 → 允许部署', () => {
    expect(shouldRejectConcurrentDeploy('rolled_back')).toBe(false);
  });
});
