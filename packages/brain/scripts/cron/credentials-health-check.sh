#!/usr/bin/env bash
# credentials-health-check.sh
#
# 凭据健康巡检脚本 — 在宿主机（Mac mini）上运行
#
# 检查范围：
#   1. NotebookLM     — notebooklm auth check --test 真调 API
#   2. Claude OAuth   — ~/.claude-accountN/.credentials.json expiresAt
#   3. Codex          — ~/.codex-teamN/auth.json + wham/usage API
#   4. 发布器 cookies — Playwright state 文件修改时间（Windows PC 需人工核查）
#
# 输出：JSON 到 stdout
# 用法：bash credentials-health-check.sh [--json]
#
# 告警阈值：
#   DAYS_WARN=30  (P1 告警)
#   DAYS_CRIT=7   (P0 告警)

set -euo pipefail

DAYS_WARN=${CRED_WARN_DAYS:-30}
DAYS_CRIT=${CRED_CRIT_DAYS:-7}
NOW_EPOCH=$(date +%s)
NOW_MS=$(( NOW_EPOCH * 1000 ))

NOTEBOOKLM_BIN="${NOTEBOOKLM_BIN:-/opt/homebrew/bin/notebooklm}"
WHAM_USAGE_URL="https://chatgpt.com/backend-api/wham/usage"

results='{"checked_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","credentials":{}}'

# ─── 工具函数 ─────────────────────────────────────────────────────────────────

json_set() {
  # json_set <path> <value_json> — 用 python3 合并 JSON（避免依赖 jq）
  local path="$1" value="$2"
  results=$(python3 -c "
import json, sys
data = json.loads(sys.argv[1])
parts = sys.argv[2].split('.')
cur = data
for p in parts[:-1]:
  cur = cur.setdefault(p, {})
cur[parts[-1]] = json.loads(sys.argv[3])
print(json.dumps(data))
" "$results" "$path" "$value")
}

ms_to_days() {
  local ms="$1"
  echo $(( ms / 86400000 ))
}

days_status() {
  local remaining_days="$1"
  if (( remaining_days < 0 )); then
    echo "expired"
  elif (( remaining_days < DAYS_CRIT )); then
    echo "critical"
  elif (( remaining_days < DAYS_WARN )); then
    echo "warning"
  else
    echo "ok"
  fi
}

# ─── 1. NotebookLM ────────────────────────────────────────────────────────────

check_notebooklm() {
  echo "[notebooklm] 检查 auth..." >&2
  if ! command -v "$NOTEBOOKLM_BIN" &>/dev/null && ! command -v notebooklm &>/dev/null; then
    json_set "credentials.notebooklm" '{"status":"skip","reason":"CLI not found"}'
    echo "[notebooklm] ⚠️  CLI 未找到，跳过" >&2
    return
  fi

  local cli="${NOTEBOOKLM_BIN}"
  if ! command -v "$cli" &>/dev/null; then
    cli="notebooklm"
  fi

  local output exit_code=0
  output=$("$cli" auth check --test 2>&1) || exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    json_set "credentials.notebooklm" '{"status":"ok","note":"auth check passed"}'
    echo "[notebooklm] ✅ auth ok" >&2
  else
    local err_short
    err_short=$(echo "$output" | head -1 | tr '"' "'")
    json_set "credentials.notebooklm" "{\"status\":\"expired\",\"error\":\"${err_short}\"}"
    echo "[notebooklm] ❌ auth failed (exit=$exit_code)" >&2
  fi
}

# ─── 2. Claude OAuth 账号 ────────────────────────────────────────────────────

check_claude_account() {
  local account="$1"
  local cred_path="${HOME}/.claude-${account}/.credentials.json"

  if [[ ! -f "$cred_path" ]]; then
    json_set "credentials.claude_${account}" '{"status":"missing","account":"'"$account"'"}'
    echo "[claude] ❌ ${account}: credentials.json 不存在" >&2
    return
  fi

  local expires_at_ms remaining_ms remaining_days status
  expires_at_ms=$(python3 -c "
import json
d = json.load(open('${cred_path}'))
print(d.get('claudeAiOauth', {}).get('expiresAt', 0))
" 2>/dev/null || echo "0")

  if [[ "$expires_at_ms" == "0" ]]; then
    json_set "credentials.claude_${account}" '{"status":"unknown","account":"'"$account"'","error":"no expiresAt"}'
    echo "[claude] ⚠️  ${account}: 无 expiresAt 字段" >&2
    return
  fi

  remaining_ms=$(( expires_at_ms - NOW_MS ))
  remaining_days=$(( remaining_ms / 86400000 ))
  status=$(days_status "$remaining_days")

  local expires_str
  expires_str=$(python3 -c "
from datetime import datetime, timezone, timedelta
ts = ${expires_at_ms} / 1000
dt = datetime.fromtimestamp(ts, tz=timezone(timedelta(hours=8)))
print(dt.strftime('%Y-%m-%d %H:%M +08'))
" 2>/dev/null || echo "unknown")

  json_set "credentials.claude_${account}" "{
    \"status\": \"${status}\",
    \"account\": \"${account}\",
    \"remaining_days\": ${remaining_days},
    \"expires_at\": \"${expires_str}\"
  }"

  case "$status" in
    ok)       echo "[claude] ✅ ${account}: ok（${remaining_days}天后到期）" >&2 ;;
    warning)  echo "[claude] ⚠️  ${account}: 还有 ${remaining_days} 天到期" >&2 ;;
    critical) echo "[claude] 🚨 ${account}: 仅剩 ${remaining_days} 天！" >&2 ;;
    expired)  echo "[claude] ❌ ${account}: 已过期" >&2 ;;
  esac
}

check_claude_accounts() {
  for account in account1 account2 account3; do
    check_claude_account "$account"
  done
}

# ─── 3. Codex 账号 (wham/usage) ──────────────────────────────────────────────

check_codex_account() {
  local team="$1"
  local auth_path="${HOME}/.codex-${team}/auth.json"

  if [[ ! -f "$auth_path" ]]; then
    json_set "credentials.codex_${team}" '{"status":"missing","account":"'"$team"'"}'
    echo "[codex] ❌ ${team}: auth.json 不存在" >&2
    return
  fi

  local access_token account_id
  access_token=$(python3 -c "
import json
d = json.load(open('${auth_path}'))
print(d.get('tokens', {}).get('access_token', ''))
" 2>/dev/null || echo "")

  account_id=$(python3 -c "
import json
d = json.load(open('${auth_path}'))
print(d.get('tokens', {}).get('account_id', ''))
" 2>/dev/null || echo "")

  if [[ -z "$access_token" ]]; then
    json_set "credentials.codex_${team}" '{"status":"invalid","account":"'"$team"'","error":"no access_token"}'
    echo "[codex] ⚠️  ${team}: auth.json 缺 access_token" >&2
    return
  fi

  local http_status
  http_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${access_token}" \
    -H "ChatGPT-Account-Id: ${account_id}" \
    -H "Accept: application/json" \
    --max-time 10 \
    "$WHAM_USAGE_URL" 2>/dev/null || echo "000")

  if [[ "$http_status" == "200" ]]; then
    json_set "credentials.codex_${team}" '{"status":"ok","account":"'"$team"'"}'
    echo "[codex] ✅ ${team}: token 有效" >&2
  elif [[ "$http_status" == "401" ]]; then
    json_set "credentials.codex_${team}" '{"status":"expired","account":"'"$team"'","http_status":401}'
    echo "[codex] ❌ ${team}: token 已过期 (401)" >&2
  else
    json_set "credentials.codex_${team}" "{\"status\":\"error\",\"account\":\"${team}\",\"http_status\":${http_status}}"
    echo "[codex] ⚠️  ${team}: API 返回 ${http_status}" >&2
  fi
}

check_codex_accounts() {
  for team in team1 team2 team3 team4 team5; do
    check_codex_account "$team"
  done
}

# ─── 4. 发布器 cookies ───────────────────────────────────────────────────────
# Publisher cookies 存在 Windows PC 上（Playwright 录制），无法从 Mac mini 直接访问。
# 此处检查宿主机上 playwright state 文件的修改时间（如已同步）；
# 否则输出 manual_check_required。

check_publishers() {
  local platforms=("douyin" "xiaohongshu" "zhihu" "weibo" "toutiao" "kuaishou" "wechat")
  local state_dir="${PLAYWRIGHT_STATE_DIR:-${HOME}/.credentials/playwright-state}"

  for platform in "${platforms[@]}"; do
    local state_file="${state_dir}/${platform}.json"
    if [[ -f "$state_file" ]]; then
      local mtime_epoch
      mtime_epoch=$(stat -f %m "$state_file" 2>/dev/null || stat -c %Y "$state_file" 2>/dev/null || echo "0")
      local age_days=$(( (NOW_EPOCH - mtime_epoch) / 86400 ))
      local status
      status=$(days_status "$(( DAYS_WARN - age_days ))")  # remaining = DAYS_WARN - age

      json_set "credentials.publisher_${platform}" "{
        \"status\": \"${status}\",
        \"platform\": \"${platform}\",
        \"file_age_days\": ${age_days},
        \"state_file\": \"${state_file}\"
      }"
      echo "[publisher] ${platform}: state 文件 ${age_days} 天前更新 → ${status}" >&2
    else
      json_set "credentials.publisher_${platform}" "{
        \"status\": \"manual_check_required\",
        \"platform\": \"${platform}\",
        \"note\": \"cookies on Windows PC, cannot check remotely\"
      }"
      echo "[publisher] ${platform}: ⚠️  需人工在 Windows PC 检查" >&2
    fi
  done
}

# ─── 主流程 ──────────────────────────────────────────────────────────────────

main() {
  echo "[cred-health] 开始凭据健康巡检 $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  echo "" >&2

  check_notebooklm
  echo "" >&2

  check_claude_accounts
  echo "" >&2

  check_codex_accounts
  echo "" >&2

  check_publishers
  echo "" >&2

  # 统计汇总
  local expired_count warning_count
  expired_count=$(echo "$results" | python3 -c "
import json, sys
d = json.load(sys.stdin)
creds = d.get('credentials', {})
print(sum(1 for v in creds.values() if isinstance(v, dict) and v.get('status') in ('expired','critical','missing')))
")
  warning_count=$(echo "$results" | python3 -c "
import json, sys
d = json.load(sys.stdin)
creds = d.get('credentials', {})
print(sum(1 for v in creds.values() if isinstance(v, dict) and v.get('status') == 'warning'))
")

  results=$(echo "$results" | python3 -c "
import json, sys
d = json.load(sys.stdin)
d['summary'] = {
  'expired_or_critical': ${expired_count},
  'warning': ${warning_count},
  'ok': sum(1 for v in d.get('credentials', {}).values() if isinstance(v, dict) and v.get('status') == 'ok')
}
print(json.dumps(d, indent=2))
")

  echo "[cred-health] 汇总: 过期/紧急=${expired_count}, 告警=${warning_count}" >&2
  echo "" >&2

  echo "$results"
}

main "$@"
