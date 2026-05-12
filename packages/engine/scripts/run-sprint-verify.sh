#!/usr/bin/env bash
# run-sprint-verify.sh — Generic sprint verification runner
#
# 用途: 调用任意 sprint 目录里的 verify-*.sh 终验脚本，校验产物报告存在且 verdict 行合规
# 用法: bash packages/engine/scripts/run-sprint-verify.sh <sprint-dir> [verify-script]
#       verify-script 默认 verify-p1.sh
#
# 环境变量:
#   BRAIN_URL           Brain endpoint（默认 http://localhost:5221）
#   DATABASE_URL        psql 连接串（部分 oracle 需要）
#   MAX_WAIT_MIN        轮询最大分钟数（透传到 verify 脚本）

set -uo pipefail

SPRINT_DIR="${1:-}"
VERIFY_SCRIPT="${2:-verify-p1.sh}"

if [ -z "$SPRINT_DIR" ]; then
  echo "ERROR: 缺 sprint 目录参数" >&2
  echo "用法: bash $0 <sprint-dir> [verify-script]" >&2
  exit 2
fi

if [ ! -d "$SPRINT_DIR" ]; then
  echo "ERROR: sprint 目录不存在: $SPRINT_DIR" >&2
  exit 2
fi

SCRIPT="${SPRINT_DIR%/}/${VERIFY_SCRIPT}"
if [ ! -x "$SCRIPT" ]; then
  echo "ERROR: 验证脚本不可执行: $SCRIPT" >&2
  exit 2
fi

echo "── 运行 sprint 验证脚本: $SCRIPT"
bash "$SCRIPT"
SCRIPT_EC=$?

REPORT="${SPRINT_DIR%/}/p1-final-acceptance.md"
if [ ! -f "$REPORT" ]; then
  echo "ERROR: 验证脚本未产出报告: $REPORT" >&2
  exit 3
fi

VERDICT_LINE=$(grep -E '^## Verdict: (PASS|FAIL)$' "$REPORT" | head -1 || true)
if [ -z "$VERDICT_LINE" ]; then
  echo "ERROR: 报告缺 '## Verdict: PASS|FAIL' 字面行: $REPORT" >&2
  exit 3
fi

VERDICT="${VERDICT_LINE##*: }"
echo "── 报告产出: $REPORT"
echo "── Verdict: $VERDICT"

# 子脚本退出码透传（脚本本身可能因 oracle FAIL 而非 0）
exit "$SCRIPT_EC"
