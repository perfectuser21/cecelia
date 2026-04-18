#!/usr/bin/env bash
# record-evidence.sh
#
# L2 动态契约证据记录器。向 $WORKTREE/.pipeline-evidence.<branch>.jsonl 追加一条
# 标准化 JSON 行，供 /dev pipeline、CI 和 Brain 回放使用。
#
# 设计原则：
#   1. 只做 append，从不重写历史。
#   2. sha256 永远由脚本计算（禁止调用方伪造）。
#   3. event 是封闭集，未知 event 立即拒绝。
#   4. 参数缺失立即 exit 1，不做"尽力而为"。
#
# 依赖：bash>=4, shasum（或 sha256sum）, date, awk, sed

set -euo pipefail

readonly SCHEMA_VERSION="1.0"

readonly -a ALLOWED_EVENTS=(
  subagent_dispatched
  tdd_red
  tdd_green
  pre_completion_verification
  critical_gap_abort
  blocked_escalation
  dispatching_parallel_agents
  architect_reviewer_dispatched
  finishing_discard_confirm
  spec_reviewer_dispatched
)

die() {
  echo "record-evidence: ERROR: $*" >&2
  exit 1
}

is_uuid() {
  [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]
}

in_array() {
  local needle="$1"; shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

sha256_file() {
  local f="$1"
  [[ -f "$f" ]] || die "sha256 target not found: $f"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    die "neither shasum nor sha256sum is available"
  fi
}

iso_now() {
  TZ=Asia/Shanghai date -Iseconds 2>/dev/null || \
    TZ=Asia/Shanghai date "+%Y-%m-%dT%H:%M:%S%z" | sed -E 's/([0-9]{2})([0-9]{2})$/\1:\2/'
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}

validate_json() {
  local line="$1"
  if command -v node >/dev/null 2>&1; then
    node -e "JSON.parse(process.argv[1])" "$line" 2>/dev/null || return 1
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import sys,json; json.loads(sys.argv[1])" "$line" 2>/dev/null || return 1
  fi
  return 0
}

# ---------- 参数 ----------
EVENT=""
TASK_ID=""
BRANCH=""
STAGE=""
WORKTREE="${WORKTREE:-$(pwd)}"
OUTPUT=""

SUBAGENT_TYPE=""
PROMPT_PATH=""
RETURN_STATUS=""
TEST_FILE=""
TEST_COMMAND=""
EXIT_CODE=""
LOG_PATH=""
CHECKLIST_JSON=""
ALL_PASS=""
REASON=""
LEVEL=""
NEXT_ACTION=""
AGENTS_COUNT=""
DIAGNOSTIC_SUBJECTS_JSON=""
ARCHITECT_ISSUE=""
TYPED_CONFIRM=""
CONTEXT_PATH=""

usage() {
  cat <<'EOF_USAGE'
Usage: record-evidence.sh --event <EVENT> [options]

Common:
  --event <name>           closed set 内（见下）
  --task-id <uuid>         可选，不传从 .dev-mode 读
  --branch <name>          可选，不传从 .dev-mode / git 读
  --stage <stage_x_*>      可选，不传从 .dev-mode 推
  --worktree <path>        可选，默认 $WORKTREE 或 $PWD
  --output <path>          可选，默认 <worktree>/.pipeline-evidence.<branch>.jsonl

Event-specific（必填字段，缺失报错）:
  subagent_dispatched:  --subagent-type --prompt --return-status
  tdd_red / tdd_green:  --test-file --test-command --exit-code --log-path
  pre_completion_verification:  --checklist-json --all-pass
  critical_gap_abort:  --reason
  blocked_escalation:  --level --reason --next-action
  dispatching_parallel_agents:  --agents-count --diagnostic-subjects-json
  architect_reviewer_dispatched:  --architect-issue --return-status
  finishing_discard_confirm:  --typed-confirm
  spec_reviewer_dispatched:  --context-path

sha256 由脚本计算，禁止手动传 --prompt-sha256 / --log-sha256。
EOF_USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --event) EVENT="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --stage) STAGE="$2"; shift 2 ;;
    --worktree) WORKTREE="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --subagent-type) SUBAGENT_TYPE="$2"; shift 2 ;;
    --prompt) PROMPT_PATH="$2"; shift 2 ;;
    --return-status) RETURN_STATUS="$2"; shift 2 ;;
    --test-file) TEST_FILE="$2"; shift 2 ;;
    --test-command) TEST_COMMAND="$2"; shift 2 ;;
    --exit-code) EXIT_CODE="$2"; shift 2 ;;
    --log-path) LOG_PATH="$2"; shift 2 ;;
    --checklist-json) CHECKLIST_JSON="$2"; shift 2 ;;
    --all-pass) ALL_PASS="$2"; shift 2 ;;
    --reason) REASON="$2"; shift 2 ;;
    --level) LEVEL="$2"; shift 2 ;;
    --next-action) NEXT_ACTION="$2"; shift 2 ;;
    --agents-count) AGENTS_COUNT="$2"; shift 2 ;;
    --diagnostic-subjects-json) DIAGNOSTIC_SUBJECTS_JSON="$2"; shift 2 ;;
    --architect-issue) ARCHITECT_ISSUE="$2"; shift 2 ;;
    --typed-confirm) TYPED_CONFIRM="$2"; shift 2 ;;
    --context-path) CONTEXT_PATH="$2"; shift 2 ;;
    --prompt-sha256|--log-sha256)
      die "$1 is computed by the script, do not pass it manually"
      ;;
    *) die "unknown argument: $1 (use --help)" ;;
  esac
done

# ---------- 基本校验 ----------
[[ -n "$EVENT" ]] || die "--event is required"
in_array "$EVENT" "${ALLOWED_EVENTS[@]}" || \
  die "event '$EVENT' not in closed set: ${ALLOWED_EVENTS[*]}"

[[ -d "$WORKTREE" ]] || die "worktree not a directory: $WORKTREE"

# ---------- branch 推断 ----------
if [[ -z "$BRANCH" ]]; then
  shopt -s nullglob
  candidates=("$WORKTREE"/.dev-mode.*)
  shopt -u nullglob
  if [[ ${#candidates[@]} -gt 0 ]]; then
    first="${candidates[0]}"
    BRANCH="${first##*/.dev-mode.}"
  fi
fi
if [[ -z "$BRANCH" ]]; then
  if command -v git >/dev/null 2>&1; then
    BRANCH=$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  fi
fi
[[ -n "$BRANCH" ]] || die "cannot determine branch (pass --branch or run inside a git worktree)"

DEV_MODE_FILE="$WORKTREE/.dev-mode.$BRANCH"

# ---------- task_id 推断 ----------
if [[ -z "$TASK_ID" && -f "$DEV_MODE_FILE" ]]; then
  TASK_ID=$(awk -F':[[:space:]]*' '/^task_id:/ {print $2; exit}' "$DEV_MODE_FILE" 2>/dev/null || true)
  TASK_ID="${TASK_ID//\"/}"
  TASK_ID="${TASK_ID//\'/}"
  TASK_ID="$(echo -n "$TASK_ID" | tr -d '[:space:]')"
fi
[[ -n "$TASK_ID" ]] || die "cannot determine task_id (pass --task-id or populate $DEV_MODE_FILE)"
is_uuid "$TASK_ID" || die "task_id not a valid UUID: $TASK_ID"

# ---------- stage 推断 ----------
if [[ -z "$STAGE" && -f "$DEV_MODE_FILE" ]]; then
  STAGE=$(awk -F':[[:space:]]*' '
    /^step_[0-9]+_[a-z_]+:[[:space:]]*in_progress/ { last=$1 }
    END { if (last) print last }
  ' "$DEV_MODE_FILE" 2>/dev/null || true)
  if [[ -n "$STAGE" ]]; then
    STAGE="${STAGE/#step_/stage_}"
  fi
fi
if [[ -z "$STAGE" ]]; then
  echo "record-evidence: WARN: stage not inferred, using 'stage_unknown'" >&2
  STAGE="stage_unknown"
fi

# ---------- event-specific 校验 + 字段构造 ----------
EXTRA_FIELDS=""

append_field() {
  EXTRA_FIELDS+=",$(json_escape "$1"):$2"
}
append_string() {
  append_field "$1" "$(json_escape "$2")"
}
append_raw() {
  append_field "$1" "$2"
}
validate_bool() {
  case "$1" in
    true|false) return 0 ;;
    *) die "$2 must be 'true' or 'false', got: $1" ;;
  esac
}
validate_int() {
  [[ "$1" =~ ^-?[0-9]+$ ]] || die "$2 must be integer, got: $1"
}
validate_json_array() {
  local j="$1" name="$2"
  [[ "$j" =~ ^[[:space:]]*\[ ]] || die "$name must be JSON array starting with '[': $j"
  validate_json "$j" || die "$name is not valid JSON: $j"
}

case "$EVENT" in
  subagent_dispatched)
    [[ -n "$SUBAGENT_TYPE" ]]  || die "--subagent-type required for subagent_dispatched"
    [[ -n "$PROMPT_PATH" ]]    || die "--prompt required for subagent_dispatched"
    [[ -n "$RETURN_STATUS" ]]  || die "--return-status required for subagent_dispatched"
    PROMPT_SHA=$(sha256_file "$PROMPT_PATH")
    append_string subagent_type   "$SUBAGENT_TYPE"
    append_string prompt_path     "$PROMPT_PATH"
    append_string prompt_sha256   "$PROMPT_SHA"
    append_string return_status   "$RETURN_STATUS"
    ;;
  tdd_red|tdd_green)
    [[ -n "$TEST_FILE" ]]     || die "--test-file required for $EVENT"
    [[ -n "$TEST_COMMAND" ]]  || die "--test-command required for $EVENT"
    [[ -n "$EXIT_CODE" ]]     || die "--exit-code required for $EVENT"
    [[ -n "$LOG_PATH" ]]      || die "--log-path required for $EVENT"
    validate_int "$EXIT_CODE" "--exit-code"
    LOG_SHA=$(sha256_file "$LOG_PATH")
    append_string test_file    "$TEST_FILE"
    append_string test_command "$TEST_COMMAND"
    append_raw    exit_code    "$EXIT_CODE"
    append_string log_path     "$LOG_PATH"
    append_string log_sha256   "$LOG_SHA"
    ;;
  pre_completion_verification)
    [[ -n "$CHECKLIST_JSON" ]] || die "--checklist-json required for pre_completion_verification"
    [[ -n "$ALL_PASS" ]]       || die "--all-pass required for pre_completion_verification"
    validate_bool "$ALL_PASS" "--all-pass"
    validate_json_array "$CHECKLIST_JSON" "--checklist-json"
    append_raw checklist_items "$CHECKLIST_JSON"
    append_raw all_pass "$ALL_PASS"
    ;;
  critical_gap_abort)
    [[ -n "$REASON" ]] || die "--reason required for critical_gap_abort"
    append_string reason "$REASON"
    ;;
  blocked_escalation)
    [[ -n "$LEVEL" ]]       || die "--level required for blocked_escalation"
    [[ -n "$REASON" ]]      || die "--reason required for blocked_escalation"
    [[ -n "$NEXT_ACTION" ]] || die "--next-action required for blocked_escalation"
    validate_int "$LEVEL" "--level"
    append_raw    level       "$LEVEL"
    append_string reason      "$REASON"
    append_string next_action "$NEXT_ACTION"
    ;;
  dispatching_parallel_agents)
    [[ -n "$AGENTS_COUNT" ]]             || die "--agents-count required"
    [[ -n "$DIAGNOSTIC_SUBJECTS_JSON" ]] || die "--diagnostic-subjects-json required"
    validate_int "$AGENTS_COUNT" "--agents-count"
    validate_json_array "$DIAGNOSTIC_SUBJECTS_JSON" "--diagnostic-subjects-json"
    append_raw agents_count        "$AGENTS_COUNT"
    append_raw diagnostic_subjects "$DIAGNOSTIC_SUBJECTS_JSON"
    ;;
  architect_reviewer_dispatched)
    [[ -n "$ARCHITECT_ISSUE" ]] || die "--architect-issue required"
    [[ -n "$RETURN_STATUS" ]]   || die "--return-status required"
    append_string architect_issue "$ARCHITECT_ISSUE"
    append_string return_status   "$RETURN_STATUS"
    ;;
  finishing_discard_confirm)
    [[ -n "$TYPED_CONFIRM" ]] || die "--typed-confirm required"
    validate_bool "$TYPED_CONFIRM" "--typed-confirm"
    append_raw typed_confirm "$TYPED_CONFIRM"
    ;;
  spec_reviewer_dispatched)
    [[ -n "$CONTEXT_PATH" ]] || die "--context-path required"
    append_string context_path "$CONTEXT_PATH"
    ;;
  *)
    die "internal: event $EVENT reached dispatch but not handled"
    ;;
esac

# ---------- 输出路径 ----------
if [[ -z "$OUTPUT" ]]; then
  OUTPUT="$WORKTREE/.pipeline-evidence.$BRANCH.jsonl"
fi
OUT_DIR=$(dirname "$OUTPUT")
mkdir -p "$OUT_DIR"

# ---------- 组装 ----------
TS=$(iso_now)
LINE="{\"version\":$(json_escape "$SCHEMA_VERSION"),\"ts\":$(json_escape "$TS"),\"task_id\":$(json_escape "$TASK_ID"),\"branch\":$(json_escape "$BRANCH"),\"stage\":$(json_escape "$STAGE"),\"event\":$(json_escape "$EVENT")${EXTRA_FIELDS}}"

if ! validate_json "$LINE"; then
  die "assembled JSON failed validation"
fi

printf '%s\n' "$LINE" >> "$OUTPUT"
echo "record-evidence: appended event=$EVENT stage=$STAGE to $OUTPUT" >&2
exit 0

# =====================================================================
# 测试样例（仅文档）
# =====================================================================
#
# T1 正确调用：
#   bash record-evidence.sh --event subagent_dispatched \
#     --task-id 11111111-2222-3333-4444-555555555555 --branch cp-x \
#     --stage stage_2_code --subagent-type implementer \
#     --prompt /tmp/prompt.md --return-status DONE
#   # exit 0, 1 line appended with auto prompt_sha256
#
# T2 缺必填：
#   bash record-evidence.sh --event subagent_dispatched
#   # exit 1: "record-evidence: ERROR: --subagent-type required ..."
#
# T3 未知 event：
#   bash record-evidence.sh --event hello_world --task-id ... --branch x
#   # exit 1: "not in closed set"
#
# T4 TDD 自动算 log_sha256，禁止手动传：
#   bash record-evidence.sh --event tdd_red --test-file t.test.ts \
#     --test-command "npm test" --exit-code 1 --log-path /tmp/red.log ...
#   # exit 0 含 log_sha256
#   bash record-evidence.sh --event tdd_red --log-sha256 deadbeef ...
#   # exit 1: "--log-sha256 is computed by the script"
#
# T5 多事件连续 append：
#   export WORKTREE=/tmp/wt && mkdir -p "$WORKTREE"
#   cat > "$WORKTREE/.dev-mode.cp-x" <<YAML
#   task_id: 11111111-2222-3333-4444-555555555555
#   step_1_plan: completed
#   step_2_code: in_progress
#   YAML
#   echo x > /tmp/p1.md && echo x > /tmp/p2.md
#   bash record-evidence.sh --event subagent_dispatched --branch cp-x \
#     --subagent-type planner --prompt /tmp/p1.md --return-status DONE
#   bash record-evidence.sh --event subagent_dispatched --branch cp-x \
#     --subagent-type implementer --prompt /tmp/p2.md --return-status DONE
#   bash record-evidence.sh --event pre_completion_verification --branch cp-x \
#     --checklist-json '[{"id":"c1","pass":true}]' --all-pass true
#   # 3 行，stage 自动推为 stage_2_code
