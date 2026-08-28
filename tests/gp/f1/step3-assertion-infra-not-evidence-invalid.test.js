// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：信任断言基础设施失败 ↔ evaluate verdict 归因
//
// r75 + r79 (run 7867ae4a) 双实证：runner entrypoint 的信任断言复核步骤在容器内给
// 整仓冷装 npm 依赖（616 包），装失败（网络抖动/预算超时）时把 evaluator 的真实
// PASS（合同 7/7 + 回归 5/5 全绿）改判为 FAIL failure_class=evidence_invalid
// （signature=required_assertion_dependency_invalid）——基础设施故障被错误归因成
// 产品证据无效 → evidence repair 单次重试 → 同签名再挂 → repeated_signature 人审
// → 撞钟杀 run。且失败路径 rm -rf evidence_dir 连安装日志一起删（失败不留原因）。
//
// 修法（本批）：
// a) derive：evidence_invalid 且 signature ∈ ASSERTION_INFRA_SIGNATURES
//    （required_assertion_dependency_invalid / required_assertion_checkout_invalid）
//    → 按基础设施有界重派 evaluator（同签名同 head 的 FAIL verdict 计数 < CAP=5
//    → spawn:evaluator assertion_infrastructure_retry；≥ CAP → fail-closed 挂人审
//    assertion_infrastructure_exhausted）。其他 evidence_invalid 签名语义不变。
// b) entrypoint：失败分支把 dependency-install.log 尾部并入 result
//    （decision.evidence_tail），不再无痕删除（shell 边由原文断言测试盯守）。
//
// 真 import derive（被改的边），不 mock。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const CAND_SHA = 'b8bcc01e45ad0000000000000000000000000000';
const IDENTITY = { contract_id: 'c79', manifest_sha256: 'm79', source_revision: 'r79' };

// evidence_invalid 路由由 judge FAIL 的 failure_class 驱动（derive 4c 分支）——
// r75/r79 真实链：evaluate FAIL → judge 复核 → judge FAIL(evidence_invalid, 断言
// 基础设施签名) → deriveFailureClassRoute。
function observedWith(judgeVerdict, decisionLog = []) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: IDENTITY },
    pr: null,
    candidate: { branch: 'cp-route-api-r79', head_sha: CAND_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: {
      verdict: 'FAIL',
      failure_class: 'evidence_invalid',
      failure_signature: ['required_assertion_dependency_invalid'],
      pr_head_sha: CAND_SHA,
      contract_identity: IDENTITY,
    },
    judgeVerdict,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 60, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
  };
}

const infraFailVerdict = () => ({
  verdict: 'FAIL',
  failure_class: 'evidence_invalid',
  failure_signature: ['required_assertion_dependency_invalid'],
  pr_head_sha: CAND_SHA,
  contract_identity: IDENTITY,
});

const infraVerdictRow = (hop, action = 'verdict:evaluate') => ({
  hop,
  action,
  detail: {
    verdict: 'FAIL',
    failure_class: 'evidence_invalid',
    failure_signature: ['required_assertion_dependency_invalid'],
    pr_head_sha: CAND_SHA,
  },
});

describe('F1 step3 — 信任断言基础设施失败按 infra 重派（r75/r79 案卷）', () => {
  it('首次 dependency install 失败 → 有界重派 evaluator（不进 evidence repair）', () => {
    const r = derive(observedWith(infraFailVerdict(), [infraVerdictRow(58, 'verdict:judge')]));
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('assertion_infrastructure_retry');
  });

  it('同签名同 head 达 CAP（5 条 FAIL verdict）→ fail-closed 挂人审', () => {
    const rows = [50, 52, 54, 56].map((h) => infraVerdictRow(h))
      .concat([infraVerdictRow(58, 'verdict:judge')]);
    const r = derive(observedWith(infraFailVerdict(), rows));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('assertion_infrastructure_exhausted');
  });

  it('负向：其他 evidence_invalid 签名语义不变（仍走 evidence repair）', () => {
    const other = {
      verdict: 'FAIL',
      failure_class: 'evidence_invalid',
      failure_signature: ['coverage_row_missing'],
      pr_head_sha: CAND_SHA,
      contract_identity: IDENTITY,
    };
    const r = derive(observedWith(other, [{
      hop: 58,
      action: 'verdict:judge',
      detail: { verdict: 'FAIL', failure_class: 'evidence_invalid', failure_signature: ['coverage_row_missing'], pr_head_sha: CAND_SHA },
    }]));
    expect(r.action).toBe('spawn:evaluator-evidence-repair');
  });
});

describe('F1 step3 — entrypoint 失败留证（shell 边原文断言）', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sh = readFileSync(join(here, '../../../docker/cecelia-runner/entrypoint.sh'), 'utf8');

  it('dependency install 失败分支把安装日志尾部并入 result（不再无痕删除）', () => {
    const seg = sh.split('trusted assertion dependency install failed')[1] ?? '';
    expect(seg.slice(0, 1200)).toContain('evidence_tail');
  });

  it('失败签名保持 required_assertion_dependency_invalid（kernel 归因键不变）', () => {
    expect(sh).toContain('required_assertion_dependency_invalid');
  });
});
