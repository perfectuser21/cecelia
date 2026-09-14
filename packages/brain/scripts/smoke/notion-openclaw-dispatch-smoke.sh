#!/usr/bin/env bash
# Smoke: Notion 排单分流 OpenClaw 在位——执行方映射导出且租户/模板形状完整。
set -euo pipefail
printf '%s\n' "▶️  smoke: notion-openclaw-dispatch-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAND1="/app/src/notion-push-sync.js"; CAND2="$SCRIPT_DIR/../../src/notion-push-sync.js"
if [ -f "$CAND1" ]; then MOD="$CAND1"; else MOD="$CAND2"; fi
MOD="$MOD" node --input-type=module -e '
const m = await import("file://" + process.env.MOD);
const ex = m.OPENCLAW_EXECUTORS;
const fail = (msg) => { console.error("❌ " + msg); process.exit(1); };
if (!ex) fail("OPENCLAW_EXECUTORS 未导出");
for (const [label, spec] of Object.entries(ex)) {
  if (!spec.tenant || !/\.json$/.test(spec.template || "")) fail("映射形状残缺: " + label);
}
if (typeof m.syncOpenClawRunsForTest !== "function") fail("终态同步未导出");
console.log("✅ notion-openclaw-dispatch-smoke OK");
'
