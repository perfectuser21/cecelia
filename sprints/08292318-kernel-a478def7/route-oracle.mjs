#!/usr/bin/env node
/**
 * route-oracle.mjs — r73 合同重开纪元 no_pr 路由真验（DoD BEHAVIOR [L2] 留证）。
 *
 * 真 import packages/brain/src/orchestrator/derive.js，喂确定性 observed 快照，
 * 断言修后路由并打印 `OK: scenario=<name> → {...}`。无 I/O、无 mock（禁 mock 被改的边）。
 *
 * 用法: node sprints/08292318-kernel-a478def7/route-oracle.mjs <reopen|bounded|negative|epoch>
 */
import { derive } from '../../packages/brain/src/orchestrator/derive.js';

const IDENTITY = { contract_id: 'c-reopen-2', manifest_sha256: 'm2', source_revision: 'r2' };

function observed(decisionLog) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    pr: null,
    candidate: null,
    contract: { approved: true, identity: IDENTITY },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false, action: 'spawn:generator' },
    proposeBranchRn: 2,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 30, fixRound: 1, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
  };
}

const genSpawn = (hop, reason) => ({ hop, action: 'spawn:generator', detail: { reason } });
const genCallback = (hop) => ({ hop, action: 'verdict:attempt_callback', detail: { role: 'generator', status: 'completed' } });
const reopen = (hop, callbackHop) => ({ hop, action: 'reopen_gan_contract', detail: { reason: 'contract_fault_reopen_gan', callback_hop: callbackHop } });
const proposerSpawn = (hop) => ({ hop, action: 'spawn:proposer', detail: { reason: 'revision_requested' } });
const reviewerApproved = (hop) => ({ hop, action: 'verdict:reviewer', detail: { approved: true } });
const fixSpawn = (hop) => ({ hop, action: 'spawn:generator-fix', detail: { reason: 'no_pr' } });

const REOPEN_ERA = [
  genSpawn(10, 'contract_approved'),
  genCallback(11),
  reopen(12, 11),
  proposerSpawn(13),
  reviewerApproved(14),
];

const SCENARIOS = {
  // B-01 / B-04：重开纪元内、纪元后未派全新 generator → 从冻结基线重写。
  reopen: { log: REOPEN_ERA, expect: { action: 'spawn:generator', reason: 'contract_reopened_fresh_generator' } },
  epoch: { log: REOPEN_ERA, expect: { action: 'spawn:generator', reason: 'contract_reopened_fresh_generator' } },
  // B-02：重开后 hop15 已派全新 generator，再 no_pr → 有界回落既有 fix 语义。
  bounded: {
    log: [...REOPEN_ERA, genSpawn(15, 'contract_reopened_fresh_generator'), genCallback(16), fixSpawn(17)],
    expect: { action: 'spawn:generator-fix', reason: 'no_pr' },
  },
  // B-03 / INV-1：无 reopen 行的 no_pr → 语义不变仍 generator-fix。
  negative: {
    log: [genSpawn(10, 'contract_approved'), genCallback(11), fixSpawn(12)],
    expect: { action: 'spawn:generator-fix', reason: 'no_pr' },
  },
};

const scenario = process.argv[2];
const spec = SCENARIOS[scenario];
if (!spec) {
  console.error(`FAIL: unknown scenario '${scenario}' (expected one of ${Object.keys(SCENARIOS).join(', ')})`);
  process.exit(2);
}

const r = derive(observed(spec.log));
if (r.action !== spec.expect.action || r.reason !== spec.expect.reason) {
  console.error(`FAIL: scenario=${scenario} expected ${JSON.stringify(spec.expect)} got ${JSON.stringify(r)}`);
  process.exit(1);
}
console.log(`OK: scenario=${scenario} → ${JSON.stringify(r)}`);
