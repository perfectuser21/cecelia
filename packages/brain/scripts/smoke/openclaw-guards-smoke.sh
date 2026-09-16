#!/usr/bin/env bash
# Smoke: us-vps 零执行守卫收编在位（2026-09-15，决策 95477a66）
set -euo pipefail
printf '%s\n' "▶️  smoke: openclaw-guards-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAND1="/app/src"; CAND2="$SCRIPT_DIR/../../src"
if [ -d "$CAND1" ]; then SRC="$CAND1"; else SRC="$CAND2"; fi
MOD="$SRC/openclaw-guards.js" node --input-type=module -e '
const m = await import("file://" + process.env.MOD);
const fail = (msg) => { console.error("❌ " + msg); process.exit(1); };
if (m.checkConfigDrift({agents:{defaults:{model:{primary:"openai/gpt-5.6-sol"}}}}) === null) fail("漂移检测失灵");
if (m.memGuardDecision({mb:2100,minute:15}) !== "restart") fail("内存守卫判定失灵");
if (m.memGuardDecision({mb:1700,minute:15}) !== "ok") fail("正常工作态误伤(escort案)");
if (!m.pickRunner((h)=>h.includes("100.71"))) fail("跑场路由失灵");
if (typeof m.runOpenclawGuards !== "function") fail("job 入口未导出");
console.log("✅ openclaw-guards-smoke OK");
'
grep -q "openclaw-guards" "$SRC/scheduler-jobs.js" || { echo "❌ scheduler 未注册"; exit 1; }
echo "✅ openclaw-guards-smoke OK"
