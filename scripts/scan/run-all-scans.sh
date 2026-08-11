#!/usr/bin/env bash
# 照相层全量重扫统一入口(刀0,2026-07-18)。
# host cron 安装说明(SSOT,系统时区 America/Los_Angeles,LA 05:00 = 北京 20:00):
#   0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh >> /tmp/registry-scan.log 2>&1
# 哨兵:本脚本停摆 >24h 后,GET /api/brain/registry?type=api|db_schema|test 自动 stale:true。
#
# 环境变量合同：
#   NODE_BIN           — 直接指定 node 可执行路径（优先级最高）
#   NODE_FALLBACK_PATHS — 冒号分隔的 node 候选绝对路径（不含 $HOME）
#   SCAN_SCRIPTS       — 空白分隔的 scanner 文件名列表（相对于 scripts/scan/）；
#                        未设置 = 默认四个；设置为空白 = exit 2
#   SCAN_REPO_SPECS    — 分号分隔的 name|root|source_database_url；设置后每仓运行四扫描器
#   SKIP_GIT_PULL      — 非空时跳过 git pull
set -uo pipefail

# 1. 确定 repo root（dirname 可被测试 stub 覆盖）
REPO_ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || {
  echo "ERROR: repo root 不可用" >&2
  exit 1
}
cd "$REPO_ROOT" || exit 1

echo "=== registry photo-layer scan $(date '+%F %T %Z') ==="

# 2. 确定 node 可执行路径（不依赖 $HOME）
if [[ -z "${NODE_BIN:-}" ]]; then
  NODE_BIN=""
  if [[ -n "${NODE_FALLBACK_PATHS:-}" ]]; then
    IFS=':' read -ra _FALLBACK <<< "$NODE_FALLBACK_PATHS"
    for _c in "${_FALLBACK[@]}"; do
      if [[ -x "$_c" ]]; then NODE_BIN="$_c"; break; fi
    done
  fi
  if [[ -z "$NODE_BIN" ]]; then
    _h="${HOME:-}"
    for _cand in \
      "${_h}/.nvm/versions/node/$(cat "${_h}/.nvmrc" 2>/dev/null || echo 'v20')/bin/node" \
      "${_h}/.asdf/shims/node"; do
      if [[ -x "$_cand" ]]; then NODE_BIN="$_cand"; break; fi
    done
  fi
  if [[ -z "$NODE_BIN" ]]; then
    NODE_BIN="$(command -v node 2>/dev/null || true)"
  fi
fi

if [[ -z "${NODE_BIN:-}" || ! -x "${NODE_BIN}" ]]; then
  echo "ERROR: 找不到可执行的 Node.js（NODE_BIN=${NODE_BIN:-<unset>}，NODE_FALLBACK_PATHS=${NODE_FALLBACK_PATHS:-<unset>}）" >&2
  exit 127
fi

echo "node: $NODE_BIN"

# 3. git pull（可通过 SKIP_GIT_PULL=1 跳过）
if [[ -z "${SKIP_GIT_PULL:-}" ]] && [[ ! ${SCAN_REPO_SPECS+x} ]]; then
  if [[ "$(git branch --show-current 2>/dev/null)" == 'main' ]] \
    && [ -z "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    git pull --ff-only 2>&1 || echo "WARN: git pull 失败,用当前工作区继续"
  else
    echo "WARN: 非 main 分支或工作区不干净,跳过 git pull"
  fi
fi

# 4. 确定 scanner 列表（SCAN_SCRIPTS 按所有 shell 空白分割，空则 exit 2）
if [[ ${SCAN_SCRIPTS+x} ]]; then
  SCANNERS=()
  for _s in $SCAN_SCRIPTS; do
    [[ -n "${_s//[[:space:]]/}" ]] && SCANNERS+=("$_s")
  done
  if [[ ${#SCANNERS[@]} -eq 0 ]]; then
    echo "ERROR: SCAN_SCRIPTS 为空或仅含空白，退出" >&2
    exit 2
  fi
else
  SCANNERS=(scan-api-registry.js scan-db-schema.js scan-test-registry.js scan-graph.mjs)
fi

# 5. 运行所有 scanner（一个失败不中断其余，聚合非零退出）
FAIL=0

run_scanner() {
  local scanner="$1" repo_name="${2:-}" repo_root="${3:-}" source_database_url="${4:-}"
  if [[ -n "$repo_name" ]]; then
    SCAN_REPO_NAME="$repo_name" SCAN_REPO_ROOT="$repo_root" \
      SOURCE_DATABASE_URL="${source_database_url:-${DATABASE_URL:-}}" \
      GRAPH_REPOS="$repo_name" "$NODE_BIN" "scripts/scan/${scanner}"
  else
    "$NODE_BIN" "scripts/scan/${scanner}"
  fi
}

pull_repo() {
  local repo_root="$1"
  [[ -n "${SKIP_GIT_PULL:-}" ]] && return 0
  if [[ "$(git -C "$repo_root" branch --show-current 2>/dev/null)" == 'main' ]] \
    && [[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
    git -C "$repo_root" pull --ff-only 2>&1 || echo "WARN: $repo_root git pull 失败,用当前工作区继续"
  else
    echo "WARN: $repo_root 非 main 或 tracked 工作区不干净,跳过 git pull"
  fi
}

if [[ ${SCAN_REPO_SPECS+x} ]]; then
  IFS=';' read -ra _REPO_SPECS <<< "$SCAN_REPO_SPECS"
  [[ ${#_REPO_SPECS[@]} -gt 0 ]] || { echo "ERROR: SCAN_REPO_SPECS 为空" >&2; exit 2; }
  for _spec in "${_REPO_SPECS[@]}"; do
    IFS='|' read -r SCAN_REPO_NAME SCAN_REPO_ROOT SOURCE_DATABASE_URL <<< "$_spec"
    if [[ -z "$SCAN_REPO_NAME" || -z "$SCAN_REPO_ROOT" || ! -d "$SCAN_REPO_ROOT" ]]; then
      echo "ERROR: 无效 SCAN_REPO_SPECS 项: $_spec" >&2
      FAIL=1
      continue
    fi
    pull_repo "$SCAN_REPO_ROOT"
    for _s in "${SCANNERS[@]}"; do
      if run_scanner "$_s" "$SCAN_REPO_NAME" "$SCAN_REPO_ROOT" "$SOURCE_DATABASE_URL"; then
        echo "OK: repo=$SCAN_REPO_NAME ${_s}"
      else
        echo "FAIL: repo=$SCAN_REPO_NAME ${_s}"
        FAIL=1
      fi
    done
  done
else
  for _s in "${SCANNERS[@]}"; do
    if run_scanner "$_s"; then
      echo "OK: ${_s}"
    else
      echo "FAIL: ${_s}"
      FAIL=1
    fi
  done
fi
exit $FAIL
