#!/usr/bin/env node
/**
 * r19 node oracle — 真实执行 evaluateDiffGate（决策不 mock），仅注入外层 Mapper 边界
 * (mapClient) 与最小 active contract(db.query)，逐场景断言 reason_code 透传 + fail-closed 出口。
 *
 * 用法: node check-reason-code.mjs --case <deterministic|deterministic_all|transient|null_reason|mapper_unavailable|fail_closed>
 */
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const DETERMINISTIC = ['no_anchor', 'anchor_missing', 'revision_mismatch', 'manifest_projection_mismatch', 'fail_current_revision'];
const TRANSIENT = ['map_unavailable', 'resolver_error', 'fact_stale', 'fact_snapshot_stale'];

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

function staleMapClient(reasonCode) {
  return async () => {
    const freshness = { status: 'stale' };
    if (reasonCode !== undefined) freshness.reason_code = reasonCode;
    return { freshness, affected_nodes: [], required_assertions: [] };
  };
}

async function runStale(reasonCode) {
  return evaluateDiffGate({
    db: makeDb(), taskId: 'task-r19', repo: 'cecelia', headRevision: 'head',
    mapClient: staleMapClient(reasonCode),
  });
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const caseName = (() => {
  const i = process.argv.indexOf('--case');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const cases = {
  async deterministic() {
    const r = await runStale('no_anchor');
    if (r.gate !== 'impact_unknown') fail(`gate=${r.gate}`);
    if (r.reason_code !== 'no_anchor') fail(`reason_code=${r.reason_code}`);
    if (r.retryable !== false) fail(`retryable=${r.retryable}`);
    console.log('OK: no_anchor 透传且 retryable=false');
  },

  async deterministic_all() {
    for (const code of DETERMINISTIC) {
      const r = await runStale(code);
      if (r.gate !== 'impact_unknown') fail(`${code}: gate=${r.gate}`);
      if (r.reason_code !== code) fail(`${code}: reason_code=${r.reason_code}`);
      if (r.retryable !== false) fail(`${code}: retryable=${r.retryable}`);
    }
    console.log(`OK: 确定性 ${DETERMINISTIC.length} 个 code 全部 retryable=false 且原样透传`);
  },

  async transient() {
    for (const code of TRANSIENT) {
      const r = await runStale(code);
      if (r.gate !== 'impact_unknown') fail(`${code}: gate=${r.gate}`);
      if (r.reason_code !== code) fail(`${code}: reason_code=${r.reason_code}`);
      if (r.retryable !== true) fail(`${code}: retryable=${r.retryable}`);
    }
    console.log(`OK: 暂态 ${TRANSIENT.length} 个 code 全部 retryable=true 且透传`);
  },

  async null_reason() {
    const r = await runStale(undefined);
    if (r.gate !== 'impact_unknown') fail(`gate=${r.gate}`);
    if (r.reason !== 'mapper_stale') fail(`reason=${r.reason}`);
    if (r.retryable !== true) fail(`retryable=${r.retryable}`);
    if (r.reason_code) fail(`凭空生成 reason_code=${r.reason_code}`);
    console.log('OK: reason_code 缺失时保留 mapper_stale + retryable=true');
  },

  async mapper_unavailable() {
    const r = await evaluateDiffGate({
      db: makeDb(), taskId: 'task-r19', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => { throw new Error('ETIMEDOUT'); },
    });
    if (r.gate !== 'impact_unknown') fail(`gate=${r.gate}`);
    if (r.reason !== 'mapper_unavailable') fail(`reason=${r.reason}`);
    if (r.retryable !== true) fail(`retryable=${r.retryable}`);
    console.log('OK: Mapper 抛异常维持 mapper_unavailable + retryable=true');
  },

  async fail_closed() {
    const branches = [...DETERMINISTIC, ...TRANSIENT, undefined];
    for (const code of branches) {
      const r = await runStale(code);
      if (r.gate !== 'impact_unknown') fail(`${code}: gate=${r.gate} 破防放行`);
      if (['pass', 'extend', 'drift'].includes(r.verdict)) fail(`${code}: verdict=${r.verdict} 假绿`);
    }
    const thrown = await evaluateDiffGate({
      db: makeDb(), taskId: 'task-r19', repo: 'cecelia', headRevision: 'head',
      mapClient: async () => { throw new Error('ETIMEDOUT'); },
    });
    if (thrown.gate !== 'impact_unknown') fail(`throw: gate=${thrown.gate}`);
    console.log('OK: 所有不可判定分支 gate 恒为 impact_unknown，绝不假绿放行');
  },
};

if (!caseName || !cases[caseName]) {
  console.error(`未知 --case：${caseName}。可选：${Object.keys(cases).join(' / ')}`);
  process.exit(2);
}

// 导入链会配置真实 pg pool（保持事件循环存活），成功后须显式退出，避免挂起。
cases[caseName]().then(() => {
  process.exit(0);
}).catch((e) => {
  console.error(`FAIL: 未捕获异常 ${e?.stack || e}`);
  process.exit(1);
});
