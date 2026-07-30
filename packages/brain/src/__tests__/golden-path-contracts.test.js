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


export const VALID_CONTRACT = {
  fr_summary: {
    statements: ['用户在入口提交后看到成功结果'],
  },
  lifelines_and_nfr: {
    items: [{
      statement: '写入必须唯一',
      class: 'lifeline',
      verification: 'SELECT COUNT(*) = 1',
      rationale: '重复写入即业务失败',
    }],
  },
  yield_order: {
    order: ['安全/资金正确性', '数据一致性', '功能完整', '性能', '体验顺滑'],
    override_reason: null,
  },
  external_commitment_changes: {
    changes: [],
    none: true,
  },
  release_and_blast_radius: {
    stages: ['internal'],
    blast_radius: '单一内部 Journey',
    rollback_triggers: ['错误率 > 1%'],
  },
  success_and_close: {
    metrics: ['成功率 >= 99%'],
    observation_window: '24h',
    close_conditions: ['24h 达标'],
    shutdown_conditions: ['连续 5 分钟错误率 > 1%'],
  },
  budget_guard: {
    total_cost_cap_usd: 10,
    atom_cost_cap_usd: 2,
    atom_runtime_sec: 1800,
    atom_parallelism: 1,
  },
};

function cloneContract() {
  return structuredClone(VALID_CONTRACT);
}

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

class StatefulContractDb {
  constructor({
    gp = { id: 'gp-1', journey_id: 'journey-1' },
    contracts = [],
    tasks = [],
  } = {}) {
    this.gp = gp;
    this.contracts = structuredClone(contracts);
    this.tasks = structuredClone(tasks);
    this.actions = [];
    this.decisions = [];
    this.events = [];
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    this.events.push(compact);

    if (/FROM golden_paths .*FOR UPDATE/i.test(compact)) {
      return { rows: this.gp ? [structuredClone(this.gp)] : [] };
    }
    if (
      /FROM golden_path_contract_versions/i.test(compact)
      && /ORDER BY version DESC LIMIT 1/i.test(compact)
    ) {
      const latest = [...this.contracts]
        .filter((row) => row.golden_path_id === params[0])
        .sort((a, b) => b.version - a.version)[0];
      return { rows: latest ? [structuredClone(latest)] : [] };
    }
    if (
      /FROM tasks/i.test(compact)
      && /payload->>'gp_contract_id'/i.test(compact)
    ) {
      return {
        rows: this.tasks
          .filter((task) => task.payload?.gp_contract_id === params[0])
          .map((task) => structuredClone(task)),
      };
    }
    if (/FROM tasks/i.test(compact) && /harness_initiative/i.test(compact)) {
      return {
        rows: this.tasks
          .filter((task) => (
            task.task_type === 'harness_initiative'
            && task.payload?.golden_path_id === params[0]
            && ['queued', 'blocked', 'dispatched', 'in_progress'].includes(task.status)
          ))
          .map((task) => structuredClone(task)),
      };
    }
    if (/UPDATE tasks/i.test(compact) && /status = 'cancelled'/i.test(compact)) {
      const ids = params[0];
      const updated = [];
      for (const task of this.tasks) {
        if (ids.includes(task.id) && ['queued', 'blocked'].includes(task.status)) {
          task.status = 'cancelled';
          updated.push(structuredClone(task));
        }
      }
      return { rows: updated };
    }
    if (
      /UPDATE golden_path_contract_versions/i.test(compact)
      && /status = CASE/i.test(compact)
    ) {
      const updated = [];
      for (const row of this.contracts) {
        if (row.golden_path_id !== params[0]) continue;
        if (row.status === 'signed') {
          row.status = 'invalidated';
          row.invalidated_at = 'now';
          updated.push(structuredClone(row));
        } else if (row.status === 'pending_signature') {
          row.status = 'superseded';
          updated.push(structuredClone(row));
        }
      }
      return { rows: updated };
    }
    if (/INSERT INTO golden_path_contract_versions/i.test(compact)) {
      const row = {
        id: `contract-${this.contracts.length + 1}`,
        golden_path_id: params[0],
        schema_version: params[1],
        version: params[2],
        contract_json: JSON.parse(params[3]),
        content_hash: params[4],
        status: 'pending_signature',
        signing_action_id: null,
      };
      this.contracts.push(row);
      return { rows: [structuredClone(row)] };
    }
    if (/INSERT INTO pending_actions/i.test(compact)) {
      const row = {
        id: `action-${this.actions.length + 1}`,
        action_type: 'sign_golden_path_contract',
        params: JSON.parse(params[0]),
        context: JSON.parse(params[1]),
        signature: params[2],
      };
      this.actions.push(row);
      return { rows: [structuredClone(row)] };
    }
    if (
      /UPDATE golden_path_contract_versions/i.test(compact)
      && /signing_action_id =/i.test(compact)
    ) {
      const row = this.contracts.find((item) => item.id === params[1]);
      row.signing_action_id = params[0];
      return { rows: [structuredClone(row)] };
    }
    if (/INSERT INTO decisions/i.test(compact)) {
      const row = {
        id: `decision-${this.decisions.length + 1}`,
        topic: params[0],
        reason: params[1],
        context: JSON.parse(params[2]),
      };
      this.decisions.push(row);
      return { rows: [structuredClone(row)] };
    }
    if (
      /UPDATE golden_path_contract_versions/i.test(compact)
      && /status = 'signed'/i.test(compact)
    ) {
      const row = this.contracts.find((item) => item.id === params[3]);
      row.status = 'signed';
      row.signature_decision_id = params[0];
      row.signed_by = params[1];
      row.signed_at = 'now';
      return { rows: [structuredClone(row)] };
    }
    if (/INSERT INTO tasks/i.test(compact)) {
      const row = {
        id: `task-${this.tasks.length + 1}`,
        title: params[0],
        description: params[1],
        task_type: 'harness_initiative',
        status: 'queued',
        payload: JSON.parse(params[2]),
      };
      this.tasks.push(row);
      return { rows: [structuredClone(row)] };
    }
    if (
      /UPDATE golden_paths/i.test(compact)
      && /status = 'approved'/i.test(compact)
    ) {
      this.gp.status = 'approved';
      this.gp.judgment_refs = [params[0]];
      this.gp.approved_at = 'now';
      return { rows: [structuredClone(this.gp)] };
    }
    throw new Error(`Unexpected SQL: ${compact}`);
  }
}

function contractRow({
  version = 1,
  contract = VALID_CONTRACT,
  status = 'pending_signature',
  signingActionId = 'action-existing',
} = {}) {
  return {
    id: `contract-${version}`,
    golden_path_id: 'gp-1',
    schema_version: 1,
    version,
    contract_json: structuredClone(contract),
    content_hash: hashGoldenPathContract(contract),
    status,
    signing_action_id: signingActionId,
  };
}

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
  } = {}) {
    return new StatefulContractDb({
      gp: {
        id: 'gp-1',
        title: '朋友圈 GP',
        one_liner: '用户发一条朋友圈',
        journey_id: 'journey-1',
        proposal_doc: '# proposal',
        status: gpStatus,
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

  it('hard-gates compatibility launch when the latest contract is unsigned', async () => {
    const db = signingDb();

    await expect(launchLatestSignedGoldenPath(db, {
      goldenPathId: 'gp-1',
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'GP_CONTRACT_SIGNATURE_REQUIRED' });
    expect(db.tasks).toEqual([]);
  });
});
