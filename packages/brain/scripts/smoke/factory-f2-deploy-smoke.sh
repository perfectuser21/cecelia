#!/usr/bin/env bash
# factory-f2-deploy-smoke.sh — 工厂 GP 五件套第一刀：F2 部署 最薄守卫
#
# ⚠️ 诚实声明（假绿灯纪律）：本闸为结构/契约级为主 + 少量运行时断言的最薄层。
#   - [结构] 断言只证明代码/注册表形态存在，不代表运行时行为已验证
#   - CI 环境 CECELIA_TICK_ENABLED=false：不断言任何"调度已真实执行"
#   - 决策 2a8bf656：工厂 journey 的 mvp 标签自此开始有机器背书，加厚走后续刀
# FIRE_TEST=1 为开发期自炸口（proven-to-fire 验证守卫非恒真），CI 不设。
#
# ⚠️ 钉子断言（commit-1 proven-to-fire 实弹，预期必红）：
#   issue 53e7ee4b — scripts/lib/bluegreen-sidecar.sh 是 blue 被删后唯一活路径，
#   必须由它收 drain-cancel；现状 0 处引用。红在此断言，修复留给 commit-2（同 PR）。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
psql_q() { psql -qtAc "$1"; }

echo "== F2 部署：蓝绿 sidecar drain 回路 =="

grep -Eq '^[^#]*curl[^#]*tick/drain-cancel' scripts/lib/bluegreen-sidecar.sh \
  && ok "[结构·钉子] bluegreen-sidecar.sh 含真实 curl 调用 tick/drain-cancel" \
  || fail "[结构·钉子] bluegreen-sidecar.sh 未含真实 curl 调用 tick/drain-cancel（issue 53e7ee4b：blue 被删后唯一活路径必须由它收 drain；注意本断言只认真实 curl 调用行，日志 echo 行不算数）"

grep -q "drain_before_swap" scripts/brain-deploy.sh && grep -q "drain_cancel_with_retry" scripts/brain-deploy.sh \
  && ok "[结构] brain-deploy.sh 含 drain_before_swap + drain_cancel_with_retry" || fail "brain-deploy.sh 缺 drain_before_swap 或 drain_cancel_with_retry"

# [运行时] drain 开关幂等回路（先例 smoke-runtime.sh:138-168）：跑完必须复原为 draining:false
#   注意零数据环境（CI/本机常见 in_progress=0）：GET drain-status 会 auto-complete
#   （drain.js:143 tasks.length===0 分支）把 draining 直接归 false 并返回 drain_completed:true，
#   永远看不到 draining:true 落地的窗口。因此：
#   ① POST /tick/drain 的响应体断言（drainTick 无条件返回 draining:true，drain.js:113-115），
#      不受 auto-complete 影响；
#   ② 紧随其后的 GET drain-status 断言放宽为 draining:true 或 drain_completed:true 二择命中
#      （有 in_progress 残留 → 前者；零数据 auto-complete → 后者），两条分支都代表 drain 生效过。
curl -fsm 5 -X POST "$BRAIN_URL/api/brain/tick/drain" | grep -q '"draining":true' \
  && ok "[运行时] POST /tick/drain 响应体 draining:true（drainTick 无条件返回）" || fail "POST /tick/drain 响应体未含 draining:true"

DRAIN_STATUS_BODY="$(curl -fsm 5 "$BRAIN_URL/api/brain/tick/drain-status")"
if echo "$DRAIN_STATUS_BODY" | grep -q '"draining":true' || echo "$DRAIN_STATUS_BODY" | grep -q '"drain_completed":true'; then
  ok "[运行时] drain-status 命中 draining:true 或 drain_completed:true（drain 生效，零数据环境 auto-complete 也算数）"
else
  fail "drain-status 既非 draining:true 也非 drain_completed:true"
fi

curl -fsm 5 -X POST "$BRAIN_URL/api/brain/tick/drain-cancel" >/dev/null \
  && ok "[运行时] POST /tick/drain-cancel 可达" || fail "POST /tick/drain-cancel 失败"

curl -fsm 5 "$BRAIN_URL/api/brain/tick/drain-status" | grep -q '"draining":false' \
  && ok "[运行时] drain-status.draining=false（已复原）" || fail "drain-status 未复原为 false"

grep -q "DRAIN_RESTORE_MAX_AGE_MS" packages/brain/src/drain.js \
  && ok "[结构] drain.js 导出 DRAIN_RESTORE_MAX_AGE_MS" || fail "drain.js 缺 DRAIN_RESTORE_MAX_AGE_MS"

[ -f scripts/smoke/e2e/deploy-daily-drill.sh ] \
  && ok "[结构] scripts/smoke/e2e/deploy-daily-drill.sh 存在" || fail "deploy-daily-drill.sh 缺失"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

# ── us-vps(Linux) 部署适配（GP 199ae170 加厚，decisions category=deployment）──

# [结构] docker-compose.us-vps.yml 存在
[ -f docker-compose.us-vps.yml ] \
  && ok "[结构] docker-compose.us-vps.yml 存在" || fail "docker-compose.us-vps.yml 缺失"

# [结构] Linux compose 文件不含账号绑定类挂载（引擎-机器绑定铁律：Claude/Codex 只在 mmv 跑）
if [ -f docker-compose.us-vps.yml ]; then
  if grep -qE '^\s*- .*(\.claude-account[0-9]|\.codex-team[0-9]|/\.grok:)' docker-compose.us-vps.yml; then
    fail "docker-compose.us-vps.yml 仍含账号绑定类挂载（claude-account/codex-team/grok）"
  else
    ok "[结构] docker-compose.us-vps.yml 不含账号绑定类挂载"
  fi
  grep -q "REPO_ROOT=/root/cecelia" docker-compose.us-vps.yml \
    && ok "[结构] docker-compose.us-vps.yml REPO_ROOT 指向 Linux 路径 /root/cecelia" \
    || fail "docker-compose.us-vps.yml 未把 REPO_ROOT 改指 /root/cecelia"
  grep -q "/var/run/docker.sock:/var/run/docker.sock" docker-compose.us-vps.yml \
    && ok "[结构] docker-compose.us-vps.yml 保留 docker.sock 挂载" \
    || fail "docker-compose.us-vps.yml 丢失 docker.sock 挂载（非账号相关，不该被裁剪）"
  grep -q "network_mode: host" docker-compose.us-vps.yml \
    && ok "[结构] docker-compose.us-vps.yml 用 host 网络模式（us-vps Postgres 只监听127.0.0.1）" \
    || fail "docker-compose.us-vps.yml 未用 host 网络模式，Linux上连不上只监听127.0.0.1的DB"
  grep -q "read_only: false" docker-compose.us-vps.yml \
    && ok "[结构] docker-compose.us-vps.yml read_only:false（生产实测read_only:true会搞坏SSH多路复用）" \
    || fail "docker-compose.us-vps.yml 不是 read_only:false，可能重新踩SSH socket创建失败的坑"
else
  fail "docker-compose.us-vps.yml 不存在，跳过内容断言"
fi

# [结构] brain-deploy.sh 按 uname -s 自动选择 compose 文件，且允许 COMPOSE_FILE 覆盖
grep -q 'COMPOSE_FILE' scripts/brain-deploy.sh \
  && ok "[结构] brain-deploy.sh 定义 COMPOSE_FILE 变量" || fail "brain-deploy.sh 未定义 COMPOSE_FILE 变量"
grep -qE 'uname -s.*Linux|Linux.*uname -s' scripts/brain-deploy.sh \
  && ok "[结构] brain-deploy.sh 含 uname -s 探测 Linux 分支" || fail "brain-deploy.sh 缺 uname -s 探测"
grep -q 'docker-compose.us-vps.yml' scripts/brain-deploy.sh \
  && ok "[结构] brain-deploy.sh 引用 docker-compose.us-vps.yml" || fail "brain-deploy.sh 未引用 docker-compose.us-vps.yml"

# [运行时] --dry-run 配合 COMPOSE_FILE 覆盖，验证选择逻辑真的生效（而不只是字符串存在于脚本里）
DRY_OUT_LINUX=$(cd "$(git rev-parse --show-toplevel)" && COMPOSE_FILE=docker-compose.us-vps.yml bash scripts/brain-deploy.sh --dry-run 2>&1) || true
echo "$DRY_OUT_LINUX" | grep -q "docker-compose.us-vps.yml" \
  && ok "[运行时] COMPOSE_FILE=docker-compose.us-vps.yml 覆盖后 dry-run 引用该文件" \
  || fail "COMPOSE_FILE 覆盖未生效于 dry-run 输出"

DRY_OUT_DEFAULT=$(cd "$(git rev-parse --show-toplevel)" && bash scripts/brain-deploy.sh --dry-run 2>&1) || true
# 期望值随当前 uname -s 走，跟 brain-deploy.sh 的探测逻辑保持同一份真相：
# 本机是 Linux（CI runner 全 ubuntu-latest）→ 默认应该选 docker-compose.us-vps.yml；
# 本机是 Darwin（mmv 等）→ 默认应该选 docker-compose.yml，不能默认切到 Linux 文件。
if [ "$(uname -s)" = "Linux" ]; then
  echo "$DRY_OUT_DEFAULT" | grep -q "docker-compose.us-vps.yml" \
    && ok "[运行时] 本机是 Linux，未覆盖 COMPOSE_FILE 时 dry-run 默认选中 docker-compose.us-vps.yml" \
    || fail "本机是 Linux，但未覆盖 COMPOSE_FILE 时 dry-run 没有默认选中 docker-compose.us-vps.yml"
else
  echo "$DRY_OUT_DEFAULT" | grep -q "docker-compose.us-vps.yml" \
    && fail "本机是 ${OSTYPE:-非Linux}，未覆盖 COMPOSE_FILE 时 dry-run 却默认引用了 Linux compose 文件（回归）" \
    || ok "[运行时] 本机非 Linux，未覆盖 COMPOSE_FILE 时 dry-run 默认行为不变（不引用 docker-compose.us-vps.yml）"
fi

# [结构] CECELIA_INTERNAL_ENV_FILE 默认值不能硬编码 macOS 路径（跟 REPO_ROOT 同类坑：
# us-vps 上实测 brain-deploy.sh --dry-run 会把这个变量默认值打成 /Users/administrator/...，
# 容器里没有这个路径，ensure_cecelia_internal_token 在真实（非 dry-run）执行时会失败）
grep -q '/Users/administrator/\.credentials/cecelia-internal\.env' scripts/brain-deploy.sh \
  && fail "brain-deploy.sh 仍硬编码 macOS 路径 /Users/administrator/.credentials/cecelia-internal.env 作为 CECELIA_INTERNAL_ENV_FILE 默认值" \
  || ok "[结构] brain-deploy.sh 不再硬编码 macOS 凭据路径"

# [运行时] HOST_HOME 切到 /root（模拟 us-vps）时，凭据文件默认路径应该跟着变
DRY_OUT_HOSTHOME_ROOT=$(cd "$(git rev-parse --show-toplevel)" && HOST_HOME=/root bash scripts/brain-deploy.sh --dry-run 2>&1) || true
echo "$DRY_OUT_HOSTHOME_ROOT" | grep -q '/root/\.credentials/cecelia-internal\.env' \
  && ok "[运行时] HOST_HOME=/root 时凭据文件默认路径跟着变成 /root/.credentials/cecelia-internal.env" \
  || fail "HOST_HOME=/root 时 dry-run 输出未见 /root/.credentials/cecelia-internal.env"

# [结构] harness-worktree.js 的 DEFAULT_BASE_REPO 不能永远硬编码 macOS 路径——
# us-vps 生产实测：golden_path_proposal 任务在 loadSkillBundle 成功后，下一步建
# worktree 时 git clone 源仍是 /Users/administrator/perfect21/cecelia，Linux 上不存在，
# 整个任务直接 fatal 失败。
grep -q "process.platform === 'linux'" packages/brain/src/harness-worktree.js \
  && ok "[结构] harness-worktree.js DEFAULT_BASE_REPO 按 platform 区分 Linux/macOS" \
  || fail "harness-worktree.js DEFAULT_BASE_REPO 未区分 Linux，us-vps 上会 clone 一个不存在的 macOS 路径"
grep -q "process.env.REPO_ROOT || '/root/cecelia'" packages/brain/src/harness-worktree.js \
  && ok "[结构] harness-worktree.js Linux 分支跟着 REPO_ROOT 走(缺省 /root/cecelia)" \
  || fail "harness-worktree.js Linux 分支未接 REPO_ROOT"

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
