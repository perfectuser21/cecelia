#!/usr/bin/env bash
# Smoke: 触达线活性告警在位（2026-09-16 空转 22h 静默案）——失败必须上浮不得静默。
set -euo pipefail
printf '%s\n' "▶️  smoke: outreach-liveness-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAND1="/app/src"; CAND2="$SCRIPT_DIR/../../src"
if [ -d "$CAND1" ]; then SRC="$CAND1"; else SRC="$CAND2"; fi
MOD="$SRC/openclaw-guards.js" node --input-type=module -e '
const m = await import("file://" + process.env.MOD);
const fail = (msg) => { console.error("❌ " + msg); process.exit(1); };
const stalled = "[t] 话术缺失: NO_SCRIPT B\n[t] 话术缺失: NO_SCRIPT B\n[t] 话术缺失: NO_SCRIPT B";
if (m.parseOutreachHealth(stalled).verdict !== "stalled") fail("空转未判 stalled");
if (!m.parseOutreachHealth(stalled).reason) fail("stalled 未给原因（失败不留原因病）");
if (m.parseOutreachHealth("[t] 单#9: 张三(dy1) via 主号").verdict !== "healthy") fail("出单误判");
if (m.parseOutreachHealth("[t] 拟人跳过本tick\n[t] 无待触达单").verdict !== "idle") fail("正常空闲被误报");
if (m.parseOutreachHealth("").verdict !== "unknown") fail("空日志未判 unknown");
console.log("✅ outreach-liveness-smoke OK");
'
grep -q "raiseFn" "$SRC/scheduler-jobs.js" || { echo "❌ 告警未接线到 scheduler"; exit 1; }
echo "✅ outreach-liveness-smoke OK（告警已接线）"
