#!/usr/bin/env bash
# test-pyramid-guard.test.sh — guard 的 proven-to-fire 自测：
# 在 tmp fixture 仓里逐个制造 A1/A2/A3 红况，断言 guard 真报红；干净 fixture 报绿。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$REPO_ROOT/scripts/test-pyramid-guard.mjs"
FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT
PASS=0; FAIL=0
check() { # $1=期望退出码 $2=描述
  local expect="$1" desc="$2" actual=0
  CI=true node "$GUARD" --root "$FIX" >/dev/null 2>&1 || actual=$?
  if [ "$actual" -eq "$expect" ] || { [ "$expect" -ne 0 ] && [ "$actual" -ne 0 ]; }; then
    echo "✅ $desc"; PASS=$((PASS+1))
  else
    echo "❌ ${desc}（期望 exit=${expect} 实际 exit=${actual}）"; FAIL=$((FAIL+1))
  fi
}

# ── 干净 fixture ──
mkdir -p "$FIX/scripts/smoke" "$FIX/.github/workflows" "$FIX/perm"
touch "$FIX/perm/a.test.js"
cat > "$FIX/scripts/test-pyramid-baseline.json" <<'EOF'
{"orphans":0,"permanent":1,"permanent_roots":[{"path":"perm","layer":"unit"}],"smoke_dir":"scripts/smoke"}
EOF
check 0 "干净 fixture → 绿"

# ── A1: 制造孤儿超基线 ──
mkdir -p "$FIX/sprints/s1"; touch "$FIX/sprints/s1/x.test.ts"
check 1 "A1 孤儿超基线 → 红"
rm -rf "$FIX/sprints"

# ── A2: 制造无跑道 smoke ──
touch "$FIX/scripts/smoke/naked.sh"
check 1 "A2 smoke 无跑道 → 红"
echo 'run: bash scripts/smoke/naked.sh' > "$FIX/.github/workflows/w.yml"
check 0 "A2 按名挂跑道 → 绿"
rm "$FIX/.github/workflows/w.yml"
echo 'for s in scripts/smoke/*.sh; do bash "$s"; done' > "$FIX/.github/workflows/w.yml"
check 0 "A2 glob 挂跑道 → 绿"
rm "$FIX/.github/workflows/w.yml"

# ── A2 左边界锚定：packages 下的 smoke glob 不能豁免根 scripts/smoke 裸脚本 ──
echo 'for s in packages/x/scripts/smoke/*.sh; do bash "$s"; done' > "$FIX/.github/workflows/w.yml"
check 1 "A2 packages 前缀 glob 不豁免根 smoke → 红（防截断假绿）"
rm "$FIX/scripts/smoke/naked.sh" "$FIX/.github/workflows/w.yml"

# ── PR 场景：当前 PR 改动中的 sprint 孤儿先豁免，等待 merge 前毕业 ──
mkdir -p "$FIX/.git" "$FIX/sprints/hotfix-1"
touch "$FIX/sprints/hotfix-1/x.test.ts"
echo "sprints/hotfix-1/x.test.ts" > "$FIX/.git/pr-diff.txt"
cat > "$FIX/git" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "diff" ] && [ "$2" = "--name-only" ]; then
  cat "$(dirname "$0")/.git/pr-diff.txt"
  exit 0
fi
exit 1
EOF
chmod +x "$FIX/git"
PATH="$FIX:$PATH" CI=true GITHUB_EVENT_NAME=pull_request BASE_REF=origin/main node "$GUARD" --root "$FIX" >/dev/null 2>&1
echo "✅ PR 场景：当前 PR sprint 孤儿暂豁免（待 merge 前毕业）"; PASS=$((PASS+1))
rm -rf "$FIX/sprints" "$FIX/git" "$FIX/.git"

# ── A3: 删永久测试 ──
rm "$FIX/perm/a.test.js"
check 1 "A3 永久池跌破基线 → 红"
touch "$FIX/perm/a.test.js"

# ── 基线缺失 ──
rm "$FIX/scripts/test-pyramid-baseline.json"
check 1 "基线缺失 → 红（宁红勿绿）"

echo "── 自测结果: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ]
