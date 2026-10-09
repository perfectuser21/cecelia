#!/usr/bin/env bash
# openclaw-process-guard.sh — MMV OpenClaw 进程/内存守卫
#
# 2026-09-22 事故：MCP 运行时不回收。网关重启后 18 小时堆到 474 个进程、9.43GB，
# wired 7.4GB、swap 8.0G/9.2G，系统开始因内存压力直接杀后台任务。
#
# 根因不是"内存管理策略"，是 OpenClaw 的一条配置从没设过 —— schema 原文：
#   mcp.sessionIdleTtlMs: "Unset or 0 keeps runtimes alive until ... Gateway shutdown."
# 每个用到 MCP 的会话起的是一条四进程链：
#   gateway → service-child-group-anchor → service-child-relay.js → npm exec → mcp-server
# 设成 900000（15min）后 90 秒回收 408 进程 / 6.8GB，swap 8.0G→1.5G，无需重启网关。
#
# 于是本守卫的第一职责不是杀进程，而是**盯住那条配置别被改回去** ——
# 配置一旦被重写/回退，泄漏会静默复发，而现象（内存慢慢吃满）要几小时才看得出来。
#
# 六条职责，顺序即优先级：
#   ① 配置漂移闸：TTL 未设或为 0 → 报错退出（根治项）
#   ② 网关在不在：不在就出声，且**这时绝不收割** —— 网关可能正在重启，
#      收割会把刚起来的链一起带走
#   ③ 只收孤儿：顺 ppid 往上走，走不到任何活网关的才算孤儿
#   ④ 阈值告警：链上进程数越线出声，但**越线不等于授权杀活进程**
#   ⑤ 孤儿插件捕获目录回收 + 磁盘水位闸（0928 磁盘写满崩溃后补；代码里排在②之前）
#   ⑥ 网关内存兜底重启：RSS 超阈 + 无 agent 在跑 + 冷却期外 → launchctl kickstart
#
# ⚠️ 铁律：绝不碰活网关的子孙进程，更不碰网关本体。
#    janitor 就是把活着的网关当孤儿杀，导致迁移后 18 条业务 cron 成功率 0
#    （PR #5447/#5448 案卷）。同样的错不能在这里再犯一次。
#    唯一例外 = 职责⑥（决策 ae189458）：prepared-model-catalog worker 泄漏让网关涨到约 8GB，
#    上游修好前只有重启能还内存；且只在无 agent 在跑、冷却期外时经 launchd 正规重启，不 kill。
#
# 测试注入：OPG_PS_SNAPSHOT / OPG_TTL_VALUE / OPG_KILL_LOG / OPG_STATE_DIR
#           OPG_CHAIN_WARN_THRESHOLD
#           OPG_CAPTURE_ROOT / OPG_INUSE_PATHS / OPG_DISK_AVAIL_GB / OPG_DISK_MIN_GB
#           OPG_GATEWAY_RSS_KB / OPG_AGENT_RUNNING / OPG_RESTART_CMD / OPG_BRAIN_RUNS_DIR
set -uo pipefail

export PATH="${OPG_PATH:-/opt/homebrew/bin:/usr/local/bin}:$PATH"

LOG_PREFIX="[openclaw-process-guard]"
STATE_DIR="${OPG_STATE_DIR:-/tmp}"
# 健康工作集实测约 68（2026-09-22，TTL 生效后稳定值）；泄漏态 474。
# 取 200 ≈ 3 倍健康值：明显异常但还没到致命，留出处置窗口。
CHAIN_WARN_THRESHOLD="${OPG_CHAIN_WARN_THRESHOLD:-200}"
WEBHOOK_URL="${FEISHU_BOT_WEBHOOK:-}"

problems=0
note() { printf '%s %s\n' "$LOG_PREFIX" "$*"; }
fault() { printf '%s [FAULT] %s\n' "$LOG_PREFIX" "$*" >&2; problems=$((problems+1)); }

send_alert() {
  local msg="$1"
  [[ -z "$WEBHOOK_URL" ]] && { note "[WARN] FEISHU_BOT_WEBHOOK 未设，跳过告警推送"; return 0; }
  curl -s -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" \
    -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$msg\"}}" --max-time 10 >/dev/null \
    || note "[WARN] 告警推送失败"
}

# ── 取进程快照 ──────────────────────────────────────────────────────────
# 格式固定为 "pid ppid 命令…"。测试用 OPG_PS_SNAPSHOT 注入，生产读真 ps。
read_ps() {
  if [[ -n "${OPG_PS_SNAPSHOT:-}" && -f "${OPG_PS_SNAPSHOT}" ]]; then
    cat "$OPG_PS_SNAPSHOT"
  else
    ps -axo pid=,ppid=,args=
  fi
}

# ── 取 TTL 配置值 ───────────────────────────────────────────────────────
# `openclaw config get` 在未设时会输出一段说明文字而不是数字，所以这里只认纯数字，
# 其余（含空、说明文字、报错）一律当"未设"处理 —— 宁可误报也不放过静默复发。
read_ttl() {
  if [[ -n "${OPG_TTL_VALUE+x}" ]]; then printf '%s' "$OPG_TTL_VALUE"; return; fi
  local raw
  raw="$(openclaw config get mcp.sessionIdleTtlMs 2>/dev/null | head -1 | tr -d '[:space:]')"
  [[ "$raw" =~ ^[0-9]+$ ]] && printf '%s' "$raw" || printf ''
}

do_kill() {
  local pid="$1"
  if [[ -n "${OPG_KILL_LOG:-}" ]]; then echo "$pid" >> "$OPG_KILL_LOG"; return 0; fi
  kill -TERM "$pid" 2>/dev/null || true
}

SNAPSHOT="$(read_ps)"

# ── ① 配置漂移闸（根治项，排第一）───────────────────────────────────────
TTL="$(read_ttl)"
if [[ ! "$TTL" =~ ^[0-9]+$ ]] || [[ "$TTL" -eq 0 ]]; then
  fault "配置漂移：mcp.sessionIdleTtlMs 当前为 '${TTL:-<未设>}'。" \
        "OpenClaw 语义是「未设或 0 = MCP 运行时活到网关关闭为止」，" \
        "泄漏会静默复发（0922 实测 18 小时堆 474 进程 / 9.43GB）。" \
        "修：openclaw config set mcp.sessionIdleTtlMs 900000"
  send_alert "[MMV 守卫] mcp.sessionIdleTtlMs 漂移为 '${TTL:-未设}'，MCP 运行时将不再回收"
else
  note "配置闸通过：mcp.sessionIdleTtlMs=${TTL}ms"
fi

# ── ⑤ 孤儿插件捕获目录回收 + 磁盘水位闸 ────────────────────────────────
# 2026-09-28 22:59 事故：网关每代模型目录把 codex 插件（~294MB，含 codex 二进制）拷进
# ~/.openclaw/tmp/openclaw-model-catalog-* / openclaw-plugin-build-*。旧网关实例被杀后
# 这些 legacy 根目录无人认领（新版运行时不回收；doctor --fix 还要求先停网关），
# 5 天攒到 14GB 写满磁盘 → codex 插件加载 ENOSPC → 网关运行时异常退出。
#
# 排在「网关在不在」之前：网关多半正是被写满的盘拖死的，这时不腾盘它永远起不来。
# 删除只认三条同时成立：legacy 根目录名 + 超龄（默认 6h）+ 没有任何进程打开其中文件。
# 新版 plugin-captures/<uuid> 带所有权令牌，归网关自己回收，不碰。
CAPTURE_ROOT="${OPG_CAPTURE_ROOT:-$HOME/.openclaw/tmp}"
CAPTURE_MIN_AGE_MIN="${OPG_CAPTURE_MIN_AGE_MIN:-360}"
DISK_MIN_GB="${OPG_DISK_MIN_GB:-10}"

read_inuse_paths() {
  if [[ -n "${OPG_INUSE_PATHS:-}" ]]; then cat "$OPG_INUSE_PATHS" 2>/dev/null; return; fi
  lsof -nP -Fn -c node -c codex -c openclaw 2>/dev/null | sed -n 's/^n//p'
}

if [[ -d "$CAPTURE_ROOT" ]]; then
  INUSE="$(read_inuse_paths)"
  reaped=0
  while IFS= read -r dir; do
    [[ -z "$dir" ]] && continue
    if printf '%s\n' "$INUSE" | grep -qF -- "$dir/"; then
      note "捕获目录仍被进程占用，保留：$dir"
      continue
    fi
    chmod -R u+w "$dir" 2>/dev/null
    if rm -rf "$dir" 2>/dev/null && [[ ! -e "$dir" ]]; then
      reaped=$((reaped+1))
    else
      fault "孤儿捕获目录删除失败：$dir"
    fi
  done < <(find "$CAPTURE_ROOT" -mindepth 1 -maxdepth 1 -type d \
             \( -name 'openclaw-model-catalog-*' -o -name 'openclaw-plugin-build-*' -o -name 'openclaw-cli-mcp-*' \) \
             -mmin +"$CAPTURE_MIN_AGE_MIN" 2>/dev/null)
  note "回收孤儿捕获目录 ${reaped} 个"
fi

DISK_AVAIL_GB="${OPG_DISK_AVAIL_GB:-$(df -g "$HOME" 2>/dev/null | awk 'NR==2 {print $4}')}"
if [[ "$DISK_AVAIL_GB" =~ ^[0-9]+$ ]] && [[ "$DISK_AVAIL_GB" -lt "$DISK_MIN_GB" ]]; then
  fault "磁盘可用 ${DISK_AVAIL_GB}GB，低于 ${DISK_MIN_GB}GB 水位。" \
        "网关每代模型目录要拷 ~300MB 插件，写满即 ENOSPC 崩溃（0928 22:59 实测）。" \
        "先 du -sh ~/.openclaw/tmp ~/.openclaw/agents ~/worktrees 找大头。"
  send_alert "[MMV 守卫] 磁盘可用仅 ${DISK_AVAIL_GB}GB（<${DISK_MIN_GB}GB），OpenClaw 网关有 ENOSPC 崩溃风险"
else
  note "磁盘可用 ${DISK_AVAIL_GB:-?}GB"
fi

# ── 找网关与进程链 ──────────────────────────────────────────────────────
GATEWAY_PIDS="$(printf '%s\n' "$SNAPSHOT" | awk '/openclaw\/dist\/index\.js[[:space:]]+gateway/ {print $1}')"
# 进程链成员：supervisor 脚手架 + MCP 服务器本体
CHAIN_LINES="$(printf '%s\n' "$SNAPSHOT" \
  | grep -E 'service-child-(group-anchor|relay)|mcp-server' || true)"
CHAIN_COUNT="$(printf '%s' "$CHAIN_LINES" | grep -c . || true)"

# ── ② 网关在不在 ────────────────────────────────────────────────────────
if [[ -z "$GATEWAY_PIDS" ]]; then
  fault "网关不在进程表里（链上仍有 ${CHAIN_COUNT} 个进程）。" \
        "本轮**不做任何收割** —— 网关可能正在重启，此时收割会把刚起来的链一起带走。"
  printf '结果: 问题 %d 项\n' "$problems"
  exit 1
fi
note "网关在：pid $(printf '%s' "$GATEWAY_PIDS" | tr '\n' ' ')"

# ── ③ 只收孤儿 ──────────────────────────────────────────────────────────
# 孤儿的唯一判据：**爹真没了**。跟爹是谁无关。
#
# 第一版我写成了「祖先里必须有 OpenClaw 网关，否则算孤儿」，真实数据当场打脸：
# 24 个 MCP 的爹是 pid 70740 —— 活着的 codex app-server。MCP 运行时完全可以
# 合法挂在 codex / npm 等非网关的活进程底下，按那个判据会被全部误杀，
# 与 janitor 把活网关当孤儿杀是同一个错，只是换了件衣服。
#
# 现在只认两种情况：
#   - ppid 不在进程表里  → 爹已退出，内核还没来得及改 ppid，或已被回收
#   - ppid 是 1 / 0      → 爹死了，被 launchd 收养
# 爹只要还活着（不管是网关、codex、npm 还是别的），一律不碰。
declare -a ORPHANS=()
is_orphan() {
  local ppid="$1"
  [[ -z "$ppid" || "$ppid" == "1" || "$ppid" == "0" ]] && return 0
  printf '%s\n' "$SNAPSHOT" | awk -v p="$ppid" '$1==p {found=1} END {exit !found}' && return 1
  return 0
}

while read -r pid ppid; do
  [[ -z "$pid" ]] && continue
  if is_orphan "$ppid"; then ORPHANS+=("$pid"); fi
done < <(printf '%s\n' "$CHAIN_LINES" | awk 'NF {print $1, $2}')

if [[ "${#ORPHANS[@]}" -gt 0 ]]; then
  note "回收孤儿链 ${#ORPHANS[@]} 个：${ORPHANS[*]}"
  for p in "${ORPHANS[@]}"; do do_kill "$p"; done
else
  note "无孤儿链"
fi

# ── ④ 阈值告警（越线只出声，不授权杀活进程）────────────────────────────
if [[ "$CHAIN_COUNT" -gt "$CHAIN_WARN_THRESHOLD" ]]; then
  fault "链上进程数 ${CHAIN_COUNT} 超过阈值 ${CHAIN_WARN_THRESHOLD}" \
        "（健康工作集实测约 68，泄漏态 474）。" \
        "先查 mcp.sessionIdleTtlMs 是否生效，再看是否有别的常驻子进程在泄漏。" \
        "**本守卫不会去杀活网关的子进程** —— 那是 janitor 犯过的错。"
  send_alert "[MMV 守卫] OpenClaw 链上进程 ${CHAIN_COUNT} 个，超阈值 ${CHAIN_WARN_THRESHOLD}"
else
  note "链上进程 ${CHAIN_COUNT} 个，在阈值 ${CHAIN_WARN_THRESHOLD} 内"
fi

# ── ⑥ 网关内存兜底重启（决策 ae189458，Brain 任务 7902b997）──────────────
# 2026-09-29：网关的 prepared-model-catalog worker 每代模型目录都复制插件源码并重新
# 作为 ES 模块加载、不卸载；每次 `openclaw models auth paste-token` 触发一代，单线程涨到
# 约 8GB。上游修好前只有重启能把内存还回来。但重启会打断在跑的 agent，所以三条同时成立才做：
#   RSS 超阈（默认 5GB）+ 没有 agent 在跑 + 距上次自动重启超过冷却期（默认 60min）
# 走 launchd 正规重启（kickstart -k），不直接 kill。
GATEWAY_LABEL="ai.openclaw.gateway"
RSS_RESTART_GB="${OPG_GATEWAY_RSS_RESTART_GB:-5}"
RESTART_COOLDOWN_MIN="${OPG_GATEWAY_RESTART_COOLDOWN_MIN:-60}"
BRAIN_RUNS_DIR="${OPG_BRAIN_RUNS_DIR:-$HOME/brain-runs}"
RESTART_STATE="$STATE_DIR/openclaw-gateway-last-restart"
RESTART_TARGET="gui/$(id -u)/${GATEWAY_LABEL}"

read_gateway_rss_kb() {
  if [[ -n "${OPG_GATEWAY_RSS_KB:-}" ]]; then printf '%s' "$OPG_GATEWAY_RSS_KB"; return; fi
  local pid
  pid="$(launchctl list "$GATEWAY_LABEL" 2>/dev/null | awk -F'= ' '/"PID"/ {gsub(/[; ]/, "", $2); print $2}')"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  ps -o rss= -p "$pid" 2>/dev/null | tr -d '[:space:]'
}

# 在跑的判据（任一成立即在跑）：
#   - 进程表里有 `openclaw agent` 进程
#   - ~/brain-runs 下有「有 .pid 无 .exit」的运行，且该 pid 还活着
#     （进程被杀的运行不会写 .exit，只认 .pid 的话一条残留就让兜底永久失效）
agent_running() {
  if [[ -n "${OPG_AGENT_RUNNING:-}" ]]; then [[ "$OPG_AGENT_RUNNING" == "1" ]]; return; fi
  printf '%s\n' "$SNAPSHOT" | grep -qE 'openclaw[^[:space:]]*[[:space:]]+agent([[:space:]]|$)' && return 0
  local f pid
  for f in "$BRAIN_RUNS_DIR"/*.pid; do
    [[ -f "$f" && ! -f "${f%.pid}.exit" ]] || continue
    pid="$(tr -d '[:space:]' < "$f" 2>/dev/null)"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && return 0
  done
  return 1
}

do_restart() {
  if [[ -n "${OPG_RESTART_CMD:-}" ]]; then "$OPG_RESTART_CMD" "$RESTART_TARGET"; return; fi
  launchctl kickstart -k "$RESTART_TARGET"
}

RSS_KB="$(read_gateway_rss_kb)"
if [[ ! "$RSS_KB" =~ ^[0-9]+$ ]]; then
  note "[WARN] 读不到网关（${GATEWAY_LABEL}）RSS，本轮跳过内存兜底"
else
  RSS_GB="$(awk -v k="$RSS_KB" 'BEGIN {printf "%.1f", k/1048576}')"
  LIMIT_KB="$(awk -v g="$RSS_RESTART_GB" 'BEGIN {printf "%d", g*1048576}')"
  if [[ "$RSS_KB" -le "$LIMIT_KB" ]]; then
    note "网关 RSS ${RSS_GB}GB，在重启阈值 ${RSS_RESTART_GB}GB 内"
  elif agent_running; then
    note "网关 RSS ${RSS_GB}GB 超阈 ${RSS_RESTART_GB}GB，但有任务在跑，暂缓重启"
  else
    NOW="$(date +%s)"
    LAST="$(cat "$RESTART_STATE" 2>/dev/null | tr -d '[:space:]')"
    [[ "$LAST" =~ ^[0-9]+$ ]] || LAST=0
    if (( NOW - LAST < RESTART_COOLDOWN_MIN * 60 )); then
      note "[WARN] 网关 RSS ${RSS_GB}GB 超阈，但距上次自动重启不足 ${RESTART_COOLDOWN_MIN} 分钟，冷却期内不重启"
    elif do_restart; then
      printf '%s\n' "$NOW" > "$RESTART_STATE"
      note "网关 RSS ${RSS_GB}GB 超阈 ${RSS_RESTART_GB}GB 且无任务在跑 → 已 kickstart ${RESTART_TARGET}"
      send_alert "[MMV 守卫] OpenClaw 网关 RSS ${RSS_GB}GB 超阈 ${RSS_RESTART_GB}GB 且空闲，已自动重启（冷却 ${RESTART_COOLDOWN_MIN}min）"
    else
      fault "网关 RSS ${RSS_GB}GB 超阈且空闲，但 kickstart ${RESTART_TARGET} 失败"
      send_alert "[MMV 守卫] OpenClaw 网关 RSS ${RSS_GB}GB 超阈，自动重启失败"
    fi
  fi
fi

printf '结果: 问题 %d 项\n' "$problems"
[[ "$problems" -eq 0 ]]
