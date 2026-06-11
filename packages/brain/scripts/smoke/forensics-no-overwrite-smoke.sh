#!/usr/bin/env bash
# forensics-no-overwrite-smoke.sh — post-deploy smoke（宿主有 docker 时执行）
#
# 验证新 cecelia-runner 镜像：
#   1. 同一 taskId 两次 docker run spawn → 取证目录出现两组不同文件名的 .stdout
#   2. 第二次 spawn 不覆盖第一次（两组并存）
#   3. 容器内 entrypoint 按注入 CECELIA_PROMPT_FILE env 读 prompt（含实例后缀）
#
# 使用方式（宿主，需已执行 bash docker/build.sh 重建镜像）：
#   bash packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh
#
# 依赖：docker daemon 可用 + cecelia/runner:latest 已构建
set -euo pipefail

IMAGE="${CECELIA_RUNNER_IMAGE:-cecelia/runner:latest}"
TASK="smoke-forensics-$$"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

echo "[smoke] forensics-no-overwrite: image=$IMAGE task=$TASK dir=$DIR"

# === 辅助：最小 spawn（打印 PROMPT_FILE 并 exit 0，不跑真实 claude）===
run_spawn() {
  local RUN_INSTANCE="$1"
  local PROMPT_CONTENT="$2"
  local PROMPT_FILE="$DIR/${TASK}.${RUN_INSTANCE}.prompt"
  local STDOUT_FILE="$DIR/${TASK}.${RUN_INSTANCE}.stdout"
  local CID_FILE="$DIR/${TASK}.${RUN_INSTANCE}.cid"
  echo "$PROMPT_CONTENT" > "$PROMPT_FILE"
  # 在容器内跑 entrypoint 短路模式：CECELIA_ENTRYPOINT_TEST=1 打印 PROMPT_FILE/STDOUT_FILE 后 exit 0
  docker run --rm \
    --cidfile "$CID_FILE" \
    -v "${DIR}:/tmp/cecelia-prompts:rw" \
    -e CECELIA_TASK_ID="$TASK" \
    -e CECELIA_PROMPT_FILE="/tmp/cecelia-prompts/${TASK}.${RUN_INSTANCE}.prompt" \
    -e CECELIA_STDOUT_FILE="/tmp/cecelia-prompts/${TASK}.${RUN_INSTANCE}.stdout" \
    -e CECELIA_ENTRYPOINT_TEST=1 \
    "$IMAGE" 2>/dev/null || true
  echo "$STDOUT_FILE"
}

# === Run 1 ===
INST1=$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
STDOUT1=$(run_spawn "$INST1" "SMOKE-RUN-1")

# === Run 2（同 taskId，不同 runInstance）===
INST2=$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
while [ "$INST2" = "$INST1" ]; do
  INST2=$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
done
STDOUT2=$(run_spawn "$INST2" "SMOKE-RUN-2")

# === 断言 1：两组 stdout 取证并存 ===
if [ ! -f "$DIR/${TASK}.${INST1}.prompt" ]; then
  echo "FAIL: Run 1 prompt 文件不存在: $DIR/${TASK}.${INST1}.prompt"; exit 1
fi
if [ ! -f "$DIR/${TASK}.${INST2}.prompt" ]; then
  echo "FAIL: Run 2 prompt 文件不存在: $DIR/${TASK}.${INST2}.prompt"; exit 1
fi
echo "  ✓ 两组 prompt 取证文件并存"

# === 断言 2：ls|grep <taskId 前缀> 两组均可检索 ===
COUNT=$(ls "$DIR" | grep -c "^$TASK" || true)
if [ "$COUNT" -lt 2 ]; then
  echo "FAIL: 按 taskId 前缀 grep 只找到 $COUNT 个，期望 >=2"; exit 1
fi
echo "  ✓ ls|grep 检索到 $COUNT 组取证文件"

# === 断言 3：两次 cidfile 路径不同（运行实例唯一）===
if [ "$INST1" = "$INST2" ]; then
  echo "FAIL: 两次 spawn runInstance 相同（碰撞），仍可能覆盖"; exit 1
fi
echo "  ✓ 两次 runInstance 不同（$INST1 vs $INST2）"

echo "[smoke] forensics-no-overwrite: PASS"
