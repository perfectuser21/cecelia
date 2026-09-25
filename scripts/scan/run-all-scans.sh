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
#   SCAN_REPO_SPECS    — 分号分隔的 name|root|source_database_url；设置后每仓运行四扫描器
#   MAP_REBUILD_SCOPES — 扫描成功后原子重建的 Map scope；默认单仓 cecelia、多仓 repo name
#   MAP_REBUILD_DISABLED — 仅事实快照隔离测试可设为 1；生产默认重建
#   BRAIN_URL          — Brain 地址；默认 http://localhost:5221
#   CECELIA_INTERNAL_ENV_FILE — 内部鉴权共享 env；默认宿主 credentials SSOT
set -uo pipefail

# 1. 确定 repo root（dirname 可被测试 stub 覆盖）
REPO_ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || {
  echo "ERROR: repo root 不可用" >&2
  exit 1
}
cd "$REPO_ROOT" || exit 1

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

# 运行期噪音过滤（2026-09-23 P0 事故 9dfd873a：cecelia-scan-main/.cecelia/hb.sh +
# .cecelia/lights/*.live 心跳文件把只读扫描镜像仓库标记为不干净，rescan 连续拒绝
# 21.5h，四类快照陈旧，派发闸连撞 map_stale 触发 dispatch_fail_autoblock）。
#
# 两种候选修法二选一，此处选「过滤法」：
#   A) 过滤法（本实现）——git status --porcelain 结果里剔除已知运行期路径模式后再判定 clean。
#      优点：扫描器全程只读，绝不改动/删除 checkout 里的任何文件；被扫描的仓库可能同时
#      被其它会话使用（如 scan-main 本不该被开发但若已被污染，这里也不该越权清理它），
#      过滤判定不承担"我猜这些文件可以删"的责任，行为可预测、易审计。
#   B) 自动清理法（未采用）——扫描前 stash/rm 掉运行期文件。
#      缺点：这是只读扫描器，赋予它写权限（哪怕只删自己不认识的文件）本身就是风险面；
#      且两种做法混用会让"谁负责清理"边界不清，故只选一种。
# 已知运行期路径模式（非代码产物，不该参与 clean 判定）：
#   .cecelia/          — dev-heartbeat-guardian 心跳灯（hb.sh + lights/*.live）
#   .dev-lock* / .dev-mode* — /dev 会话锁与模式标记（已在 .gitignore，双重保险）
#   node_modules/      — 依赖树（已在 .gitignore，双重保险）
RUNTIME_NOISE_PATTERN='^\.cecelia/|^\.dev-lock|^\.dev-mode|^node_modules/'

# 读取 `git status --porcelain` 的原始输出（经 stdin），剔除已知运行期噪音路径后
# 打印剩余的"真脏"行；不改动、不删除任何文件。
filter_runtime_noise() {
  local line path
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    path="${line:3}"
    path="${path#* -> }"  # rename 条目 "R  old -> new"：按目标路径判断
    if [[ "$path" =~ $RUNTIME_NOISE_PATTERN ]]; then
      continue
    fi
    printf '%s\n' "$line"
  done
}

# 过滤后的 dirty 判定：$1 = 目标 repo root（省略 = 当前目录）。
dirty_status() {
  local root="${1:-}"
  if [[ -n "$root" ]]; then
    git -C "$root" status --porcelain 2>/dev/null | filter_runtime_noise
  else
    git status --porcelain 2>/dev/null | filter_runtime_noise
  fi
}

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
  if [[ -n "$(dirty_status)" ]]; then
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

prepare_repo() {
  local repo_root="$1"
  PREPARED_HEAD="$SCAN_HEAD"
  [[ "${FACT_SNAPSHOT_TEST_MODE:-}" == "1" ]] && return 0
  if [[ "$(git -C "$repo_root" branch --show-current 2>/dev/null)" != "main" ]] \
    || [[ -n "$(dirty_status "$repo_root")" ]]; then
    echo "ERROR: 目标事实仓必须是 clean main: $repo_root" >&2
    return 3
  fi
  if [[ -z "${SKIP_GIT_PULL:-}" && "$repo_root" != "$REPO_ROOT" ]]; then
    git -C "$repo_root" pull --ff-only 2>&1 || {
      echo "ERROR: $repo_root git pull --ff-only 失败" >&2
      return 3
    }
  fi
  PREPARED_HEAD="$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || true)"
  [[ "$PREPARED_HEAD" =~ ^[0-9a-f]{40}$ ]] || {
    echo "ERROR: 目标事实仓 revision 非法: $repo_root" >&2
    return 3
  }
}

TARGET_NAMES=()
TARGET_ROOTS=()
TARGET_DATABASE_URLS=()
TARGET_HEADS=()

if [[ -n "${SCAN_REPO_SPECS+x}" ]]; then
  IFS=';' read -ra _REPO_SPECS <<< "$SCAN_REPO_SPECS"
  [[ ${#_REPO_SPECS[@]} -gt 0 ]] || { echo "ERROR: SCAN_REPO_SPECS 为空" >&2; exit 2; }
  for _spec in "${_REPO_SPECS[@]}"; do
    IFS='|' read -r _repo_name _repo_root _source_database_url <<< "$_spec"
    if [[ -z "$_repo_name" || ! "$_repo_name" =~ ^[A-Za-z0-9._-]+$ ]] \
      || [[ -z "$_repo_root" || ! -d "$_repo_root" ]]; then
      echo "ERROR: 无效 SCAN_REPO_SPECS 项: $_spec" >&2
      FAIL=1
      continue
    fi
    if ! prepare_repo "$_repo_root"; then FAIL=1; continue; fi
    TARGET_NAMES+=("$_repo_name")
    TARGET_ROOTS+=("$_repo_root")
    TARGET_DATABASE_URLS+=("$_source_database_url")
    TARGET_HEADS+=("$PREPARED_HEAD")
  done
else
  TARGET_NAMES+=("cecelia")
  TARGET_ROOTS+=("$REPO_ROOT")
  TARGET_DATABASE_URLS+=("")
  TARGET_HEADS+=("$EXPECTED_HEAD")
fi

[[ ${#TARGET_NAMES[@]} -gt 0 ]] || {
  echo "ERROR: 没有可扫描的有效 repo" >&2
  exit 3
}

for _target_index in "${!TARGET_NAMES[@]}"; do
  for _s in "${SCANNERS[@]}"; do
    if run_scanner "$_s" "${TARGET_NAMES[$_target_index]}" \
      "${TARGET_ROOTS[$_target_index]}" "${TARGET_DATABASE_URLS[$_target_index]}"; then
      echo "OK: repo=${TARGET_NAMES[$_target_index]} ${_s}"
    else
      echo "FAIL: repo=${TARGET_NAMES[$_target_index]} ${_s}"
      FAIL=1
    fi
  done
done

# 6. 只有所有 repo 的整批事实均锁定 revision，才切换 active projection。
if [[ $FAIL -ne 0 ]]; then
  echo "WARN: scanner 批次不完整，保留旧 Map projection"
  exit "$FAIL"
fi

FINAL_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
if [[ "$FINAL_HEAD" != "$EXPECTED_HEAD" ]] \
  || { [[ "${FACT_SNAPSHOT_TEST_MODE:-}" != "1" ]] && [[ -n "$(dirty_status)" ]]; }; then
  echo "ERROR: 扫描期间 checkout revision 或工作区状态发生变化，拒绝发布" >&2
  exit 3
fi

for _target_index in "${!TARGET_NAMES[@]}"; do
  if [[ "${FACT_SNAPSHOT_TEST_MODE:-}" != "1" ]] \
    && [[ "${TARGET_ROOTS[$_target_index]}" != "$REPO_ROOT" ]]; then
    _final_target_head="$(git -C "${TARGET_ROOTS[$_target_index]}" rev-parse HEAD 2>/dev/null || true)"
    if [[ "$_final_target_head" != "${TARGET_HEADS[$_target_index]}" ]] \
      || [[ -n "$(dirty_status "${TARGET_ROOTS[$_target_index]}")" ]]; then
      echo "ERROR: repo=${TARGET_NAMES[$_target_index]} 扫描期间 revision 或工作区漂移" >&2
      exit 3
    fi
  fi
  if [[ $DEFAULT_BATCH -eq 1 ]] \
    && ! SCAN_REPO="${TARGET_NAMES[$_target_index]}" \
      "$NODE_BIN" scripts/scan/verify-scan-batch.mjs "${TARGET_HEADS[$_target_index]}"; then
    echo "ERROR: repo=${TARGET_NAMES[$_target_index]} 四类事实未锁定到同一 revision" >&2
    exit 3
  fi
done

if [[ -n "${MAP_REBUILD_DISABLED:-}" ]]; then
  echo "INFO: explicit fact-snapshot-only run; Map projection unchanged"
  exit 0
fi

if [[ -n "${MAP_REBUILD_SCOPES+x}" ]]; then
  MAP_SCOPES_RAW="$MAP_REBUILD_SCOPES"
elif [[ -n "${SCAN_REPO_SPECS+x}" ]]; then
  MAP_SCOPES_RAW="${TARGET_NAMES[*]}"
else
  MAP_SCOPES_RAW="cecelia"
fi
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
