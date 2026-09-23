#!/usr/bin/env bash
# openclaw-xai-token-sync.sh — 把 grok CLI 的登录态同步给 OpenClaw 的每个 agent
#
# ── 为什么需要它（2026-09-22 实证）────────────────────────────────────────
# `openclaw agent --model xai/grok-4.5` 长期 HTTP 403，而 grok CLI 本身好好的
# （真跑有结果，auth_mode=oidc，会自己续期）。两件事叠出来的：
#
#   ① OpenClaw 的 xai 插件**不注册任何登录方式** —— `models auth login` 与
#      `models auth setup-token` 都回 "No provider plugins found"。
#      唯一通路是 `models auth paste-token`，贴一份**静态** token。
#   ② ~/.grok/auth.json 里的 key 是 OIDC JWT，实测**约 6 小时到期**，CLI 会自己
#      换新的，而贴进 OpenClaw 的那份快照不会跟着换 → 每隔几小时必然 403。
#      （记忆里 0919 那条「Grok key 过期待人工续」就是这个，人工续一次只管几小时。）
#
# 还有第三件事：**凭据是 per-agent 的**。每次 paste 都会给该 agent 建一份私库，
# 没有"全局写入口"。实证：贴给 dev 之后 dev 通、infra 仍 403；贴给 infra 之后
# infra 通、main 仍 403（main 私库里存着旧 token，盖住一切）。所以必须逐个 agent 贴。
#
# 于是本脚本 = 逐个 agent 贴 + 定时跑。装成 launchd 每小时一次即可长期有效。
#
# ⚠️ 不打印 token。任何失败都出声，绝不静默跳过 —— 静默跳过的结果就是几小时后
#    grok 又 403 而没人知道为什么。
set -uo pipefail

# grok 装在 ~/.grok/bin，**不在** /opt/homebrew/bin —— 2026-09-23 生产打脸：
# 漏了这一段，launchd 下续期那步恒报 `timeout: failed to run command 'grok'`，
# 而日志只显示「续期调用失败 —— CLI 可能需要重新登录」，把 PATH 问题误导成人工活。
# 同一天 session-runner-router 也栽在 launchd PATH 上，是同一类问题：
# **自动化脚本在 launchd 下的 PATH 和人的 shell 不是一回事，必须显式声明。**
export PATH="${XAI_SYNC_PATH:-$HOME/.grok/bin:/opt/homebrew/bin:/usr/local/bin}:$PATH"

GROK_AUTH="${GROK_AUTH_FILE:-$HOME/.grok/auth.json}"
# agent 名单以**配置**为准，不扫目录。0922 实测：~/.openclaw/agents 下有 26 个目录，
# 而 agents.entries 只有 23 个 —— 多出的 affine-jinnuo/affine-yuesheng/openclaw
# 是遗留目录，paste-token 对它们必然失败。扫目录会两头错：对废目录报假警，
# 又会漏掉"已配置但还没建目录"的新 agent。
# ~/.openclaw 下有两份配置，务必读对：
#   openclaw.json  —— **真身**，`openclaw config set` 写的是它
#   clawdbot.json  —— 旧名，可能停在很久以前（2026-09-23 实测：它 23 个 agent，
#                     真身 24 个，多出来的 newmedia 永远同步不到 token）
# 读错的后果最坏：漏掉的 agent 不在分母里，日志照样显示「23/23 成功」全绿。
OPENCLAW_CONFIG="${OPENCLAW_CONFIG_FILE:-}"
if [ -z "$OPENCLAW_CONFIG" ]; then
  for c in "$HOME/.openclaw/openclaw.json" "$HOME/.openclaw/clawdbot.json"; do
    [ -f "$c" ] && { OPENCLAW_CONFIG="$c"; break; }
  done
fi
AGENTS_DIR="${OPENCLAW_AGENTS_DIR:-}"
PROFILE_ID="${XAI_PROFILE_ID:-xai:manual}"
# JWT 剩余寿命低于这个值就先让 CLI 续一次再同步。
REFRESH_MARGIN_MIN="${XAI_REFRESH_MARGIN_MIN:-90}"
# 撞锁是瞬时的，重试 3 次足够；重试仍失败才算真失败。
PASTE_RETRIES="${XAI_PASTE_RETRIES:-3}"
PASTE_RETRY_SLEEP="${XAI_PASTE_RETRY_SLEEP:-3}"

# epoch → 可读时刻。两件事都踩过：
#   ① launchd 环境不带 TZ，默认按 UTC 渲染 —— 首轮日志把 23:01 打成 08:01，
#      排查时会以为 token 早就过期了。所以显式指定时区。
#   ② `date -r <epoch>` 是 BSD/macOS 写法；GNU coreutils 的 -r 是「取文件 mtime」，
#      在 Linux 上必然失败。生产在 MMV（macOS）但 CI 跑 Linux，两边都得能用。
fmt_epoch() {
  local e="$1" tz="${SYNC_TZ:-Asia/Shanghai}"
  TZ="$tz" date -d "@${e}" '+%F %H:%M %Z' 2>/dev/null && return 0   # GNU
  TZ="$tz" date -r "$e"    '+%F %H:%M %Z' 2>/dev/null && return 0   # BSD/macOS
  printf '%s' "$e"                                                   # 两家都不认就给原始值
}

LOG_PREFIX="[xai-token-sync]"
note()  { printf '%s %s\n' "$LOG_PREFIX" "$*"; }
fault() { printf '%s [FAULT] %s\n' "$LOG_PREFIX" "$*" >&2; }

problems=0

# ── 读 CLI 登录态里的 token 与到期时刻 ───────────────────────────────────
# 只输出 "<exp_epoch> <token>"，调用方自己拆；token 绝不落日志。
read_cli_token() {
  python3 - "$GROK_AUTH" <<'PY'
import json, sys, base64
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"ERR {e}", file=sys.stderr); sys.exit(1)
if not isinstance(d, dict) or not d:
    print("ERR auth.json 结构异常", file=sys.stderr); sys.exit(1)
entry = list(d.values())[0]
key = entry.get("key")
if not key:
    print("ERR auth.json 里没有 key", file=sys.stderr); sys.exit(1)
exp = 0
try:                                  # key 是 JWT，exp 在 payload 里
    p = key.split(".")[1]; p += "=" * (-len(p) % 4)
    exp = int(json.loads(base64.urlsafe_b64decode(p)).get("exp", 0))
except Exception:
    pass                              # 解不出就当 0，交给上面按"已过期"处理
print(f"{exp} {key}")
PY
}

# ── ① 快到期就先让 CLI 续一次 ────────────────────────────────────────────
# grok CLI 只在真正调用时才会用 refresh_token 换新的。这里花极少量 token 触发一次。
ensure_fresh() {
  local exp="$1" now left
  now="$(date +%s)"
  left=$(( (exp - now) / 60 ))
  if [ "$exp" -gt 0 ] && [ "$left" -gt "$REFRESH_MARGIN_MIN" ]; then
    note "CLI token 还有 ${left} 分钟，无需触发续期"
    return 0
  fi
  note "CLI token 剩余 ${left} 分钟（阈值 ${REFRESH_MARGIN_MIN}）→ 触发一次最小调用让 CLI 续期"
  if timeout 90 grok -p "ok" >/dev/null 2>&1; then
    note "  ✓ 续期调用完成"
  else
    fault "续期调用失败 —— CLI 自身可能需要重新登录：grok（交互式）"
    problems=$((problems+1))
  fi
}

# ── ② 逐个 agent 贴 ──────────────────────────────────────────────────────
# paste-token 读 stdin，可非交互。每个 agent 一份私库，这是 OpenClaw 的机制，
# 不是可以省掉的循环 —— 漏掉哪个，哪个就继续 403。
list_agents() {
  # 测试可用 OPENCLAW_AGENTS_DIR 直接给名单；生产一律读配置的 agents.entries。
  if [ -n "$AGENTS_DIR" ]; then
    [ -d "$AGENTS_DIR" ] || { fault "找不到 agents 目录 $AGENTS_DIR"; return 1; }
    ( cd "$AGENTS_DIR" && ls -d */ 2>/dev/null | sed 's#/$##' )
    return 0
  fi
  [ -f "$OPENCLAW_CONFIG" ] || { fault "找不到 OpenClaw 配置 $OPENCLAW_CONFIG"; return 1; }
  python3 - "$OPENCLAW_CONFIG" <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    for name in (d.get("agents", {}).get("entries") or {}):
        print(name)
except Exception as e:
    print(f"ERR {e}", file=sys.stderr); sys.exit(1)
PYEOF
}

# 单个 agent 贴 token，带重试。
# 0922 实测：连续 23 次 openclaw 调用里会偶发一次失败，单独重跑立刻成功 ——
# 是撞上了 OpenClaw 的 state-lifecycle 锁（"another OpenClaw process owns
# state-lifecycle"）。不重试的话每轮都会莫名其妙掉一两个 agent，而掉的那个
# 几小时后就 403，排查时根本看不出是锁竞争。
paste_one() {
  local token="$1" agent="$2" attempt=1
  while [ "$attempt" -le "$PASTE_RETRIES" ]; do
    if printf '%s\n' "$token" \
       | timeout 120 openclaw models auth paste-token \
           --provider xai --agent "$agent" --profile-id "$PROFILE_ID" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt+1))
    [ "$attempt" -le "$PASTE_RETRIES" ] && sleep "$PASTE_RETRY_SLEEP"
  done
  return 1
}

sync_agents() {
  local token="$1" ok=0 fail=0 agents idx=0 total
  agents="$(list_agents)" || return 1
  [ -n "$agents" ] || { fault "agent 名单为空"; return 1; }
  total="$(printf '%s\n' "$agents" | grep -c .)"
  note "开始逐个同步，共 ${total} 个 agent（每个约 30s，整轮约 $((total/2)) 分钟）"
  while read -r agent; do
    [ -n "$agent" ] || continue
    idx=$((idx+1))
    note "  [${idx}/${total}] ${agent}"
    if paste_one "$token" "$agent"; then
      ok=$((ok+1))
    else
      fault "agent ${agent} 同步失败（已重试 ${PASTE_RETRIES} 次）"
      fail=$((fail+1))
    fi
  done <<< "$agents"
  note "同步完成：成功 ${ok} 个，失败 ${fail} 个"
  [ "$fail" -eq 0 ] || problems=$((problems+1))
}

# ── 主流程 ───────────────────────────────────────────────────────────────
if [ ! -f "$GROK_AUTH" ]; then
  fault "grok CLI 未登录（缺 ${GROK_AUTH}）。修：在 MMV 上跑 grok 并完成登录。"
  exit 1
fi

RAW="$(read_cli_token)" || { fault "读不出 CLI token（见上）"; exit 1; }
EXP="${RAW%% *}"
TOKEN="${RAW#* }"
[ -n "$TOKEN" ] || { fault "CLI token 为空"; exit 1; }

ensure_fresh "$EXP"

# 续期后重读一次：上一步很可能已经把 auth.json 换成新 token 了
RAW="$(read_cli_token)" || { fault "续期后读不出 CLI token"; exit 1; }
EXP="${RAW%% *}"
TOKEN="${RAW#* }"
note "本轮同步的 token 到期于 $(fmt_epoch "$EXP")"

sync_agents "$TOKEN"

printf '结果: 问题 %d 项\n' "$problems"
[ "$problems" -eq 0 ]
