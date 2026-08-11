#!/usr/bin/env bash
# 照相层全量重扫统一入口(刀0,2026-07-18)。
# host cron 安装说明(SSOT,系统时区 America/Los_Angeles,LA 05:00 = 北京 20:00):
#   0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh >> /tmp/registry-scan.log 2>&1
# 哨兵:本脚本停摆 >24h 后,GET /api/brain/registry?type=api|db_schema|test 自动 stale:true。
#
# 环境变量合同：
#   NODE_BIN           — 直接指定 node 可执行路径（优先级最高）
#   NODE_FALLBACK_PATHS — 冒号分隔的 node 候选绝对路径（不含 ${HOME}）
#   SCAN_SCRIPTS       — 空白分隔的 scanner 文件名列表（相对于 scripts/scan/）；
#                        未设置 = 默认四个；设置为空白 = exit 2
#   SKIP_GIT_PULL      — 非空时跳过 git pull（仍校验 clean main 与 exact SHA）
#   EXPECTED_SCAN_SHA  — 本批必须扫描的 revision；默认 origin/main
#   FACT_SNAPSHOT_TEST_MODE — 仅隔离 smoke 可跳过宿主 checkout 守卫
#   MAP_REBUILD_SCOPES — 扫描成功后原子重建的 Map scope；默认 cecelia
#   MAP_REBUILD_DISABLED — 仅事实快照隔离测试可设为 1；生产默认重建
#   BRAIN_URL          — Brain 地址；默认 http://localhost:5221
#   CECELIA_INTERNAL_ENV_FILE — 内部鉴权共享 env；默认宿主 credentials SSOT
set -uo pipefail

# 1. 确定 repo root（dirname 可被测试 stub 覆盖）
REPO_ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || {
  echo "ERROR: repo root 不可用" >&2
  exit 1
}
cd "$REPO_ROOT"

# Docker bridge 会把宿主 localhost 请求呈现为网关地址，不能依赖 socket loopback。
# cron 从 production env 精确读取这一项，不 source 其余凭据或执行文件内容。
if [[ -z "${CECELIA_INTERNAL_TOKEN:-}" ]]; then
  INTERNAL_AUTH_ENV_FILE="${CECELIA_INTERNAL_ENV_FILE:-/Users/administrator/.credentials/cecelia-internal.env}"
  INTERNAL_AUTH_HELPER="$REPO_ROOT/scripts/lib/internal-auth-token.sh"
  if [[ -f "$INTERNAL_AUTH_ENV_FILE" && -f "$INTERNAL_AUTH_HELPER" ]]; then
    # shellcheck disable=SC1090
    source "$INTERNAL_AUTH_HELPER"
    load_cecelia_internal_token "$INTERNAL_AUTH_ENV_FILE" || true
  fi
fi

echo "=== registry photo-layer scan $(date '+%F %T %Z') ==="

# 2. 确定 node 可执行路径（不依赖 ${HOME}）
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

# 3. 生产扫描只能来自 clean main，并精确锁定本批期望 revision。
if [[ "${FACT_SNAPSHOT_TEST_MODE:-}" != "1" ]]; then
  if [[ "$(git branch --show-current 2>/dev/null)" != "main" ]]; then
    echo "ERROR: 事实扫描必须运行在 main 分支" >&2
    exit 3
  fi
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    echo "ERROR: 事实扫描拒绝不干净工作区" >&2
    exit 3
  fi
  if [[ -z "${SKIP_GIT_PULL:-}" ]]; then
    git pull --ff-only 2>&1 || {
      echo "ERROR: git pull --ff-only 失败，拒绝扫描未知 revision" >&2
      exit 3
    }
  fi
fi
SCAN_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
EXPECTED_HEAD="${EXPECTED_SCAN_SHA:-${SCAN_HEAD}}"
if [[ ! "$SCAN_HEAD" =~ ^[0-9a-f]{40}$ || "$SCAN_HEAD" != "$EXPECTED_HEAD" ]]; then
  echo "ERROR: 扫描 HEAD 与期望 main revision 不一致 (${SCAN_HEAD:-missing} != ${EXPECTED_HEAD:-missing})" >&2
  exit 3
fi

# 4. 确定 scanner 列表（SCAN_SCRIPTS 按所有 shell 空白分割，空则 exit 2）
if [[ -n "${SCAN_SCRIPTS+x}" ]]; then
  DEFAULT_BATCH=0
  SCANNERS=()
  for _s in $SCAN_SCRIPTS; do
    [[ -n "${_s//[[:space:]]/}" ]] && SCANNERS+=("$_s")
  done
  if [[ ${#SCANNERS[@]} -eq 0 ]]; then
    echo "ERROR: SCAN_SCRIPTS 为空或仅含空白，退出" >&2
    exit 2
  fi
else
  DEFAULT_BATCH=1
  SCANNERS=(scan-api-registry.js scan-db-schema.js scan-test-registry.js scan-graph.mjs)
fi

# 5. 运行所有 scanner（一个失败不中断其余，聚合非零退出）
FAIL=0
for _s in "${SCANNERS[@]}"; do
  if "$NODE_BIN" "scripts/scan/${_s}"; then
    echo "OK: ${_s}"
  else
    echo "FAIL: ${_s}"
    FAIL=1
  fi
done

# 6. 只有整批事实同 revision 扫描成功，才切换 active projection。
# 任一 scanner 失败时保留旧 projection，读面会按 freshness fail-closed。
if [[ $FAIL -ne 0 ]]; then
  echo "WARN: scanner 批次不完整，保留旧 Map projection"
  exit "$FAIL"
fi

FINAL_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
if [[ "$FINAL_HEAD" != "$EXPECTED_HEAD" ]] \
  || { [[ "${FACT_SNAPSHOT_TEST_MODE:-}" != "1" ]] && [[ -n "$(git status --porcelain 2>/dev/null)" ]]; }; then
  echo "ERROR: 扫描期间 checkout revision 或工作区状态发生变化，拒绝发布" >&2
  exit 3
fi
if [[ $DEFAULT_BATCH -eq 1 ]] \
  && ! "$NODE_BIN" scripts/scan/verify-scan-batch.mjs "$EXPECTED_HEAD"; then
  echo "ERROR: 四类事实未锁定到同一 revision，拒绝发布" >&2
  exit 3
fi

if [[ -n "${MAP_REBUILD_DISABLED:-}" ]]; then
  echo "INFO: explicit fact-snapshot-only run; Map projection unchanged"
  exit 0
fi

MAP_SCOPES_RAW="${MAP_REBUILD_SCOPES:-cecelia}"
MAP_SCOPES=()
for _scope in $MAP_SCOPES_RAW; do
  [[ -n "${_scope//[[:space:]]/}" ]] && MAP_SCOPES+=("$_scope")
done
if [[ ${#MAP_SCOPES[@]} -eq 0 ]]; then
  echo "ERROR: MAP_REBUILD_SCOPES 为空或仅含空白，拒绝留下旧 projection" >&2
  exit 2
fi

BRAIN_ENDPOINT="${BRAIN_URL:-http://localhost:5221}"
BRAIN_ENDPOINT="${BRAIN_ENDPOINT%/}"
for _scope in "${MAP_SCOPES[@]}"; do
  if [[ ! "$_scope" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    echo "ERROR: 非法 Map scope: $_scope" >&2
    FAIL=1
    continue
  fi
  CURL_ARGS=(-sf --connect-timeout 5 --max-time 60
    -X POST "$BRAIN_ENDPOINT/api/brain/map/rebuild"
    -H 'Content-Type: application/json')
  if [[ -n "${CECELIA_INTERNAL_TOKEN:-}" ]]; then
    CURL_ARGS+=(-H "Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}")
  fi
  if curl "${CURL_ARGS[@]}" \
    --data "{\"scope_key\":\"$_scope\"}" >/dev/null; then
    echo "OK: map projection rebuilt: $_scope"
  else
    echo "FAIL: map projection rebuild: $_scope" >&2
    FAIL=1
  fi
done
exit $FAIL
