#!/usr/bin/env node
/**
 * check-reason-code.mjs — Diff Impact Gate reason_code 透传 / fail-closed 出口验收 oracle（r19）
 *
 * 真实执行 evaluateDiffGate（不 stub 决策逻辑），仅注入外层 Mapper HTTP 边界（mapClient）
 * 与最小 active contract（db.query 返回 contract row，让流程进入步骤 3a）。
 * 任一断言失败 → 打印 FAIL 并 exit 1；全过 → 打印 OK 并 exit 0。
 *
 * 用法: node sprints/08180424-kernel-c0d4fe12/verify/check-reason-code.mjs --case <name>
 *   deterministic       确定性 reason_code(no_anchor) 透传且 retryable=false
 *   deterministic_all   确定性终态集合每个 code 均透传且 retryable=false（INV-2 不无限空转）
 *   transient           暂态 reason_code(map_unavailable) 透传且 retryable=true
 *   null_reason         reason_code 缺失 → 保留 mapper_stale 语义 + retryable=true
 *   mapper_unavailable  Mapper 抛异常 → mapper_unavailable + retryable=true（本改动不触碰）
 *   fail_closed         所有 stale/异常分支 gate=impact_unknown，绝不 pass（INV-1 fail-closed）
 */
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// 确定性终态集合（不会因重试自愈；PRD ASSUMPTION 锁死）
const DETERMINISTIC = ['no_anchor', 'anchor_missing', 'revision_mismatch', 'manifest_projection_mismatch', 'fail_current_revision'];
// 暂态集合（仍可重试）
const TRANSIENT = ['map_unavailable', 'resolver_error', 'fact_stale', 'fact_snapshot_stale'];

// 最小 active contract mock（让 evaluateDiffGate 通过步骤 1，进入步骤 2/3a）
function makeDb() {
  return {
    query: async () => ({
      rows: [{
        id: 'contract-r19', task_id: 'task-r19', repo: 'cecelia',
        base_revision: 'base', contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    }),
  };
}

// mapClient：返回 stale + 指定 reason_code
function staleMapClient(reasonCode) {
  return async () => {
    const freshness = { status: 'stale' };
    if (reasonCode !== undefined) freshness.reason_code = reasonCode;
    return { freshness, affected_nodes: [], required_assertions: [] };
  };
}

async function run(taskId, reasonCode) {
  return evaluateDiffGate({
    db: makeDb(), taskId, repo: 'cecelia', headRevision: 'head',
    mapClient: staleMapClient(reasonCode),
  });
}

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }

const caseName = (() => {
  const i = process.argv.indexOf('--case');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const cases = {
  async deterministic() {
    const r = await run('task-det', 'no_anchor');
    if (r.gate !== 'impact_unknown') fail(`gate 应为 impact_unknown，实为 ${r.gate}`);
    if (r.reason_code !== 'no_anchor') fail(`reason_code 未透传，期望 no_anchor 实为 ${JSON.stringify(r.reason_code)}`);
    if (r.retryable !== false) fail(`确定性终态 retryable 应为 false，实为 ${JSON.stringify(r.retryable)}`);
    console.log('OK: no_anchor 透传且 retryable=false');
  },
  async deterministic_all() {
    for (const code of DETERMINISTIC) {
      const r = await run('task-det-all', code);
      if (r.reason_code !== code) fail(`确定性 code=${code} 未原样透传，实为 ${JSON.stringify(r.reason_code)}`);
      if (r.retryable !== false) fail(`确定性 code=${code} retryable 应为 false，实为 ${JSON.stringify(r.retryable)}`);
      if (r.gate !== 'impact_unknown') fail(`确定性 code=${code} gate 应为 impact_unknown，实为 ${r.gate}`);
    }
    console.log(`OK: 确定性集合 ${DETERMINISTIC.length} 个 code 全部 retryable=false 且透传`);
  },
  async transient() {
    for (const code of TRANSIENT) {
      const r = await run('task-transient', code);
      if (r.reason_code !== code) fail(`暂态 code=${code} 未透传，实为 ${JSON.stringify(r.reason_code)}`);
      if (r.retryable !== true) fail(`暂态 code=${code} retryable 应为 true，实为 ${JSON.stringify(r.retryable)}`);
      if (r.gate !== 'impact_unknown') fail(`暂态 code=${code} gate 应为 impact_unknown，实为 ${r.gate}`);
    }
    console.log(`OK: 暂态集合 ${TRANSIENT.length} 个 code 全部 retryable=true 且透传`);
  },
  async null_reason() {
    const r = await run('task-null', undefined);
    if (r.gate !== 'impact_unknown') fail(`gate 应为 impact_unknown，实为 ${r.gate}`);
    if (r.reason !== 'mapper_stale') fail(`reason_code 缺失时 reason 应保持 mapper_stale，实为 ${JSON.stringify(r.reason)}`);
    if (r.retryable !== true) fail(`reason_code 缺失时 retryable 应为 true，实为 ${JSON.stringify(r.retryable)}`);
    if (r.reason_code) fail(`reason_code 缺失时不得凭空生成，实为 ${JSON.stringify(r.reason_code)}`);
    console.log('OK: reason_code 缺失 → mapper_stale + retryable=true');
  },
  async mapper_unavailable() {
    const r = await evaluateDiffGate({
      db: makeDb(), taskId: 'task-unavail', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => { throw new Error('ETIMEDOUT'); },
    });
    if (r.gate !== 'impact_unknown') fail(`gate 应为 impact_unknown，实为 ${r.gate}`);
    if (r.reason !== 'mapper_unavailable') fail(`Mapper 抛异常 reason 应为 mapper_unavailable，实为 ${JSON.stringify(r.reason)}`);
    if (r.retryable !== true) fail(`Mapper 抛异常 retryable 应为 true，实为 ${JSON.stringify(r.retryable)}`);
    console.log('OK: Mapper 抛异常 → mapper_unavailable + retryable=true（未被本改动波及）');
  },
  async fail_closed() {
    // INV-1：所有确定性 + 暂态 + null + 抛异常分支，gate 恒为 impact_unknown，绝不 pass/extend/drift
    for (const code of [...DETERMINISTIC, ...TRANSIENT, undefined]) {
      const r = await run('task-failclosed', code);
      if (r.gate !== 'impact_unknown') fail(`fail-closed 破防：code=${JSON.stringify(code)} gate=${r.gate}（不得放行）`);
      if (['pass', 'extend', 'drift'].includes(r.verdict)) fail(`fail-closed 破防：code=${JSON.stringify(code)} verdict=${r.verdict}`);
    }
    const thrown = await evaluateDiffGate({
      db: makeDb(), taskId: 'task-fc-throw', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => { throw new Error('boom'); },
    });
    if (thrown.gate !== 'impact_unknown') fail(`fail-closed 破防：抛异常 gate=${thrown.gate}`);
    console.log('OK: 所有不可判定分支 gate=impact_unknown，绝不假绿放行');
  },
};

if (!caseName || !cases[caseName]) {
  console.error(`用法: --case <${Object.keys(cases).join('|')}>`);
  process.exit(2);
}
await cases[caseName]();
