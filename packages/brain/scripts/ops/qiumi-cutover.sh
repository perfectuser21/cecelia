#!/usr/bin/env bash
# qiumi-cutover.sh — 秋米任务从「us-vps cron 旧脚本」切到「Brain 统一调度 + Jev 路由」（PR3 Task 6）。
#
# 四步，幂等，每步可单跑 --step=N：
#   1 注释掉 us-vps crontab 里的 notion-qiumi-delegate.py 行（旧派发器退役），
#     并在停下那一刻取 SINCE 落盘到 $CUTOVER_STATE_DIR/since
#   2 循环 qiumi-inflight-check.mjs 等旧脚本在途清零（最长 30 分钟，超时退 3）
#   3 在 us-vps 的 Brain env 文件写开关：QIUMI_SYNC_ENABLED / QIUMI_DISPATCH_ENABLED /
#     QIUMI_SYNC_SINCE（只读 step1 落盘那个值，缺文件退 7）
#   4 库操作：存量秋米任务解闸（去掉 payload.headed_manual，覆盖 queued/blocked/paused）+ 排程台账改写
#
# 回滚（只认单步，不能配 STEP=all）：
#   --step=3 --rollback  关掉 QIUMI_SYNC_ENABLED / QIUMI_DISPATCH_ENABLED（不验前置闸）
#   --step=4 --rollback  存量任务重新上闸（headed_manual=true）
# 顺序：先关开关 → 重建容器 → 重新上闸 → 最后才复活旧 cron。
# 反过来先复活 cron，那段时间两边都活着，会在同一台真机上双跑。
#
# 为什么必须是这个顺序（PR2 终审：并存期防双认领没有别的防线）：
# Notion 侧没有条件写，谁先看到委派行谁就认领。并存期真正挡住双认领的只有「开关默认关 +
# SINCE 缺失 fail-closed」这一条——一旦 us-vps 的 */3 cron 与 Brain 同步循环同时开着，
# SINCE 之后新建的行两边都能认领，谁也挡不住。
# 所以 step1（停旧 cron）+ step2（等在途清零）必须先于 step3（开 QIUMI_SYNC_ENABLED）完成。
# 影子跑也一样：影子跑是「只同步不派发」，不是「新旧并跑」，开同步之前旧 cron 必须已经停。
# 这条不靠人记得住——step3 会先回 us-vps 验一遍旧 cron 真的退役了，没退役就退 6。
# 第 3 步只写文件，容器重建是人工动作（learning cp-0916213853：改 env 不重建等于没改）。
# 第 4 步碰库：库名不是 _test/_scratch 结尾时必须显式 --confirm-prod，否则退 4。
#
# 完整操作流程（含影子跑与回滚）见 docs/runbooks/qiumi-cutover.md。
set -euo pipefail

STEP="${STEP:-all}"
CONFIRM_PROD=0
ROLLBACK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --step=*) STEP="${1#--step=}" ;;
    --step) STEP="${2:?--step 需要参数}"; shift ;;
    --confirm-prod) CONFIRM_PROD=1 ;;
    --rollback) ROLLBACK=1 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) printf '未知参数: %s\n' "$1" >&2; exit 64 ;;
  esac
  shift
done

# 回滚只有两步，只认 --step=3 / --step=4。
# 配 step1/step2 是自相矛盾的组合（那是正向动作：停 cron、等清零），
# 配 STEP=all 更糟——会把正向四步连着跑一遍。都在这里挡掉，别让它跑进去才发现。
if [[ $ROLLBACK -eq 1 && "$STEP" != "3" && "$STEP" != "4" ]]; then
  # 格式串以 `--` 开头会被 printf 当成选项，必须走 '%s\n'
  printf '%s\n' '--rollback 必须指定步骤：--step=3 --rollback（关开关）或 --step=4 --rollback（存量重新上闸）' >&2
  exit 64
fi

: "${BRAIN_ENV_FILE:=/opt/cecelia/.env}"
: "${US_VPS:=us-vps}"
: "${CUTOVER_STATE_DIR:=${HOME}/.cache/qiumi-cutover}"
SINCE_FILE="${CUTOVER_STATE_DIR}/since"
# step2 清零时留的凭据：step3 的退 6 闸靠它确认「在途真的清过零」，
# 光验 cron 停了挡不住「跑了 step1、跳过 step2 直接 step3」这种走法。
CLEARED_FILE="${CUTOVER_STATE_DIR}/inflight_cleared_at"
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { printf '[cutover %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
run_step() { [[ "$STEP" == "all" || "$STEP" == "$1" ]]; }
ssh_vps() { ssh -o BatchMode=yes "$US_VPS" "$@"; }

# 远端 env 写入两式：覆盖写给布尔开关，保持写给 SINCE。
# 改完顺手删 sed 留下的 .bak——env 里是全套凭据，备份不该长期躺在生产机上。
set_remote_env() {
  local kv="$1" k="${1%%=*}"
  ssh_vps "set -e; F='${BRAIN_ENV_FILE}'; \
    if grep -q '^${k}=' \"\$F\"; then sed -i.bak 's#^${k}=.*#${kv}#' \"\$F\"; rm -f \"\$F.bak\"; \
    else printf '%s\n' '${kv}' >> \"\$F\"; fi; \
    grep -n '^${k}=' \"\$F\""
}
# 前两步的校验提成函数：step3 开闸要过，step4 摘存量闸同样要过。
# 单跑 --step=4 不验的话，旧 cron 还活着时闸就被摘了，两边一起派真机。
require_cron_retired() {
  if ssh_vps 'crontab -l 2>/dev/null | grep -qE "^[^#]*notion-qiumi-delegate\.py"'; then
    log "拒绝：${US_VPS} 上旧 cron 仍在运行，必须先跑 --step=1 与 --step=2"
    exit 6
  fi
}
require_inflight_cleared() {
  if [[ ! -s "$CLEARED_FILE" ]]; then
    log "拒绝：找不到清零凭据 inflight_cleared_at（${CLEARED_FILE}），请先跑 --step=2 等在途清零"
    exit 6
  fi
  log "  在途清零凭据：$(cat "$CLEARED_FILE")"
}

# 只在缺失时写，远端已有值一律不动：SINCE 往后推会漏行，往前调会重复入账。
set_remote_env_keep() {
  local kv="$1" k="${1%%=*}"
  ssh_vps "set -e; F='${BRAIN_ENV_FILE}'; \
    if grep -q '^${k}=' \"\$F\"; then echo \"  ${k} 已存在，保持不动\"; \
    else printf '%s\n' '${kv}' >> \"\$F\"; fi; \
    grep -n '^${k}=' \"\$F\""
}

# ── 前置校验：在动任何东西之前把缺件全报出来，别切到一半才发现 psql 不在 ──
command -v ssh >/dev/null || { log "缺 ssh"; exit 1; }
if run_step 2; then command -v node >/dev/null || { log "缺 node（step2 需要）"; exit 1; }; fi
if run_step 4; then
  command -v psql >/dev/null || { log "缺 psql（step4 需要）"; exit 1; }
  : "${DATABASE_URL:?step4 需要 DATABASE_URL}"
  DB_NAME="$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(decodeURIComponent(u.pathname.slice(1)))' "$DATABASE_URL")"
  # 生产确认闸：只有 _test/_scratch 结尾的库可以裸跑；其余必须主理人显式 --confirm-prod。
  if [[ ! "$DB_NAME" =~ (_test|_scratch)$ && $CONFIRM_PROD -ne 1 ]]; then
    log "拒绝：目标库 ${DB_NAME} 非测试库，需显式 --confirm-prod"
    exit 4
  fi
fi

# ── step 1：旧 cron 退役 ──
if run_step 1; then
  log "step1 注释 us-vps 旧 cron（notion-qiumi-delegate.py）"
  # crontab -l 在「没有 crontab」时退非零：不先探一下就直接 `crontab -l | … | crontab -`，
  # 会把一个空 crontab 装上去，等于顺手清空了 us-vps 的全部定时任务。
  if ! ssh_vps 'crontab -l >/dev/null 2>&1'; then
    log "  ${US_VPS} 没有 crontab，跳过"
  else
    # 只给「行首不是 # 的」加前缀 → 重复跑不会叠第二层注释。
    # 先把 crontab 收进变量并检查退出码，再喂给管道：`crontab -l` 在管道里失败时
    # 状态会被吞掉，后半截照样把空内容装进 crontab。
    ssh_vps 'T="$(crontab -l)" || exit 1; printf "%s\n" "$T" | sed -E "/^[^#]*notion-qiumi-delegate\.py/ s|^|#[retired-qiumi-cutover] |" | crontab -'
    log "  当前 crontab 中相关行："
    ssh_vps 'crontab -l | grep -n "notion-qiumi-delegate.py" || echo "  （无匹配行）"'
    # 还剩没被注释的行 = 这一步没成，后面不能继续。
    if ssh_vps 'crontab -l | grep -qE "^[^#]*notion-qiumi-delegate\.py"'; then
      log "仍有未注释的旧 cron 行，停止"
      exit 5
    fi
  fi

  # SINCE 必须取「旧 cron 停下这一刻」，而不是 step3 写 env 那一刻。
  # 两者之间还要等在途清零（最长 30min），这段时间里新建的委派行旧脚本已经不管了，
  # 若 SINCE 取 step3 的时刻，Brain 侧的 created_time on_or_after 又会把它们挡掉——两边都不收。
  # 落盘到本机状态文件，step3 只读不算；已存在就保持不动（重跑 step1 不该把 SINCE 推后）。
  mkdir -p "$CUTOVER_STATE_DIR"
  if [[ -s "$SINCE_FILE" ]]; then
    log "  SINCE 已存在，保持不动：$(cat "$SINCE_FILE")"
  else
    date -u +%FT%TZ > "$SINCE_FILE"
    log "  SINCE 取值并落盘 ${SINCE_FILE}：$(cat "$SINCE_FILE")"
  fi
  # 取到就当场写进远端 .env，本机文件只是副本：中间还隔着等在途（最长 30min）和重建容器，
  # 值留在本机越久越容易被「重跑一下 step3」这类操作冲掉。同步开关此刻仍是关的，写早了不会启动同步。
  set_remote_env_keep "QIUMI_SYNC_SINCE=$(cat "$SINCE_FILE")"
fi

# ── step 2：等旧脚本在途清零 ──
if run_step 2; then
  log "step2 等旧脚本在途清零（每 30s 一次，最长 30min）"
  for i in $(seq 1 60); do
    # 退出码要原样取到，所以不能把 node 放进 if 的条件位（那样 $? 取到的是 if 的结果）。
    set +e
    node "${HERE}/qiumi-inflight-check.mjs"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      log "  在途已清零（第 ${i} 次检查）"
      # 留凭据：step3 的退 6 闸拿它确认这一步真跑过，不然跳过 step2 直接开闸也没人拦。
      mkdir -p "$CUTOVER_STATE_DIR"
      date -u +%FT%TZ > "$CLEARED_FILE"
      log "  清零凭据 inflight_cleared_at 已落盘：$(cat "$CLEARED_FILE")"
      break
    fi
    # 退 2 = 还有在途，继续等；其它非零码 = 检查本身坏了，立刻停（查不到 ≠ 清零）。
    if [[ $rc -ne 2 ]]; then log "在途检查异常退出（rc=${rc}），停止"; exit "$rc"; fi
    if [[ $i -eq 60 ]]; then log "等待 30min 仍有在途，退出 3"; exit 3; fi
    sleep 30
  done
fi

# ── step 3：打开 Brain 侧开关 ──
if run_step 3; then
  if [[ $ROLLBACK -eq 1 ]]; then
    # 回滚：只关不开。前置校验一概不验——那几道闸是防「开早了」的，
    # 拿它们挡住关闸的人，等于把系统锁在开着的状态里。
    log "step3 --rollback：关掉 Brain 侧两个开关（${US_VPS}:${BRAIN_ENV_FILE}）"
    set_remote_env "QIUMI_SYNC_ENABLED=false"
    set_remote_env "QIUMI_DISPATCH_ENABLED=false"
    log "  已关闭。必须重建 Brain 容器才生效（cp-0916213853），重建完再跑 --step=4 --rollback"
  else
    # 顺序闸（机械化，不靠人记）：旧 cron 还活着就不准开同步开关——两边同时开 = 双认领，
    # 而 Notion 侧没有条件写能兜底。--step=3 单跑时这道闸尤其重要（跳过 step1 直接开闸是最容易犯的错）。
    require_cron_retired
    # 光验 cron 停了还不够：跑了 step1、跳过 step2 直接来这里，旧脚本手上那批活还在跑，
    # 开关却已经开了。step2 清零时留的 inflight_cleared_at 就是这一步的入场券。
    require_inflight_cleared
    log "step3 写开关到 ${US_VPS}:${BRAIN_ENV_FILE}（旧 cron 已确认退役）"
    # SINCE 只读 step1 落盘的那个值，本步一秒钟都不重新取——重新取就等于把起点推后，
    # step1 到这里之间新建的委派行会被两边一起漏掉。
    if [[ ! -s "$SINCE_FILE" ]]; then
      log "拒绝：找不到 ${SINCE_FILE}，SINCE 必须在 step1 停 cron 那一刻取。请先跑 --step=1"
      exit 7
    fi
    SINCE="$(cat "$SINCE_FILE")"
    log "  SINCE（step1 停 cron 那一刻）= ${SINCE}"
    # SINCE 在 step1 就已经写进远端 .env 了，这里只是兜底保持（远端已有值不动）。
    set_remote_env "QIUMI_SYNC_ENABLED=true"
    set_remote_env "QIUMI_DISPATCH_ENABLED=true"
    set_remote_env_keep "QIUMI_SYNC_SINCE=${SINCE}"
    log "  已写入。env 改了必须重建 Brain 容器才生效（cp-0916213853），重建完再跑 step4"
  fi
fi

# ── step 4：库侧解闸 + 台账 ──
if run_step 4; then
  if [[ $ROLLBACK -eq 1 ]]; then
    # 回滚的另一半：step4 正向把存量行的 headed_manual 永久摘掉了，
    # 光关开关不够——容器重建前后那段时间，Brain 照样会派这些没闸的活，
    # 跟复活的旧 cron 撞在同一台真机上。这里把它们重新上闸。
    # 范围与正向一致（queued/blocked/paused），且只补没闸的行，已有 true 的不动。
    log "step4 --rollback：存量任务重新上闸（库=${DB_NAME}）"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
      "UPDATE tasks SET payload = COALESCE(payload,'{}'::jsonb) || '{\"headed_manual\":true}'::jsonb, updated_at = NOW() WHERE task_type='qiumi_task' AND status IN ('queued','blocked','paused') AND COALESCE(payload->>'headed_manual','false') <> 'true';"
    log "  现存未上闸的秋米任务（应为 0）："
    psql "$DATABASE_URL" -q -c \
      "SELECT count(*) AS unlocked FROM tasks WHERE task_type='qiumi_task' AND status IN ('queued','blocked','paused') AND COALESCE(payload->>'headed_manual','false') <> 'true';"
    log "done（step=${STEP} rollback）"
    exit 0
  fi
  # 正向 step4 同样要过前两步的校验：旧 cron 还活着时摘闸 = 两边一起派真机。
  require_cron_retired
  require_inflight_cleared
  log "step4 存量任务解闸 + 排程台账（库=${DB_NAME}）"
  # 范围不能只认 queued：切换当下被三振 blocked、或被急停 paused 的行，
  # 日后回到 queued 时闸还在身上，就永远选不中了。
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "UPDATE tasks SET payload = payload - 'headed_manual', updated_at = NOW() WHERE task_type='qiumi_task' AND status IN ('queued','blocked','paused');"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "UPDATE ops_schedule_entries SET active=FALSE, updated_at=NOW() WHERE label ILIKE '%notion-qiumi-delegate%';"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO ops_schedule_entries (source, host_alias, label, kind, schedule_desc, active) VALUES ('brain','us-vps','qiumi-router+openclaw-agent-reaper','brain_recurring','tick 2min 派发 / reaper 60s',TRUE) ON CONFLICT (source, host_alias, label) DO UPDATE SET active=TRUE, updated_at=NOW();"
  log "  台账现状："
  psql "$DATABASE_URL" -q -c \
    "SELECT label, active FROM ops_schedule_entries WHERE label ILIKE '%qiumi%' ORDER BY label;"
fi

log "done（step=${STEP}）"
