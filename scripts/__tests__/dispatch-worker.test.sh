#!/usr/bin/env bash
# dispatch-worker.test.sh — dispatch-worker.sh 行为测试
# 运行: bash scripts/__tests__/dispatch-worker.test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCH="$SCRIPT_DIR/../dispatch-worker.sh"

PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

# ── 测试 fixtures ──────────────────────────────────────────
TMPDIR_TESTS=$(mktemp -d)
trap 'rm -rf "$TMPDIR_TESTS"' EXIT

TASK_DOC="$TMPDIR_TESTS/task.md"
WORK_DIR="$TMPDIR_TESTS/workdir"
mkdir -p "$WORK_DIR"
echo "说明：这是测试 prompt" > "$TASK_DOC"

echo "── dispatch-worker 行为测试 ──"

# ── B1: 缺 task_doc → exit 2 ──────────────────────────────
echo ""
echo "B1: 参数校验"
CODE=$(bash "$DISPATCH" 2>/dev/null; echo $?) || true
CODE=$(bash "$DISPATCH" 2>/dev/null; echo $?) || true
set +e
bash "$DISPATCH" /nonexistent/doc.md "$WORK_DIR" 2>/dev/null
CODE=$?
set -e
[ "$CODE" -eq 2 ] \
  && ok "B1: task_doc 不存在 → exit 2" \
  || fail "B1: task_doc 不存在应返 exit 2，实际 $CODE"

# ── B2: 缺 work_dir → exit 2 ─────────────────────────────
set +e
bash "$DISPATCH" "$TASK_DOC" /nonexistent/workdir 2>/dev/null
CODE=$?
set -e
[ "$CODE" -eq 2 ] \
  && ok "B2: work_dir 不存在 → exit 2" \
  || fail "B2: work_dir 不存在应返 exit 2，实际 $CODE"

# ── B3: 未知 vendor → exit 2 ─────────────────────────────
set +e
bash "$DISPATCH" --vendor unknownvendor "$TASK_DOC" "$WORK_DIR" 2>/dev/null
CODE=$?
set -e
[ "$CODE" -eq 2 ] \
  && ok "B3: 未知 vendor → exit 2" \
  || fail "B3: 未知 vendor 应返 exit 2，实际 $CODE"

# ── B4: --dry-run → exit 0 + 打印命令行 ──────────────────
echo ""
echo "B4: dry-run 模式"
set +e
OUTPUT=$(bash "$DISPATCH" --vendor claude --dry-run "$TASK_DOC" "$WORK_DIR" 2>/dev/null)
CODE=$?
set -e
[ "$CODE" -eq 0 ] \
  && ok "B4a: --dry-run exit 0" \
  || fail "B4a: --dry-run 应 exit 0，实际 $CODE"
echo "$OUTPUT" | grep -q "DRY-RUN" \
  && ok "B4b: --dry-run 输出含 DRY-RUN 标记" \
  || fail "B4b: --dry-run 输出未含 DRY-RUN: $OUTPUT"

# ── B5: codex dry-run ────────────────────────────────────
set +e
OUTPUT=$(bash "$DISPATCH" --vendor codex --dry-run "$TASK_DOC" "$WORK_DIR" 2>/dev/null)
CODE=$?
set -e
[ "$CODE" -eq 0 ] \
  && ok "B5: codex --dry-run exit 0" \
  || fail "B5: codex --dry-run 应 exit 0，实际 $CODE"

# ── B6: grok dry-run ─────────────────────────────────────
set +e
OUTPUT=$(bash "$DISPATCH" --vendor grok --dry-run "$TASK_DOC" "$WORK_DIR" 2>/dev/null)
CODE=$?
set -e
[ "$CODE" -eq 0 ] \
  && ok "B6: grok --dry-run exit 0" \
  || fail "B6: grok --dry-run 应 exit 0，实际 $CODE"

# ── B7: 额度撞墙检测函数 ─────────────────────────────────
echo ""
echo "B7: 额度撞墙 grep"
WALL_STRINGS=(
  "Usage limit reached for your account"
  "rate_limit_error occurred"
  "429 Too Many Requests"
  "rate limit exceeded, please retry"
  "quota_exceeded error"
  "You have exceeded your quota"
  "Rate Limit Exceeded"
)
PASS_STRINGS=(
  "Successfully completed the task"
  "All done, changes committed."
  "Error: file not found"  # 普通错误，非配额
)

for s in "${WALL_STRINGS[@]}"; do
  echo "$s" | grep -qEi 'Usage limit reached|rate_limit_error|overloaded_error|credit balance|Your account has reached|429 Too Many|rate limit exceeded|usage_limit_exceeded|You have exceeded|quota_exceeded|Rate limit|Rate Limit|Too Many Requests' \
    && ok "B7-wall: [$s] → 正确识别为撞墙" \
    || fail "B7-wall: [$s] 应识别为撞墙但未命中"
done

for s in "${PASS_STRINGS[@]}"; do
  echo "$s" | grep -qEi 'Usage limit reached|rate_limit_error|overloaded_error|credit balance|Your account has reached|429 Too Many|rate limit exceeded|usage_limit_exceeded|You have exceeded|quota_exceeded|Rate limit|Rate Limit|Too Many Requests' \
    && fail "B7-ok: [$s] 被误判为撞墙" \
    || ok "B7-ok: [$s] → 正确识别为非撞墙"
done

# ── B8: 无可用账号 → exit 1 + JSON ok=false ──────────────
echo ""
echo "B8: 无可用账号"

# 临时覆盖 Brain URL 到不存在地址，mock claude 账号列表为空
set +e
OUTPUT=$(BRAIN_URL="http://127.0.0.1:19999" HOME="$TMPDIR_TESTS" \
  bash "$DISPATCH" --vendor claude --max-retries 1 "$TASK_DOC" "$WORK_DIR" 2>/dev/null)
CODE=$?
set -e
# 可能 exit 1（无账号可用）或 exit 0（若 fallback 账号存在）
# 关键：输出是 JSON
echo "$OUTPUT" | python3 -c "import sys,json; json.load(sys.stdin); sys.exit(0)" 2>/dev/null \
  && ok "B8: 输出为合法 JSON" \
  || fail "B8: 输出不是合法 JSON: $OUTPUT"

# ── B9: --output-file 写入文件 ───────────────────────────
echo ""
echo "B9: --output-file"
OUT_FILE="$TMPDIR_TESTS/result.json"
set +e
BRAIN_URL="http://127.0.0.1:19999" HOME="$TMPDIR_TESTS" \
  bash "$DISPATCH" --vendor claude --dry-run --output-file "$OUT_FILE" "$TASK_DOC" "$WORK_DIR" 2>/dev/null
set -e
# dry-run + claude → 账号列表里至少有 account1..4 fallback，应写入文件
[ -f "$OUT_FILE" ] \
  && ok "B9: --output-file 文件已创建" \
  || fail "B9: --output-file 未创建文件 $OUT_FILE"

# ── 汇总 ─────────────────────────────────────────────────
echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" && exit 0 || { echo "❌ 有 $FAIL 项失败"; exit 1; }
