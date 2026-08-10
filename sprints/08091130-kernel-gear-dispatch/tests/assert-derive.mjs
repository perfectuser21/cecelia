/**
 * 真执行 oracle：直调 kernel 纯函数 derive()，按 gear 断言分叉方向，不匹配 exit 1。
 * 用法: node assert-derive.mjs <gear|none> <expect: generator|notgan|planner|invalid>
 * 无 mock / 无替身 / 无 DB——被改的边（derive 状态机）本体。evaluator 直接跑，exit code 即判定。
 */
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const gearArg = process.argv[2];
const expect = process.argv[3];
const gear = gearArg === 'none' ? undefined : gearArg;

const observed = {
  run: { phase: 'planning' },
  task: { status: 'in_progress' },
  prdExists: false,
  contract: { approved: false },
  pr: null,
  inflight: { containers: [], host_pids: [], attempts: [] },
  lastAgentExit: { code: 0, auth_failed: false },
  proposeBranchRn: 0,
  ganLatestRoundVerdict: null,
  generatorSpawned: false,
  evaluateVerdict: null,
  judgeVerdict: null,
  reviewRequired: false,
  reviewApproved: false,
  decisionLog: [],
  counters: {
    hops: 1, fixRound: 0, pollCount: 0,
    noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0,
  },
  ...(gear === undefined ? {} : { gear }),
};

const d = derive(observed);
const tag = `gear=${gearArg} expect=${expect} → phase=${d.phase} action=${d.action} reason=${d.reason ?? ''}`;

function fail(msg) {
  console.error(`FAIL: ${msg} | ${tag}`);
  process.exit(1);
}

const GAN_ROLES = ['spawn:planner', 'spawn:proposer', 'spawn:reviewer'];

switch (expect) {
  case 'generator':
    if (d.action === 'spawn:planner') fail('hotfix 竟返回 spawn:planner（未跳 planning）');
    if (d.action !== 'spawn:generator' || d.phase !== 'generate') fail('hotfix 应 phase=generate/action=spawn:generator');
    break;
  case 'notgan':
    if (GAN_ROLES.includes(d.action)) fail('hotfix 不应派 planner/proposer/reviewer');
    break;
  case 'planner':
    if (d.action !== 'spawn:planner' || d.phase !== 'planning') fail('default/缺省/segmented 应 phase=planning/action=spawn:planner（零回归）');
    break;
  case 'invalid':
    if (d.action !== 'mark_failed' || d.phase !== 'failed' || d.reason !== 'invalid_gear') fail('非法 gear 应 fail-closed mark_failed/invalid_gear');
    break;
  default:
    fail(`未知 expect: ${expect}`);
}

console.log(`OK: ${tag}`);
