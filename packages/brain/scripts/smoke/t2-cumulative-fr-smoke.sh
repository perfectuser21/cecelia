#!/usr/bin/env bash
# t2-cumulative-fr-smoke.sh — 九要素 T2 累积 FR 通电结构冒烟
# 守卫三根线不再断回去：
#   ① 写入方：promoteToRegression 支持 dbOnly，且共享管道函数以 dbOnly:true 调用
#   ② 写端 FK：feature_id 兜底回退 tasks.ability_id（否则读端直连永远为空）
#   ③ 读端 key：两处同源 SQL 均走 golden_path.feature_id 直连，不再绕 tasks.ability_id
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── T2 累积 FR 通电 smoke ──"

# ① dbOnly 通路
grep -q "dbOnly = false" "$ROOT/src/harness-promote-regression.js" && ok "promoteToRegression 有 dbOnly 参数" || bad "promoteToRegression 缺 dbOnly 参数"
grep -q "reason: 'db_only'" "$ROOT/src/harness-promote-regression.js" && ok "dbOnly 早退返回 db_only" || bad "缺 dbOnly 早退返回"
grep -q "dbOnly: true" "$ROOT/src/lib/callback-postprocess.js" && ok "共享管道以 dbOnly:true 调用" || bad "共享管道未用 dbOnly:true"

# ② 写端 feature_id 兜底
grep -q "task?.ability_id" "$ROOT/src/harness-promote-regression.js" && ok "feature_id 兜底回退 ability_id" || bad "缺 ability_id 兜底"

# ③ 读端 key 直连（两处同源）
grep -q "JOIN journey_features jf ON gp.feature_id = jf.id" "$ROOT/src/harness-line-context.js" && ok "line-context 走 feature_id 直连" || bad "line-context 未走 feature_id 直连"
grep -q "JOIN journey_features jf ON gp.feature_id = jf.id" "$ROOT/src/routes/abilities.js" && ok "golden-paths 端点走 feature_id 直连" || bad "golden-paths 端点未走 feature_id 直连"
grep -q "t.ability_id = jf.id" "$ROOT/src/harness-line-context.js" "$ROOT/src/routes/abilities.js" && bad "存在旧 tasks.ability_id 绕行残留" || ok "无旧 join 残留"

echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
