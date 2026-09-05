#!/usr/bin/env bash
# home-sequencer-smoke — Brain 内序列器核心冒烟（第 80 批）
# 真调格子表/路由/摘要/解析四件套：四档裁剪、r54/c8/#51 三判则路由、
# 摘要字节纪律、监工回复封闭词表。任何一项不符即 exit 1。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."

node --input-type=module <<'NODE'
import {
  STAGE_ORDER, stagesForGear, routeVerdict,
  buildCheckpointDigest, parseCommanderReply,
} from './packages/brain/src/orchestrator/home-sequencer.js';

// ① 格序与四档
if (STAGE_ORDER.length !== 11) process.exit(1);
if (stagesForGear('parameter_only').includes('contract')) process.exit(1);
try { stagesForGear('nope'); process.exit(1); } catch {}

// ② 三条实战判则路由
const ctx = { gear: 'new_capability', attempt: 1 };
if (routeVerdict('evaluate', 'retry', ctx).target !== 'generate') process.exit(1);   // r54
if (routeVerdict('seal', 'blocked', ctx).target !== 'contract') process.exit(1);      // #51/#52
if (routeVerdict('publish', 'blocked', ctx).kind !== 'finalize') process.exit(1);     // c8
if (routeVerdict('generate', 'retry', { ...ctx, attempt: 4 }).status !== 'blocked') process.exit(1);

// ③ 摘要蒸馏纪律
const sha = 'c'.repeat(40);
const d = buildCheckpointDigest({
  stage_id: 'generate', stage_attempt: 2, status: 'completed',
  summary: 'z'.repeat(9000),
  evidence: [{ type: 'candidate_coordinates', head_sha: sha }],
});
if (Buffer.byteLength(d, 'utf8') > 1200 || !d.includes(sha)) process.exit(1);

// ④ 监工回复解析封闭词表
if (parseCommanderReply('分析。\nVERDICT: accepted').verdict !== 'accepted') process.exit(1);
if (parseCommanderReply('VERDICT: maybe').verdict !== null) process.exit(1);

console.log('HOME_SEQUENCER_SMOKE_PASS');
NODE
