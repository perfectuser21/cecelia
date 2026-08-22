#!/usr/bin/env bash
# Smoke: 验证窗对多轮 fix 链自动顺延（resolveValidationClock）
# 真跑 kernel 纯函数——锚 hop 之后每出现一次 spawn:generator-fix，
# 验证窗顺延一个 timeoutSeconds（deadline = anchor_started + (1+fixCount)*timeout）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

MOD="packages/brain/src/orchestrator/validation-clock.js"

# 1. 模块存在且导出 resolveValidationClock
[ -f "$MOD" ] || { echo "FAIL: $MOD 不存在"; exit 1; }
grep -q "export function resolveValidationClock" "$MOD" \
  || { echo "FAIL: resolveValidationClock 未导出"; exit 1; }
echo "OK: $MOD 存在且导出 resolveValidationClock"

# 2. 真跑：0/1/2 次 generator-fix → deadline 线性顺延，零 fix 逐字节零回归
node --input-type=module -e '
import { resolveValidationClock } from "./packages/brain/src/orchestrator/validation-clock.js";
const s = "2026-08-03T19:02:13.199Z";
const a = { hop: 70, action: "spawn:generator", created_at: s, detail: { pipeline_started_at: s, deadline_at: "2026-08-03T21:02:13.199Z" } };
const fx = (h, at) => ({ hop: h, action: "spawn:generator-fix", created_at: at, detail: {} });
const call = (log) => resolveValidationClock({ action: "spawn:evaluator", decisionLog: log, intentAt: "2026-08-03T21:30:00.000Z", timeoutSeconds: 7200 }).deadline_at;
const zero = call([a]);
const one = call([a, fx(72, "2026-08-03T20:00:00.000Z")]);
const two = call([a, fx(72, "2026-08-03T20:00:00.000Z"), fx(74, "2026-08-03T20:30:00.000Z")]);
const ok = zero === "2026-08-03T21:02:13.199Z" && one === "2026-08-03T23:02:13.199Z" && two === "2026-08-04T01:02:13.199Z";
if (!ok) { console.error("FAIL: deadline 顺延不符", { zero, one, two }); process.exit(1); }
console.log("OK: deadline 顺延", zero, one, two);
'

echo "PASS: validation-clock-fix-extension-smoke.sh"
