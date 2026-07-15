#!/usr/bin/env bash
# ratchet-guard.test.sh — 棘轮守卫 proven-to-fire 自测（刀4-T2 DoD）
# fixture 让某指标倒退 → guard 退出非零并打印指标名
# 正常路径 → guard 退出 0
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$REPO_ROOT/scripts/ratchet-guard.mjs"
REGISTRY="$REPO_ROOT/scripts/ratchet-registry.json"

PASS=0; FAIL=0

check() {
  local expect="$1" desc="$2" actual=0
  "${@:3}" >/dev/null 2>&1 || actual=$?
  if { [ "$expect" -eq 0 ] && [ "$actual" -eq 0 ]; } || \
     { [ "$expect" -ne 0 ] && [ "$actual" -ne 0 ]; }; then
    echo "✅ $desc"; PASS=$((PASS+1))
  else
    echo "❌ ${desc}（期望 exit=${expect}，实际 exit=${actual}）"; FAIL=$((FAIL+1))
  fi
}

# ── 正常路径：守卫全绿退出 0 ──────────────────────────────────────────────────

check 0 "正常路径：node scripts/ratchet-guard.mjs 退出 0" \
  node "$GUARD"

# ── fixture：写临时 registry，让 smoke_pool 倒退（only_up 但水位高于实际值）─

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

FIXTURE_REG="$TMPDIR/ratchet-registry.json"
# smoke_pool 水位设为 9999（实际 9 < 9999），期望 guard 报红
python3 - <<'PYEOF' "$REGISTRY" "$FIXTURE_REG"
import sys, json
src, dst = sys.argv[1], sys.argv[2]
with open(src) as f: reg = json.load(f)
for m in reg:
    if m['name'] == 'smoke_pool':
        m['watermark'] = 9999  # 强制倒退
with open(dst, 'w') as f: json.dump(reg, f)
PYEOF

check 1 "fixture smoke_pool 倒退 → guard 退出非零" \
  node "$GUARD" --registry "$FIXTURE_REG"

# ── fixture：orphans 倒退（only_down 水位设为 -1，实际 0 > -1）─────────────

FIXTURE_REG2="$TMPDIR/ratchet-registry-2.json"
python3 - <<'PYEOF' "$REGISTRY" "$FIXTURE_REG2"
import sys, json
src, dst = sys.argv[1], sys.argv[2]
with open(src) as f: reg = json.load(f)
for m in reg:
    if m['name'] == 'orphans':
        m['watermark'] = -1  # 强制倒退（当前 0 > -1）
with open(dst, 'w') as f: json.dump(reg, f)
PYEOF

check 1 "fixture orphans 倒退 → guard 退出非零" \
  node "$GUARD" --registry "$FIXTURE_REG2"

# ── 打印指标名 ────────────────────────────────────────────────────────────────

output="$(node "$GUARD" --registry "$FIXTURE_REG" 2>&1 || true)"
if echo "$output" | grep -q "smoke_pool"; then
  echo "✅ 违规输出含指标名 smoke_pool"; PASS=$((PASS+1))
else
  echo "❌ 违规输出缺指标名 smoke_pool（实际: ${output}）"; FAIL=$((FAIL+1))
fi

# ── 总结 ──────────────────────────────────────────────────────────────────────

echo ""
echo "ratchet-guard 自测：PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ] || exit 1
