#!/usr/bin/env bash
# Smoke: Notion 排单分流 OpenClaw（relation 数据驱动版）——
# 硬编码执行方枚举已废（主理人 2026-09-14 纠正），派发语义在 ops 表 dispatch 列；
# 这里守：①旧枚举不得回潮 ②pull/终态同步入口在位。
set -euo pipefail
printf '%s\n' "▶️  smoke: notion-openclaw-dispatch-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAND1="/app/src/notion-push-sync.js"; CAND2="$SCRIPT_DIR/../../src/notion-push-sync.js"
if [ -f "$CAND1" ]; then MOD="$CAND1"; else MOD="$CAND2"; fi
MOD="$MOD" node --input-type=module -e '
const m = await import("file://" + process.env.MOD);
const fail = (msg) => { console.error("❌ " + msg); process.exit(1); };
if (m.OPENCLAW_EXECUTORS) fail("OPENCLAW_EXECUTORS 硬编码枚举回潮——排单可选项必须是 ops 表本身");
if (typeof m.runNotionTaskPull !== "function") fail("runNotionTaskPull 未导出");
if (typeof m.pullNotionTasksForTest !== "function") fail("pull 入口未导出");
if (typeof m.syncOpenClawRunsForTest !== "function") fail("终态同步未导出");
console.log("✅ notion-openclaw-dispatch-smoke OK（relation 数据驱动）");
'
