#!/usr/bin/env bash
# Regression: TMPDIR 被显式设成空字符串（非 unset）时，`mktemp -t <template>` 在
# GNU coreutils（Linux 容器，如 cecelia-node-brain）下会报 "mktemp: : Invalid argument"。
# 实测：Brain deploy webhook 容器内 TMPDIR=""，导致 dashboard-staging-selfcheck.sh
# 的 mktemp -t 调用直接崩溃，打断唯一推荐的 Cecelia Dashboard 部署路径。
# 修法：所有 mktemp -t 改成 mktemp "${TMPDIR:-/tmp}/<template>"，显式兜底目录，
# 不依赖 -t 的隐式 TMPDIR 探测（该探测在 TMPDIR="" 时不会回退到 /tmp）。
set -uo pipefail

PASS=0
FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# 只在 GNU mktemp（Linux）下复现；BSD/macOS mktemp -t 语义不同不会崩，跳过复现但仍检查代码写法。
IS_GNU_MKTEMP=0
if mktemp --version >/dev/null 2>&1; then IS_GNU_MKTEMP=1; fi

echo "── TMPDIR=空字符串 场景复现 ──"
if [[ "$IS_GNU_MKTEMP" -eq 1 ]]; then
  if TMPDIR="" mktemp -t regress-old-style.XXXXXX.log >/dev/null 2>&1; then
    bad "环境异常：GNU mktemp -t 在 TMPDIR=\"\" 下未复现崩溃，无法验证修复必要性"
  else
    ok "复现：TMPDIR=\"\" 时 mktemp -t 崩溃（这就是容器里发生的事）"
  fi
else
  ok "非 GNU mktemp（BSD/macOS），跳过崩溃复现，仅检查脚本写法"
fi

echo "── 修法：显式兜底路径必须能在 TMPDIR=\"\" 下正常工作 ──"
if TMPDIR="" out=$(mktemp "${TMPDIR:-/tmp}/regress-new-style.XXXXXX.log" 2>&1); then
  ok "TMPDIR=\"\" 时 mktemp \"\${TMPDIR:-/tmp}/...\" 正常返回: $out"
  rm -f "$out"
else
  bad "修法本身在 TMPDIR=\"\" 下仍失败: $out"
fi

echo "── 代码检查：仓库内不应再有裸 mktemp -t 调用 ──"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$SCRIPT_DIR/../.."
HITS=$(grep -rEn '^\s*[A-Za-z_]+="?\$\(mktemp -t ' "$REPO_ROOT/scripts" \
  --exclude-dir=__tests__ --exclude-dir=node_modules 2>/dev/null || true)
if [[ -z "$HITS" ]]; then
  ok "scripts/ 下无裸 mktemp -t 调用"
else
  bad "仍有裸 mktemp -t 调用（TMPDIR=\"\" 会崩）："$'\n'"$HITS"
fi

echo ""
echo "PASS:$PASS FAIL:$FAIL"
[[ "$FAIL" -eq 0 ]]
