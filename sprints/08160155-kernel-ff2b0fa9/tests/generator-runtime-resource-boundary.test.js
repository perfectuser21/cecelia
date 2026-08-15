// 永久回归：Generator server-owned PostgreSQL runtime resource（先红后绿）
//
// 本文件是 sprint 08160155-kernel-ff2b0fa9 的 TDD-RED 契约测试。
// 永久落点：packages/brain/src/orchestrator/__tests__/generator-runtime-resource-boundary.test.js
//   —— Generator 实现时把本文件放到该路径（import 改为 '../dispatcher.js'），永久留在 brain-ci.yml 作回归。
// 本 sprint-dir 副本用相对路径从真实 dispatcher 组装 generator TaskBundle，
// 断言消费 Dispatcher 服务端 buildInputs 真实注入结果（禁 mock 被改的边：真 buildInputs，非替身）。
import { describe, it, expect } from 'vitest';

import { resolveAction, __test__ } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const { buildInputs } = __test__;

const TASK_ID = 'ff2b0fa9-48c7-4c4d-85a5-907f8a2d4376';

// 用真实 Dispatcher 内部装配器组装 role=generator 的 TaskBundle inputs。
// contract.approved=true + row 提供合同分支，避免 generator 分支抛 FROZEN_CONTRACT_* 前置错误。
function assembleGeneratorInputs({ action = 'spawn:generator', payloadOverrides = {} } = {}) {
  const spec = resolveAction(action);
  const ctx = {
    taskId: TASK_ID,
    worktreePath: '/tmp/wt',
    observed: {
      task: {
        id: TASK_ID,
        title: 'Generator boundary regression',
        description: 'assemble generator bundle',
        payload: { sprint_dir: 'sprints/08160155-kernel-ff2b0fa9', ...payloadOverrides },
      },
      contract: { approved: true, row: { propose_branch: 'cp-harness-propose-r1-ff2b0fa9' } },
    },
  };
  const attemptMetadata = { logicalCycleId: 'intent:test', attemptKind: 'initial', workstreamKey: 'ws1' };
  return buildInputs(action, spec, ctx, attemptMetadata);
}

describe('Generator server-owned PostgreSQL runtime resource [BEHAVIOR]', () => {
  it('generator TaskBundle 注入 server-owned runtime_resources postgres 为 true', () => {
    const inputs = assembleGeneratorInputs();
    expect(inputs.runtime_resources).toBeTypeOf('object');
    expect(inputs.runtime_resources.postgres).toBe(true);
  });

  it('caller 传 runtime_resources postgres false 不降权 postgres 仍为 true', () => {
    const inputs = assembleGeneratorInputs({
      payloadOverrides: {
        runtime_resources: { postgres: false },
        workspace_spec: { runtime_resources: { postgres: false } },
      },
    });
    expect(inputs.runtime_resources.postgres).toBe(true);
  });

  it('generator-fix 重派同样注入 server-owned postgres 为 true', () => {
    const inputs = assembleGeneratorInputs({ action: 'spawn:generator-fix' });
    expect(inputs.runtime_resources.postgres).toBe(true);
  });
});
