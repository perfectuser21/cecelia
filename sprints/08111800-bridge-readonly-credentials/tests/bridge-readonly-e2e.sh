#!/usr/bin/env bash
# bridge-readonly-e2e.sh — 宿主 bridge 凭据只读消费 集成/单测 oracle
#
# 用真实 cecelia-bridge.cjs 进程 + stub CLAUDE_BIN 子进程验证：
#   - 权威 ~/.claude-account{N}/.credentials.json 全程 mtime+sha256 零变化（核心红线）
#   - claude 子进程的 CLAUDE_CONFIG_DIR 指向临时目录（非权威目录），attempt 结束后被清理
#   - 临时目录创建失败（TMPDIR 破坏）时主流程失败，绝不回退到权威目录（no fallback）
#   - 并发两个 attempt 各用互不相同的临时目录，权威文件仍零写入
#   - 临时目录清理失败时 cleanup 不抛错（主流程不受影响）
#
# 不用真 claude、不用真权威账号：用隔离 HOME + stub 二进制，evaluator 本机可复跑。
# MODE: all|redline|wiring|creation-fail|concurrency|cleanup-fail
set -uo pipefail
MODE="${1:-all}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BRIDGE="$REPO_ROOT/packages/brain/scripts/cecelia-bridge.cjs"
HELPER_PATH="$REPO_ROOT/packages/brain/scripts/ephemeral-claude-config.cjs"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
mtime_of() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"
}
free_port() {
  node -e 'const n=require("net");const s=n.createServer();s.listen(0,()=>{const p=s.address().port;s.close(()=>console.log(p));});'
}

# ---- 共享装置：隔离 HOME + 权威账号 + stub claude + sentinel ----
WORK=""
BRIDGE_PID=""
cleanup_all() {
  [ -n "$BRIDGE_PID" ] && kill "$BRIDGE_PID" 2>/dev/null || true
  [ -n "$WORK" ] && rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup_all EXIT

setup_fixture() {
  WORK="$(mktemp -d)"
  THOME="$WORK/home"
  AUTH="$THOME/.claude-account1"
  SENTINEL="$WORK/seen.log"
  mkdir -p "$AUTH"
  printf '{"claudeAiOauth":{"accessToken":"ORIGINAL","refreshToken":"ORIGINAL"}}' > "$AUTH/.credentials.json"
  printf '{"theme":"dark"}' > "$AUTH/settings.json"
  : > "$SENTINEL"
  STUB="$WORK/claude-stub.sh"
  # stub claude：记录它看到的 CLAUDE_CONFIG_DIR，并模拟 CLI 刷新回写到该目录（应落在临时副本，不碰权威）
  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'echo "$CLAUDE_CONFIG_DIR" >> "$BRIDGE_SENTINEL"'
    printf '%s\n' 'if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ -d "$CLAUDE_CONFIG_DIR" ]; then'
    printf '%s\n' '  printf %s "{\"claudeAiOauth\":{\"accessToken\":\"REFRESHED_BY_CLAUDE\"}}" > "$CLAUDE_CONFIG_DIR/.credentials.json"'
    printf '%s\n' 'fi'
    printf '%s\n' 'echo "stub-reply-text"'
    printf '%s\n' 'exit 0'
  } > "$STUB"
  chmod +x "$STUB"
  PORT="$(free_port)"
  AUTH_SHA_BEFORE="$(sha256 "$AUTH/.credentials.json")"
  AUTH_MTIME_BEFORE="$(mtime_of "$AUTH/.credentials.json")"
}

start_bridge() {
  # 额外 env 以 KEY=VAL 形式作为参数传入（如 TMPDIR=/nonexistent）
  env BRIDGE_PORT="$PORT" HOME="$THOME" CLAUDE_BIN="$STUB" BRIDGE_SENTINEL="$SENTINEL" "$@" \
    node "$BRIDGE" > "$WORK/bridge.log" 2>&1 &
  BRIDGE_PID=$!
  local i
  for i in $(seq 1 60); do
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  echo "FAIL: bridge 未就绪 port=$PORT"; sed -n '1,40p' "$WORK/bridge.log"; exit 1
}

call_llm() {
  curl -s -m 60 -X POST "http://127.0.0.1:$PORT/llm-call" \
    -H 'Content-Type: application/json' \
    -d "{\"prompt\":\"ping\",\"model\":\"haiku\",\"accountId\":\"account1\"}"
}

assert_auth_untouched() {
  local sha_after mtime_after
  sha_after="$(sha256 "$AUTH/.credentials.json")"
  mtime_after="$(mtime_of "$AUTH/.credentials.json")"
  if [ "$sha_after" != "$AUTH_SHA_BEFORE" ]; then
    echo "FAIL: 权威 .credentials.json sha256 变化 before=$AUTH_SHA_BEFORE after=$sha_after"; return 1
  fi
  if [ "$mtime_after" != "$AUTH_MTIME_BEFORE" ]; then
    echo "FAIL: 权威 .credentials.json mtime 变化 before=$AUTH_MTIME_BEFORE after=$mtime_after"; return 1
  fi
  return 0
}

run_redline() {
  setup_fixture
  start_bridge
  RESP="$(call_llm)"
  echo "$RESP" | grep -q '"ok":true' || { echo "FAIL: /llm-call 未返回 ok:true resp=$RESP"; exit 1; }
  assert_auth_untouched || exit 1
  echo "OK[redline]: 经 bridge 跑完一次 attempt，权威 .credentials.json mtime+sha256 前后完全不变"
}

run_wiring() {
  setup_fixture
  start_bridge
  RESP="$(call_llm)"
  echo "$RESP" | grep -q '"ok":true' || { echo "FAIL: /llm-call 未返回 ok:true resp=$RESP"; exit 1; }
  SEEN="$(head -n1 "$SENTINEL")"
  [ -n "$SEEN" ] || { echo "FAIL: claude 未被 spawn（sentinel 为空）"; exit 1; }
  if [ "$SEEN" = "$AUTH" ]; then
    echo "FAIL: CLAUDE_CONFIG_DIR 仍指向权威目录 $AUTH （应指向临时副本）"; exit 1
  fi
  case "$SEEN" in
    "$THOME"/.claude-*) echo "FAIL: CLAUDE_CONFIG_DIR 落在权威账号目录家族 $SEEN"; exit 1;;
  esac
  [ -e "$SEEN" ] && { echo "FAIL: attempt 结束后临时目录未清理 $SEEN"; exit 1; }
  assert_auth_untouched || exit 1
  echo "OK[wiring]: CLAUDE_CONFIG_DIR 指向临时目录 $SEEN（非权威），且 attempt 结束后已清理"
}

run_concurrency() {
  setup_fixture
  start_bridge
  R1="$(call_llm)" & P1=$!
  R2="$(call_llm)" & P2=$!
  wait $P1; wait $P2
  DISTINCT="$(sort -u "$SENTINEL" | grep -c . || true)"
  LINES="$(grep -c . "$SENTINEL" || true)"
  [ "$LINES" -ge 2 ] || { echo "FAIL: 并发未产生 2 次 spawn（lines=$LINES）"; exit 1; }
  [ "$DISTINCT" -ge 2 ] || { echo "FAIL: 并发两 attempt 复用了同一临时目录（distinct=$DISTINCT）"; cat "$SENTINEL"; exit 1; }
  if grep -qx "$AUTH" "$SENTINEL"; then echo "FAIL: 并发中出现指向权威目录的 attempt"; exit 1; fi
  assert_auth_untouched || exit 1
  echo "OK[concurrency]: 并发两 attempt 各用互不相同临时目录（distinct=$DISTINCT），权威文件零写入"
}

run_creation_fail() {
  setup_fixture
  # 权威账号存在且完好，但把 TMPDIR 指向不存在路径 → 临时目录创建必失败
  start_bridge TMPDIR="/nonexistent-cecelia-$RANDOM-$RANDOM"
  RESP="$(call_llm)"
  # 主流程应失败（ok:false 或 HTTP 500 body），且绝不静默回退到权威目录
  if echo "$RESP" | grep -q '"ok":true'; then
    echo "FAIL: 临时目录创建失败却返回 ok:true（疑似回退到权威目录）resp=$RESP"; exit 1
  fi
  if grep -qx "$AUTH" "$SENTINEL"; then
    echo "FAIL: 创建失败后回退到权威目录起 claude（sentinel 命中权威路径）"; exit 1
  fi
  assert_auth_untouched || exit 1
  grep -qiE 'ephemeral|临时|config.?dir|prepare' "$WORK/bridge.log" || echo "WARN: bridge.log 未见临时目录相关告警（建议补告警文案，不阻塞）"
  echo "OK[creation-fail]: 临时目录创建失败 → 主流程失败且未回退权威目录，权威文件零写入"
}

run_cleanup_fail() {
  # 单测：cleanup 目标已被外部删除时不得抛错（清理失败仅记日志，不影响结果）
  HOME_DIR="$(mktemp -d)"
  AUTH9="$HOME_DIR/.claude-account9"
  mkdir -p "$AUTH9"
  printf '{"x":1}' > "$AUTH9/.credentials.json"
  HELPER="$HELPER_PATH" HOMEX="$HOME_DIR" node <<'NODE'
const os=require('os'), fs=require('fs'), path=require('path');
process.env.HOME=process.env.HOMEX;
let mod;
try { mod = require(process.env.HELPER); }
catch(e){ console.error('FAIL: 缺 helper 模块 '+process.env.HELPER+' ('+e.code+')'); process.exit(1); }
const prep = mod.prepareEphemeralClaudeConfig;
if (typeof prep !== 'function'){ console.error('FAIL: helper 未导出 prepareEphemeralClaudeConfig'); process.exit(1); }
const r = prep('account9');
if (!r || !r.configDir || !fs.existsSync(r.configDir)){ console.error('FAIL: configDir 未创建'); process.exit(1); }
if (typeof r.cleanup !== 'function'){ console.error('FAIL: 未返回 cleanup()'); process.exit(1); }
// 模拟清理失败：目标已被外部删除
fs.rmSync(r.configDir, {recursive:true, force:true});
let threw=false;
try { r.cleanup(); } catch(e){ threw=true; }
if (threw){ console.error('FAIL: cleanup 在目标缺失时抛错（应仅记日志不抛）'); process.exit(1); }
console.log('OK[cleanup-fail]: cleanup 吞掉清理失败，不影响主流程');
NODE
  RC=$?
  rm -rf "$HOME_DIR" 2>/dev/null || true
  [ "$RC" -eq 0 ] || exit 1
}

case "$MODE" in
  redline) run_redline;;
  wiring) run_wiring;;
  creation-fail) run_creation_fail;;
  concurrency) run_concurrency;;
  cleanup-fail) run_cleanup_fail;;
  all)
    run_redline
    cleanup_all; BRIDGE_PID=""; WORK=""
    run_wiring
    cleanup_all; BRIDGE_PID=""; WORK=""
    run_creation_fail
    cleanup_all; BRIDGE_PID=""; WORK=""
    run_concurrency
    cleanup_all; BRIDGE_PID=""; WORK=""
    run_cleanup_fail
    echo "✅ Golden Path 全段验证通过（redline/wiring/creation-fail/concurrency/cleanup-fail）"
    ;;
  *) echo "unknown MODE=$MODE"; exit 2;;
esac
