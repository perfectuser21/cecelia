import { hashGoldenPathContract } from '../../golden-path-contracts.js';


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

export function cloneContract() {
  return structuredClone(VALID_CONTRACT);
}

export class StatefulContractDb {
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
    this.receipts = [];
    this.events = [];
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    this.events.push(compact);

    if (/FROM golden_paths .*FOR UPDATE/i.test(compact)) {
      return { rows: this.gp ? [structuredClone(this.gp)] : [] };
    }
    if (/FROM map_scope_repositories AS repositories/i.test(compact)) {
      return {
        rows: [{ repo: 'cecelia', source_revision: 'a'.repeat(40) }],
      };
    }
    if (/SELECT scope_key, repo, adapter_config FROM map_scope_repositories/i.test(compact)) {
      return {
        rows: [{
          scope_key: 'cecelia',
          repo: 'cecelia',
          adapter_config: {
            aliases: [
              'perfectuser21/cecelia',
              'https://github.com/perfectuser21/cecelia',
            ],
          },
        }],
      };
    }
    if (/pg_advisory_xact_lock/i.test(compact)) {
      return { rows: [] };
    }
    if (/FROM work_routing_receipts r/i.test(compact)) {
      const receipt = this.receipts.find((row) => (
        row.source === params[0]
        && row.source_id === params[1]
        && row.router_version === params[2]
      ));
      const task = receipt && this.tasks.find((row) => row.id === receipt.task_id);
      return {
        rows: receipt && task
          ? [{ ...structuredClone(task), routing_receipt_id: receipt.id, task_id: task.id }]
          : [],
      };
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
      const routedInsert = /project_id, area_id, goal_id/i.test(compact);
      const row = {
        id: `task-${this.tasks.length + 1}`,
        title: params[0],
        description: params[1],
        task_type: 'harness_initiative',
        status: 'queued',
        payload: JSON.parse(routedInsert ? params[9] : params[2]),
      };
      this.tasks.push(row);
      return { rows: [structuredClone(row)] };
    }
    if (/INSERT INTO work_routing_receipts/i.test(compact)) {
      const row = {
        id: `receipt-${this.receipts.length + 1}`,
        task_id: params[0],
        source: params[1],
        source_id: params[2],
        router_version: params[13],
      };
      this.receipts.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (/UPDATE tasks SET payload = payload \|\|/i.test(compact)) {
      const task = this.tasks.find((row) => row.id === params[0]);
      task.payload = { ...task.payload, ...JSON.parse(params[1]) };
      return { rows: [] };
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

export function contractRow({
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
