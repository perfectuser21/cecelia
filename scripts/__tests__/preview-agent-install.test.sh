#!/usr/bin/env bash
# preview-agent-install.test.sh — 安装脚本：plist 不再携带明文 DEPLOY_TOKEN（任务 6f937566 ②）
#
# 旧行为：install 把环境里的 DEPLOY_TOKEN 原样写进 ~/Library/LaunchAgents/com.cecelia.preview-agent.plist，
# 令牌明文落在 plist 里。新行为：plist 只写 DEPLOY_TOKEN_FILE 路径，代理启动时自己读凭据文件。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="${SCRIPT_DIR}/../preview-agent-install.sh"
PASS=0; FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SECRET="tok_$(printf 'e%.0s' $(seq 1 60))"
TOKEN_FILE="$TMP/cred/cecelia-deploy-token.env"
mkdir -p "$TMP/cred" "$TMP/bin" "$TMP/home"
printf 'DEPLOY_TOKEN=%s\n' "$SECRET" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
# launchctl 若被调用就记账（dry-run / --no-load 都不得调用）
printf '#!/bin/bash\necho "$*" >> "%s/launchctl.log"\n' "$TMP" > "$TMP/bin/launchctl"
chmod +x "$TMP/bin/launchctl"
PLIST="$TMP/home/Library/LaunchAgents/com.cecelia.preview-agent.plist"
REL="$TMP/rel/rel-abc"

echo "── T1 dry-run：plist 无 DEPLOY_TOKEN 键与令牌原文，有 DEPLOY_TOKEN_FILE ──"
set +e
OUT=$(PATH="$TMP/bin:$PATH" HOME="$TMP/home" DEPLOY_TOKEN="$SECRET" DEPLOY_TOKEN_FILE="$TOKEN_FILE" \
  PREVIEW_AGENT_ROOT="$REL" bash "$INSTALL" --dry-run 2>&1)
RC=$?
set -e
[ "$RC" = 0 ] && pass "dry-run 退出 0" || fail "dry-run 退出 0" "rc=$RC out=$OUT"
if echo "$OUT" | grep -q '<key>DEPLOY_TOKEN</key>'; then fail "plist 不含 DEPLOY_TOKEN 键" "仍写入了令牌键"; else pass "plist 不含 DEPLOY_TOKEN 键"; fi
if echo "$OUT" | grep -qF "$SECRET"; then fail "输出不含令牌原文" "令牌泄露"; else pass "输出不含令牌原文"; fi
echo "$OUT" | grep -q '<key>DEPLOY_TOKEN_FILE</key>' && pass "plist 写入 DEPLOY_TOKEN_FILE" || fail "plist 写入 DEPLOY_TOKEN_FILE" "$OUT"
echo "$OUT" | grep -qF "<string>${TOKEN_FILE}</string>" && pass "DEPLOY_TOKEN_FILE 指向凭据文件" || fail "DEPLOY_TOKEN_FILE 指向凭据文件" "$OUT"
echo "$OUT" | grep -qF "<string>${REL}/scripts/preview-agent.mjs</string>" && pass "ProgramArguments 指向发布目录" || fail "ProgramArguments 指向发布目录" "$OUT"
echo "$OUT" | grep -q '<key>CECELIA_DEPLOY_ROOT</key>' && pass "注入 CECELIA_DEPLOY_ROOT（capacity-gate 采样路径）" || fail "注入 CECELIA_DEPLOY_ROOT" "$OUT"
echo "$OUT" | grep -q '<key>DB_NAME</key>' && pass "仍注入 DB_NAME" || fail "仍注入 DB_NAME" "$OUT"
[ ! -e "$PLIST" ] && pass "dry-run 不写 plist 文件" || fail "dry-run 不写 plist 文件" "写了 $PLIST"
[ ! -e "$TMP/launchctl.log" ] && pass "dry-run 不调用 launchctl" || fail "dry-run 不调用 launchctl" "$(cat "$TMP/launchctl.log")"

echo "── T2 凭据文件不存在 → 拒绝（退出非 0）──"
set +e
OUT2=$(PATH="$TMP/bin:$PATH" HOME="$TMP/home" DEPLOY_TOKEN_FILE="$TMP/cred/missing.env" \
  PREVIEW_AGENT_ROOT="$REL" bash "$INSTALL" --dry-run 2>&1)
RC2=$?
set -e
[ "$RC2" != 0 ] && pass "缺凭据文件拒绝安装" || fail "缺凭据文件拒绝安装" "rc=0 out=$OUT2"

echo "── T3 --no-load 写 plist（600）但不调用 launchctl；文件内无令牌 ──"
set +e
OUT3=$(PATH="$TMP/bin:$PATH" HOME="$TMP/home" DEPLOY_TOKEN="$SECRET" DEPLOY_TOKEN_FILE="$TOKEN_FILE" \
  PREVIEW_RELEASES_DIR="$TMP/rel" PREVIEW_AGENT_ROOT="$REL" bash "$INSTALL" --no-load 2>&1)
RC3=$?
set -e
[ "$RC3" = 0 ] && pass "--no-load 退出 0" || fail "--no-load 退出 0" "rc=$RC3 out=$OUT3"
if [ -f "$PLIST" ]; then
  pass "plist 已写入"
  if grep -qF "$SECRET" "$PLIST" || grep -q '<key>DEPLOY_TOKEN</key>' "$PLIST"; then fail "plist 文件无令牌" "泄露"; else pass "plist 文件无令牌"; fi
  MODE=$(stat -c '%a' "$PLIST" 2>/dev/null || stat -f '%Lp' "$PLIST")
  [ "$MODE" = 600 ] && pass "plist 权限 600" || fail "plist 权限 600" "$MODE"
else
  fail "plist 已写入" "$OUT3"
fi
[ ! -e "$TMP/launchctl.log" ] && pass "--no-load 不调用 launchctl" || fail "--no-load 不调用 launchctl" "$(cat "$TMP/launchctl.log")"

echo "── T4 既不是部署根也不在发布目录下 → 真实安装仍被拒（防在 worktree 里装）──"
set +e
OUT4=$(PATH="$TMP/bin:$PATH" HOME="$TMP/home" DEPLOY_TOKEN_FILE="$TOKEN_FILE" \
  PREVIEW_RELEASES_DIR="$TMP/rel" PREVIEW_AGENT_ROOT="$TMP/elsewhere" bash "$INSTALL" --no-load 2>&1)
RC4=$?
set -e
[ "$RC4" != 0 ] && pass "非发布目录拒绝安装" || fail "非发布目录拒绝安装" "rc=0 out=$OUT4"

echo "── T5 装载模式：bootout 异步（print 仍见服务数次）+ 首次 bootstrap 返回 5 → 等卸载、重试后装载成功 ──"
# 现场（MMV 10-12）：bootout 立即返回但服务还在卸载，紧接着 bootstrap 报 "Bootstrap failed: 5: Input/output error"
LC="$TMP/lc5"; mkdir -p "$LC/bin" "$LC/state"; touch "$LC/state/loaded"
cat > "$LC/bin/launchctl" <<SH
#!/bin/bash
echo "\$*" >> "$LC/calls.log"
S="$LC/state"
ghost=\$(cat "\$S/ghost" 2>/dev/null || echo 0)
case "\$1" in
  bootout) if [ -e "\$S/loaded" ]; then rm -f "\$S/loaded"; echo 4 > "\$S/ghost"; exit 0; fi; exit 3 ;;
  print) [ -e "\$S/loaded" ] && exit 0; if [ "\$ghost" -gt 0 ]; then echo \$((ghost - 1)) > "\$S/ghost"; exit 0; fi; exit 113 ;;
  bootstrap)
    if [ ! -e "\$S/failed-once" ]; then touch "\$S/failed-once"; echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; fi
    if [ -e "\$S/loaded" ] || [ "\$ghost" -gt 0 ]; then echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; fi
    touch "\$S/loaded"; exit 0 ;;
  kickstart) [ -e "\$S/loaded" ] && exit 0; exit 113 ;;
esac
exit 0
SH
chmod +x "$LC/bin/launchctl"
set +e
OUT5=$(PATH="$LC/bin:$PATH" HOME="$TMP/home" DEPLOY_TOKEN_FILE="$TOKEN_FILE" \
  PREVIEW_LAUNCHD_POLL_INTERVAL=0.05 PREVIEW_LAUNCHD_RETRY_SLEEP=0.05 \
  PREVIEW_RELEASES_DIR="$TMP/rel" PREVIEW_AGENT_ROOT="$REL" bash "$INSTALL" 2>&1)
RC5=$?
set -e
[ "$RC5" = 0 ] && pass "竞态下装载退出 0" || fail "竞态下装载退出 0" "rc=$RC5 out=$OUT5 calls=$(cat "$LC/calls.log" 2>/dev/null)"
grep -q '^print ' "$LC/calls.log" 2>/dev/null && pass "bootout 后轮询 print" || fail "bootout 后轮询 print" "$(cat "$LC/calls.log" 2>/dev/null)"
[ "$(grep -c '^bootstrap ' "$LC/calls.log" 2>/dev/null)" -ge 2 ] && pass "bootstrap 失败后重试" || fail "bootstrap 失败后重试" "$(cat "$LC/calls.log" 2>/dev/null)"
[ -e "$LC/state/loaded" ] && pass "最终服务已装载" || fail "最终服务已装载" "$(cat "$LC/calls.log" 2>/dev/null)"
grep -q '^kickstart ' "$LC/calls.log" 2>/dev/null && pass "装载后 kickstart" || fail "装载后 kickstart" "$(cat "$LC/calls.log" 2>/dev/null)"

echo ""
echo "preview-agent-install.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
