#!/usr/bin/env bash
# harness-pg-forensics-closure-smoke.sh
# 真环境验证 Harness Evaluator 取证闭环 r2 的三条核心机械行为——导入真实 orchestrator
# 模块（非 mock）跑合同→PG 机械派生 + 必验项 unverifiable 出口守卫，任一断言不过即 exit 1。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module <<'NODE'
import {
  contractRequiresPostgres,
  deriveCapabilityRequirements,
} from './packages/brain/src/orchestrator/preflight/requirements.js';
import { enforceVerifiableEvaluatorVerdict } from './packages/brain/src/orchestrator/execution-contract.js';

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// 1. 合同含 psql → 机械派生 postgres=true（不依赖人工手填）
const pgContract = '## E2E\n```bash\npsql "$DB_URL" -c "SELECT 1"\n```';
if (contractRequiresPostgres(pgContract) !== true) fail('psql 合同未机械识别为需要 PG');
if (deriveCapabilityRequirements({ role: 'evaluator', requirements: {}, contract: pgContract }).postgres !== true) {
  fail('deriveCapabilityRequirements 未从合同派生 postgres=true');
}

// 2. 纯 curl 合同 → postgres=false（边界不变，不回退老路）
if (contractRequiresPostgres('curl -sf localhost:5221/api/brain/health') !== false) {
  fail('无 PG 要求的合同被误判为需要 PG');
}

// 3. 合同必验项 unverifiable（要 PG 但 runtime 无 PG）→ verdict 强制非 PASS
const unverifiable = enforceVerifiableEvaluatorVerdict({
  verdict: 'PASS',
  requirements: { postgres: true },
  runtimeResources: { postgres: false, node_deps: true },
  behaviorTests: [],
});
if (unverifiable.verdict === 'PASS') fail('unverifiable 必验项仍放行 PASS');
if (unverifiable.failure_class !== 'evidence_insufficient') fail('unverifiable 未标 evidence_insufficient');

// 4. runtime 有 PG 且 behavior_tests 含 psql 真跑证据（exit 0）→ 保留 PASS
const verified = enforceVerifiableEvaluatorVerdict({
  verdict: 'PASS',
  requirements: { postgres: true },
  runtimeResources: { postgres: true, node_deps: true },
  behaviorTests: [{ command: 'psql "$DB_URL" -c "SELECT count(*)"', exit_code: 0, log_tail: '1' }],
});
if (verified.verdict !== 'PASS') fail('真验通过的 PG 必验项被误降级');

console.log('OK harness-pg-forensics-closure smoke — 合同→PG 派生 + unverifiable 禁 PASS 全过');
NODE
