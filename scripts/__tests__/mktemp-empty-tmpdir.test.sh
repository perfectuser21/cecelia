#!/usr/bin/env bash
# Regression: cecelia-node-brain 容器跑的是 BusyBox mktemp（非 GNU/BSD），
# 它的模板解析**不支持 XXXXXX 占位符后再跟静态后缀**（如 `foo.XXXXXX.log`），
# 一律报 "mktemp: : Invalid argument"，与 TMPDIR 是否为空无关（曾误判为 TMPDIR="" 导致，
# 实测 TMPDIR 正常时同样报错，真根因是模板本身）。
# 该 bug 直接打断 dashboard-staging-selfcheck.sh 的 staging 自检，
# 使 Brain deploy webhook（唯一推荐的 Cecelia Dashboard 部署路径）失败。
# 修法：mktemp 模板里 XXXXXX 必须是结尾，静态后缀放前面（如 `dashboard-slot.XXXXXX`），
# 不要在 XXXXXX 之后再拼后缀。
set -uo pipefail

PASS=0
FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

IS_BUSYBOX=0
if (mktemp --help 2>&1 || true) | grep -qi 'busybox'; then IS_BUSYBOX=1; fi

echo "── BusyBox mktemp：XXXXXX 后带静态后缀 场景复现 ──"
if [[ "$IS_BUSYBOX" -eq 1 ]]; then
  if out=$(mktemp "${TMPDIR:-/tmp}/regress-old-style.XXXXXX.log" 2>&1); then
    bad "环境异常：BusyBox mktemp 对 XXXXXX 后带后缀的模板未复现崩溃，无法验证修复必要性"
    rm -f "$out"
  else
    ok "复现：XXXXXX 后带静态后缀（.log）时 mktemp 崩溃（这就是脚本里发生的事）"
  fi
else
  ok "非 BusyBox mktemp（GNU/BSD 支持后缀），跳过崩溃复现，仅检查脚本写法"
fi

echo "── 修法：XXXXXX 放模板结尾，不带静态后缀，必须能正常工作 ──"
if out=$(mktemp "${TMPDIR:-/tmp}/regress-new-style.XXXXXX" 2>&1); then
  ok "XXXXXX 结尾的模板正常返回: $out"
  rm -f "$out"
else
  bad "修法本身仍失败: $out"
fi

echo "── 代码检查：仓库内 mktemp 调用的模板不应在 XXXXXX 后再拼静态后缀 ──"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$SCRIPT_DIR/../.."
# 匹配形如 mktemp ... XXXXXX<非空白字符>（XXXXXX 后面还跟着别的字符，说明不是结尾）
HITS=$(grep -rEn 'mktemp[^#]*XXXXXX[A-Za-z0-9._-]' "$REPO_ROOT/scripts" \
  --exclude-dir=__tests__ --exclude-dir=node_modules 2>/dev/null || true)
if [[ -z "$HITS" ]]; then
  ok "scripts/ 下无 XXXXXX 后带静态后缀的 mktemp 模板"
else
  bad "仍有 XXXXXX 后带静态后缀的 mktemp 模板（BusyBox 下会崩）："$'\n'"$HITS"
fi

echo ""
echo "PASS:$PASS FAIL:$FAIL"
[[ "$FAIL" -eq 0 ]]
