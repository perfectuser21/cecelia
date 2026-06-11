#!/usr/bin/env bash
# forensics-no-overwrite-smoke.sh — post-deploy smoke（宿主有 docker 时执行）
#
# 验证新 cecelia-runner 镜像：
#   1. 容器 entrypoint 按注入的 CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE env
#      解析取证路径（断言容器真实 stdout，而非脚本自己写的文件）
#   2. 同一 taskId 两次 docker run spawn → 取证目录出现两组不同文件名的文件
#   3. 第二次 spawn 不覆盖第一次（两组并存），两容器报告的取证路径互不相同
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

# === 辅助：最小 spawn（CECELIA_ENTRYPOINT_TEST=1 短路打印 PROMPT_FILE/STDOUT_FILE 后 exit 0）===
# 返回值（stdout）：容器原样打印的两行（PROMPT_FILE=... / STDOUT_FILE=...）
# 容器退出码非零 → 立即 FAIL（不再 `|| true` 吞错）
run_spawn() {
  local RUN_INSTANCE="$1"
  local PROMPT_CONTENT="$2"
  local PROMPT_FILE="$DIR/${TASK}.${RUN_INSTANCE}.prompt"
  local CID_FILE="$DIR/${TASK}.${RUN_INSTANCE}.cid"
  # 注入到容器的 env 值（容器内路径），后面用作断言 oracle 的期望值
  local CONTAINER_PROMPT="/tmp/cecelia-prompts/${TASK}.${RUN_INSTANCE}.prompt"
  local CONTAINER_STDOUT="/tmp/cecelia-prompts/${TASK}.${RUN_INSTANCE}.stdout"
  echo "$PROMPT_CONTENT" > "$PROMPT_FILE"

  local OUT RC
  set +e
  OUT=$(docker run --rm \
    --cidfile "$CID_FILE" \
    -v "${DIR}:/tmp/cecelia-prompts:rw" \
    -e CECELIA_TASK_ID="$TASK" \
    -e CECELIA_PROMPT_FILE="$CONTAINER_PROMPT" \
    -e CECELIA_STDOUT_FILE="$CONTAINER_STDOUT" \
    -e CECELIA_ENTRYPOINT_TEST=1 \
    "$IMAGE" 2>/dev/null)
  RC=$?
  set -e
  if [ "$RC" -ne 0 ]; then
    echo "FAIL: 实例 $RUN_INSTANCE 容器退出码非零（$RC）"; exit 1
  fi
  printf '%s' "$OUT"
}

# === Run 1 ===
INST1=$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
OUT1=$(run_spawn "$INST1" "SMOKE-RUN-1")

# === Run 2（同 taskId，不同 runInstance）===
INST2=$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
while [ "$INST2" = "$INST1" ]; do
  INST2=$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
done
OUT2=$(run_spawn "$INST2" "SMOKE-RUN-2")

# === 解析容器真实 stdout（协议生效的唯一 oracle）===
PARSE() { printf '%s\n' "$1" | grep "^$2=" | head -1 | cut -d= -f2-; }
ACTUAL_PROMPT1=$(PARSE "$OUT1" PROMPT_FILE)
ACTUAL_STDOUT1=$(PARSE "$OUT1" STDOUT_FILE)
ACTUAL_PROMPT2=$(PARSE "$OUT2" PROMPT_FILE)
ACTUAL_STDOUT2=$(PARSE "$OUT2" STDOUT_FILE)

EXPECT_PROMPT1="/tmp/cecelia-prompts/${TASK}.${INST1}.prompt"
EXPECT_STDOUT1="/tmp/cecelia-prompts/${TASK}.${INST1}.stdout"
EXPECT_PROMPT2="/tmp/cecelia-prompts/${TASK}.${INST2}.prompt"
EXPECT_STDOUT2="/tmp/cecelia-prompts/${TASK}.${INST2}.stdout"

# === 断言 1：容器报告的取证路径与注入 env 精确一致（协议真实生效）===
if [ "$ACTUAL_PROMPT1" != "$EXPECT_PROMPT1" ] || [ "$ACTUAL_STDOUT1" != "$EXPECT_STDOUT1" ]; then
  echo "FAIL: Run 1 容器输出与注入 env 不一致"
  echo "  期望 PROMPT_FILE=$EXPECT_PROMPT1  实际=$ACTUAL_PROMPT1"
  echo "  期望 STDOUT_FILE=$EXPECT_STDOUT1  实际=$ACTUAL_STDOUT1"
  exit 1
fi
if [ "$ACTUAL_PROMPT2" != "$EXPECT_PROMPT2" ] || [ "$ACTUAL_STDOUT2" != "$EXPECT_STDOUT2" ]; then
  echo "FAIL: Run 2 容器输出与注入 env 不一致"
  echo "  期望 PROMPT_FILE=$EXPECT_PROMPT2  实际=$ACTUAL_PROMPT2"
  echo "  期望 STDOUT_FILE=$EXPECT_STDOUT2  实际=$ACTUAL_STDOUT2"
  exit 1
fi
echo "  ✓ 两次容器输出的取证路径均与注入 env 精确一致（协议生效）"

# === 断言 2：两组 prompt 取证文件并存，按 taskId 前缀均可检索 ===
COUNT=$(ls "$DIR" | grep -c "^$TASK" || true)
if [ "$COUNT" -lt 2 ]; then
  echo "FAIL: 按 taskId 前缀检索只找到 $COUNT 个，期望 >=2"; exit 1
fi
echo "  ✓ ls 检索到 $COUNT 个取证文件（两组并存，未覆盖）"

# === 断言 3：两容器报告的取证路径互不相同，且各自含自己实例后缀 ===
if [ "$ACTUAL_PROMPT1" = "$ACTUAL_PROMPT2" ]; then
  echo "FAIL: 两容器报告的 PROMPT_FILE 路径相同，仍可能覆盖"; exit 1
fi
case "$ACTUAL_PROMPT1" in
  *".${INST1}.prompt") ;;
  *) echo "FAIL: Run 1 路径未含实例后缀 .${INST1}.prompt（实际 ${ACTUAL_PROMPT1}）"; exit 1 ;;
esac
case "$ACTUAL_PROMPT2" in
  *".${INST2}.prompt") ;;
  *) echo "FAIL: Run 2 路径未含实例后缀 .${INST2}.prompt（实际 ${ACTUAL_PROMPT2}）"; exit 1 ;;
esac
echo "  ✓ 两容器取证路径互异且分别含各自实例后缀（${INST1} vs ${INST2}）"

echo "[smoke] forensics-no-overwrite: PASS"
exit 0
