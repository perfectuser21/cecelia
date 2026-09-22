#!/usr/bin/env bash
# openclaw_xai_token_sync.test.sh — grok token 同步器守卫
#
# 背景（2026-09-22 实证）：OpenClaw 的 xai 插件不注册任何登录方式，唯一通路是
# paste-token 贴静态 token；而 grok CLI 的 OIDC JWT 约 6 小时到期、CLI 自己续，
# 贴进去那份不会跟着续 → 每隔几小时必然 403。且凭据 per-agent，漏一个就 403 一个。
#
# 守卫盯五件事：
#   ① 逐个 agent 都贴到 —— 漏掉哪个哪个就继续 403，这是最容易悄悄退化的一条
#   ② 有 agent 失败必须退出码非 0 —— 静默吞掉的结果是几小时后又 403 而没人知道
#   ③ 快到期先触发 CLI 续期；充裕时不白花 token
#   ④ CLI 未登录要报死，不假装成功
#   ⑤ 绝不把 token 打进日志
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SYNC="$ROOT/scripts/ops/openclaw-xai-token-sync.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  ❌ %s\n' "$1"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── 测试替身 ─────────────────────────────────────────────────────────────
# openclaw：把 (agent, provider) 记到文件；stdin 读到的 token 也记下来，
#           用来验证"贴的是新 token"和"没把 token 打进 stdout"。
# grok    ：记录被调用过，模拟 CLI 续期。
mk_env() {
  BIN="$WORK/bin"; rm -rf "$BIN"; mkdir -p "$BIN"
  : > "$WORK/pasted.txt"; : > "$WORK/grok-calls.txt"
  cat > "$BIN/openclaw" <<'SH'
#!/bin/bash
agent=""; provider=""
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) agent="$2"; shift 2;;
    --provider) provider="$2"; shift 2;;
    *) shift;;
  esac
done
tok="$(cat)"
echo "$agent|$provider|$tok" >> "${PASTE_LOG:?}"
[ "$agent" = "${FAIL_AGENT:-}" ] && exit 1
# FLAKY_AGENT：前 FLAKY_TIMES 次失败，之后成功（模拟撞锁后重试成功）
if [ "$agent" = "${FLAKY_AGENT:-}" ]; then
  n=$(grep -c "^${agent}|" "${PASTE_LOG}")
  [ "$n" -le "${FLAKY_TIMES:-1}" ] && exit 1
fi
exit 0
SH
  cat > "$BIN/grok" <<'SH'
#!/bin/bash
echo "called" >> "${GROK_LOG:?}"
# 模拟 CLI 续期：把 auth.json 换成一个更晚到期的 token
if [ -n "${REFRESH_TO_FILE:-}" ] && [ -f "$REFRESH_TO_FILE" ]; then
  cp "$REFRESH_TO_FILE" "${GROK_AUTH_FILE:?}"
fi
exit 0
SH
  chmod +x "$BIN/openclaw" "$BIN/grok"
  export PASTE_LOG="$WORK/pasted.txt" GROK_LOG="$WORK/grok-calls.txt"
  export XAI_SYNC_PATH="$BIN"
  export OPENCLAW_AGENTS_DIR="$WORK/agents"
  rm -rf "$WORK/agents"; mkdir -p "$WORK/agents"/{main,dev,infra,media,verifier}
  unset FAIL_AGENT REFRESH_TO_FILE FLAKY_AGENT FLAKY_TIMES
  export XAI_PASTE_RETRY_SLEEP=0
}

# 造一个 exp 在 now+minutes 的假 JWT（只有 payload 需要合法）
mk_auth() {
  local file="$1" minutes="$2" marker="${3:-TOKENBODY}"
  python3 - "$file" "$minutes" "$marker" <<'PY'
import base64, json, sys, time
path, minutes, marker = sys.argv[1], int(sys.argv[2]), sys.argv[3]
def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip("=")
jwt = f'{b64({"alg":"RS256","typ":"JWT"})}.{b64({"exp":int(time.time())+minutes*60,"m":marker})}.sig{marker}'
json.dump({"https://auth.x.ai::probe": {"key": jwt, "email": "t@example.com"}}, open(path, "w"))
PY
}

echo "▶️  grok token 同步器守卫"

# ── ① 逐个 agent 都贴到 ──────────────────────────────────────────────────
mk_env
export GROK_AUTH_FILE="$WORK/auth.json"
mk_auth "$GROK_AUTH_FILE" 300 FRESH
OUT=$(bash "$SYNC" 2>&1); RC=$?
GOT=$(cut -d'|' -f1 < "$WORK/pasted.txt" | sort | tr '\n' ' ')
EXPECT="dev infra main media verifier "
[ "$GOT" = "$EXPECT" ] && ok "5 个 agent 全部贴到（漏一个就 403 一个）" \
  || bad "贴到的 agent 不全：得到 '${GOT}'，期望 '${EXPECT}'"
[ "$RC" -eq 0 ] && ok "全成功 → 退出码 0" || bad "全成功却退出码 ${RC}：$OUT"
grep -q '|xai|' "$WORK/pasted.txt" && ok "provider 传的是 xai" || bad "provider 不是 xai"

# ── ② 有 agent 失败必须退出码非 0 ────────────────────────────────────────
mk_env
export GROK_AUTH_FILE="$WORK/auth.json"; mk_auth "$GROK_AUTH_FILE" 300 FRESH
OUT=$(FAIL_AGENT=media bash "$SYNC" 2>&1); RC=$?
[ "$RC" -ne 0 ] && ok "有 agent 同步失败 → 退出码非 0（不静默吞）" \
  || bad "有 agent 失败却退出码 0 —— 几小时后 grok 又 403 而没人知道"
printf '%s' "$OUT" | grep -q 'media' && ok "失败的 agent 名出现在输出里" \
  || bad "没说清哪个 agent 失败"

# ── ②b 瞬时失败要重试（撞 OpenClaw 的 state-lifecycle 锁）────────────────
# 0922 实测：连续 23 次 openclaw 调用会偶发掉一个，单独重跑立刻成功。
# 不重试的话每轮莫名掉一两个 agent，而掉的那个几小时后就 403，
# 排查时根本看不出是锁竞争 —— 所以"偶发失败能自愈"必须是被断言的行为。
mk_env
export GROK_AUTH_FILE="$WORK/auth.json"; mk_auth "$GROK_AUTH_FILE" 300 FRESH
OUT=$(FLAKY_AGENT=media FLAKY_TIMES=1 bash "$SYNC" 2>&1); RC=$?
[ "$RC" -eq 0 ] && ok "某 agent 首次失败、重试成功 → 整体判成功" \
  || bad "瞬时失败没被重试救回来，退出码 ${RC}：$OUT"
[ "$(grep -c '^media|' "$WORK/pasted.txt")" -ge 2 ] && ok "确实重试了该 agent（调用 ≥2 次）" \
  || bad "没有重试，只调了一次"

# ── ③ 快到期先续期；充裕时不白花 token ───────────────────────────────────
mk_env
export GROK_AUTH_FILE="$WORK/auth.json"; mk_auth "$GROK_AUTH_FILE" 300 FRESH
bash "$SYNC" >/dev/null 2>&1
[ ! -s "$WORK/grok-calls.txt" ] && ok "token 充裕（300min）→ 不触发续期调用" \
  || bad "token 还很充裕却调了 CLI，白花额度"

mk_env
export GROK_AUTH_FILE="$WORK/auth.json"; mk_auth "$GROK_AUTH_FILE" 10 STALE
mk_auth "$WORK/renewed.json" 360 RENEWED
OUT=$(REFRESH_TO_FILE="$WORK/renewed.json" bash "$SYNC" 2>&1)
[ -s "$WORK/grok-calls.txt" ] && ok "token 剩 10min（低于阈值 90）→ 触发 CLI 续期" \
  || bad "快到期却没触发续期 —— 贴过去的还是快死的那份"
# 续期后必须**重读**：贴出去的应当是新 token，不是续期前那份
if grep -q 'RENEWED' "$WORK/pasted.txt" && ! grep -q 'STALE' "$WORK/pasted.txt"; then
  ok "续期后重读了 auth.json，贴的是新 token"
else
  bad "贴的仍是续期前的旧 token —— 续期等于白做"
fi

# ── ④ CLI 未登录要报死 ───────────────────────────────────────────────────
mk_env
export GROK_AUTH_FILE="$WORK/nonexistent.json"
OUT=$(bash "$SYNC" 2>&1); RC=$?
[ "$RC" -ne 0 ] && ok "CLI 未登录 → 退出码非 0" || bad "CLI 未登录却判成功"
[ ! -s "$WORK/pasted.txt" ] && ok "CLI 未登录 → 一个 agent 都不贴" \
  || bad "没有可用 token 却还在贴，会把坏值推给所有 agent"

# ── ⑤ 绝不把 token 打进日志 ──────────────────────────────────────────────
mk_env
export GROK_AUTH_FILE="$WORK/auth.json"; mk_auth "$GROK_AUTH_FILE" 300 SECRETBODY
OUT=$(bash "$SYNC" 2>&1)
printf '%s' "$OUT" | grep -q 'SECRETBODY' \
  && bad "token 被打进了日志（日志会进 launchd 输出文件）" \
  || ok "token 不出现在日志里"

printf '\n结果: PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
