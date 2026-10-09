#!/usr/bin/env bash
# commander-invoker-smoke — 常驻监工唤醒器冒烟（第 81 批）
# 真调 buildCharter/createCommanderSession/wakeCommander（fake runner，不花真钱）：
# charter 骨架、开局参数、喂食闸、降级①重问、降级③升人。任何一项不符即 exit 1。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.."

node --input-type=module <<'NODE'
import {
  buildCharter, createCommanderSession, wakeCommander,
} from './packages/brain/src/orchestrator/commander-invoker.js';

// ① charter 骨架
const c = buildCharter({ runId: 'r-smoke', taskRequest: '题目', gear: 'bugfix' });
if (!c.includes('VERDICT:') || !c.includes('accepted / retry / blocked')) process.exit(1);

// ② 开局带 --session-id
let seen = null;
const runner1 = async (args) => { seen = args; return '监工就位'; };
const s = await createCommanderSession({ runId: 'r', taskRequest: 't', gear: 'bugfix' }, { runner: runner1 });
if (!seen.includes('--session-id') || !seen.includes(s.sessionId)) process.exit(1);

// ③ 喂食闸：超 1200B 必炸
try {
  await wakeCommander({ sessionId: s.sessionId, runId: 'r', stageId: 'plan', stageAttempt: 1, digest: 'x'.repeat(3000) },
    { runner: async () => 'VERDICT: accepted' });
  process.exit(1);
} catch (e) { if (!String(e.message).includes('digest_too_large')) process.exit(1); }

// ④ 降级①：首答无机器行 → 重问一次
let calls = 0;
const runner2 = async () => (++calls === 1 ? '没词' : 'ok\nVERDICT: retry');
const r = await wakeCommander({ sessionId: s.sessionId, runId: 'r', stageId: 'plan', stageAttempt: 1, digest: 'd' },
  { runner: runner2 });
if (calls !== 2 || r.verdict !== 'retry') process.exit(1);

// ⑤ 降级③：两答皆无效 → 升人不猜
const r2 = await wakeCommander({ sessionId: s.sessionId, runId: 'r', stageId: 'plan', stageAttempt: 1, digest: 'd' },
  { runner: async () => '始终不说词' });
if (r2.verdict !== null || r2.escalate !== true) process.exit(1);

console.log('COMMANDER_INVOKER_SMOKE_PASS');
NODE
