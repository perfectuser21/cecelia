#!/usr/bin/env bash
# Smoke: kernel validation clock 按 fix 轮自动顺延（有界 6）[r71]
# 真跑被改纯函数 resolveValidationClock，断言：
#   1. decisionLog 含 3 个 spawn:generator-fix → 原点顺延到最后一次 fix(04:00)、deadline 05:30
#   2. 有界——7 个 fix 时原点冻结在第 6 次 fix(06:00)、deadline 07:30（第 7 次不再顺延）
#   3. 无 fix 轮回归——原点=首个 generator(00:00)、deadline 01:30
# 纯函数无需 DB/Brain server，直接 node import 被改文件真跑。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module -e '
import { resolveValidationClock } from "./packages/brain/src/orchestrator/validation-clock.js";
import assert from "node:assert";
const TIMEOUT = 5400;
const genRow = () => ({ hop: 10, action: "spawn:generator", created_at: "2026-08-25T00:00:00.000Z", detail: { pipeline_started_at: "2026-08-25T00:00:00.000Z", deadline_at: "2026-08-25T01:30:00.000Z", reason: "contract_approved" } });
const fixRow = (hop, createdAt) => ({ hop, action: "spawn:generator-fix", created_at: createdAt, detail: { reason: "red_fix" } });
const extended = resolveValidationClock({ action: "spawn:evaluator", decisionLog: [genRow(), fixRow(20, "2026-08-25T01:20:00.000Z"), fixRow(30, "2026-08-25T02:40:00.000Z"), fixRow(40, "2026-08-25T04:00:00.000Z")], intentAt: "2026-08-25T04:05:00.000Z", timeoutSeconds: TIMEOUT });
assert.deepStrictEqual(extended, { pipeline_started_at: "2026-08-25T04:00:00.000Z", deadline_at: "2026-08-25T05:30:00.000Z" }, "fix 轮顺延到最后一次 fix 失败");
const fixes = ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"].map((t, i) => fixRow(20 + i * 10, `2026-08-25T${t}:00.000Z`));
const bounded = resolveValidationClock({ action: "spawn:evaluator", decisionLog: [genRow(), ...fixes], intentAt: "2026-08-25T07:05:00.000Z", timeoutSeconds: TIMEOUT });
assert.deepStrictEqual(bounded, { pipeline_started_at: "2026-08-25T06:00:00.000Z", deadline_at: "2026-08-25T07:30:00.000Z" }, "顺延有界（满 6 次冻结）失败");
const noFix = resolveValidationClock({ action: "spawn:evaluator", decisionLog: [genRow()], intentAt: "2026-08-25T00:30:00.000Z", timeoutSeconds: TIMEOUT });
assert.deepStrictEqual(noFix, { pipeline_started_at: "2026-08-25T00:00:00.000Z", deadline_at: "2026-08-25T01:30:00.000Z" }, "无 fix 轮回归失败");
console.log("resolveValidationClock fix-round assertions passed");
'

echo "KERNEL_R71_VALIDATION_CLOCK_FIX_ROUND_SMOKE_PASS"
