#!/usr/bin/env bash
# callback-postprocess-smoke.sh — 孪生回调路径共享后处理管道结构冒烟
# 守卫:5c11 串行解锁/5c8b review_result 必须经共享模块,双路径必须同引,
# 防止 routes/execution.js 与 callback-processor.js 第四次分叉(前三次:updated_at/claim、迟到幂等、串行解锁)。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "── callback-postprocess 共享管道 smoke ──"
[[ -f "$ROOT/src/lib/callback-postprocess.js" ]] && ok "共享模块存在" || bad "共享模块缺失"
grep -q "export async function serialUnlockNext" "$ROOT/src/lib/callback-postprocess.js" && ok "导出 serialUnlockNext" || bad "缺 serialUnlockNext"
grep -q "export async function writeReviewResult" "$ROOT/src/lib/callback-postprocess.js" && ok "导出 writeReviewResult" || bad "缺 writeReviewResult"
grep -q "from './lib/callback-postprocess.js'" "$ROOT/src/callback-processor.js" && ok "DB 直写路径已接共享管道" || bad "callback-processor 未引共享管道"
grep -q "from '../lib/callback-postprocess.js'" "$ROOT/src/routes/execution.js" && ok "HTTP 路径已接共享管道" || bad "execution.js 未引共享管道"
# 反分叉:两条路径里不允许再各自内联串行解锁 SQL
INLINE=$(grep -l "depends_on_prev.*= 'true'" "$ROOT/src/callback-processor.js" "$ROOT/src/routes/execution.js" 2>/dev/null | wc -l | tr -d ' ')
[[ "$INLINE" == "0" ]] && ok "无内联串行解锁残留(反分叉)" || bad "存在内联串行解锁残留($INLINE 处)"

echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
