#!/usr/bin/env bash
# Smoke: Notion 排单接手入口在位——runNotionTaskPull 可加载且为函数。
set -euo pipefail
printf '%s\n' "▶️  smoke: notion-tasks-pull-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAND1="/app/src/notion-push-sync.js"
CAND2="$SCRIPT_DIR/../../src/notion-push-sync.js"
if [ -f "$CAND1" ]; then MOD="$CAND1"; else MOD="$CAND2"; fi
MOD="$MOD" node --input-type=module -e '
const m = await import("file://" + process.env.MOD);
if (typeof m.runNotionTaskPull !== "function") { console.error("❌ runNotionTaskPull 未导出"); process.exit(1); }
if (typeof m.pullNotionTasksForTest !== "function") { console.error("❌ pull 内核未导出"); process.exit(1); }
console.log("✅ notion-tasks-pull-smoke OK");
'
