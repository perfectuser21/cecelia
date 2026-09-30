#!/usr/bin/env bash
# t2-cumulative-fr-smoke.sh — 九要素 T2 累积 FR 通电结构冒烟
# golden_path 旧表退役（任务 7d312fd8）后守卫改为三根线：
#   ① 写入方：promoteToRegression 支持 dbOnly，dbOnly:true 直接返回 golden_path_retired（不再写 golden_path）
#   ② 写端：golden_path 的 INSERT 已彻底删除（旧 feature_id/ability_id 兜底连同写路径一起退役）
#   ③ 读端 key：两处同源 SQL 仍保留 golden_path.feature_id 直连语句（应急放行窗口下可跑），不再绕 tasks.ability_id
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── T2 累积 FR 通电 smoke ──"

# ① dbOnly 通路（退役后：直接返回 golden_path_retired，不再落库）
grep -q "dbOnly = false" "$ROOT/src/harness-promote-regression.js" && ok "promoteToRegression 有 dbOnly 参数" || bad "promoteToRegression 缺 dbOnly 参数"
grep -q "reason: 'golden_path_retired'" "$ROOT/src/harness-promote-regression.js" && ok "dbOnly 早退返回 golden_path_retired" || bad "缺 dbOnly 早退返回"
grep -q "dbOnly: true" "$ROOT/src/lib/callback-postprocess.js" && ok "共享管道以 dbOnly:true 调用" || bad "共享管道未用 dbOnly:true"

# ② 写端：golden_path INSERT 已随退役删除（不再需要 ability_id 兜底，因为根本不再写）
grep -q "INSERT INTO golden_path" "$ROOT/src/harness-promote-regression.js" && bad "golden_path INSERT 残留未退役" || ok "golden_path 写路径已随退役删除"

# ③ 读端 key 直连（两处同源，legacyGoldenPath 应急窗口下仍可跑）
grep -q "JOIN journey_features jf ON gp.feature_id = jf.id" "$ROOT/src/harness-line-context.js" && ok "line-context 走 feature_id 直连" || bad "line-context 未走 feature_id 直连"
grep -q "JOIN journey_features jf ON gp.feature_id = jf.id" "$ROOT/src/routes/abilities.js" && ok "golden-paths 端点走 feature_id 直连" || bad "golden-paths 端点未走 feature_id 直连"
grep -q "t.ability_id = jf.id" "$ROOT/src/harness-line-context.js" "$ROOT/src/routes/abilities.js" && bad "存在旧 tasks.ability_id 绕行残留" || ok "无旧 join 残留"

echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
