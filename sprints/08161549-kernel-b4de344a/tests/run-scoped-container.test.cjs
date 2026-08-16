'use strict';

// TDD Red 证据（proposer 起草）——本 sprint 的运行时回归测试最终落在
// packages/brain/scripts/fleet-worker/*.test.cjs（vitest include: scripts/**）。
// 此文件仅作 GAN 阶段 red 证明：断言 run 级双容器契约尚未实现。
// 使用 vitest 全局（describe/it/expect）——与 packages/brain 现有 *.test.cjs 同栈
// （vitest.config.js globals:true, include: scripts/**）。禁 node:test/assert。
const path = require('node:path');

const RUNNER = path.resolve(
  __dirname,
  '../../../packages/brain/scripts/fleet-worker/attempt-runner.cjs',
);
const WORKSPACE = path.resolve(
  __dirname,
  '../../../packages/brain/scripts/fleet-worker/workspace-manager.cjs',
);

describe('run 级双容器契约 [BEHAVIOR] (TDD red)', () => {
  it('B-01: attempt-runner 暴露 run 级工作容器命名/复用入口 deriveRunContainerName', () => {
    // eslint-disable-next-line global-require
    const runner = require(RUNNER);
    // 现状容器名 = cecelia-fleet-<attemptId>；run 级入口尚不存在 → 预期红。
    expect(typeof runner.deriveRunContainerName).toBe('function');
    expect(runner.deriveRunContainerName('11111111-1111-4111-8111-111111111111'))
      .toBe('cecelia-fleet-run-11111111');
  });

  it('B-03: workspace-manager 暴露候选 quarantine bundle + 干净 clone 入口', () => {
    // eslint-disable-next-line global-require
    const ws = require(WORKSPACE);
    const mgr = ws.createWorkspaceManager({
      repoAllowlist: { 'perfectuser21/cecelia': 'cecelia' },
      workspaceRoot: '/tmp/x',
      quarantineRoot: '/tmp/q',
    });
    // 候选落 quarantine bundle + 从 bundle 干净 clone 的入口尚不存在 → 预期红。
    expect(typeof mgr.bundleCandidate).toBe('function');
    expect(typeof mgr.cloneFromBundle).toBe('function');
  });
});
