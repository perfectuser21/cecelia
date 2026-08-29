// route-oracle.mjs — 合同重开纪元 no_pr 路由的确定性 oracle（evaluator 原样复跑）。
// 真 import packages/brain/src/orchestrator/derive.js（禁 mock 被改的边），
// 喂复刻 r73 的确定性 observed 快照，按 scenario 断言路由 action/reason；
// 不符 → exit 1 并打印 FAIL。纯函数、无 I/O、可重放。
//
// 用法: node sprints/08292318-kernel-a478def7/route-oracle.mjs <reopen|bounded|negative|epoch>
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
const genCb = (hop) => ({ hop, action: 'verdict:attempt_callback', detail: { role: 'generator', status: 'completed' } });
const reopen = (hop, cbHop) => ({ hop, action: 'reopen_gan_contract', detail: { reason: 'contract_fault_reopen_gan', callback_hop: cbHop } });
const proposerSpawn = (hop) => ({ hop, action: 'spawn:proposer', detail: { reason: 'revision_requested' } });
const reviewerApproved = (hop) => ({ hop, action: 'verdict:reviewer', detail: { approved: true } });
const fixSpawn = (hop) => ({ hop, action: 'spawn:generator-fix', detail: { reason: 'no_pr' } });

const reopenEra = [genSpawn(10, 'contract_approved'), genCb(11), reopen(12, 11), proposerSpawn(13), reviewerApproved(14)];

const SCENARIOS = {
  // r73 核心：重开纪元内、纪元后未派全新 generator → 派全新 generator
  reopen: { log: reopenEra, action: 'spawn:generator', reason: 'contract_reopened_fresh_generator' },
  // 有界：纪元后已派全新 generator(hop15) 再 no_pr → 回落 fix
  bounded: { log: [...reopenEra, genSpawn(15, 'contract_reopened_fresh_generator'), genCb(16), fixSpawn(17)], action: 'spawn:generator-fix', reason: 'no_pr' },
  // 负向：无 reopen 行 → 语义不变仍 fix
  negative: { log: [genSpawn(10, 'contract_approved'), genCb(11), fixSpawn(12)], action: 'spawn:generator-fix', reason: 'no_pr' },
  // 纪元隔离：重开前的 spawn:generator(hop10) 不算「已派」→ 仍派全新 generator
  epoch: { log: reopenEra, action: 'spawn:generator', reason: 'contract_reopened_fresh_generator' },
};

const key = process.argv[2];
const spec = SCENARIOS[key];
if (!spec) {
  console.error(`FAIL: 未知 scenario '${key}'（可选: ${Object.keys(SCENARIOS).join('|')}）`);
  process.exit(2);
}
const r = derive(observed(spec.log));
if (r.action !== spec.action || r.reason !== spec.reason) {
  console.error(`FAIL: scenario=${key} 期望 action=${spec.action} reason=${spec.reason}，实得 ${JSON.stringify(r)}`);
  process.exit(1);
}
console.log(`OK: scenario=${key} → ${JSON.stringify(r)}`);
