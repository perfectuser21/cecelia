import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseActivityContract } from '../../../src/orchestrator/activity-contract.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'contract.json'), 'utf8'));

describe('coding_spec 契约通过通用执行器真实校验', () => {
  it('parseActivityContract 接受契约且按 order 排出五个活动', () => {
    const plan = parseActivityContract(contract);
    expect(plan.workflow).toBe('coding_spec');
    expect(plan.activities.map(a => a.key)).toEqual(['intent', 'spec', 'chain_check', 'publish', 'report']);
  });
});

const ENTRY_RE = /^(?:[a-zA-Z0-9_][a-zA-Z0-9_-]*\/)*[a-zA-Z0-9_][a-zA-Z0-9_-]*\.(?:js|mjs|sh)$/;
const PHASES = ['setup', 'source', 'per_item', 'batch_end', 'finalize'];

// Global Constraints：budget / max_attempts / phase 期望值
const EXPECTED = {
  intent: { order: 1, phase: 'setup', entry: 'activities/intent.mjs', max_duration_s: 60, max_attempts: 1 },
  spec: { order: 2, phase: 'source', entry: 'activities/spec.mjs', max_duration_s: 900, max_attempts: 2 },
  chain_check: { order: 3, phase: 'batch_end', entry: 'activities/chain-check.mjs', max_duration_s: 30, max_attempts: 1 },
  publish: { order: 4, phase: 'batch_end', entry: 'activities/publish.mjs', max_duration_s: 900, max_attempts: 1 },
  report: { order: 5, phase: 'finalize', entry: 'activities/report.mjs', max_duration_s: 30, max_attempts: 2 },
};

// 各活动实际会报出的 reason_code（grep 活动源码得到），按类别归档
const REPORTED = {
  intent: {
    retryable: ['brain_unavailable'],
    needs_human: ['acceptance_missing'],
    fatal: ['task_id_missing', 'sprint_dir_invalid', 'task_not_found'],
  },
  spec: {
    retryable: ['claude_failed', 'claude_timeout'],
    needs_human: ['claude_auth'],
    fatal: ['sprint_dir_invalid', 'task_id_missing', 'intent_ids_missing', 'intent_ids_invalid', 'spec_missing', 'spec_out_of_scope_write'],
  },
  chain_check: {
    fatal: ['md_chain_invalid', 'sprint_dir_invalid', 'task_id_missing'],
  },
  publish: {
    retryable: ['push_failed', 'gh_failed'],
    needs_human: ['gh_auth'],
    fatal: ['sprint_dir_invalid', 'task_id_missing', 'chain_files_missing', 'branch_invalid', 'git_add_failed', 'git_commit_failed', 'git_diff_failed'],
  },
  report: {
    retryable: ['brain_unavailable'],
    fatal: ['pr_url_missing', 'task_id_missing', 'task_not_found'],
  },
};

const byKey = (key) => contract.activities.find((a) => a.key === key);
const declared = (a, cls) => (cls === 'needs_human' ? a.failure.needs_human.cases : a.failure[cls]);

describe('coding_spec 契约', () => {
  it('workflow 名与活动顺序', () => {
    expect(contract.workflow).toBe('coding_spec');
    const sorted = [...contract.activities].sort((a, b) => a.order - b.order);
    expect(sorted.map((a) => a.key)).toEqual(['intent', 'spec', 'chain_check', 'publish', 'report']);
    expect(sorted.map((a) => a.order)).toEqual([1, 2, 3, 4, 5]);
  });

  describe.each(Object.entries(EXPECTED))('活动 %s', (key, exp) => {
    it('runtime 形状', () => {
      const a = byKey(key);
      expect(a).toBeDefined();
      expect(a.order).toBe(exp.order);
      expect(a.runtime.protocol).toBe('json-stdio-v1');
      expect(PHASES).toContain(a.runtime.phase);
      expect(a.runtime.phase).toBe(exp.phase);
      expect(a.runtime.entry).toBe(exp.entry);
      expect(a.runtime.entry).toMatch(ENTRY_RE);
      expect(fs.existsSync(path.join(ROOT, a.runtime.entry))).toBe(true);
      expect(a.runtime.on_failure).toBe('stop_run');
      expect([1, 2]).toContain(a.runtime.max_attempts);
      expect(a.runtime.max_attempts).toBe(exp.max_attempts);
      expect(a.runtime.input).toBeUndefined();
      expect(a.runtime.per_item).toBeUndefined();
    });

    it('budget 为正整数且等于约定值', () => {
      const a = byKey(key);
      expect(Number.isSafeInteger(a.budget.max_duration_s) && a.budget.max_duration_s > 0).toBe(true);
      expect(Number.isSafeInteger(a.budget.heartbeat_s) && a.budget.heartbeat_s > 0).toBe(true);
      expect(a.budget.max_duration_s).toBe(exp.max_duration_s);
      expect(a.budget.heartbeat_s).toBe(30);
    });

    it('failure 四组都是数组，needs_human.cases 是数组', () => {
      const a = byKey(key);
      for (const group of ['empty_ok', 'retryable', 'fatal']) {
        expect(Array.isArray(a.failure[group])).toBe(true);
      }
      expect(Array.isArray(a.failure.needs_human?.cases)).toBe(true);
    });

    it('活动实际会报出的 failure_class 在契约中非空，且包含其 reason_code', () => {
      const a = byKey(key);
      for (const [cls, codes] of Object.entries(REPORTED[key])) {
        expect(declared(a, cls).length, `${key}.${cls} 应非空`).toBeGreaterThan(0);
        for (const code of codes) expect(declared(a, cls), `${key}.${cls}`).toContain(code);
      }
    });

    it('活动不会报出的 failure_class 声明为空数组', () => {
      const a = byKey(key);
      for (const cls of ['retryable', 'needs_human', 'fatal']) {
        if (!(cls in REPORTED[key])) expect(declared(a, cls)).toEqual([]);
      }
    });
  });
});
