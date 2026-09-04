#!/usr/bin/env bash
# handoff-schemas-smoke — 九格交接 schema 校验器冒烟（第 79 批）
# 真调 validateHandoffObject / validateStageEvidence：合法件放行、r53 缺字段拒收、
# r40 假 sha 形状拒收、无要求阶段零误伤。任何一项不符即 exit 1。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."

node --input-type=module <<'NODE'
import {
  validateHandoffObject,
  validateStageEvidence,
} from './packages/brain/src/orchestrator/handoff-schemas.js';

const SHA40 = 'a'.repeat(40);
const UUID = 'cccccccc-0000-4000-8000-000000000009';
const cand = {
  repo: 'perfectuser21/cecelia', branch: 'cp-harness-propose-r1-x',
  head_sha: SHA40, bridge_run_id: UUID, source_attempt_id: UUID,
};

// ① 合法件放行
if (!validateHandoffObject('candidate_coordinates', cand).ok) process.exit(1);

// ② r53：少 source_attempt_id 必须拒收且点名
const missing = { ...cand }; delete missing.source_attempt_id;
const r2 = validateHandoffObject('candidate_coordinates', missing);
if (r2.ok || !r2.issues.join().includes('source_attempt_id')) process.exit(1);

// ③ r40 形状层：假 sha（uuid 续写）必须拒收
if (validateHandoffObject('candidate_coordinates',
  { ...cand, head_sha: 'a78b37aa-c951-4cbb-976b-a7b70e975af2' }).ok) process.exit(1);

// ④ 阶段级：generate 缺件拒收；cleanup 零误伤
if (validateStageEvidence('generate', []).ok) process.exit(1);
if (!validateStageEvidence('cleanup', []).ok) process.exit(1);

// ⑤ 未知类型不静默放行
if (validateHandoffObject('nope', {}).ok) process.exit(1);

console.log('HANDOFF_SCHEMAS_SMOKE_PASS');
NODE
