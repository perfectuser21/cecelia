#!/usr/bin/env bash
# pipeline-trace.sh — 查看任意 branch 的 /dev pipeline 执行全景
#
# 用法：
#   bash packages/engine/scripts/pipeline-trace.sh <branch-name>
#
# 示例：
#   bash packages/engine/scripts/pipeline-trace.sh cp-03301336-pr-review-fail-closed-stophook-fix
#
# 输出：每个 Stage（0-4）的状态、时间、seal 字段、PR URL、CI 状态、Learning 文件

set -euo pipefail

# ──────────────────────────────────────────────
# 参数校验
# ──────────────────────────────────────────────
if [[ $# -lt 1 || "$1" == "--help" || "$1" == "-h" ]]; then
  echo "Usage: pipeline-trace.sh <branch-name>"
  echo ""
  echo "  <branch-name>  要查看的 branch，如 cp-03301336-pr-review-fail-closed-stophook-fix"
  echo ""
  echo "输出该 branch 的 /dev pipeline 执行全景（Stage 0-4 状态、seal 字段、PR/CI、Learning）"
  if [[ $# -lt 1 ]]; then
    exit 1
  fi
  exit 0
fi

BRANCH="$1"

# ──────────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────────

# 从 JSON 文件提取字段值（使用 node 或 jq，优先 node）
_json_field() {
  local file="$1"
  local field="$2"
  if [[ ! -f "$file" ]]; then
    echo ""
    return
  fi
  if command -v node &>/dev/null; then
    node -e "try{const o=JSON.parse(require('fs').readFileSync('$file','utf8'));console.log(o['$field']??'')}catch(e){}" 2>/dev/null || echo ""
  elif command -v jq &>/dev/null; then
    jq -r ".$field // empty" "$file" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

# 从 key: value 格式文件提取字段
_kv_field() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    echo ""
    return
  fi
  grep "^${key}:" "$file" 2>/dev/null | head -1 | sed "s/^${key}:[[:space:]]*//" || echo ""
}

# ──────────────────────────────────────────────
# 查找证据文件（按优先级）
# ──────────────────────────────────────────────
REPO_ROOT=""
EVIDENCE_DIR=""

# 确定仓库根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# packages/engine/scripts/ → ../../.. → repo root
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# 搜索路径：worktrees 优先，主仓库次之
SEARCH_DIRS=()

# 1. 所有 worktree 目录
for wt_dir in "$REPO_ROOT/.claude/worktrees"/*/; do
  if [[ -d "$wt_dir" ]]; then
    SEARCH_DIRS+=("$wt_dir")
  fi
done

# 2. 主仓库根
SEARCH_DIRS+=("$REPO_ROOT")

# 查找 .dev-mode.{branch}
DEV_MODE_FILE=""
for dir in "${SEARCH_DIRS[@]}"; do
  candidate="$dir/.dev-mode.${BRANCH}"
  if [[ -f "$candidate" ]]; then
    DEV_MODE_FILE="$candidate"
    EVIDENCE_DIR="$dir"
    break
  fi
done

# 未找到 branch 数据
if [[ -z "$DEV_MODE_FILE" ]]; then
  echo "未找到 branch '$BRANCH' 的 pipeline 数据。"
  echo "(搜索范围: .claude/worktrees/*/ 和主仓库根目录)"
  exit 0
fi

# ──────────────────────────────────────────────
# 读取 .dev-mode 数据
# ──────────────────────────────────────────────
STARTED=$(_kv_field "$DEV_MODE_FILE" "started")
STEP_0=$(_kv_field "$DEV_MODE_FILE" "step_0_worktree")
STEP_1=$(_kv_field "$DEV_MODE_FILE" "step_1_spec")
STEP_2=$(_kv_field "$DEV_MODE_FILE" "step_2_code")
STEP_3=$(_kv_field "$DEV_MODE_FILE" "step_3_integrate")
STEP_4=$(_kv_field "$DEV_MODE_FILE" "step_4_ship")
PR_URL=$(_kv_field "$DEV_MODE_FILE" "pr_url")
CLEANUP=$(_kv_field "$DEV_MODE_FILE" "cleanup_done")

# ──────────────────────────────────────────────
# 读取 seal 文件
# ──────────────────────────────────────────────
SPEC_SEAL="$EVIDENCE_DIR/.dev-gate-spec.${BRANCH}"
CRG_SEAL="$EVIDENCE_DIR/.dev-gate-crg.${BRANCH}"

# spec seal
SPEC_VERDICT="not found"
SPEC_DIVERGENCE=""
if [[ -f "$SPEC_SEAL" ]]; then
  v=$(_json_field "$SPEC_SEAL" "verdict")
  SPEC_VERDICT="${v:-unknown}"
  d=$(_json_field "$SPEC_SEAL" "divergence_count")
  SPEC_DIVERGENCE="${d}"
fi

# crg seal
CRG_VERDICT="not found"
if [[ -f "$CRG_SEAL" ]]; then
  v=$(_json_field "$CRG_SEAL" "verdict")
  CRG_VERDICT="${v:-unknown}"
fi

# generator seal
GENERATOR_SEAL="$EVIDENCE_DIR/.dev-gate-generator.${BRANCH}"
GENERATOR_STATUS="not found"
if [[ -f "$GENERATOR_SEAL" ]]; then
  GENERATOR_STATUS="✅"
fi

# ──────────────────────────────────────────────
# CI 状态（从 .dev-mode 读取，避免外部 API 依赖）
# ──────────────────────────────────────────────
CI_STATUS="unknown"
if [[ -n "$PR_URL" ]]; then
  ci_raw=$(_kv_field "$DEV_MODE_FILE" "ci_status")
  if [[ -n "$ci_raw" ]]; then
    CI_STATUS="$ci_raw"
  elif [[ "$STEP_3" == "done" && "$STEP_4" != "" ]]; then
    CI_STATUS="success"
  elif [[ "$STEP_3" == "in_progress" ]]; then
    CI_STATUS="pending"
  fi
fi

# ──────────────────────────────────────────────
# Learning 文件
# ──────────────────────────────────────────────
LEARNING_PATH="not found"
LEARNING_RCA=""

# 搜索 docs/learnings/{branch}.md（在 repo root 中）
LEARNING_CANDIDATE="$REPO_ROOT/docs/learnings/${BRANCH}.md"
if [[ -f "$LEARNING_CANDIDATE" ]]; then
  LEARNING_PATH="docs/learnings/${BRANCH}.md"
  if grep -q "### 根本原因" "$LEARNING_CANDIDATE" 2>/dev/null; then
    LEARNING_RCA=" (含 RCA)"
  fi
fi

# ──────────────────────────────────────────────
# 状态图标
# ──────────────────────────────────────────────
_icon() {
  local status="$1"
  case "$status" in
    done|completed|true) echo "✅" ;;
    in_progress|pending) echo "🔄" ;;
    *) echo "⏸️ " ;;
  esac
}

# ──────────────────────────────────────────────
# 输出
# ──────────────────────────────────────────────
LINE="────────────────────────────────────────────────────────"

echo ""
echo "Branch: $BRANCH"
echo "$LINE"

# Stage 0
echo "$(_icon "$STEP_0") Stage 0  Worktree     started: ${STARTED:-unknown}"

# Stage 1
SPEC_DETAIL="seal: $SPEC_VERDICT"
if [[ -n "$SPEC_DIVERGENCE" ]]; then
  SPEC_DETAIL="$SPEC_DETAIL  divergence=$SPEC_DIVERGENCE"
fi
echo "$(_icon "$STEP_1") Stage 1  Spec         step_1_spec: ${STEP_1:-pending}  $SPEC_DETAIL"

# Stage 2
echo "$(_icon "$STEP_2") Stage 2  Code         step_2_code: ${STEP_2:-pending}  crg: $CRG_VERDICT  generator: $GENERATOR_STATUS"

# Stage 3
PR_DISPLAY="${PR_URL:-not found}"
echo "$(_icon "$STEP_3") Stage 3  Integrate    PR: $PR_DISPLAY  CI: $CI_STATUS"

# Stage 4
CLEANUP_DISPLAY="${CLEANUP:-false}"
echo "$(_icon "$STEP_4") Stage 4  Ship         learning: $LEARNING_PATH${LEARNING_RCA}  cleanup: $CLEANUP_DISPLAY"

echo "$LINE"
echo ""
