#!/usr/bin/env bash
# skill-eval-worker-loop.sh — 把单次执行的 skill-eval-worker.js 包成常驻循环
# runOnce() 跑完一次任务（或发现没有 pending 任务）就退出进程，
# 因此不能直接用 `pm2 start skill-eval-worker.js` ——需要这层 wrapper 反复拉起它，
# 让 pm2 只需要管好这一个 wrapper 进程的存活（对齐仓库已有先例 gemini-relay/douyin-proxy）。
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while true; do
  node "$SCRIPT_DIR/skill-eval-worker.js"
  sleep 5
done
