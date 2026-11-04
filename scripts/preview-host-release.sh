#!/usr/bin/env bash
# preview-host-release.sh — 预览主机（MMV）发布：把 preview-agent 与 preview-reaper 切到 origin/main 新快照
#
# 为什么需要（任务 6f937566 ①）：
#   MMV 上 preview-agent（launchd plist）和 preview-reaper（crontab）一直钉在
#   cecelia-preview-releases/fleet-65ab15f4d6（9c5663d39，10-02 手工建），之后 main 上的预览修复
#   （#6155 闲置回收、#6320 台账库）一个都没上到预览主机——没有可重复的发布流程。
#
# 做什么（--apply 时）：
#   1. 源仓库 fetch，取 origin/main（或 --ref）的 sha；在发布根下建 rel-<sha12> 快照
#      （git clone --local + 检出 sha，origin 指回 GitHub；preview-env-start.sh 要在这里 fetch PR 分支）
#   2. npm ci 装 Brain 运行依赖；写 .release-sha（代理 health 回报 git_sha 用）
#   3. 备份当前 plist 与 crontab → 用快照里的 preview-agent-install.sh 重写 plist（不含令牌）并重载
#   4. crontab 里 preview-reaper 那一行换成新快照，带 DB_NAME（台账库）
#   5. 验活：health.git_sha == 目标 sha、新快照 .runtime/host-disk.json 180s 内刷新过、
#      用凭据文件令牌 POST stop/0 得 200（证明 CI 的 DEPLOY_TOKEN 仍能过鉴权）
#   6. 任一步失败 → 恢复备份的 plist 与 crontab 并重载，非零退出
#   7. 成功 → 记录 .current，清理旧快照（保留 KEEP 个；上一版与仍被预览 worktree/依赖链接引用的不删）
#
# 影响面：重载代理时 CI 调 start 可能短暂连不上（CI 侧有重试）；预览子进程是 detached 的，
#   plist 带 AbandonProcessGroup，正在跑的预览不受影响。
#
# 用法（只在 MMV 本机跑，不碰 us-vps）：
#   bash scripts/preview-host-release.sh              默认 dry-run：只打印计划，零副作用
#   bash scripts/preview-host-release.sh --apply      真正发布
#   bash scripts/preview-host-release.sh --apply --ref origin/main
#   bash scripts/preview-host-release.sh --apply --component agent --ref <sha>  仅代理，cron/reaper 不变
set -euo pipefail

APPLY=0
REF="origin/main"
COMPONENT="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --component) COMPONENT="${2:?--component 需要参数}"; shift ;;
    --ref) REF="${2:?--ref 需要参数}"; shift ;;
    *) echo "未知参数：$1（可用 --apply / --dry-run / --component all|agent / --ref <ref>）" >&2; exit 2 ;;
  esac
  shift
done

[[ "$COMPONENT" = all || "$COMPONENT" = agent ]] || { echo "--component 只接受 all 或 agent" >&2; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/preview-agent-owner.sh"
SOURCE_REPO="${PREVIEW_RELEASE_SOURCE_REPO:-/Users/administrator/perfect21/cecelia}"
RELEASES_DIR="${PREVIEW_RELEASES_DIR:-/Users/administrator/perfect21/cecelia-preview-releases}"
RELEASES_DIR="${RELEASES_DIR%/}"
PREVIEW_BASE_DIR="${PREVIEW_BASE_DIR:-/Users/administrator/worktrees/cecelia-previews}"
LABEL="com.cecelia.preview-agent"
PLIST="${PREVIEW_AGENT_PLIST:-$HOME/Library/LaunchAgents/${LABEL}.plist}"
AGENT_URL="${PREVIEW_AGENT_URL:-http://100.71.151.105:5241}"
LEDGER_DB="${PREVIEW_LEDGER_DB:-cecelia_staging}"
REAPER_LOG="${PREVIEW_REAPER_LOG:-/tmp/preview-reaper-cron.log}"
KEEP="${PREVIEW_RELEASE_KEEP:-3}"
VERIFY_TIMEOUT="${PREVIEW_RELEASE_VERIFY_TIMEOUT:-120}"
POLL_INTERVAL="${PREVIEW_RELEASE_POLL_INTERVAL:-3}"
SAMPLE_MAX_AGE="${PREVIEW_RELEASE_SAMPLE_MAX_AGE:-180}"
# 根 workspace 装 Brain 生产依赖（preview-env-start.sh 的 lock 一致快路径直接链接这两个 node_modules）
read -r -a NPM_CI_ARGS <<< "${PREVIEW_RELEASE_NPM_CI_ARGS:---omit=dev --workspace=packages/brain --include-workspace-root --no-audit --no-fund}"
export DEPLOY_TOKEN_FILE="${DEPLOY_TOKEN_FILE:-$HOME/.credentials/cecelia-deploy-token.env}"
# 令牌只从凭据文件走，避免调用方环境里的值被带进任何子进程/plist
unset DEPLOY_TOKEN

log() { echo "[preview-release] $*"; }
die() { echo "[preview-release] ❌ $*" >&2; exit 1; }

# plist 里某个 <key> 后面的第一个 <string>（兼容 key/string 同行与分行两种排版）
plist_string() {
  awk -v k="<key>$2</key>" 'index($0,k){f=1} f&&/<string>/{s=$0; sub(/.*<string>/,"",s); sub(/<\/string>.*/,"",s); print s; exit}' "$1" 2>/dev/null || true
}
reaper_cron_line() {
  printf '20 * * * * cd %s && REPO_ROOT=%s DB_NAME=%s bash scripts/preview-reaper.sh >> %s 2>&1' "$1" "$1" "$LEDGER_DB" "$REAPER_LOG"
}
render_crontab() { # $1 = 新快照目录；stdin 旧 crontab；去掉所有 preview-reaper 行，追加一条新的
  grep -v 'scripts/preview-reaper.sh' || true
  reaper_cron_line "$1"; echo
}
file_age() { # 秒；文件不存在返回很大的数
  local m
  # 先 GNU 再 BSD：GNU 的 stat -f 是"文件系统信息"，会吐出非数字内容
  m=$(stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null) || { echo 999999; return; }
  echo $(( $(date +%s) - m ))
}
health_sha() {
  curl -s --max-time 5 "${AGENT_URL}/api/brain/health" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).git_sha||""))}catch{}})' 2>/dev/null || true
}

# ── 0. 前置检查 ──────────────────────────────────────────────────────────────
[[ -d "$SOURCE_REPO/.git" ]] || die "源仓库 ${SOURCE_REPO} 不存在"
node "$SCRIPT_DIR/preview-agent/deploy-token.mjs" check >/dev/null 2>&1 \
  || die "凭据文件 ${DEPLOY_TOKEN_FILE} 缺失或没有 DEPLOY_TOKEN= 行（代理会拒绝启动）。先从 1Password 同步再发布"
[[ "$KEEP" =~ ^[0-9]+$ && "$KEEP" -ge 2 ]] || die "PREVIEW_RELEASE_KEEP 至少为 2（当前版 + 上一版）"

# 活 endpoint 必须有可恢复的 launchd owner。孤儿进程无法由 plist 事务恢复，
# 不能先安装再靠 health 超时回滚，更不能按旧 plist 名称盲目接管。
if [[ "$APPLY" = 1 ]] && curl -fsS --max-time 5 "${AGENT_URL}/api/brain/health" >/dev/null 2>&1; then
  [[ -f "$PLIST" ]] || die "代理 endpoint 已运行，但没有可恢复 plist；拒绝接管孤儿 owner，先完成独立归属迁移"
  preview_agent_owner "$LABEL" "$(plist_string "$PLIST" WorkingDirectory)" "$AGENT_URL" >/dev/null \
    || die "代理 endpoint 已运行，但 PID/监听/目录不属于 launchd owner；拒绝接管，先完成独立归属迁移"
fi

if [[ "$APPLY" = 1 ]]; then
  git -C "$SOURCE_REPO" fetch -q origin || die "源仓库 fetch 失败"
fi
SHA=$(git -C "$SOURCE_REPO" rev-parse --verify "${REF}^{commit}" 2>/dev/null) || die "解析不了 ${REF}"
ORIGIN_URL=$(git -C "$SOURCE_REPO" remote get-url origin)
NEW="${RELEASES_DIR}/rel-${SHA:0:12}"
PREV=""
[[ -f "$RELEASES_DIR/.current" ]] && PREV=$(cat "$RELEASES_DIR/.current")
[[ -z "$PREV" && -f "$PLIST" ]] && PREV=$(plist_string "$PLIST" WorkingDirectory)
PREV="${PREV%/}"

log "目标：${REF} = ${SHA}"
log "新快照：${NEW}"
log "当前代理目录：${PREV:-（未知）}"
if [[ "$COMPONENT" = all ]]; then log "crontab reaper 行将改为：$(reaper_cron_line "$NEW")";
else log "组件 agent：仅更新代理；旧 reaper 与 cron 保持原样，不代表 reaper 已升级"; fi
log "plist：${PLIST}（令牌改为读 ${DEPLOY_TOKEN_FILE}，不再写进 plist）"
log "验活：${AGENT_URL}/api/brain/health 的 git_sha == ${SHA:0:12}…，磁盘样本 ${SAMPLE_MAX_AGE}s 内，stop/0 鉴权 200"

if [[ "$APPLY" != 1 ]]; then
  log "dry-run：以上为计划，未做任何改动。确认后加 --apply 执行"
  exit 0
fi

# ── 1. 加锁（防两次发布并发踩 plist/crontab）───────────────────────────────
mkdir -p "$RELEASES_DIR"
LOCK="$RELEASES_DIR/.release.lock"
mkdir "$LOCK" 2>/dev/null || die "另一次发布正在进行（${LOCK}），确认无人在跑后删掉该目录重试"
chmod 700 "$LOCK"
trap 'rm -f "$LOCK"/crontab.*; rmdir "$LOCK" 2>/dev/null || true' EXIT
[[ "$(cd "$SOURCE_REPO" && pwd -P)" != "$NEW" ]] || die "SOURCE_REPO 不能与目标快照相同"
# 返回 0=可读存在，3=官方明确无表，1=无法确认；错误不能降级为空表。
read_cron() {
  local output="$1" error="$2" rc user message
  if LC_ALL=C crontab -l > "$output" 2> "$error"; then return 0; else rc=$?; fi
  user=$(id -un) || return 1
  message=$(cat "$error")
  # Darwin 的程序名前缀与 Vixie/Cronie 的无前缀均逐字匹配当前用户。
  if [[ "$rc" = 1 && ! -s "$output" ]] &&
      [[ "$message" = "crontab: no crontab for $user" || "$message" = "no crontab for $user" ]]; then return 3; fi
  return 1
}
HAD_CRON=0
if read_cron "$LOCK/crontab.before" "$LOCK/crontab.before.err"; then HAD_CRON=1;
else cron_rc=$?; [[ "$cron_rc" = 3 ]] || die "cron 读取失败，无法确认原表；未安装且未调用写接口"; fi
verify_cron() {
  local present=0 rc
  if read_cron "$LOCK/crontab.after" "$LOCK/crontab.after.err"; then present=1;
  else rc=$?; [[ "$rc" = 3 ]] || return 1; fi
  [[ "$present" = "$HAD_CRON" ]] && cmp -s "$LOCK/crontab.before" "$LOCK/crontab.after"
}
# 全组件必须先证明官方写接口可用；agent 模式不调用任何 cron 写/恢复接口。
if [[ "$COMPONENT" = all ]]; then
  crontab - < "$LOCK/crontab.before" || die "cron 原字节写回权限预检失败，尚未安装或切换代理"
  if [[ "$HAD_CRON" = 0 ]]; then crontab -r || die "cron 空表恢复预检失败"; fi
  verify_cron || die "cron 权限预检后原字节未保全"
fi

# ── 2. 建快照 ───────────────────────────────────────────────────────────────
if [[ -f "$NEW/.release-sha" && "$(cat "$NEW/.release-sha")" == "$SHA" ]]; then
  log "快照已存在且完整，复用"
else
  [[ ! -e "$NEW" ]] || die "目标目录存在但不是完整快照，保留现场且拒绝覆盖：${NEW}"
  git clone -q --local --no-checkout "$SOURCE_REPO" "$NEW" || die "clone 失败"
  git -C "$NEW" remote set-url origin "$ORIGIN_URL"
  git -C "$NEW" -c advice.detachedHead=false checkout -q --detach "$SHA" || die "检出 ${SHA} 失败"
  log "装 Brain 运行依赖：npm ci ${NPM_CI_ARGS[*]}"
  (cd "$NEW" && npm ci "${NPM_CI_ARGS[@]}") || die "npm ci 失败（快照 ${NEW} 未启用，代理仍在旧目录）"
  echo "$SHA" > "$NEW/.release-sha"   # 最后写：有它才算完整快照
fi

# ── 3. 备份 → 换 plist / crontab ─────────────────────────────────────────────
BACKUP="$RELEASES_DIR/.backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP"; chmod 700 "$BACKUP"
HAD_PLIST=0
if [[ -f "$PLIST" ]]; then cp -p "$PLIST" "$BACKUP/agent.plist"; chmod 600 "$BACKUP/agent.plist"; HAD_PLIST=1; fi
cp -p "$LOCK/crontab.before" "$BACKUP/crontab.txt"
log "已备份 plist/crontab → ${BACKUP}"

# bootout 是异步的：等卸载完再 bootstrap，失败重试（见 lib/launchd-reload.sh）
# shellcheck source=lib/launchd-reload.sh
source "$SCRIPT_DIR/lib/launchd-reload.sh"
reload_agent() {
  local expected="$1" deadline=$(( $(date +%s) + VERIFY_TIMEOUT ))
  launchd_reload "$LABEL" "$PLIST" || return 1
  while [[ $(date +%s) -lt "$deadline" ]]; do
    preview_agent_owner "$LABEL" "$expected" "$AGENT_URL" >/dev/null && return 0
    sleep "$POLL_INTERVAL"
  done
  log "PID/监听/目录归属验收失败：${expected}"
  return 1
}
rollback() {
  log "⚠️ $1 —— 回滚到发布前的 plist 与 crontab"
  local restored=1
  if [[ "$HAD_PLIST" = 1 ]]; then
    cp -p "$BACKUP/agent.plist" "$PLIST"
    reload_agent "$PREV" || restored=0
  else
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    launchd_wait_gone "gui/$(id -u)/${LABEL}" || restored=0
    rm -f "$PLIST"
  fi
  if [[ "$COMPONENT" = all ]]; then
    if ! verify_cron; then
      if [[ "$HAD_CRON" = 1 ]]; then crontab - < "$BACKUP/crontab.txt"; else crontab -r; fi
    fi
  fi
  verify_cron || { log "⚠️ 原 cron 字节恢复验收失败"; exit 1; }
  [[ "$restored" = 1 ]] || { log "⚠️ 前驱 PID/监听/目录恢复验收失败，未声称回滚成功"; exit 1; }
  log "已回滚（代理目录：${PREV:-未知}），新快照 ${NEW} 保留待排查"
  exit 1
}

PREVIEW_AGENT_ROOT="$NEW" PREVIEW_RELEASES_DIR="$RELEASES_DIR" PREVIEW_AGENT_PLIST="$PLIST" \
  bash "$NEW/scripts/preview-agent-install.sh" --no-load >/dev/null || rollback "生成新 plist 失败"
reload_agent "$NEW" || rollback "launchctl 新实例 PID/监听/目录归属失败"

if [[ "$COMPONENT" = all ]]; then
  NEW_CRON="$BACKUP/crontab.new"
  render_crontab "$NEW" < "$BACKUP/crontab.txt" > "$NEW_CRON"
  crontab - < "$NEW_CRON" || rollback "写 crontab 失败"
  read_cron "$LOCK/crontab.after" "$LOCK/crontab.after.err" && cmp -s "$NEW_CRON" "$LOCK/crontab.after" || rollback "新 cron 字节读回失败"
else
  verify_cron || rollback "agent 发布期间旧 cron 字节发生变化"
fi
log "代理已重载，组件 ${COMPONENT} 开始验活（最多 ${VERIFY_TIMEOUT}s）"

# ── 4. 验活 ─────────────────────────────────────────────────────────────────
deadline=$(( $(date +%s) + VERIFY_TIMEOUT ))
got=""; sha_ok=0; sample_ok=0
while [[ $(date +%s) -lt $deadline ]]; do
  got=$(health_sha)
  [[ "$got" == "$SHA" ]] && sha_ok=1 || sha_ok=0
  [[ $(file_age "$NEW/.runtime/host-disk.json") -le $SAMPLE_MAX_AGE ]] && sample_ok=1 || sample_ok=0
  [[ "$sha_ok" = 1 && "$sample_ok" = 1 ]] && break
  sleep "$POLL_INTERVAL"
done
[[ "$sha_ok" = 1 ]] || rollback "health.git_sha=${got:-<无>}，不是目标 ${SHA}"
[[ "$sample_ok" = 1 ]] || rollback "新快照磁盘样本 ${NEW}/.runtime/host-disk.json 未在 ${SAMPLE_MAX_AGE}s 内刷新（准入会 sample_stale）"
probe=$(node "$NEW/scripts/preview-agent/deploy-token.mjs" probe "${AGENT_URL}/api/brain/preview/stop/0" 2>&1) \
  || rollback "凭据文件令牌鉴权失败（${probe}）——CI 的 DEPLOY_TOKEN 会 401"
preview_agent_owner "$LABEL" "$NEW" "$AGENT_URL" >/dev/null || rollback "最终 PID/监听/目录归属失败"
if [[ "$COMPONENT" = agent ]]; then verify_cron || rollback "最终旧 cron 字节未保全"; fi
log "✅ 验活通过：git_sha=${SHA:0:12}，磁盘样本新鲜，鉴权 ${probe}"

echo "$NEW" > "$RELEASES_DIR/.current"

# ── 5. 清理旧快照 ───────────────────────────────────────────────────────────
in_use() { # 仍有预览 worktree 挂在它的 .git 上，或预览依赖链接指进它 → 不删
  local d="$1" l
  grep -F "cd ${d} " "$BACKUP/crontab.txt" | grep -q 'scripts/preview-reaper.sh' && return 0
  [[ -n "$(ls -A "$d/.git/worktrees" 2>/dev/null)" ]] && return 0
  for l in "$PREVIEW_BASE_DIR"/preview-*/node_modules "$PREVIEW_BASE_DIR"/preview-*/packages/brain/node_modules; do
    [[ -L "$l" ]] || continue
    [[ "$(readlink "$l")" == "$d"/* ]] && return 0
  done
  return 1
}
if [[ "$COMPONENT" = all ]]; then
kept=2   # 当前 + 上一版
while IFS= read -r d; do
  d="${d%/}"
  [[ "$d" == "$NEW" || "$d" == "$PREV" ]] && continue
  if [[ $kept -lt $KEEP ]]; then kept=$((kept + 1)); continue; fi
  if in_use "$d"; then log "保留 ${d}（仍被预览环境引用）"; continue; fi
  rm -rf "$d" && log "已清理旧快照 ${d}"
done < <(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null)
ls -1dt "$RELEASES_DIR"/.backup-*/ 2>/dev/null | tail -n +6 | while IFS= read -r b; do rm -rf "$b"; done
fi  # agent 组件保留全部快照与备份，不扩大本次发布为清理作业

if [[ "$COMPONENT" = all ]]; then log "完成：代理与 reaper 已切到 ${NEW}（上一版 ${PREV:-无} 保留）";
else log "完成：仅代理切到 ${NEW}；旧 reaper 未升级且依赖锚保留（上一版 ${PREV:-无} 保留）"; fi
