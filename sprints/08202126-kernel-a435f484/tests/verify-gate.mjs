/**
 * verify-gate.mjs — evaluator 可执行 oracle（manual:bash 直调，非替身）
 *
 * 真调 evaluateDiffGate / evaluateStructureGate（被改的裁决状态机本体），
 * 只注入更外层 mapClient（Mapper HTTP 边界，本单不改其算法）；db:null 使 contract=null，
 * 步骤 3a stale 分支在无 Postgres 环境即可真实进入（runtime_resources.postgres=false）。
 *
 * 用法：node verify-gate.mjs <case>
 *   det-diff          确定性 stale → diff gate reason_code 透传 + retryable:false
 *   mask-diff         确定性 stale → diff gate 不折叠通用 mapper_stale（回执可显现具体 reason_code）
 *   transient-diff    真瞬态 unknown → diff gate retryable:true 保留
 *   unavail-diff      Mapper 抛错 → diff gate mapper_unavailable + retryable:true 保留
 *   det-structure     确定性 stale → structure gate reason_code 透传 + retryable:false
 *   transient-structure 真瞬态 unknown → structure gate retryable:true 保留
 *
 * 退出码：0=期望满足，1=不满足（打印实际返回体供留证）。
 */
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

const REASON = 'projection_revision_mismatch';
const deterministic = async () => ({ freshness: { status: 'stale', reason_code: REASON } });
const transient = async () => ({ freshness: { status: 'unknown' } });
const throwing = async () => { throw new Error('ETIMEDOUT'); };

function structureCtx(mapClient) {
  return {
    db: null,
    task: { id: 'task-struct', change_kind: 'bugfix' },
    contract: {
      repo: 'cecelia', base_revision: 'base', change_kind: 'bugfix',
      affected_capabilities: [], contract_body: { affected_capabilities: [], required_assertions: [] },
    },
    mapClient,
  };
}

const diffCtx = (mapClient) => ({ db: null, taskId: 'task-verify', repo: 'cecelia', headRevision: 'head', mapClient });

const cases = {
  'det-diff': async () => {
    const r = await evaluateDiffGate(diffCtx(deterministic));
    return [r, r.gate === 'impact_unknown' && r.reason_code === REASON && r.retryable === false];
  },
  'mask-diff': async () => {
    const r = await evaluateDiffGate(diffCtx(deterministic));
    const surfaced = r.reason ?? r.reason_code ?? null; // 复刻 harness-gates gateReceipt 规则
    return [{ ...r, surfaced }, r.reason !== 'mapper_stale' && surfaced === REASON];
  },
  'transient-diff': async () => {
    const r = await evaluateDiffGate(diffCtx(transient));
    return [r, r.gate === 'impact_unknown' && r.retryable === true];
  },
  'unavail-diff': async () => {
    const r = await evaluateDiffGate(diffCtx(throwing));
    return [r, r.gate === 'impact_unknown' && r.reason === 'mapper_unavailable' && r.retryable === true];
  },
  'det-structure': async () => {
    const r = await evaluateStructureGate(structureCtx(deterministic));
    return [r, r.gate === 'blocked' && r.reason_code === REASON && r.retryable === false];
  },
  'transient-structure': async () => {
    const r = await evaluateStructureGate(structureCtx(transient));
    return [r, r.gate === 'blocked' && r.retryable === true];
  },
};

const name = process.argv[2];
const fn = cases[name];
if (!fn) { console.error(`FAIL: unknown case ${name}`); process.exit(2); }
const [result, ok] = await fn();
console.log(`case=${name} result=${JSON.stringify(result)}`);
if (!ok) { console.error(`FAIL: ${name} 期望未满足`); process.exit(1); }
console.log(`OK: ${name}`);
