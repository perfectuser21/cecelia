import { it, expect } from 'vitest';
import { sample } from './fixtures/commander-contract-v1.js';
import { decideLedger } from '../factory-pusher.js';
const scope = { activity_definition_version_id: sample.definition.expected_path[0].activity_definition_version_id,
  implementation: sample.implementations.code.implementation, environment: sample.contract.environment };
const cfg = { agent: 'work-commander', device: { node: 'worker', profile: 'private', serial: 'phone' }, dispatch_via: 'commander',
  dev: { repo_hint: 'https://github.com/perfectuser21/cecelia' }, commander: { workflow_definition: sample.definition,
    workflow_input: sample.task.payload.workflow_input, evidence_scopes: [scope] } };
const ledger = { workflow_key: 'private_publish', stage: 3, candidate_version: 'paired@2', blocked_kind: 'none', window_k: 3, recent_total: 3, recent_pass: 3, recent_runs: [] };
const fact = role => ({ evidence_scope: scope, pass: true, independent_verified: true, readback_verified: true, execution_role: role });
const runs = role => [1,2,3].map(i => ({ run_id: `run-${i}`, pass: true, evidence_provenance: 'factory_judge', activity_evidence: [fact(role)] }));
const decide = (over = {}, config = cfg, rest = {}) => decideLedger({ ledger: { ...ledger, ...over }, cfg: config, commanderRoute: true, now: new Date('2026-10-14T06:00:00Z'), ...rest });
it('v2业务滑窗通过或救场不得替代冻结Code独立证据晋级', () => {
  expect(decide().actions.some(a => a.type === 'transition')).toBe(false);
  expect(decide({ recent_runs: runs('fallback') }).actions.some(a => a.type === 'transition')).toBe(false);
  expect(decide({ recent_runs: runs('rescue') }).actions.some(a => a.type === 'transition')).toBe(false);
});
it('明确冻结scope的独立primary窗口才晋级；没有scope形成可观测阻断', () => {
  expect(decide({ recent_runs: runs('primary') }).actions).toEqual([expect.objectContaining({ type: 'transition', to_stage: 4 })]);
  const missing = structuredClone(cfg); delete missing.commander.evidence_scopes;
  expect(decide({}, missing).actions).toEqual([expect.objectContaining({ type: 'block', kind: 'resource' })]);
});
it('已完成开发工单不能替代业务独立验收推进stage4/6', () => {
  for (const stage of [4,6]) expect(decide({ stage }, cfg, { ticketsDone: 1 }).actions.some(a => a.type === 'transition')).toBe(false);
});
it('Skill独立验证可先推进；不要求不存在的Code资格', () => {
  const skillScope = { ...scope, implementation: sample.implementations.skill.implementation };
  const config = structuredClone(cfg); config.commander.evidence_scopes = [skillScope];
  const observed = runs('primary').map(r => ({ ...r, activity_evidence: [{ ...r.activity_evidence[0], evidence_scope: skillScope }] }));
  expect(decide({ recent_runs: observed }, config).actions.some(a => a.type === 'transition')).toBe(true);
});
