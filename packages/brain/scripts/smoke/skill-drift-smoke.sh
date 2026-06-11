#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── harness skill-drift smoke ──"
r=$(curl -sf "$BRAIN/api/brain/harness/skill-drift") || { echo "  ❌ skill-drift GET 不可达"; echo "PASS: 0  FAIL: 1"; exit 1; }

echo "$r" | jq -e '.skills | length == 6' >/dev/null 2>&1 && ok "skills 恰好 6 项" || fail "skills 长度 != 6"
echo "$r" | jq -e '.skills | map(.name) | sort == ["harness-contract-proposer","harness-contract-reviewer","harness-evaluator","harness-generator","harness-planner","harness-report"]' >/dev/null 2>&1 \
  && ok "name 集合精确等于 6 个 harness skill" || fail "name 集合不符"
echo "$r" | jq -e 'keys | sort == ["any_drift","skills"]' >/dev/null 2>&1 && ok "顶层 keys 严格匹配" || fail "顶层 keys 不符"
echo "$r" | jq -e '.skills | all(keys | sort == ["drifted","name","snapshot_version","ssot_version"])' >/dev/null 2>&1 \
  && ok "项级 keys 严格匹配" || fail "项级 keys 不符"
echo "$r" | jq -e '.any_drift == (.skills | map(.drifted) | any)' >/dev/null 2>&1 && ok "any_drift 内部一致" || fail "any_drift 与数组不一致"
echo "$r" | jq -e '.skills | all(.drifted == (.ssot_version != .snapshot_version))' >/dev/null 2>&1 \
  && ok "drifted == 两 version 真实对比" || fail "drifted 不等于真实对比"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/harness/skill-drift")
[[ "$code" != "200" ]] && ok "POST 同路径非 200（方法语义）" || fail "POST 返回了 200"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
