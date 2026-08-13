// Executable oracle for the DoD [BEHAVIOR] rows (evaluator runs this directly).
// 真调 createDispatcher → buildBundle → gpContractIdentity（被改的那条边不 mock）；
// 只把 attemptStore / launcher / registry 这些外层 I/O 边界替换成测试替身。
// 用法: node gp-identity-assembly.mjs <case>
//   case ∈ { journey-only | journey-illegal | partial-gp | complete-gp | empty }
// 退出码: 0 = 断言通过, 1 = 断言失败/未知 case。
import { createDispatcher } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const JOURNEY_ID = '88888888-8888-4888-8888-888888888888';
const GP_ID = '77777777-7777-4777-8777-777777777777';
const CONTRACT_ID = '66666666-6666-4666-8666-666666666666';
const STEP_ID = '99999999-9999-4999-8999-999999999999';

function makeDeps() {
  let capturedBundle = null;
  const deps = {
    attemptStore: {
      createAttempt: async (input) => { capturedBundle = input.bundle; return { id: input.id, ...input, task_bundle: input.bundle }; },
      markStarting: async (id) => ({ id, status: 'starting', lease_owner: 'x:1', lease_generation: 0 }),
      recordLaunchReceipt: async (id, r) => ({ id, status: 'starting', ...r }),
      fail: () => {},
      listFailedExecutionTargets: async () => [],
    },
    registry: { resolve: () => ({ name: 'codex', start: () => ({ provider: 'codex', command: 'codex', args: ['exec'], stdin: '{}' }) }) },
    launcher: {
      launch: async () => ({ actualMachineId: 'brain-1', executionTransport: 'local-docker', remoteJobId: null, attestationStatus: 'local', containerId: 'c1', jobId: null }),
      inspect: () => {},
      cancel: async () => ({ status: 'missing' }),
    },
    loadSkill: (name) => ({ name, version: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, content: 'x' }),
    randomUUID: () => attemptId,
    createCallbackSecret: () => 's',
    machineId: 'brain-1',
    leaseOwner: 'x:1',
  };
  return { deps, getBundle: () => capturedBundle };
}

function baseObserved(payload) {
  return {
    task: { id: taskId, title: 'T', description: 'd', payload: { executor: 'auto', sprint_dir: 'sprints/08131510-kernel-gp-identity', worktree_path: '/tmp/w', ...payload } },
    run: { id: runId },
    contract: { approved: false, row: { propose_branch: 'cp-propose-r1' } },
    pr: { head_ref: 'cp-fix', head_sha: 'b'.repeat(40) },
    prdExists: true,
    proposeBranchRn: 1,
    proposeBranch: 'cp-x',
    proposeBranchSha: 'a'.repeat(40),
    callbackResult: { transcript: 't' },
  };
}

async function dispatch(payload, action = 'spawn:generator-fix') {
  const { deps, getBundle } = makeDeps();
  const res = await createDispatcher(deps)(action, {
    taskId, runId, hop: 17, observed: baseObserved(payload), decision: { phase: 'generate', reason: 'x' },
  });
  return { res, bundle: getBundle() };
}

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }
function ok(msg) { console.log(`OK: ${msg}`); process.exit(0); }

const CASE = process.argv[2];

const CASES = {
  // 核心修复：仅 journey_id 的 generator-fix 组包成功，不注入 gp_contract，不 assembly fault。
  'journey-only': async () => {
    const { res, bundle } = await dispatch({ journey_id: JOURNEY_ID });
    if (res.failure_class === 'assembly_fault') fail(`journey-only 仍 assembly_fault detail=${res.detail}`);
    if (res.detail === 'GP_CONTRACT_IDENTITY_INVALID') fail('journey-only 仍抛 GP_CONTRACT_IDENTITY_INVALID');
    if (res.fallback_reason === 'TASK_BUNDLE_ASSEMBLY_FAILED') fail('journey-only 仍返回 TASK_BUNDLE_ASSEMBLY_FAILED');
    if (!bundle) fail('journey-only 未产出 TaskBundle（createAttempt 未被调用）');
    if (bundle.inputs.gp_contract !== undefined) fail(`journey-only bundle 误注入 gp_contract=${JSON.stringify(bundle.inputs.gp_contract)}`);
    ok('journey-only 组包成功、无 gp_contract、无 assembly fault');
  },
  // 边界：仅 journey_id 且格式非法 → 仍不触发 GP 全字段校验。
  'journey-illegal': async () => {
    const { res, bundle } = await dispatch({ journey_id: 'not-a-uuid' });
    if (res.failure_class === 'assembly_fault') fail(`journey-illegal 触发了 GP 校验 detail=${res.detail}`);
    if (!bundle) fail('journey-illegal 未产出 TaskBundle');
    if (bundle.inputs.gp_contract !== undefined) fail('journey-illegal 误注入 gp_contract');
    ok('journey-illegal 仍旁路 GP 全字段校验、组包成功');
  },
  // 铁律：出现任一 GP 身份字段但不全 → 继续 fail-closed。
  'partial-gp': async () => {
    const { res, bundle } = await dispatch({ journey_id: JOURNEY_ID, golden_path_id: GP_ID });
    if (res.failure_class !== 'assembly_fault') fail(`partial-gp 未 fail-closed failure_class=${res.failure_class}`);
    if (res.detail !== 'GP_CONTRACT_IDENTITY_INVALID') fail(`partial-gp detail 非 GP_CONTRACT_IDENTITY_INVALID: ${res.detail}`);
    if (bundle) fail('partial-gp 不应产出 TaskBundle（fail-closed 前不建 attempt）');
    ok('partial-gp 继续 fail-closed（GP_CONTRACT_IDENTITY_INVALID）');
  },
  // 完整 GP 身份 → 结构化透传，行为不变。
  'complete-gp': async () => {
    const { res, bundle } = await dispatch({
      journey_id: JOURNEY_ID, gp_contract_id: CONTRACT_ID, gp_contract_version: 1,
      gp_contract_hash: 'e'.repeat(64), golden_path_id: GP_ID, anchor: { step_id: STEP_ID },
    });
    if (res.failure_class === 'assembly_fault') fail(`complete-gp 误 fail detail=${res.detail}`);
    if (!bundle) fail('complete-gp 未产出 TaskBundle');
    const gp = bundle.inputs.gp_contract;
    const expected = { id: CONTRACT_ID, version: 1, hash: 'e'.repeat(64), golden_path_id: GP_ID, journey_id: JOURNEY_ID, step_id: STEP_ID };
    if (JSON.stringify(gp) !== JSON.stringify(expected)) fail(`complete-gp gp_contract 透传不符: ${JSON.stringify(gp)}`);
    ok('complete-gp 六字段结构化透传不变');
  },
  // 空态：无 journey_id 无 GP 字段 → 返回 null（组包成功、无 gp_contract）。
  'empty': async () => {
    const { res, bundle } = await dispatch({});
    if (res.failure_class === 'assembly_fault') fail(`empty 误 fail detail=${res.detail}`);
    if (!bundle) fail('empty 未产出 TaskBundle');
    if (bundle.inputs.gp_contract !== undefined) fail('empty 误注入 gp_contract');
    ok('empty payload 组包成功、无 gp_contract');
  },
};

const runner = CASES[CASE];
if (!runner) { console.error(`FAIL: unknown case '${CASE}'（journey-only|journey-illegal|partial-gp|complete-gp|empty）`); process.exit(1); }
runner().catch((e) => { console.error(`FAIL: 未捕获异常 ${e && e.stack || e}`); process.exit(1); });
