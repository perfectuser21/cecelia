#!/usr/bin/env bash
# OKR Database Storage Script
#
# 将 OKR output.json 存储到 Brain 数据库
#
# Usage:
#   bash store-to-database.sh output.json
#
# 功能：
#   1. 读取 output.json (Features 和 Tasks)
#   2. 映射 repository → project_id
#   3. 创建 Goal (如果需要)
#   4. 创建 Feature SubProjects
#   5. 创建 Tasks (关联到 Feature 和 Goal)
#
# Exit codes:
#   0 - 成功存储所有任务
#   1 - 部分失败（部分任务已创建）
#   2 - 完全失败（无任务创建）

set -euo pipefail

# ===== Configuration =====
OUTPUT_FILE="${1:-output.json}"
BRAIN_API="${BRAIN_API:-http://localhost:5221}"
TASKS_API="${TASKS_API:-http://localhost:5212}"
MAX_RETRIES=3
RETRY_DELAY=2

# ===== Colors =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ===== Helper Functions =====

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}" >&2
}

# Retry API call with exponential backoff
retry_api_call() {
    local method=$1
    local url=$2
    local data=$3
    local retry_count=0

    while [ $retry_count -lt $MAX_RETRIES ]; do
        if response=$(curl -s -X "$method" "$url" \
            -H "Content-Type: application/json" \
            -d "$data" 2>&1); then

            # Check if response is valid JSON
            if echo "$response" | jq empty 2>/dev/null; then
                echo "$response"
                return 0
            fi
        fi

        retry_count=$((retry_count + 1))
        if [ $retry_count -lt $MAX_RETRIES ]; then
            log_warn "API call failed, retrying ($retry_count/$MAX_RETRIES)..."
            sleep $((RETRY_DELAY * retry_count))
        fi
    done

    log_error "API call failed after $MAX_RETRIES retries"
    return 1
}

# Map repository name to project_id
map_repo_to_project() {
    local repo_name=$1

    # Query database for project with matching repo_path
    local project_id=$(curl -s "$TASKS_API/api/tasks/projects" | \
        jq -r ".[] | select(.repo_path != null and (.repo_path | contains(\"$repo_name\"))) | .id" | \
        head -1)

    if [ -z "$project_id" ]; then
        log_error "No project found for repository: $repo_name"
        return 1
    fi

    echo "$project_id"
}

# ===== Main Logic =====

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "OKR Database Storage"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Validate input file
if [ ! -f "$OUTPUT_FILE" ]; then
    log_error "Output file not found: $OUTPUT_FILE"
    exit 2
fi

if ! jq empty "$OUTPUT_FILE" 2>/dev/null; then
    log_error "Invalid JSON format: $OUTPUT_FILE"
    exit 2
fi

log_info "Reading $OUTPUT_FILE..."

# 2. Extract OKR information
OBJECTIVE=$(jq -r '.objective // "Unknown Objective"' "$OUTPUT_FILE")
KR_TITLE=$(jq -r '.key_results[0].title // "Unknown KR"' "$OUTPUT_FILE")

log_info "Objective: $OBJECTIVE"
log_info "Key Result: $KR_TITLE"
echo ""

# 3. Check Brain service
log_info "Checking Brain service..."
if ! curl -s -f "$BRAIN_API/api/brain/health" >/dev/null 2>&1; then
    log_error "Brain service unavailable at $BRAIN_API"
    log_warn "Saving to pending-tasks.json for manual processing"
    cp "$OUTPUT_FILE" pending-tasks.json
    echo ""
    echo "To retry later:"
    echo "  bash $(basename "$0") pending-tasks.json"
    exit 2
fi
log_success "Brain service OK"
echo ""

# 4. Create Goal (if KR ID not provided, create a new Goal)
# For now, we'll use a placeholder goal_id or create one
log_info "Creating Goal..."

GOAL_DATA=$(cat <<EOF
{
  "title": "$OBJECTIVE - $KR_TITLE",
  "description": "$OBJECTIVE",
  "status": "active",
  "priority": "P0"
}
EOF
)

if GOAL_RESPONSE=$(retry_api_call POST "$BRAIN_API/api/brain/action/create-goal" "$GOAL_DATA"); then
    GOAL_ID=$(echo "$GOAL_RESPONSE" | jq -r '.id // .goal_id // empty')
    if [ -n "$GOAL_ID" ]; then
        log_success "Goal created: $GOAL_ID"
    else
        log_warn "Goal creation response unclear, using existing goal"
        # Try to find existing goal
        GOAL_ID=$(curl -s "$TASKS_API/api/tasks/goals" | jq -r ".[0].id // empty")
    fi
else
    log_error "Failed to create Goal"
    exit 2
fi
echo ""

# 5. Process Features and Tasks
FEATURES=$(jq -c '.key_results[].features[]? // empty' "$OUTPUT_FILE")
FEATURE_COUNT=0
TASK_COUNT=0
FAILED_COUNT=0

if [ -z "$FEATURES" ]; then
    log_warn "No features found in $OUTPUT_FILE"
    exit 0
fi

while IFS= read -r feature; do
    FEATURE_COUNT=$((FEATURE_COUNT + 1))

    FEATURE_TITLE=$(echo "$feature" | jq -r '.title')
    FEATURE_DESC=$(echo "$feature" | jq -r '.description')
    REPO_NAME=$(echo "$feature" | jq -r '.repository')

    log_info "Processing Feature $FEATURE_COUNT: $FEATURE_TITLE"

    # Map repository to project_id
    if ! PROJECT_ID=$(map_repo_to_project "$REPO_NAME"); then
        log_error "Skipping feature (repo mapping failed)"
        FAILED_COUNT=$((FAILED_COUNT + 1))
        continue
    fi

    log_info "  Repository: $REPO_NAME → Project: $PROJECT_ID"

    # Create Feature as SubProject
    FEATURE_PROJECT_DATA=$(cat <<EOF
{
  "name": "$FEATURE_TITLE",
  "parent_id": "$PROJECT_ID",
  "description": "$FEATURE_DESC"
}
EOF
)

    if FEATURE_RESPONSE=$(retry_api_call POST "$TASKS_API/api/tasks/projects" "$FEATURE_PROJECT_DATA"); then
        FEATURE_ID=$(echo "$FEATURE_RESPONSE" | jq -r '.id // empty')
        if [ -n "$FEATURE_ID" ]; then
            log_success "  Feature SubProject created: $FEATURE_ID"
        else
            log_error "  Failed to extract Feature ID from response"
            FAILED_COUNT=$((FAILED_COUNT + 1))
            continue
        fi
    else
        log_error "  Failed to create Feature SubProject"
        FAILED_COUNT=$((FAILED_COUNT + 1))
        continue
    fi

    # Create Task for this Feature
    TASK_DATA=$(cat <<EOF
{
  "title": "$FEATURE_TITLE",
  "project_id": "$FEATURE_ID",
  "goal_id": "$GOAL_ID",
  "task_type": "dev",
  "prd_content": "# $FEATURE_TITLE\n\n## 描述\n\n$FEATURE_DESC\n\n## Repository\n\n$REPO_NAME",
  "payload": {
    "from_okr": true,
    "okr_file": "$OUTPUT_FILE",
    "feature_title": "$FEATURE_TITLE",
    "repository": "$REPO_NAME"
  }
}
EOF
)

    if TASK_RESPONSE=$(retry_api_call POST "$BRAIN_API/api/brain/action/create-task" "$TASK_DATA"); then
        TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.id // .task_id // empty')
        if [ -n "$TASK_ID" ]; then
            log_success "  Task created: $TASK_ID"
            TASK_COUNT=$((TASK_COUNT + 1))
        else
            log_warn "  Task creation response unclear"
        fi
    else
        log_error "  Failed to create Task"
        FAILED_COUNT=$((FAILED_COUNT + 1))
    fi

    echo ""
done <<< "$FEATURES"

# 6. Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Storage Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Goal ID: $GOAL_ID"
echo "  Features processed: $FEATURE_COUNT"
echo "  Tasks created: $TASK_COUNT"
echo "  Failed: $FAILED_COUNT"
echo ""

if [ $FAILED_COUNT -gt 0 ]; then
    log_warn "Some tasks failed to store (check logs above)"
    echo ""
    echo "Query successful tasks:"
    echo "  curl -s $TASKS_API/api/tasks/tasks?goal_id=$GOAL_ID | jq"
    exit 1
else
    log_success "All tasks stored successfully!"
    echo ""
    echo "Query tasks:"
    echo "  curl -s $TASKS_API/api/tasks/tasks?goal_id=$GOAL_ID | jq"
    echo ""
    echo "Brain will automatically schedule these tasks"
    exit 0
fi
