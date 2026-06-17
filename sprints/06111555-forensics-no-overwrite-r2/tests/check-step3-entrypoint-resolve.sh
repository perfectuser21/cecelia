#!/usr/bin/env bash
# Golden Path Step 3 oracle — 把 entrypoint.sh 当普通 bash 脚本测其 prompt/stdout 文件解析逻辑。
#   priority: 注入 CECELIA_PROMPT_FILE + CECELIA_STDOUT_FILE → 必须两者均采用注入的唯一文件（非旧拼接）
#   fallback: env 缺失 → 必须两者均回退旧拼接 <taskId>.prompt / <taskId>.stdout（向后兼容滚动部署）
# 依赖 entrypoint 在 set -euo pipefail 之后、副作用之前支持 CECELIA_ENTRYPOINT_TEST=1 短路打印并 exit 0。
set -euo pipefail
MODE="${1:-priority}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
ENTRY="$ROOT/docker/cecelia-runner/entrypoint.sh"
[ -f "$ENTRY" ] || { echo "FAIL: entrypoint 不存在 $ENTRY"; exit 1; }

DIR="$(mktemp -d)"
UNIQUE="$DIR/cf9ce514.deadbeef.prompt"
UNIQUE_STDOUT="$DIR/cf9ce514.deadbeef.stdout"
echo "UNIQUE-PROMPT-SENTINEL" > "$UNIQUE"
echo "UNIQUE-STDOUT-SENTINEL" > "$UNIQUE_STDOUT"

if [ "$MODE" = "priority" ]; then
  OUT=$(CECELIA_ENTRYPOINT_TEST=1 CECELIA_TASK_ID=cf9ce514 \
        CECELIA_PROMPT_FILE="$UNIQUE" CECELIA_STDOUT_FILE="$UNIQUE_STDOUT" \
        bash "$ENTRY" 2>/dev/null || true)
  echo "$OUT" | grep -q "PROMPT_FILE=$UNIQUE" \
    || { echo "FAIL: 注入 CECELIA_PROMPT_FILE 未被采用（仍走旧拼接？）; got=[$OUT]"; exit 1; }
  echo "$OUT" | grep -q "STDOUT_FILE=$UNIQUE_STDOUT" \
    || { echo "FAIL: 注入 CECELIA_STDOUT_FILE 未被采用（仍走旧拼接？）; got=[$OUT]"; exit 1; }
  echo "OK step3/priority: entrypoint 采用注入的唯一文件（prompt+stdout）"

elif [ "$MODE" = "fallback" ]; then
  OUT=$(CECELIA_ENTRYPOINT_TEST=1 CECELIA_TASK_ID=cf9ce514 \
        bash "$ENTRY" 2>/dev/null || true)
  echo "$OUT" | grep -Eq "PROMPT_FILE=.*/cf9ce514\.prompt$" \
    || { echo "FAIL: env 缺失未回退旧拼接 <taskId>.prompt; got=[$OUT]"; exit 1; }
  echo "$OUT" | grep -Eq "STDOUT_FILE=.*/cf9ce514\.stdout$" \
    || { echo "FAIL: env 缺失未回退旧拼接 <taskId>.stdout; got=[$OUT]"; exit 1; }
  if echo "$OUT" | grep -q "$UNIQUE"; then
    echo "FAIL: env 缺失却仍指向唯一 prompt 文件（回退逻辑错）; got=[$OUT]"; exit 1
  fi
  if echo "$OUT" | grep -q "$UNIQUE_STDOUT"; then
    echo "FAIL: env 缺失却仍指向唯一 stdout 文件（回退逻辑错）; got=[$OUT]"; exit 1
  fi
  echo "OK step3/fallback: env 缺失回退旧拼接（prompt+stdout，向后兼容）"

else
  echo "FAIL: 未知 MODE=$MODE（用 priority|fallback）"; exit 1
fi
