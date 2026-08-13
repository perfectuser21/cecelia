'use strict';

// RED baseline (proposer) — RED-1 / RED-2.
// 证明当前 attempt-runner.cjs 的容器 ownership 只按 machine_id 派生的 worker_id 过滤：
// 同机同 canonical machine_id、不同 CECELIA_FLEET_DATA_ROOT 的两个 Worker 实例，
// 会把对方的容器判成 "owned orphan" 并 docker.remove（生产互杀根因）。
// 修复后：容器 ownership 必须包含稳定 instance namespace，reconcile 只作用于本实例
// namespace 的容器；旧无 namespace 容器 fail-closed 不收割。
//
// 该测试是可独立运行的 RED 证据（无需 Docker/PG）。真机进程级/真实 Docker 回归见
// contract-draft.md 的 ## E2E 验收 与 instance-namespace-fence.integration.test.cjs。

// vitest globals（--globals / globals:true）；与仓库现有 attempt-runner.test.cjs 同栈。
const {
  createAttemptRunner,
} = require('../../../packages/brain/scripts/fleet-worker/attempt-runner.cjs');

const WORKER_ID = 'us-mac-m4'; // 两实例共享的 canonical machine_id
const IMAGE_DIGEST = `cecelia/runner@sha256:${'a'.repeat(64)}`;
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const A_ATTEMPT_ID = '0ca01d4b-0ca0-41d4-8ca0-1d4b0ca01d4b'; // Worker-A 的 active attempt
const LEGACY_ATTEMPT_ID = '77777777-7777-4777-8777-777777777777';

function noopManagers() {
  const workspaceManager = {
    prepare: vi.fn(async () => ({})),
    verify: vi.fn(async () => ({ status: 'verified' })),
    cleanup: vi.fn(async () => ({ status: 'cleaned' })),
    quarantine: vi.fn(async () => ({ status: 'quarantined' })),
    reconcile: vi.fn(async () => ({ cleaned_attempts: [] })),
  };
  const resourceManager = {
    provision: vi.fn(async () => ({})),
    release: vi.fn(async () => ({ status: 'released' })),
    releaseService: vi.fn(async () => ({ status: 'released' })),
    reconcile: vi.fn(async () => ({ removed_attempts: [] })),
  };
  const stateStore = {
    save: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => []), // Worker-B 不认识任何 attempt（独立 data root）
  };
  return { workspaceManager, resourceManager, stateStore };
}

function makeDocker(listed) {
  return {
    prepare: vi.fn(async () => ({ containerId: 'x' })),
    start: vi.fn(async () => ({})),
    inspect: vi.fn(async () => ({ status: 'running' })),
    wait: vi.fn(async () => new Promise(() => {})),
    remove: vi.fn(async () => ({ removed: true })),
    // 当前实现：listOwned 只按 label=cecelia.fleet.worker_id=<workerId> 过滤，
    // 因此会返回同 machine_id 的另一实例（Worker-A）的容器。
    listOwned: vi.fn(async () => listed),
  };
}

function buildWorkerB(docker) {
  const { workspaceManager, resourceManager, stateStore } = noopManagers();
  return createAttemptRunner({
    workspaceManager,
    docker,
    stateStore,
    workerId: WORKER_ID,
    // 修复引入的稳定实例命名空间（由 data root 持久化身份派生）。
    // 当前实现忽略此参数 —— 正是 bug。
    instanceNamespace: 'nsB',
    runnerImageDigest: IMAGE_DIGEST,
    credentialConsumer: { consume: vi.fn(() => ({})) },
    githubCredentialConsumer: { consume: vi.fn(() => ({})) },
    resourceManager,
  });
}

describe('Fleet Worker instance namespace fence [BEHAVIOR][RED]', () => {
  it('RED-1: Worker-B 不得 remove 属于另一实例 namespace(nsA) 的容器', async () => {
    const foreignNamespaced = {
      containerId: 'worker-a-container',
      labels: {
        'cecelia.fleet.attempt_id': A_ATTEMPT_ID,
        'cecelia.fleet.run_id': RUN_ID,
        'cecelia.fleet.worker_id': WORKER_ID, // 同 machine_id
        'cecelia.fleet.instance_namespace': 'nsA', // 但属于 Worker-A 的实例 namespace
      },
    };
    const docker = makeDocker([foreignNamespaced]);
    const runner = buildWorkerB(docker);

    await runner.reconcile();

    // 修复前：worker_id 相同 + attempt 未知 → 被当 orphan remove（互杀）。
    expect(docker.remove).not.toHaveBeenCalledWith(
      expect.objectContaining({ containerId: 'worker-a-container' }),
    );
  });

  it('RED-2: 旧无 namespace 标签的容器必须 fail-closed（不被任意实例收割）', async () => {
    const legacyUnnamespaced = {
      containerId: 'legacy-container',
      labels: {
        'cecelia.fleet.attempt_id': LEGACY_ATTEMPT_ID,
        'cecelia.fleet.run_id': RUN_ID,
        'cecelia.fleet.worker_id': WORKER_ID,
        // 无 cecelia.fleet.instance_namespace
      },
    };
    const docker = makeDocker([legacyUnnamespaced]);
    const runner = buildWorkerB(docker);

    await runner.reconcile();

    expect(docker.remove).not.toHaveBeenCalledWith(
      expect.objectContaining({ containerId: 'legacy-container' }),
    );
  });
});
