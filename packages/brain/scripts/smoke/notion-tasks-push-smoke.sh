#!/usr/bin/env bash
# Smoke: Notion Tasks 推送接线在位——TASK_STATUS_TO_NOTION 映射可加载且覆盖全部活跃态。
# 依赖约束：bash+node（蓝绿 pre-swap 在 brain 容器内跑，禁 jq/网络）。
set -euo pipefail
printf '%s\n' "▶️  smoke: notion-tasks-push-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAND1="/app/src/notion-push-sync.js"
CAND2="$SCRIPT_DIR/../../src/notion-push-sync.js"
if [ -f "$CAND1" ]; then MOD="$CAND1"; else MOD="$CAND2"; fi
MOD="$MOD" node --input-type=module -e '
const m = await import("file://" + process.env.MOD);
const map = m.TASK_STATUS_TO_NOTION;
const fail = (msg) => { console.error("❌ " + msg); process.exit(1); };
if (!map) fail("TASK_STATUS_TO_NOTION 未导出");
for (const k of ["queued","in_progress","blocked","completed","failed"]) {
  if (!map[k]) fail("状态缺映射: " + k);
}
const legal = new Set(["Planned","Delegated","In Progress","Done","Cancelled"]);
for (const [k,v] of Object.entries(map)) {
  if (!legal.has(v)) fail(`映射到 Notion 非法选项: ${k}→${v}`);
}
if (typeof m.pushTasksForTest !== "function") fail("pushTasks 内核未导出");
console.log("✅ notion-tasks-push-smoke OK");
'
