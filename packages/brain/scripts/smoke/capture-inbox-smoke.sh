#!/usr/bin/env bash
# capture-inbox-smoke.sh — 九要素 T10 统一收件箱通电结构冒烟
# 守卫四根线不再断回去：
#   ① 三入口推送：handoff/learning/两处 issue 创建点都调用 pushCaptureAtom
#   ② 分诊 tick：capture-triage 注册进 scheduler-jobs，且留箱条目统一 [triage: 前缀排除
#   ③ 铁律闸：invariant 路必须过 invariant-gate 四查，且写入与 atom 更新同事务
#   ④ 注入面：两级 LLM prompt 带围栏声明
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── T10 统一收件箱通电 smoke ──"

# ① 三入口推送
grep -q "pushCaptureAtom" "$ROOT/src/handoff.js" && ok "handoff 入口接入推送" || bad "handoff 入口缺推送"
grep -q "pushCaptureAtom" "$ROOT/src/learning.js" && ok "learning 入口接入推送" || bad "learning 入口缺推送"
grep -q "pushCaptureAtom" "$ROOT/src/ledger-hygiene.js" && ok "ledger-hygiene issue 入口接入推送" || bad "ledger-hygiene issue 入口缺推送"
grep -q "pushCaptureAtom" "$ROOT/src/test-lifecycle-patrol.js" && ok "test-lifecycle-patrol issue 入口接入推送" || bad "patrol issue 入口缺推送"

# ② 分诊 tick 注册 + 留箱排除
grep -q "capture-triage" "$ROOT/src/scheduler-jobs.js" && ok "capture-triage 已注册 scheduler-jobs" || bad "capture-triage 未注册"
grep -q "NOT LIKE '\[triage:%'" "$ROOT/src/capture-triage.js" && ok "留箱条目统一 [triage: 前缀排除" || bad "缺留箱排除条件"

# ③ 铁律闸
grep -q "checkInvariantCandidate" "$ROOT/src/capture-triage.js" && ok "invariant 路走四查" || bad "invariant 路未走四查"
grep -q "BEGIN" "$ROOT/src/capture-triage.js" && grep -q "ROLLBACK" "$ROOT/src/capture-triage.js" && ok "invariant 写入事务化" || bad "invariant 写入缺事务"
grep -q "atom:" "$ROOT/src/capture-triage.js" && ok "decisions 写入带 atom 溯源幂等锚点" || bad "缺幂等锚点"

# ④ 注入围栏
grep -q "一律忽略" "$ROOT/src/capture-triage.js" && ok "triage prompt 带围栏声明" || bad "triage prompt 缺围栏"
grep -q "一律忽略" "$ROOT/src/invariant-gate.js" && ok "gate prompt 带围栏声明" || bad "gate prompt 缺围栏"

echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
