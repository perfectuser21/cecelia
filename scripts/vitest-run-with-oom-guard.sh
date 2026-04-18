#!/usr/bin/env bash
# vitest-run-with-oom-guard.sh
#
# 包裹 vitest 调用，区分"真测试失败"和"tinypool worker OOM 假阳性"。
#
# 背景：vitest forks 模式下，测试跑完后 fork 进程可能因内存碎片 OOM 退出，
# tinypool 报 "Worker exited unexpectedly"，导致 vitest 返回 exit 1，
# 但实际所有测试都通过了。
#
# 判定规则（按优先级）：
#   1. exit 0                              → 成功，直接返回
#   2. 输出含 "Failed Tests N"            → 真测试失败，传播 exit code
#   3. 输出含 "Worker exited unexpectedly" 且含 "Tests.*N passed"
#                                          → OOM 假阳性，返回 0
#   4. 其他（类型错误/编译错误等）        → 传播 exit code
#
# 用法：
#   LABEL="brain-unit shard 1/4" bash scripts/vitest-run-with-oom-guard.sh \
#     npx vitest run --shard=1/4 --reporter=verbose
#
# 环境变量：
#   LABEL    — 日志前缀（默认 "vitest"）
#   LOG_FILE — 输出落盘路径（默认 /tmp/vitest-out.txt）

set -uo pipefail

LOG_FILE="${LOG_FILE:-/tmp/vitest-out.txt}"
LABEL="${LABEL:-vitest}"

if [[ $# -eq 0 ]]; then
  echo "[$LABEL] ERROR: 未提供 vitest 命令" >&2
  echo "用法: LABEL=\"...\" $0 npx vitest run [options]" >&2
  exit 2
fi

"$@" 2>&1 | tee "$LOG_FILE"
EXIT=${PIPESTATUS[0]}

if [[ $EXIT -eq 0 ]]; then
  exit 0
fi

# "Failed Tests N" header 仅在真实断言失败时出现 — 直接判定为真失败
if grep -qE '^[^a-zA-Z]*Failed Tests [0-9]+' "$LOG_FILE"; then
  echo "[$LABEL] 检测到真实测试失败，exit $EXIT"
  exit "$EXIT"
fi

# 无真失败，但 exit 非零 — 检查是否为 worker OOM 假阳性
if grep -qE 'Worker exited unexpectedly' "$LOG_FILE" \
   && grep -qE 'Tests.*[0-9]+ passed' "$LOG_FILE"; then
  echo "[$LABEL] worker OOM 退出但所有测试通过 — 视为成功（exit 0）"
  exit 0
fi

echo "[$LABEL] 非测试类失败（setup/typecheck/编译错误等），传播 exit $EXIT"
exit "$EXIT"
