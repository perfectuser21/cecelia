#!/usr/bin/env bash
# grok-launch.sh — Grok TUI launcher with retry logic
#
# 使用场景：headed 模式下由 harness-skill-relay.js 通过 tmux 启动。
# 信号处理：SIGABRT/134/137/143 → 重试（最多 MAX_RETRIES=3 次）
#            exit 0 / SIGINT(130) → 正常退出，不重启
#
# GP3 区分：
#   session 建立前崩溃 → 重开新 TUI（不传 --resume）
#   session 建立后崩溃 → grok --resume <session-id> 恢复
#
# INV-10: 不含 patch/sed.*grok/awk.*grok 等修改 Grok 内部逻辑的代码
# INV-12: 不含 --no-tty 或强制去 TTY 的标志
#
# 使用方式：
#   GROK_SESSION_ID=<id> bash grok-launch.sh --task-id <tid> --prompt-file <file>

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

MAX_RETRIES="${MAX_RETRIES:-3}"
RETRY_COUNT=0

# GP3: GROK_SESSION_ID 非空 → session 已建立，重试时用 --resume
GROK_SESSION_ID="${GROK_SESSION_ID:-}"

# FR-R4: debug log 采集
LOG_FILE="${GROK_LOG_FILE:-/tmp/grok-launch-${TASK_ID:-$$}.log}"
echo "[grok-launch] start: task=${TASK_ID} MAX_RETRIES=${MAX_RETRIES} log=${LOG_FILE}" >&2

_run_grok() {
  local exit_code=0

  if [[ -n "$GROK_SESSION_ID" && "$RETRY_COUNT" -gt 0 ]]; then
    # INV-5 + GP3: session 建立后崩溃，用 grok --resume <session-id> 恢复
    echo "[grok-launch] retry ${RETRY_COUNT}: grok --resume ${GROK_SESSION_ID}" >&2
    grok --resume "$GROK_SESSION_ID" 2>> "$LOG_FILE" \
      || exit_code=$?
  else
    # session 未建立（或首次运行）：重开新 TUI，不传 --resume
    if [[ -n "$PROMPT_FILE" && -f "$PROMPT_FILE" ]]; then
      echo "[grok-launch] initial run with prompt file: ${PROMPT_FILE}" >&2
      grok "$(cat "$PROMPT_FILE")" 2>> "$LOG_FILE" \
        || exit_code=$?
    else
      echo "[grok-launch] initial run (no prompt file)" >&2
      grok 2>> "$LOG_FILE" \
        || exit_code=$?
    fi
  fi
  return "$exit_code"
}

# SIGABRT/ABRT 处理器
_ABORT_REQUESTED=0
trap '_ABORT_REQUESTED=1' ABRT SIGABRT

main_loop() {
  while true; do
    _ABORT_REQUESTED=0
    local exit_code=0

    _run_grok || exit_code=$?

    # exit 0：正常完成，不重启（INV-3）
    if [[ $exit_code -eq 0 ]]; then
      echo "[grok-launch] grok exited 0 — done" >&2
      exit 0
    fi

    # exit 130 (SIGINT/Ctrl-C)：用户中断，不重启（INV-3）
    if [[ $exit_code -eq 130 ]]; then
      echo "[grok-launch] grok exited 130 (SIGINT) — not restarting" >&2
      exit 0
    fi

    # SIGABRT (134) / OOM (137) / SIGTERM (143)：重试
    if [[ $exit_code -eq 134 || $exit_code -eq 137 || $exit_code -eq 143 || $_ABORT_REQUESTED -eq 1 ]]; then
      RETRY_COUNT=$((RETRY_COUNT + 1))
      if [[ $RETRY_COUNT -gt $MAX_RETRIES ]]; then
        echo "[grok-launch] max retries (${MAX_RETRIES}) exceeded — exit 1" >&2
        exit 1
      fi
      echo "[grok-launch] abort/crash (exit=${exit_code}), retry ${RETRY_COUNT}/${MAX_RETRIES}" >&2
      sleep 2
      continue
    fi

    # 其他非零退出：不重启
    echo "[grok-launch] grok exited ${exit_code} — not restarting" >&2
    exit "$exit_code"
  done
}

main_loop
