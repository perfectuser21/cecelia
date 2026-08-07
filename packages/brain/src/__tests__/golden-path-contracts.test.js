import { describe, expect, it } from 'vitest';

import {
  GP_CONTRACT_KEYS,
  GP_CONTRACT_SCHEMA_VERSION,
  createGoldenPathContractVersion,
  hashGoldenPathContract,
  launchLatestSignedGoldenPath,
  signAndLaunchGoldenPathContract,
  validateGoldenPathContract,
} from '../golden-path-contracts.js';
import {
  GP_HARNESS_BASE_REPO,
  GP_HARNESS_TARGET_ENVIRONMENT,
} from '../golden-path-contract-task.js';
import {
  StatefulContractDb,
  VALID_CONTRACT,
  cloneContract,
  contractRow,
} from './fixtures/golden-path-contract.js';

describe('Golden Path contract schema', () => {
  it('accepts exactly the seven frozen business keys', () => {
    expect(GP_CONTRACT_SCHEMA_VERSION).toBe(1);
    expect(GP_CONTRACT_KEYS).toEqual([
      'fr_summary',
      'lifelines_and_nfr',
      'yield_order',
      'external_commitment_changes',
      'release_and_blast_radius',
      'success_and_close',
      'budget_guard',
    ]);
    expect(validateGoldenPathContract(VALID_CONTRACT)).toEqual(VALID_CONTRACT);
  });

  it.each(GP_CONTRACT_KEYS)('rejects missing top-level key %s', (key) => {
    const contract = cloneContract();
    delete contract[key];
    expect(() => validateGoldenPathContract(contract)).toThrow();
  });

  it('rejects an eighth business key', () => {
    expect(() => validateGoldenPathContract({
      ...VALID_CONTRACT,
      risk_tier: { value: 'low' },
    })).toThrow();
  });

  it('rejects empty FR and unsupported NFR classes', () => {
    const emptyFr = cloneContract();
    emptyFr.fr_summary.statements = [];
    expect(() => validateGoldenPathContract(emptyFr)).toThrow();

    const invalidClass = cloneContract();
    invalidClass.lifelines_and_nfr.items[0].class = 'optional';
    expect(() => validateGoldenPathContract(invalidClass)).toThrow();
  });

  it('requires an executable verification for every lifeline', () => {
    const contract = cloneContract();
    contract.lifelines_and_nfr.items[0].verification = '';
    expect(() => validateGoldenPathContract(contract)).toThrow();
  });

  it('requires external-commitment none and changes to agree', () => {
    const contradictoryNone = cloneContract();
    contradictoryNone.external_commitment_changes.changes = ['SLA 变更'];
    expect(() => validateGoldenPathContract(contradictoryNone)).toThrow();

    const missingChange = cloneContract();
    missingChange.external_commitment_changes.none = false;
    expect(() => validateGoldenPathContract(missingChange)).toThrow();
  });

  it('requires a reason when the global yield order is overridden', () => {
    const contract = cloneContract();
    contract.yield_order.order = ['数据一致性', '安全/资金正确性'];
    expect(() => validateGoldenPathContract(contract)).toThrow();

    contract.yield_order.override_reason = '该 GP 不触碰资金，数据恢复优先';
    expect(validateGoldenPathContract(contract)).toEqual(contract);
  });

  it('rejects missing rollback conditions and non-positive budgets', () => {
    const noRollback = cloneContract();
    noRollback.release_and_blast_radius.rollback_triggers = [];
    expect(() => validateGoldenPathContract(noRollback)).toThrow();

    for (const field of [
      'total_cost_cap_usd',
      'atom_cost_cap_usd',
      'atom_runtime_sec',
      'atom_parallelism',
    ]) {
      const contract = cloneContract();
      contract.budget_guard[field] = 0;
      expect(() => validateGoldenPathContract(contract)).toThrow();
    }
  });

  it('hashes recursively reordered JSON identically', () => {
    const reordered = {
      budget_guard: {
        atom_parallelism: 1,
        atom_runtime_sec: 1800,
        atom_cost_cap_usd: 2,
        total_cost_cap_usd: 10,
      },
      success_and_close: VALID_CONTRACT.success_and_close,
      release_and_blast_radius: VALID_CONTRACT.release_and_blast_radius,
      external_commitment_changes: VALID_CONTRACT.external_commitment_changes,
      yield_order: VALID_CONTRACT.yield_order,
      lifelines_and_nfr: {
        items: [{
          rationale: '重复写入即业务失败',
          verification: 'SELECT COUNT(*) = 1',
          class: 'lifeline',
          statement: '写入必须唯一',
        }],
      },
      fr_summary: VALID_CONTRACT.fr_summary,
    };

    expect(hashGoldenPathContract(reordered))
      .toBe(hashGoldenPathContract(VALID_CONTRACT));
  });
});

describe('Golden Path contract version transaction', () => {
  it('requires the existing GP ledger anchor', async () => {
    const db = new StatefulContractDb({
      gp: { id: 'gp-1', journey_id: null },
    });

    await expect(createGoldenPathContractVersion(db, {
      goldenPathId: 'gp-1',
      contract: VALID_CONTRACT,
    })).rejects.toMatchObject({ code: 'GP_LEDGER_ANCHOR_REQUIRED' });
    expect(db.contracts).toEqual([]);
    expect(db.actions).toEqual([]);
  });

  it('returns the latest same-hash version idempotently without a new action', async () => {
    const existing = contractRow();
    const db = new StatefulContractDb({ contracts: [existing] });

    const result = await createGoldenPathContractVersion(db, {
      goldenPathId: 'gp-1',
      contract: structuredClone(VALID_CONTRACT),
    });

    expect(result).toMatchObject({
      contract_version: { id: existing.id, version: 1 },
      pending_action_id: 'action-existing',
      idempotent: true,
    });
    expect(db.contracts).toHaveLength(1);
    expect(db.actions).toEqual([]);
  });

  it('invalidates a signed version and appends a pending version plus action', async () => {
    const changed = cloneContract();
    changed.fr_summary.statements = ['用户看到新版结果'];
    const db = new StatefulContractDb({
      contracts: [contractRow({ status: 'signed' })],
    });

    const result = await createGoldenPathContractVersion(db, {
      goldenPathId: 'gp-1',
      contract: changed,
    });

    expect(db.contracts).toHaveLength(2);
    expect(db.contracts[0]).toMatchObject({
      version: 1,
      status: 'invalidated',
      invalidated_at: 'now',
    });
    expect(db.contracts[1]).toMatchObject({
      version: 2,
      status: 'pending_signature',
      signing_action_id: 'action-1',
    });
    expect(db.actions[0]).toMatchObject({
      action_type: 'sign_golden_path_contract',
      params: {
        golden_path_id: 'gp-1',
        contract_id: 'contract-2',
        version: 2,
      },
    });
    expect(result).toMatchObject({
      contract_version: { id: 'contract-2', version: 2 },
      pending_action_id: 'action-1',
      idempotent: false,
    });
  });

  it('supersedes an unsigned version when content changes', async () => {
    const changed = cloneContract();
    changed.success_and_close.observation_window = '48h';
    const db = new StatefulContractDb({ contracts: [contractRow()] });

    await createGoldenPathContractVersion(db, {
      goldenPathId: 'gp-1',
      contract: changed,
    });

    expect(db.contracts.map(({ version, status }) => ({ version, status })))
      .toEqual([
        { version: 1, status: 'superseded' },
        { version: 2, status: 'pending_signature' },
      ]);
  });

  it.each(['dispatched', 'in_progress'])(
    'rejects contract replacement while a Harness task is %s',
    async (status) => {
      const changed = cloneContract();
      changed.success_and_close.observation_window = '48h';
      const db = new StatefulContractDb({
        contracts: [contractRow({ status: 'signed' })],
        tasks: [{
          id: `task-${status}`,
          task_type: 'harness_initiative',
          status,
          payload: { golden_path_id: 'gp-1', gp_contract_id: 'contract-1' },
        }],
      });

      await expect(createGoldenPathContractVersion(db, {
        goldenPathId: 'gp-1',
        contract: changed,
      })).rejects.toMatchObject({ code: 'GP_CONTRACT_IN_FLIGHT' });
      expect(db.contracts).toHaveLength(1);
      expect(db.contracts[0].status).toBe('signed');
      expect(db.actions).toEqual([]);
    },
  );

  it('cancels queued and blocked Harness tasks before invalidating the old version', async () => {
    const changed = cloneContract();
    changed.success_and_close.observation_window = '48h';
    const db = new StatefulContractDb({
      contracts: [contractRow({ status: 'signed' })],
      tasks: ['queued', 'blocked'].map((status) => ({
        id: `task-${status}`,
        task_type: 'harness_initiative',
        status,
        payload: { golden_path_id: 'gp-1', gp_contract_id: 'contract-1' },
      })),
    });

    await createGoldenPathContractVersion(db, {
      goldenPathId: 'gp-1',
      contract: changed,
    });

    expect(db.tasks.map(({ status }) => status)).toEqual(['cancelled', 'cancelled']);
    const cancelIndex = db.events.findIndex((sql) => /UPDATE tasks/i.test(sql));
    const invalidateIndex = db.events.findIndex(
      (sql) => /status = CASE/i.test(sql),
    );
    expect(cancelIndex).toBeGreaterThan(-1);
    expect(cancelIndex).toBeLessThan(invalidateIndex);
  });
});

describe('Golden Path contract signature and Harness launch', () => {
  function signingDb({
    contracts = [contractRow()],
    tasks = [],
    gpStatus = 'converged',
    gp = {},
  } = {}) {
    return new StatefulContractDb({
      gp: {
        id: 'gp-1',
        title: '朋友圈 GP',
        one_liner: '用户发一条朋友圈',
        journey_id: 'journey-1',
        proposal_doc: '# proposal',
        status: gpStatus,
        ...gp,
      },
      contracts,
      tasks,
    });
  }

  it('rejects signing an older version without writing a decision or task', async () => {
    const changed = cloneContract();
    changed.success_and_close.observation_window = '48h';
    const db = signingDb({
      contracts: [
        contractRow({ version: 1, status: 'superseded' }),
        contractRow({ version: 2, contract: changed }),
      ],
    });

    await expect(signAndLaunchGoldenPathContract(db, {
      goldenPathId: 'gp-1',
      contractId: 'contract-1',
      version: 1,
      contentHash: db.contracts[0].content_hash,
      reviewer: 'owner',
    })).rejects.toMatchObject({ code: 'GP_CONTRACT_STALE' });
    expect(db.decisions).toEqual([]);
    expect(db.tasks).toEqual([]);
  });

  it('signs the latest pending version and creates exactly one bound Harness task', async () => {
    const db = signingDb();

    const result = await signAndLaunchGoldenPathContract(db, {
      goldenPathId: 'gp-1',
      contractId: 'contract-1',
      version: 1,
      contentHash: db.contracts[0].content_hash,
      reviewer: 'owner',
    });

    expect(db.decisions).toHaveLength(1);
    expect(db.contracts[0]).toMatchObject({
      status: 'signed',
      signature_decision_id: 'decision-1',
      signed_by: 'owner',
    });
    expect(db.tasks).toHaveLength(1);
    expect(db.tasks[0].payload).toMatchObject({
      golden_path_id: 'gp-1',
      journey_id: 'journey-1',
      gp_contract_id: 'contract-1',
      gp_contract_version: 1,
      gp_contract_hash: hashGoldenPathContract(VALID_CONTRACT),
    });
    expect(db.gp.status).toBe('approved');
    expect(result).toMatchObject({
      contract_version: { id: 'contract-1', status: 'signed' },
      task: { id: 'task-1' },
      idempotent: false,
    });
  });

  it('returns the same task when the signed version is retried', async () => {
    const signed = contractRow({ status: 'signed' });
    signed.signature_decision_id = 'decision-existing';
    const existingTask = {
      id: 'task-existing',
      task_type: 'harness_initiative',
      status: 'queued',
      payload: {
        golden_path_id: 'gp-1',
        gp_contract_id: signed.id,
        gp_contract_version: signed.version,
        gp_contract_hash: signed.content_hash,
      },
    };
    const db = signingDb({ contracts: [signed], tasks: [existingTask] });

    const result = await signAndLaunchGoldenPathContract(db, {
      goldenPathId: 'gp-1',
      contractId: signed.id,
      version: 1,
      contentHash: signed.content_hash,
      reviewer: 'owner',
    });

    expect(result).toMatchObject({
      task: { id: 'task-existing' },
      idempotent: true,
    });
    expect(db.decisions).toEqual([]);
    expect(db.tasks).toHaveLength(1);
  });

  it('rejects a pending action whose contract id or hash no longer matches', async () => {
    const db = signingDb();

    await expect(signAndLaunchGoldenPathContract(db, {
      goldenPathId: 'gp-1',
      contractId: 'contract-other',
      version: 1,
      contentHash: 'f'.repeat(64),
      reviewer: 'owner',
    })).rejects.toMatchObject({ code: 'GP_CONTRACT_STALE' });
    expect(db.decisions).toEqual([]);
    expect(db.tasks).toEqual([]);
  });

  // ── 债2：GP 胶水参数化（task d2567378）────────────────────────────────────
  // 两列 NULL = 沿用常量（存量 GP 零行为变化），有值 = 按 GP 行走（跨 repo / 真机环境可达）。
  it('两列为 NULL 时 payload 回落到 GP_HARNESS_* 常量（存量 GP 零行为变化）', async () => {
    const db = signingDb();

    await signAndLaunchGoldenPathContract(db, {
      goldenPathId: 'gp-1',
      contractId: 'contract-1',
      version: 1,
      contentHash: db.contracts[0].content_hash,
      reviewer: 'owner',
    });

    expect(db.tasks[0].payload).toMatchObject({
      base_repo: GP_HARNESS_BASE_REPO,
      target_environment: GP_HARNESS_TARGET_ENVIRONMENT,
    });
  });

  it('两列有值时 payload 优先读 GP 行（跨 repo + 真机环境）', async () => {
    const db = signingDb({
      gp: {
        base_repo: 'https://github.com/perfectuser21/zenithjoy.git',
        target_environment: 'windows_wechat',
      },
    });

    await signAndLaunchGoldenPathContract(db, {
      goldenPathId: 'gp-1',
      contractId: 'contract-1',
      version: 1,
      contentHash: db.contracts[0].content_hash,
      reviewer: 'owner',
    });

    expect(db.tasks[0].payload).toMatchObject({
      base_repo: 'https://github.com/perfectuser21/zenithjoy.git',
      target_environment: 'windows_wechat',
    });
  });

  it('单列有值时另一列各自独立回落（不是一有一无就整组失效）', async () => {
    const db = signingDb({ gp: { target_environment: 'windows_cloud' } });

    await signAndLaunchGoldenPathContract(db, {
      goldenPathId: 'gp-1',
      contractId: 'contract-1',
      version: 1,
      contentHash: db.contracts[0].content_hash,
      reviewer: 'owner',
    });

    expect(db.tasks[0].payload).toMatchObject({
      base_repo: GP_HARNESS_BASE_REPO,
      target_environment: 'windows_cloud',
    });
  });

  // DB 的 CHECK 只在写 golden_paths 时把关；GP 行是历史遗留或被旁路写入时，
  // 非法值会一路带进 payload，直到 harness 派发才炸。这里在写任何一行之前先拦掉。
  it('target_environment 非法枚举 → 抛错且不写 decision/task', async () => {
    const db = signingDb({ gp: { target_environment: 'no_such_env' } });

    await expect(signAndLaunchGoldenPathContract(db, {
      goldenPathId: 'gp-1',
      contractId: 'contract-1',
      version: 1,
      contentHash: db.contracts[0].content_hash,
      reviewer: 'owner',
    })).rejects.toMatchObject({ code: 'GP_TARGET_ENVIRONMENT_INVALID' });

    expect(db.decisions).toEqual([]);
    expect(db.tasks).toEqual([]);
  });

  it('hard-gates compatibility launch when the latest contract is unsigned', async () => {
    const db = signingDb();

    await expect(launchLatestSignedGoldenPath(db, {
      goldenPathId: 'gp-1',
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'GP_CONTRACT_SIGNATURE_REQUIRED' });
    expect(db.tasks).toEqual([]);
  });
});
