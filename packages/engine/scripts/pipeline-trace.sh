#!/usr/bin/env bash
# pipeline-trace.sh — 查看任意 branch 的 /dev pipeline 执行全景
#
# 用法：
#   bash packages/engine/scripts/pipeline-trace.sh <branch-name>
#
# 示例：
#   bash packages/engine/scripts/pipeline-trace.sh cp-03301519-pipeline-trace-detail
#
# 输出：每个 Stage（0-4）的状态、时间、seal 字段、PR URL、CI 状态、Learning 文件

set -euo pipefail

# ──────────────────────────────────────────────
# 参数校验
# ──────────────────────────────────────────────
if [[ $# -lt 1 || "$1" == "--help" || "$1" == "-h" ]]; then
  echo "Usage: pipeline-trace.sh <branch-name>"
  echo ""
  echo "  <branch-name>  要查看的 branch，如 cp-03301519-pipeline-trace-detail"
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
GENERATOR_SEAL="$EVIDENCE_DIR/.dev-gate-generator.${BRANCH}"
PLANNER_SEAL="$EVIDENCE_DIR/.dev-gate-planner.${BRANCH}"

# spec seal
SPEC_VERDICT="not found"
SPEC_DIVERGENCE=""
SPEC_REVIEWER=""
SPEC_TIMESTAMP=""
SPEC_SUMMARY=""
if [[ -f "$SPEC_SEAL" ]]; then
  v=$(_json_field "$SPEC_SEAL" "verdict")
  SPEC_VERDICT="${v:-unknown}"
  d=$(_json_field "$SPEC_SEAL" "divergence_count")
  SPEC_DIVERGENCE="${d}"
  r=$(_json_field "$SPEC_SEAL" "reviewer")
  SPEC_REVIEWER="${r}"
  t=$(_json_field "$SPEC_SEAL" "timestamp")
  SPEC_TIMESTAMP="${t}"
  raw=$(_json_field "$SPEC_SEAL" "summary")
  if [[ -n "$raw" ]]; then
    SPEC_SUMMARY=$(echo "$raw" | head -1)
  fi
fi

# crg seal
CRG_VERDICT="not found"
CRG_REVIEWER=""
if [[ -f "$CRG_SEAL" ]]; then
  v=$(_json_field "$CRG_SEAL" "verdict")
  CRG_VERDICT="${v:-unknown}"
  r=$(_json_field "$CRG_SEAL" "reviewer")
  CRG_REVIEWER="${r}"
fi

# generator seal
GENERATOR_BUILD=""
GENERATOR_FILES=""
if [[ -f "$GENERATOR_SEAL" ]]; then
  b=$(_json_field "$GENERATOR_SEAL" "build_status")
  GENERATOR_BUILD="${b}"
  GENERATOR_FILES=$(node -e "try{const o=JSON.parse(require('fs').readFileSync('$GENERATOR_SEAL','utf8'));const a=o['files_modified'];if(Array.isArray(a)){console.log(a.length+'  ['+a.map(f=>f.split('/').pop()).join(', ')+']')}else console.log('')}catch(e){}" 2>/dev/null)
fi

# planner seal
PLANNER_STATUS=""
PLANNER_SEALED_BY=""
PLANNER_TIMESTAMP=""
if [[ -f "$PLANNER_SEAL" ]]; then
  s=$(_json_field "$PLANNER_SEAL" "status")
  PLANNER_STATUS="${s}"
  sb=$(_json_field "$PLANNER_SEAL" "sealed_by")
  PLANNER_SEALED_BY="${sb}"
  pt=$(_json_field "$PLANNER_SEAL" "timestamp")
  PLANNER_TIMESTAMP="${pt}"
fi

# ──────────────────────────────────────────────
# 从 PR_URL 提取 PR number
# ──────────────────────────────────────────────
PR_NUMBER=""
if [[ -n "$PR_URL" ]]; then
  PR_NUMBER=$(echo "$PR_URL" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' || echo "")
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
RCA_EXCERPT=""

# 搜索 docs/learnings/{branch}.md（在 repo root 中）
LEARNING_CANDIDATE="$REPO_ROOT/docs/learnings/${BRANCH}.md"
if [[ -f "$LEARNING_CANDIDATE" ]]; then
  LEARNING_PATH="docs/learnings/${BRANCH}.md"
  if grep -q "### 根本原因" "$LEARNING_CANDIDATE" 2>/dev/null; then
    RCA_EXCERPT=$(grep -A 10 "### 根本原因" "$LEARNING_CANDIDATE" 2>/dev/null | grep -vE "^###|^$|^---" | head -1 | sed 's/^[[:space:]]*//')
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
INDENT="           "

echo ""
echo "Branch: $BRANCH"
echo "$LINE"

# Stage 0
echo "$(_icon "$STEP_0") Stage 0  Worktree"
echo "${INDENT}started: ${STARTED:-unknown}"

# Stage 1
SPEC_LINE="spec: $SPEC_VERDICT"
if [[ -n "$SPEC_DIVERGENCE" ]]; then
  SPEC_LINE="$SPEC_LINE  divergence=$SPEC_DIVERGENCE"
fi
if [[ -n "$SPEC_REVIEWER" ]]; then
  SPEC_LINE="$SPEC_LINE  reviewer: $SPEC_REVIEWER"
fi
if [[ -n "$SPEC_TIMESTAMP" ]]; then
  SPEC_LINE="$SPEC_LINE  at: $SPEC_TIMESTAMP"
fi

PLANNER_LINE=""
if [[ -n "$PLANNER_STATUS" ]]; then
  PLANNER_LINE="planner: $PLANNER_STATUS"
  if [[ -n "$PLANNER_SEALED_BY" ]]; then
    PLANNER_LINE="$PLANNER_LINE  sealed_by: $PLANNER_SEALED_BY"
  fi
  if [[ -n "$PLANNER_TIMESTAMP" ]]; then
    PLANNER_LINE="$PLANNER_LINE  at: $PLANNER_TIMESTAMP"
  fi
fi

echo "$(_icon "$STEP_1") Stage 1  Spec"
echo "${INDENT}${SPEC_LINE}"
if [[ -n "$PLANNER_LINE" ]]; then
  echo "${INDENT}${PLANNER_LINE}"
fi

# Stage 2
CRG_LINE="crg: $CRG_VERDICT"
if [[ -n "$CRG_REVIEWER" ]]; then
  CRG_LINE="$CRG_LINE  crg_reviewer: $CRG_REVIEWER"
fi

GENERATOR_LINE=""
if [[ -n "$GENERATOR_BUILD" ]]; then
  GENERATOR_LINE="build: $GENERATOR_BUILD"
fi
if [[ -n "$GENERATOR_FILES" ]]; then
  # GENERATOR_FILES 格式: "2  [file1.sh, file2.ts]"
  FILES_COUNT=$(echo "$GENERATOR_FILES" | awk '{print $1}')
  FILES_LIST=$(echo "$GENERATOR_FILES" | sed 's/^[0-9]*[[:space:]]*//')
  if [[ -n "$GENERATOR_LINE" ]]; then
    GENERATOR_LINE="$GENERATOR_LINE  files: $FILES_COUNT  $FILES_LIST"
  else
    GENERATOR_LINE="files: $FILES_COUNT  $FILES_LIST"
  fi
fi

echo "$(_icon "$STEP_2") Stage 2  Code"
echo "${INDENT}${CRG_LINE}"
if [[ -n "$GENERATOR_LINE" ]]; then
  echo "${INDENT}${GENERATOR_LINE}"
fi

# Stage 3
echo "$(_icon "$STEP_3") Stage 3  Integrate"
PR_DISPLAY_LINE=""
if [[ -n "$PR_NUMBER" ]]; then
  PR_DISPLAY_LINE="PR #${PR_NUMBER}  CI: $CI_STATUS"
else
  PR_DISPLAY_LINE="PR: ${PR_URL:-not found}  CI: $CI_STATUS"
fi
echo "${INDENT}${PR_DISPLAY_LINE}"
if [[ -n "$PR_URL" ]]; then
  echo "${INDENT}${PR_URL}"
fi

# Stage 4
SHIP_LINE="learning: $LEARNING_PATH  cleanup: ${CLEANUP:-false}"
echo "$(_icon "$STEP_4") Stage 4  Ship"
echo "${INDENT}${SHIP_LINE}"
if [[ -n "$RCA_EXCERPT" ]]; then
  echo "${INDENT}rca: $RCA_EXCERPT"
fi

echo "$LINE"
echo ""
