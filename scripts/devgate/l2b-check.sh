#!/usr/bin/env bash
set -euo pipefail

# L2B Evidence Check
# 支持两种模式：pr（L2B-min）和 release（L2B-full）

MODE="${1:-pr}"
EVIDENCE_FILE=".layer2-evidence.md"

echo "==> L2B Evidence Check (mode: $MODE)"

# 检查文件存在
if [[ ! -f "$EVIDENCE_FILE" ]]; then
  echo "❌ 缺少 $EVIDENCE_FILE"
  echo "提示: 创建该文件记录可复核证据（手动验证、自动化测试、截图等）"
  exit 1
fi

# 检查文件不为空
if [[ ! -s "$EVIDENCE_FILE" ]]; then
  echo "❌ $EVIDENCE_FILE 为空"
  exit 1
fi

# 检查必需字段
REQUIRED_SECTIONS=(
  "## 手动验证"
  "## 自动化测试"
)

for section in "${REQUIRED_SECTIONS[@]}"; do
  if ! grep -qF "$section" "$EVIDENCE_FILE"; then
    echo "❌ 缺少必需章节: $section"
    exit 1
  fi
done

# L2B-min: 至少 1 条可复核证据
if [[ "$MODE" == "pr" ]]; then
  # P1-1: 增强检查 - 必须有可复现命令或机器引用
  # 可复现命令：包含 bash/npm/node/git 等命令
  # 机器引用：包含 CI run ID、commit SHA、文件 hash 等

  HAS_COMMAND=false
  HAS_MACHINE_REF=false

  # 检查可复现命令（在代码块内或列表项中）
  if grep -qE '(npm run|bash |node |git |pytest |cargo |go test)' "$EVIDENCE_FILE"; then
    HAS_COMMAND=true
  fi

  # 检查机器引用（SHA、run ID、hash 等）
  if grep -qE '([0-9a-f]{7,40}|run[_-]?id|#[0-9]+|sha256)' "$EVIDENCE_FILE"; then
    HAS_MACHINE_REF=true
  fi

  if [[ "$HAS_COMMAND" == "false" && "$HAS_MACHINE_REF" == "false" ]]; then
    echo "❌ L2B 需要可复现证据："
    echo "   - 可复现命令（如 npm run test, bash scripts/check.sh）"
    echo "   - 或机器引用（如 CI run ID, commit SHA, file hash）"
    exit 1
  fi

  # 简单检查：至少有一个列表项或代码块
  if ! grep -qE '^- |^```' "$EVIDENCE_FILE"; then
    echo "❌ 至少需要 1 条可复核证据（列表项或代码块）"
    exit 1
  fi

  echo "✅ L2B-min 检查通过 (command=$HAS_COMMAND, machine_ref=$HAS_MACHINE_REF)"
fi

# L2B-full: 完整证据 + DoD 全勾
if [[ "$MODE" == "release" ]]; then
  # 检查 DoD 引用
  if ! grep -qF "## DoD 完成度" "$EVIDENCE_FILE"; then
    echo "❌ Release 模式需要 '## DoD 完成度' 章节"
    exit 1
  fi
  
  # 检查是否有未完成项（[ ]）
  if grep -q '^\- \[ \]' "$EVIDENCE_FILE"; then
    echo "❌ 存在未完成的 DoD 项"
    exit 1
  fi
  
  echo "✅ L2B-full 检查通过"
fi

exit 0
