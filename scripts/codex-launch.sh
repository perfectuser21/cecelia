#!/usr/bin/env bash
# codex-launch.sh — Codex TUI launcher with retry logic
#
# 使用场景：headed 模式下由 harness-skill-relay.js 通过 tmux 启动。
# 信号处理：SIGABRT/134/137/143 → 重试（最多 MAX_RETRIES=3 次）
#            exit 0 / SIGINT(130) → 正常退出，不重启
#
# INV-11: 只使用 codex-slot receipt 私有目录
# INV-12: 保留 TTY 兼容性，不强制去 TTY
#
# 使用方式：
#   CODEX_HOME=/var/run/... CODEX_SLOT_RECEIPT=... bash codex-launch.sh --task-id <tid> --prompt-file <file>

set -uo pipefail

TASK_ID=""
PROMPT_FILE=""

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id) TASK_ID="$2"; shift 2 ;;
    --prompt-file) PROMPT_FILE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# INV-11: broker/receiver 注入 exact receipt envelope；任何缺失都失败关闭。
for key in CODEX_HOME CODEX_SLOT_AGENT_ID CODEX_SLOT_LEASE_ID CODEX_SLOT_RECEIPT CODEX_SLOT_SESSION_ID; do
  [[ -n "${!key:-}" ]] || { echo "[codex-launch] codex-slot ${key} missing" >&2; exit 78; }
done
unset OPENAI_API_KEY CODEX_RELAY_HOME

MAX_RETRIES="${MAX_RETRIES:-3}"
RETRY_COUNT=0

# 当前 session id（首次运行后由 codex 写出，重试时用于 resume）
CODEX_SESSION_ID="${CODEX_SESSION_ID:-}"

echo "[codex-launch] start: task=${TASK_ID} CODEX_HOME=${CODEX_HOME} MAX_RETRIES=${MAX_RETRIES}" >&2

_run_codex() {
  local exit_code=0
  if [[ -n "$CODEX_SESSION_ID" && "$RETRY_COUNT" -gt 0 ]]; then
    # INV-5: 重试时用 session-id 调 codex resume
    echo "[codex-launch] retry ${RETRY_COUNT}: codex resume ${CODEX_SESSION_ID}" >&2
    codex resume "$CODEX_SESSION_ID" \
      -c 'approval_policy="never"' \
      -c 'sandbox_mode="danger-full-access"' \
      --dangerously-bypass-approvals-and-sandbox \
      || exit_code=$?
  else
    if [[ -n "$PROMPT_FILE" && -f "$PROMPT_FILE" ]]; then
      echo "[codex-launch] initial run with prompt file: ${PROMPT_FILE}" >&2
      codex \
        --dangerously-bypass-approvals-and-sandbox \
        "$(cat "$PROMPT_FILE")" \
        || exit_code=$?
    else
      echo "[codex-launch] initial run (no prompt file)" >&2
      codex \
        --dangerously-bypass-approvals-and-sandbox \
        || exit_code=$?
    fi
  fi
  return "$exit_code"
}

# SIGABRT/ABRT/137/143 处理器：标记需要重试
_ABORT_REQUESTED=0
trap '_ABORT_REQUESTED=1' ABRT SIGABRT

main_loop() {
  while true; do
    _ABORT_REQUESTED=0
    local exit_code=0

    _run_codex || exit_code=$?

    # exit 0：正常完成，不重启（INV-3）
    if [[ $exit_code -eq 0 ]]; then
      echo "[codex-launch] codex exited 0 — done" >&2
      exit 0
    fi

    # exit 130 (SIGINT/Ctrl-C)：用户中断，不重启（INV-3）
    if [[ $exit_code -eq 130 ]]; then
      echo "[codex-launch] codex exited 130 (SIGINT) — not restarting" >&2
      exit 0
    fi

    # SIGABRT (134) / OOM (137) / SIGTERM (143)：重试
    if [[ $exit_code -eq 134 || $exit_code -eq 137 || $exit_code -eq 143 || $_ABORT_REQUESTED -eq 1 ]]; then
      RETRY_COUNT=$((RETRY_COUNT + 1))
      if [[ $RETRY_COUNT -gt $MAX_RETRIES ]]; then
        echo "[codex-launch] max retries (${MAX_RETRIES}) exceeded — exit 1" >&2
        exit 1
      fi
      echo "[codex-launch] abort/crash (exit=${exit_code}), retry ${RETRY_COUNT}/${MAX_RETRIES}" >&2
      sleep 2
      continue
    fi

    # 其他非零退出：不重启
    echo "[codex-launch] codex exited ${exit_code} — not restarting" >&2
    exit "$exit_code"
  done
}

main_loop
