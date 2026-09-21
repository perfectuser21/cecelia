#!/usr/bin/env bash
# 回归守卫：常驻服务豁免（2026-09-21 P0，task 0db9167a）
#
# 事故：OpenClaw 2026-09-20 迁到 MMV 后，janitor --mode frequent 每 15 分钟把它
# 当孤儿 node 进程杀掉。实测每轮杀 6 个、每个存活 868-910 秒，杀完重生形成自维持
# 循环：openclaw 网关 + service-child-relay + zenithjoy-releases×2 + douyin-proxy
# + preview-agent。后果是任何超过 15 分钟的 OpenClaw 任务永远完不成 ——
# 当天跑过的 6 条业务 cron 全失败，5 条死因均为
# "cron: job interrupted by gateway restart"。
#
# 根因：豁免只认一条字面量路径 */usr/local/libexec/cecelia/*，而新迁来的服务
# 不在名单里。这是同一形状的第三次（2026-08-10 ops 测试零执行、2026-09-07
# credentials 子目录漏跑），所以本次修法必须**自维护**：launchd 托管的进程
# 一律豁免，不再依赖人去记得改名单。
#
# 本测试是行为测试，不是 grep 字面量 —— 从 janitor.sh 里提取真函数并真调用，
# 喂的是事故当天 ps 抓到的真实命令行。

set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

JANITOR="$(dirname "$0")/../../janitor.sh"
[ -f "$JANITOR" ] || { echo "ERROR: janitor.sh not found"; exit 1; }

# ── 提取被测函数（顶层定义，闭合 } 在第 0 列）────────────────────────────
EXTRACT="$(awk '
  /^(launchd_managed_pids|is_exempt_resident_service)\(\)[[:space:]]*\{/ { on = 1 }
  on { print }
  on && /^\}/ { on = 0 }
' "$JANITOR")"

if [ -z "$EXTRACT" ]; then
  fail "janitor.sh 未定义顶层函数 launchd_managed_pids / is_exempt_resident_service"
  echo "--- 测试结果：PASS=$PASS FAIL=$FAIL ---"
  exit 1
fi

# 被测函数在子 shell 里求值；launchd PID 集合走注入接缝，不依赖本机真实状态
run_case() {
  local pid="$1" cmd="$2" launchd_pids="$3"
  JANITOR_LAUNCHD_PIDS="$launchd_pids" bash -c "
    set -uo pipefail
    $EXTRACT
    if is_exempt_resident_service '$pid' '$cmd'; then echo EXEMPT; else echo KILLABLE; fi
  " 2>/dev/null
}

assert() {
  local want="$1" got="$2" desc="$3"
  if [ "$want" = "$got" ]; then ok "$desc"; else fail "$desc（期望 $want，实得 $got）"; fi
}

# ── A. launchd 托管一律豁免（自维护，事故当天 launchctl list 实测命中这三个）──
assert EXEMPT "$(run_case 12037 '/opt/homebrew/opt/node/bin/node --max-old-space-size=4096 /opt/homebrew/lib/node_modules/openclaw/dist/index.js gateway --port 18789' '12037
12469
12739')" "OpenClaw 网关（launchd 托管）豁免"

assert EXEMPT "$(run_case 12469 'node /Users/administrator/perfect21/cecelia/scripts/preview-agent.mjs' '12037
12469
12739')" "preview-agent（launchd 托管）豁免"

assert EXEMPT "$(run_case 12739 '/opt/homebrew/bin/node /Users/administrator/claude-output/douyin-proxy.js' '12037
12469
12739')" "douyin-proxy（launchd 托管）豁免"

# ── B. 显式白名单兜住非 launchd 托管的常驻件 ─────────────────────────────
assert EXEMPT "$(run_case 12542 '/opt/homebrew/bin/node /Users/administrator/zenithjoy-releases/current/dist/index.js' '99999')" \
  "zenithjoy-releases（keepalive 拉起，不在 launchctl list）靠白名单豁免"

assert EXEMPT "$(run_case 30001 '/usr/local/libexec/cecelia/fleet-worker' '99999')" \
  "cecelia libexec 常驻件豁免（2026-08-05 旧守卫不回归）"

# ── C. 闸必须还有牙：不在名单、不受 launchd 托管的照杀 ────────────────────
assert KILLABLE "$(run_case 40001 'node /tmp/runaway-script.js' '99999')" \
  "野 node 进程仍可被清理（豁免没开成后门）"

assert KILLABLE "$(run_case 40002 '/opt/homebrew/bin/node /Users/administrator/perfect21/cecelia/scripts/some-oneoff.mjs' '99999')" \
  "开发目录下的一次性脚本不被误豁免"

assert KILLABLE "$(run_case 40003 'node /Users/administrator/zenithjoy-releases-backup/dist/index.js' '99999')" \
  "相邻但非 current 的发布目录不被误豁免（白名单不得写成裸 *zenithjoy-releases*）"

# ── D. PID 匹配必须精确，不能子串命中 ────────────────────────────────────
assert KILLABLE "$(run_case 1203 'node /tmp/whatever.js' '12037')" \
  "PID 1203 不得被 12037 的子串匹配误豁免"

echo "--- 测试结果：PASS=$PASS FAIL=$FAIL ---"
[ "$FAIL" -eq 0 ]
