#!/usr/bin/env bash
# flush-callback-queue.sh — 回调死信队列自愈消费者
# cecelia-run.sh HTTP 回调 3 次重试全败后写 $QUEUE_DIR/<task_id>.json;
# 本脚本在每次 cecelia-run 启动时被调用,逐文件补投:成功删文件,失败保留下次再试。
# 恒 exit 0——补投失败绝不阻断本次任务执行。
set -uo pipefail

QUEUE_DIR="${CALLBACK_QUEUE_DIR:-/tmp/cecelia-callback-queue}"
WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:5221/api/brain/execution-callback}"

[[ -d "$QUEUE_DIR" ]] || exit 0
shopt -s nullglob

for f in "$QUEUE_DIR"/*.json; do
  if curl -sS "$WEBHOOK_URL" -X POST \
      -H "Content-Type: application/json" \
      ${WEBHOOK_TOKEN:+-H "X-Cecilia-Token: $WEBHOOK_TOKEN"} \
      -d @"$f" --max-time 10 >/dev/null 2>&1; then
    rm -f "$f"
    echo "[flush-callback-queue] 补投成功: $(basename "$f")" >&2
  else
    echo "[flush-callback-queue] 补投失败保留: $(basename "$f")" >&2
  fi
done
exit 0
