#!/usr/bin/env bash
# factory-f4-selfheal-smoke.sh — 工厂 GP 五件套第一刀：F4 故障自愈 最薄守卫
#
# ⚠️ 诚实声明（假绿灯纪律）：本闸为结构/契约级为主 + 少量运行时断言的最薄层。
#   - [结构] 断言只证明代码/注册表形态存在，不代表运行时行为已验证
#   - CI 环境 CECELIA_TICK_ENABLED=false：不断言任何"调度已真实执行"
#   - 决策 2a8bf656：工厂 journey 的 mvp 标签自此开始有机器背书，加厚走后续刀
# FIRE_TEST=1 为开发期自炸口（proven-to-fire 验证守卫非恒真），CI 不设。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
psql_q() { psql -qtAc "$1"; }

echo "== F4 故障自愈：liveness 合同层 =="
node -e '
import("./packages/brain/src/executor-contracts.js").then(async m => {
  // PR1-B 由七增八：openclaw-agent = 秋米中文 GTD 任务的执行者（Brain 经 ssh 在 MMV 起 agent）
  // 棒3 由八增九：script = executor=script 一等任务类型
  const expected = ["brain-local","relay-container","kernel-process","headed-session","bridge","external-worker","codex-review-local","openclaw-agent","script","preview-janitor","app-server-controller","image-janitor","phone-ssh-controller","linux-pool-controller"];
