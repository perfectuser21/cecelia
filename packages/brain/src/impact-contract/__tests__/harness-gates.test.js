import { describe, expect, it, vi } from 'vitest';

import {
  createHarnessImpactGates,
  findCurrentDiffPassReceipt,
  verifyImpactMergeFence,
} from '../harness-gates.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_TASK_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GAP_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const RUN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

describe('Harness Impact Gate 生产接线适配器', () => {
  it('未纳入 Impact Contract 治理的存量任务不启用门禁', async () => {
    const structureGate = vi.fn().mockResolvedValue({
      gate: 'pass',
      contract: { id: 'contract-1', contract_hash: 'c'.repeat(64) },
    });
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(null),
      structureGate,
    });

    const result = await gates.beforeGenerate({
      run: {
        impact_contract_policy: 'legacy_exempt',
        impact_contract_policy_reason: 'predates impact contract rollout',
      },
      task: {
        id: TASK_ID,
        payload: {
          change_kind: 'bugfix',
          base_repo: 'https://github.com/perfectuser21/cecelia.git',
        },
      },
    });

    expect(result).toMatchObject({
      gate: 'pass',
      stage: 'structure',
      reason: 'impact_contract_not_managed',
    });
    expect(structureGate).not.toHaveBeenCalled();
  });

  it('明确要求 Impact Contract 的任务无 active 合同时 fail-closed', async () => {
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(null),
      structureGate: vi.fn(),
    });

    const result = await gates.beforeGenerate({
      run: { impact_contract_policy: 'required' },
      task: {
        id: TASK_ID,
        payload: { change_kind: 'bugfix', impact_contract_required: true },
      },
    });

    expect(result).toMatchObject({
      gate: 'blocked',
      reason: 'impact_contract_declaration_missing',
      retryable: false,
    });
  });

  it('generator 前以 active 声明重跑 Structure Gate 新鲜度校验', async () => {
    const active = {
      id: 'contract-1',
      task_id: TASK_ID,
      repo: 'perfectuser21/cecelia',
      change_kind: 'bugfix',
      base_revision: BASE_SHA,
      contract_body: {
        affected_capabilities: [{ capability_id: 'brain' }],
        required_assertions: [],
      },
    };
    const structureGate = vi.fn().mockResolvedValue({
      gate: 'pass',
      contract: { ...active, contract_hash: 'c'.repeat(64) },
    });
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      structureGate,
    });

    const result = await gates.beforeGenerate({
      task: { id: TASK_ID, payload: { change_kind: 'bugfix' } },
    });

    expect(result.gate).toBe('pass');
    expect(structureGate).toHaveBeenCalledWith(expect.objectContaining({
      contract: expect.objectContaining({
        task_id: TASK_ID,
        repo: active.repo,
        base_revision: BASE_SHA,
        affected_capabilities: active.contract_body.affected_capabilities,
      }),
    }));
  });

  it('uses the run-bound recovery contract for frozen-path structure, diff and fresh-map merge gates', async () => {
    const active = {
      id: 'impact-recovery-1', repo: 'cecelia', base_revision: BASE_SHA,
      contract_hash: 'c'.repeat(64), contract_body: { required_assertions: [] },
    };
    const recovery = {
      id: 'recovery-1', repo: 'cecelia', base_sha: BASE_SHA,
      branch: 'cp-map-fix', reason_code: 'map_unavailable',
      consumed_attempt_id: 'generator-attempt-1',
    };
    const readChangedFiles = vi.fn().mockResolvedValue([
      'packages/brain/src/lib/map-read-service.js',
    ]);
    const validateRecoveryFreshness = vi.fn().mockResolvedValue({
      status: 'fresh', source_revision: HEAD_SHA,
    });
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      getRecoveryContext: vi.fn().mockResolvedValue(recovery),
      readChangedFiles,
      validateRecoveryFreshness,
    });
    const task = { id: TASK_ID, payload: {
      change_kind: 'bugfix',
      changed_files: ['packages/brain/src/lib/map-read-service.js'],
    } };
    const run = { id: RUN_ID, impact_contract_policy: 'required', map_recovery_contract_id: 'recovery-1' };

    await expect(gates.beforeGenerate({ task, run })).resolves.toMatchObject({
      gate: 'pass', stage: 'structure', map_recovery_contract_id: 'recovery-1',
    });
    await expect(gates.beforeEvaluate({ task, run, pr: { head_sha: HEAD_SHA } }))
      .resolves.toMatchObject({
        gate: 'pass', stage: 'diff', map_recovery_contract_id: 'recovery-1',
      });
    await expect(gates.beforeMerge({ task, run, pr: { head_sha: HEAD_SHA }, decisionLog: [] }))
      .resolves.toMatchObject({
        gate: 'pass', stage: 'merge', map_recovery_contract_id: 'recovery-1',
      });
    expect(validateRecoveryFreshness).toHaveBeenCalledWith({}, {
      repo: 'cecelia', headRevision: HEAD_SHA,
    });
  });

  it('blocks recovery diff outside the frozen Map implementation allowlist', async () => {
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue({
        id: 'impact-recovery-1', repo: 'cecelia', base_revision: BASE_SHA,
        contract_hash: 'c'.repeat(64), contract_body: { required_assertions: [] },
      }),
      getRecoveryContext: vi.fn().mockResolvedValue({
        id: 'recovery-1', repo: 'cecelia', base_sha: BASE_SHA,
        consumed_attempt_id: 'generator-attempt-1',
      }),
      readChangedFiles: vi.fn().mockResolvedValue(['packages/brain/src/orchestrator/dispatcher.js']),
    });

    await expect(gates.beforeEvaluate({
      task: { id: TASK_ID, payload: { change_kind: 'bugfix' } },
      run: { id: RUN_ID, map_recovery_contract_id: 'recovery-1' },
      pr: { head_sha: HEAD_SHA },
    })).resolves.toMatchObject({ gate: 'blocked', reason: 'map_recovery_diff_forbidden' });
  });

  it('generator-fix 对已扩展合同按 head revision 验 freshness', async () => {
    const active = {
      id: 'contract-1',
      task_id: TASK_ID,
      repo: 'perfectuser21/cecelia',
      change_kind: 'bugfix',
      base_revision: BASE_SHA,
      head_revision: HEAD_SHA,
      contract_body: { affected_capabilities: [], required_assertions: [] },
    };
    const structureGate = vi.fn().mockResolvedValue({ gate: 'pass', contract: active });
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      structureGate,
    });

    await gates.beforeGenerate({ task: { id: TASK_ID, payload: { change_kind: 'bugfix' } } });

    expect(structureGate).toHaveBeenCalledWith(expect.objectContaining({
      contract: expect.objectContaining({ head_revision: HEAD_SHA }),
    }));
  });

  it('evaluator 前按 active contract base 与 PR head 读取真实 diff', async () => {
    const active = {
      id: 'contract-1',
      repo: 'perfectuser21/cecelia',
      base_revision: BASE_SHA,
      contract_hash: 'c'.repeat(64),
    };
    const diffGate = vi.fn().mockResolvedValue({ gate: 'pass', contract: active });
    const readChangedFiles = vi.fn().mockResolvedValue(['packages/brain/src/tick.js']);
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      diffGate,
      readChangedFiles,
    });

    const result = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: {} },
      pr: { head_sha: HEAD_SHA },
    });

    expect(result.gate).toBe('pass');
    expect(readChangedFiles).toHaveBeenCalledWith(BASE_SHA, HEAD_SHA, active.repo);
    expect(diffGate).toHaveBeenCalledWith(expect.objectContaining({
      taskId: TASK_ID,
      headRevision: HEAD_SHA,
      changedFiles: ['packages/brain/src/tick.js'],
    }));
  });

  it('evaluator 对 Runner 验证的本地候选使用冻结 changed_files，不要求 Brain 拥有候选对象', async () => {
    const active = {
      id: 'contract-1', repo: 'perfectuser21/cecelia',
      base_revision: BASE_SHA, contract_hash: 'c'.repeat(64),
    };
    const diffGate = vi.fn().mockResolvedValue({ gate: 'pass', contract: active });
    const readChangedFiles = vi.fn().mockRejectedValue(new Error('candidate object is remote'));
    const gates = createHarnessImpactGates({
      db: {}, getActiveContract: vi.fn().mockResolvedValue(active), diffGate, readChangedFiles,
    });

    const result = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: {} },
      pr: {
        head_sha: HEAD_SHA,
        type: 'git_candidate',
        verification_status: 'verified',
        changed_files: ['docker/cecelia-runner/entrypoint.sh'],
      },
    });

    expect(result.gate).toBe('pass');
    expect(readChangedFiles).not.toHaveBeenCalled();
    expect(diffGate).toHaveBeenCalledWith(expect.objectContaining({
      changedFiles: ['docker/cecelia-runner/entrypoint.sh'],
    }));
  });

  it('repair task 使用 source task 的 active contract，并推进 assigned → fixing', async () => {
    const active = {
      id: 'contract-source',
      task_id: SOURCE_TASK_ID,
      repo: 'perfectuser21/cecelia',
      change_kind: 'bugfix',
      base_revision: BASE_SHA,
      contract_hash: 'c'.repeat(64),
      contract_body: {
        task_id: SOURCE_TASK_ID,
        change_kind: 'bugfix',
        base_revision: BASE_SHA,
        affected_capabilities: [{ capability_id: 'brain' }],
        required_assertions: [],
      },
    };
    const getActiveContract = vi.fn().mockResolvedValue(active);
    const transitionGap = vi.fn().mockResolvedValue({ gap: { status: 'fixing' } });
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract,
      getGap: vi.fn().mockResolvedValue({
        id: GAP_ID,
        source_task_id: SOURCE_TASK_ID,
        repair_task_id: TASK_ID,
        status: 'assigned',
      }),
      transitionGap,
      structureGate: vi.fn().mockResolvedValue({ gate: 'pass', contract: active }),
    });

    const result = await gates.beforeGenerate({
      task: { id: TASK_ID, payload: { harness_gap_id: GAP_ID, change_kind: 'bugfix' } },
      run: { impact_contract_policy: 'legacy_exempt' },
    });

    expect(result).toMatchObject({
      gate: 'pass',
      source_task_id: SOURCE_TASK_ID,
      harness_gap_id: GAP_ID,
    });
    expect(getActiveContract).toHaveBeenCalledWith({}, SOURCE_TASK_ID);
    expect(transitionGap).toHaveBeenCalledWith({}, GAP_ID, 'fixing', expect.any(Object));
  });

  it('repair evaluator 以 source contract 对账并推进 fixing → verifying', async () => {
    const active = {
      id: 'contract-source',
      task_id: SOURCE_TASK_ID,
      repo: 'perfectuser21/cecelia',
      base_revision: BASE_SHA,
      contract_hash: 'c'.repeat(64),
      contract_body: { required_assertions: [] },
    };
    const updateGapRevision = vi.fn().mockResolvedValue(undefined);
    const transitionGap = vi.fn().mockResolvedValue({ gap: { status: 'verifying' } });
    const diffGate = vi.fn().mockResolvedValue({ gate: 'pass', contract: active });
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      getGap: vi.fn().mockResolvedValue({
        id: GAP_ID,
        source_task_id: SOURCE_TASK_ID,
        repair_task_id: TASK_ID,
        status: 'fixing',
      }),
      updateGapRevision,
      transitionGap,
      diffGate,
      readChangedFiles: vi.fn().mockResolvedValue(['packages/brain/src/tick.js']),
    });

    const result = await gates.beforeEvaluate({
      task: { id: TASK_ID, payload: { harness_gap_id: GAP_ID } },
      pr: { head_sha: HEAD_SHA },
      run: { id: RUN_ID, impact_contract_policy: 'legacy_exempt' },
    });

    expect(diffGate).toHaveBeenCalledWith(expect.objectContaining({ taskId: SOURCE_TASK_ID }));
    expect(updateGapRevision).toHaveBeenCalledWith({}, GAP_ID, HEAD_SHA);
    expect(transitionGap).toHaveBeenCalledWith({}, GAP_ID, 'verifying', expect.any(Object));
    expect(result).toMatchObject({ gate: 'pass', harness_gap_id: GAP_ID });
  });

  it('merge 前在当前 source contract 上重验可信回执围栏', async () => {
    const hash = 'c'.repeat(64);
    const active = {
      id: 'contract-source',
      task_id: SOURCE_TASK_ID,
      contract_hash: hash,
    };
    const verifyMergeFence = vi.fn().mockResolvedValue({ gate: 'pass', contract: active });
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      getGap: vi.fn().mockResolvedValue({
        id: GAP_ID,
        source_task_id: SOURCE_TASK_ID,
        repair_task_id: TASK_ID,
        status: 'verifying',
      }),
      verifyMergeFence,
      diffGate: vi.fn().mockResolvedValue({ gate: 'pass', contract: active }),
      readChangedFiles: vi.fn().mockResolvedValue(['packages/brain/src/tick.js']),
    });
    const decisionLog = [{
      detail: { impact_gate: {
        stage: 'diff', gate: 'pass', head_revision: HEAD_SHA, contract_hash: hash,
      } },
    }];

    const result = await gates.beforeMerge({
      task: { id: TASK_ID, payload: { harness_gap_id: GAP_ID } },
      pr: { head_sha: HEAD_SHA },
      decisionLog,
      run: { id: RUN_ID, impact_contract_policy: 'legacy_exempt' },
    });

    expect(verifyMergeFence).toHaveBeenCalledWith({}, {
      taskId: SOURCE_TASK_ID,
      runId: RUN_ID,
      headRevision: HEAD_SHA,
      expectedContractHash: hash,
    });
    expect(result.gate).toBe('pass');
  });

  it('merge 前重新查询 Mapper freshness，stale 时即使旧 Diff receipt 存在也阻断', async () => {
    const hash = 'c'.repeat(64);
    const active = {
      id: 'contract-source', task_id: TASK_ID, repo: 'perfectuser21/cecelia',
      base_revision: BASE_SHA, contract_hash: hash,
    };
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      readChangedFiles: vi.fn().mockResolvedValue(['packages/brain/src/tick.js']),
      diffGate: vi.fn().mockResolvedValue({
        gate: 'impact_unknown', reason: 'mapper_stale', retryable: true,
      }),
      verifyMergeFence: vi.fn(),
    });

    const result = await gates.beforeMerge({
      task: { id: TASK_ID, payload: {} },
      pr: { head_sha: HEAD_SHA },
      decisionLog: [{ detail: { impact_gate: {
        stage: 'diff', gate: 'pass', head_revision: HEAD_SHA, contract_hash: hash,
      } } }],
      run: { id: RUN_ID, impact_contract_policy: 'required' },
    });

    expect(result).toMatchObject({ gate: 'blocked', reason: 'mapper_stale', retryable: true });
  });

  it('merge 只接受当前 head 与 active contract hash 的 Diff PASS 回执', () => {
    const hash = 'c'.repeat(64);
    const decisionLog = [{
      action: 'spawn:evaluator',
      detail: {
        impact_gate: {
          stage: 'diff',
          gate: 'pass',
          head_revision: HEAD_SHA,
          contract_hash: hash,
        },
      },
    }];

    expect(findCurrentDiffPassReceipt(decisionLog, HEAD_SHA, hash)).toBeTruthy();
    expect(findCurrentDiffPassReceipt(decisionLog, 'd'.repeat(40), hash)).toBeNull();
  });

  it('merge receipt 必须绑定 completed evaluator attempt 与当前 Journey 断言版本', async () => {
    const assertion = {
      assertion_id: 'packages/brain/src/assert-brain.test.js',
      command: 'npx vitest run packages/brain/src/assert-brain.test.js',
      journey_step_link_id: '11111111-1111-4111-8111-111111111111',
      assertion_revision: 2,
      assertion_digest: 'd'.repeat(64),
    };
    const active = {
      id: '22222222-2222-4222-8222-222222222222',
      contract_hash: 'c'.repeat(64),
      contract_body: { required_assertions: [assertion] },
    };
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [active] })
        .mockResolvedValueOnce({ rows: [{
          journey_step_link_id: assertion.journey_step_link_id,
          assertion_revision: assertion.assertion_revision,
          assertion_digest: assertion.assertion_digest,
          assertion_ref_snapshot: assertion.assertion_id,
          command_argv: ['npx', 'vitest', 'run', assertion.assertion_id],
          current_assertion_revision: assertion.assertion_revision,
          current_assertion_ref: assertion.assertion_id,
        }] }),
    };

    await expect(verifyImpactMergeFence(db, {
      taskId: TASK_ID,
      runId: RUN_ID,
      headRevision: HEAD_SHA,
      expectedContractHash: active.contract_hash,
    })).resolves.toMatchObject({ gate: 'pass' });

    const receiptSql = db.query.mock.calls[1][0];
    expect(receiptSql).toMatch(/JOIN harness_attempts AS attempt/i);
    expect(receiptSql).toMatch(/attempt\.run_id::text = receipt\.run_id/i);
    expect(receiptSql).toMatch(/JOIN journey_step_links AS link/i);
    expect(receiptSql).toMatch(/attempt\.status = 'completed'/i);
    expect(receiptSql).toMatch(/outcome' IN \('PASS', 'FIXED'\)/i);
  });

  it('聚合断言的每个 Journey source binding 都必须有当前 receipt', async () => {
    const linkA = '11111111-1111-4111-8111-111111111111';
    const linkB = '33333333-3333-4333-8333-333333333333';
    const assertion = {
      assertion_id: 'packages/brain/src/assert-brain.test.js',
      command: 'npx vitest run packages/brain/src/assert-brain.test.js',
      journey_step_link_id: linkA, assertion_revision: 2, assertion_digest: 'd'.repeat(64),
      source_bindings: [
        { journey_step_link_id: linkA, assertion_revision: 2, assertion_digest: 'd'.repeat(64) },
        { journey_step_link_id: linkB, assertion_revision: 3, assertion_digest: 'd'.repeat(64) },
      ],
    };
    const active = {
      id: '22222222-2222-4222-8222-222222222222', contract_hash: 'c'.repeat(64),
      contract_body: { required_assertions: [assertion] },
    };
    const receipt = (link, revision) => ({
      journey_step_link_id: link, assertion_revision: revision,
      assertion_digest: assertion.assertion_digest,
      assertion_ref_snapshot: assertion.assertion_id,
      command_argv: ['npx', 'vitest', 'run', assertion.assertion_id],
      current_assertion_revision: revision,
      current_assertion_ref: assertion.assertion_id,
    });
    const db = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [active] })
      .mockResolvedValueOnce({ rows: [receipt(linkA, 2)] }) };

    await expect(verifyImpactMergeFence(db, {
      taskId: TASK_ID, runId: RUN_ID, headRevision: HEAD_SHA,
      expectedContractHash: active.contract_hash,
    })).resolves.toMatchObject({ gate: 'blocked', reason: 'impact_assertion_receipts_missing' });

    db.query.mockReset()
      .mockResolvedValueOnce({ rows: [active] })
      .mockResolvedValueOnce({ rows: [receipt(linkA, 2), receipt(linkB, 3)] });
    await expect(verifyImpactMergeFence(db, {
      taskId: TASK_ID, runId: RUN_ID, headRevision: HEAD_SHA,
      expectedContractHash: active.contract_hash,
    })).resolves.toMatchObject({ gate: 'pass' });
  });
});
