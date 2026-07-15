#!/usr/bin/env bash
# smoke-core-no-jq.test.sh — 核心 smoke 依赖守卫
# 蓝绿 pre-swap smoke 在 brain 容器内执行，容器依赖清单只许 bash+curl+node；
# 裸调 jq 会 command not found → canary 拦截自动部署（2026-07-15 实弹复现）。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CORE_LIST="$REPO_ROOT/packages/quality/smoke-core.txt"
SMOKE_DIR="$REPO_ROOT/packages/brain/scripts/smoke"
FAILED=0
while IFS= read -r script || [[ -n "$script" ]]; do
  [[ "$script" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${script// }" ]] && continue
  f="$SMOKE_DIR/$script"
  if [[ ! -f "$f" ]]; then echo "  ❌ $script: 清单引用的文件不存在"; FAILED=1; continue; fi
  if grep -nE '(^|[^[:alnum:]_.-])jq([[:space:]]|$)' "$f"; then
    echo "  ❌ $script: 依赖 jq（容器内不可用，只许 bash+curl+node）"; FAILED=1
  else
    echo "  ✅ $script"
  fi
done < "$CORE_LIST"
[[ "$FAILED" == 0 ]] && echo "smoke-core-no-jq.test.sh: OK" || { echo "smoke-core-no-jq.test.sh: FAILED"; exit 1; }
