#!/usr/bin/env bash
# codex-request.test.sh — 西安侧只读借用脚本单元自测（mock ssh/scp/codex）
#
# 单一写者模型：美国侧 crontab 是唯一负责刷新+持久化的角色，本脚本只读借用，
# 用完不回传、不覆盖美国侧。详见 codex-request.sh 顶部注释里的红线说明。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../codex-request.sh"
PASS=0; FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

# 生成一个 exp 声明在 offset_seconds 之后的假 JWT（payload 是唯一被脚本解析的部分，
# header/signature 内容无所谓）。offset_seconds 可以是负数，模拟已过期的 token。
make_fake_jwt() {
  local offset_seconds="$1"
  python3 -c "
import json, base64, time
payload = json.dumps({'exp': int(time.time()) + $offset_seconds}).encode()
b64 = base64.urlsafe_b64encode(payload).rstrip(b'=').decode()
print('header.' + b64 + '.signature')
"
}

setup() {
  TMP=$(mktemp -d)
  HOME="$TMP/home"
  mkdir -p "$HOME"
  BIN="$TMP/bin"
  mkdir -p "$BIN"
  LOG="$TMP/calls.log"
  touch "$LOG"

  # 默认拉到手的 token 剩余有效期 9 天（跟生产实测数值同量级），远高于 48h 阈值
  FAKE_AT_FRESH="$(make_fake_jwt 777600)"

  cat >"$BIN/ssh" <<SH
#!/bin/bash
echo "ssh \$*" >> "$LOG"
if [[ "\$*" == *"echo ok"* ]]; then echo ok; exit 0; fi
exit 0
SH
  chmod +x "$BIN/ssh"

  cat >"$BIN/scp" <<SH
#!/bin/bash
echo "scp \$*" >> "$LOG"
dest="\${@: -1}"
if [[ "\$dest" != *":"* ]]; then
  printf '{"tokens":{"access_token":"%s","refresh_token":"mock_rt"}}' "$FAKE_AT_FRESH" > "\$dest"
fi
exit 0
SH
  chmod +x "$BIN/scp"

  cat >"$BIN/codex" <<SH
#!/bin/bash
echo "codex ran with CODEX_HOME=\$CODEX_HOME" >> "$LOG"
exit "\${CODEX_MOCK_EXIT_CODE:-0}"
SH
  chmod +x "$BIN/codex"

  cat >"$BIN/codex-us-exit-guard" <<SH
#!/bin/bash
echo "guard \$*" >> "$LOG"
case "\$1" in
  prepare)
    if [[ "\${MOCK_GUARD_PREPARE_FAIL:-0}" == "1" ]]; then
      echo "mock 美国出口检查失败" >&2
      exit 1
    fi
    : > "\$2"
    ;;
  restore)
    if [[ "\${MOCK_GUARD_RESTORE_FAIL:-0}" == "1" ]]; then
      echo "mock 美国出口恢复失败" >&2
      exit 1
    fi
    rm -f "\$2"
    ;;
  *) exit 2 ;;
esac
SH
  chmod +x "$BIN/codex-us-exit-guard"

  export PATH="$BIN:$PATH"
  export HOME
  export CODEX_EXIT_GUARD="$BIN/codex-us-exit-guard"
  unset MOCK_GUARD_PREPARE_FAIL MOCK_GUARD_RESTORE_FAIL
}

teardown() { rm -rf "$TMP"; }

test_invalid_team_rejected() {
  setup
  if bash "$TARGET" --team team6 >/tmp/out.$$ 2>&1; then
    fail "非法 team（team6）应被拒绝" "脚本却成功退出"
  else
    pass "非法 team（team6）被拒绝"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_missing_team_rejected() {
  setup
  if bash "$TARGET" >/tmp/out.$$ 2>&1; then
    fail "缺少 --team 参数应报错" "脚本却成功退出"
  else
    pass "缺少 --team 参数报错"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_pull_then_run_no_pushback_on_success() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=0 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    fail "codex 正常退出(0)时脚本应以 0 退出" "实际 rc=$rc, 输出: $(cat /tmp/out.$$)"
  elif ! grep -q "codex ran with CODEX_HOME=$HOME/.codex-team3" "$LOG"; then
    fail "应以正确 CODEX_HOME 前台运行 codex" "$(cat "$LOG")"
  elif [[ "$(grep -c '^scp ' "$LOG")" -ne 1 ]]; then
    fail "只读模式下应且只应发生 1 次 scp（拉取），不应有回传" "$(cat "$LOG")"
  else
    pass "正常退出：拉取→跑codex→结束，全程只有 1 次 scp（无回传）"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_no_pushback_even_on_nonzero_exit() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=7 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e
  if [[ "$rc" -ne 7 ]]; then
    fail "脚本应透传 codex 的非零退出码(7)" "实际 rc=$rc"
  elif [[ "$(grep -c '^scp ' "$LOG")" -ne 1 ]]; then
    fail "codex 异常退出(7)时也不应回传，只应有拉取那 1 次 scp" "$(cat "$LOG")"
  else
    pass "codex 非零退出(7)时依然不回传，且退出码透传"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_codex_runs_as_child_so_exit_guard_can_restore() {
  if grep -qE '^\s*exec\s+env\s+CODEX_HOME' "$TARGET"; then
    fail "Codex 应作为子进程运行以便恢复出口" "仍使用 exec 替换脚本进程"
  else
    pass "Codex 作为子进程运行，脚本保留恢复机会"
  fi
}

test_exit_trap_only_restores_network_not_token() {
  if ! grep -qE '^\s*trap\s+.*EXIT' "$TARGET"; then
    fail "应注册 EXIT trap 恢复网络" "未找到 EXIT trap"
  elif grep -qE 'push_token_back|scp.*REMOTE_AUTH' "$TARGET"; then
    fail "EXIT trap 不得恢复 token 回传" "命中回传逻辑"
  else
    pass "EXIT trap 只用于恢复网络，不回传 token"
  fi
}

test_guard_prepare_happens_before_scp() {
  setup
  if ! bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1; then
    fail "guard prepare 发生在 scp 之前" "$(cat /tmp/out.$$)"
  else
    local guard_line scp_line
    guard_line="$(grep -n '^guard prepare ' "$LOG" | head -n 1 | cut -d: -f1 || true)"
    scp_line="$(grep -n '^scp ' "$LOG" | head -n 1 | cut -d: -f1 || true)"
    if [[ -n "$guard_line" && -n "$scp_line" && "$guard_line" -lt "$scp_line" ]]; then
      pass "guard prepare 发生在 scp 之前"
    else
      fail "guard prepare 发生在 scp 之前" "$(cat "$LOG")"
    fi
  fi
  rm -f /tmp/out.$$
  teardown
}

test_guard_failure_prevents_scp_and_codex() {
  setup
  export MOCK_GUARD_PREPARE_FAIL=1
  if bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1; then
    fail "guard 失败时不拉 token、不启动 Codex" "脚本意外成功"
  elif grep -qE '^(scp |codex ran)' "$LOG"; then
    fail "guard 失败时不拉 token、不启动 Codex" "$(cat "$LOG")"
  elif grep -q '美国出口' /tmp/out.$$; then
    pass "guard 失败时不拉 token、不启动 Codex"
  else
    fail "guard 失败时不拉 token、不启动 Codex" "$(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_guard_restores_after_codex_success() {
  setup
  if bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1 && grep -q '^guard restore ' "$LOG"; then
    pass "Codex 成功退出后恢复出口"
  else
    fail "Codex 成功退出后恢复出口" "$(cat "$LOG") $(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_guard_restores_after_codex_nonzero_exit() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=7 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e
  if [[ "$rc" -eq 7 ]] && grep -q '^guard restore ' "$LOG"; then
    pass "Codex 非零退出后恢复出口并保留退出码"
  else
    fail "Codex 非零退出后恢复出口并保留退出码" "rc=$rc $(cat "$LOG")"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_no_push_function_defined() {
  if grep -qE 'push_token_back|scp.*REMOTE_AUTH' "$TARGET"; then
    fail "脚本不应再包含任何往回推的 scp 调用" "$(grep -nE 'push_token_back|scp.*REMOTE_AUTH' "$TARGET")"
  else
    pass "脚本内无任何回传相关代码"
  fi
}

test_no_token_content_printed() {
  if grep -nE 'cat[[:space:]]+.*auth\.json|echo.*auth_token|print.*refresh_token|print.*access_token' "$TARGET"; then
    fail "脚本疑似打印 token 内容" "命中上面 grep 结果"
  else
    pass "grep 确认脚本无打印 token 内容语句"
  fi
}

test_no_login_command() {
  if grep -qE 'codex[[:space:]]+login' "$TARGET"; then
    fail "西安侧脚本绝不能调用 codex login" "命中"
  else
    pass "脚本未调用 codex login（红线遵守）"
  fi
}

test_chmod_600_on_pull() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=0 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  set -e
  if [[ -f "$HOME/.codex-team3/auth.json" ]]; then
    local mode
    if stat --version >/dev/null 2>&1; then
      mode=$(stat -c "%a" "$HOME/.codex-team3/auth.json")   # GNU coreutils (Linux CI)
    else
      mode=$(stat -f "%Lp" "$HOME/.codex-team3/auth.json")  # BSD stat (macOS)
    fi
    if [[ "$mode" == "600" ]]; then
      pass "本地 auth.json 落盘后 mode 为 600"
    else
      fail "本地 auth.json 落盘后 mode 为 600" "实际 mode=$mode"
    fi
  else
    fail "本地 auth.json 落盘后 mode 为 600" "文件不存在"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_rejects_when_remaining_below_48h() {
  setup
  # 覆盖默认的新鲜 mock scp：这次拉到手的 token 只剩 1 小时（3600秒）就过期
  local stale_jwt
  stale_jwt="$(make_fake_jwt 3600)"
  cat >"$BIN/scp" <<SH
#!/bin/bash
echo "scp \$*" >> "$LOG"
dest="\${@: -1}"
if [[ "\$dest" != *":"* ]]; then
  printf '{"tokens":{"access_token":"%s","refresh_token":"mock_rt"}}' "$stale_jwt" > "\$dest"
fi
exit 0
SH
  chmod +x "$BIN/scp"

  set +e
  bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e

  if [[ "$rc" -eq 0 ]]; then
    fail "剩余有效期不足 48h 时应拒绝运行（非 0 退出）" "实际 rc=0, 输出: $(cat /tmp/out.$$)"
  elif grep -q "codex ran with CODEX_HOME" "$LOG"; then
    fail "剩余有效期不足 48h 时不应该跑 codex" "$(cat "$LOG")"
  elif ! grep -qE "剩余有效期不足" /tmp/out.$$; then
    fail "应打印说明剩余有效期不足而拒绝运行的错误信息" "$(cat /tmp/out.$$)"
  else
    pass "剩余有效期不足 48h（模拟美国侧 cron 掉线）时正确拒绝运行，且不调用 codex"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_allows_when_remaining_above_48h() {
  setup
  # 默认 mock 已经是 9 天有效期（远高于 48h），直接复用 setup 里的默认值
  set +e
  bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e

  if [[ "$rc" -ne 0 ]]; then
    fail "剩余有效期充足（9天）时应正常运行" "实际 rc=$rc, 输出: $(cat /tmp/out.$$)"
  elif ! grep -q "codex ran with CODEX_HOME=$HOME/.codex-team3" "$LOG"; then
    fail "剩余有效期充足时应正常跑 codex" "$(cat "$LOG")"
  else
    pass "剩余有效期充足（9天 >= 48h）时正常放行运行 codex"
  fi
  rm -f /tmp/out.$$
  teardown
}

echo "=== codex-request.sh 单元测试 ==="
test_invalid_team_rejected
test_missing_team_rejected
test_pull_then_run_no_pushback_on_success
test_no_pushback_even_on_nonzero_exit
test_codex_runs_as_child_so_exit_guard_can_restore
test_exit_trap_only_restores_network_not_token
test_guard_prepare_happens_before_scp
test_guard_failure_prevents_scp_and_codex
test_guard_restores_after_codex_success
test_guard_restores_after_codex_nonzero_exit
test_no_push_function_defined
test_no_token_content_printed
test_no_login_command
test_chmod_600_on_pull
test_rejects_when_remaining_below_48h
test_allows_when_remaining_above_48h

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
