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
# 四条职责，顺序即优先级：
#   ① 配置漂移闸：TTL 未设或为 0 → 报错退出（根治项）
#   ② 网关在不在：不在就出声，且**这时绝不收割** —— 网关可能正在重启，
#      收割会把刚起来的链一起带走
#   ③ 只收孤儿：顺 ppid 往上走，走不到任何活网关的才算孤儿
#   ④ 阈值告警：链上进程数越线出声，但**越线不等于授权杀活进程**
#
# ⚠️ 铁律：绝不碰活网关的子孙进程，更不碰网关本体。
#    janitor 就是把活着的网关当孤儿杀，导致迁移后 18 条业务 cron 成功率 0
#    （PR #5447/#5448 案卷）。同样的错不能在这里再犯一次。
#
# 测试注入：OPG_PS_SNAPSHOT / OPG_TTL_VALUE / OPG_KILL_LOG / OPG_STATE_DIR
#           OPG_CHAIN_WARN_THRESHOLD
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

printf '结果: 问题 %d 项\n' "$problems"
[[ "$problems" -eq 0 ]]
