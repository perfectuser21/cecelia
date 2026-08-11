#!/usr/bin/env bash
# 验证 should-auto-merge.sh 的合并决策逻辑。
# 背景：CI 通用 auto-merge、harness kernel mergeGate、engine-pr-watchdog 是三条互不知晓的
# PR 合并通道。harness generator 产出的 PR 也用 cp-* 分支命名，会触发同一个 ci.yml；通用
# 通道只看「cp-* 分支 + CI 绿」就 squash merge，比 kernel 的 evaluator+judge gate 快，会
# 抢先合并、架空裁判裁决权（#4755/#4759 实证）。
# 2026-08 收敛：判据从「PR 标题 feat(harness): 前缀」（LLM 自由字段，#4755 漏过）换成向
# Brain 求证归属（查 initiative_runs.pr_url）。本脚本用 PATH 注入 fake curl 控制 Brain 应答，
# 断言脚本按归属决策，并覆盖 fail-closed 三态。
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/should-auto-merge.sh"
WORKFLOW="$(cd "$(dirname "$0")/../.." && pwd)/ci.yml"
AUTO_MERGE_JOB="$(awk '
  /^  auto-merge:/ { capture=1; next }
  capture && /^  [a-zA-Z0-9_-]+:/ { exit }
  capture { print }
' "$WORKFLOW")"
PASS=0; FAIL=0

# fake curl：脚本约定 curl -w $'\n%{http_code}'，故输出 body\n<code>；由 FAKE_MODE 控制应答。
FAKE_DIR="$(mktemp -d)"
trap 'rm -rf "$FAKE_DIR"' EXIT
cat > "$FAKE_DIR/curl" <<'FAKE'
#!/usr/bin/env bash
case "${FAKE_MODE:-}" in
  owned)    printf '{"owned":true,"run_id":"11111111-1111-4111-8111-111111111111","pr_number":4755,"reason":"matched"}\n200' ;;
  notowned) printf '{"owned":false,"run_id":null,"pr_number":123,"reason":"no match"}\n200' ;;
  5xx)      printf '{"error":"boom"}\n500' ;;
  badjson)  printf 'not-json-at-all\n200' ;;
  timeout)  exit 28 ;;
  *)        printf '\n000' ;;
esac
FAKE
chmod +x "$FAKE_DIR/curl"

# assert_decision <期望关键词> <描述> <FAKE_MODE> <head_branch> <pr_number>
assert_decision() {
  local expect="$1" desc="$2" mode="$3" branch="$4" prnum="$5"
  local out
  out="$(FAKE_MODE="$mode" PATH="$FAKE_DIR:$PATH" BRAIN_URL="http://brain.local" bash "$SCRIPT" "$branch" "$prnum" 2>&1 || true)"
  if echo "$out" | grep -q "$expect"; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (期望含 '$expect'，实际: $out)"; FAIL=$((FAIL+1))
  fi
}

# ── 归属决策（不看标题，只看 Brain 求证）─────────────────────────────────────
# harness-owned（Brain owned:true）→ 跳过通用 auto-merge，交给 kernel mergeGate。核心断言。
assert_decision "SKIP" "Brain owned:true（harness-owned）→ 跳过 auto-merge" \
  "owned" "cp-08101107-04e4690d" "4755"

# 手动 /dev 的 cp-* PR（Brain owned:false）→ 正常走 auto-merge（不能误伤 /dev 流程，红线）。
assert_decision "MERGE" "Brain owned:false（手动 /dev）→ 正常 auto-merge" \
  "notowned" "cp-manual-dev" "123"

# 非 cp-* 分支 → 跳过（保留原有行为）。curl 之前就短路，FAKE_MODE 无关。
assert_decision "SKIP" "非 cp-* 分支 → 跳过 auto-merge" \
  "owned" "feature/manual-branch" "999"

# ── fail-closed 三态（Brain 5xx / 非法 JSON / 超时）一律 SKIP（任一 MERGE 即失败，红线）──
assert_decision "SKIP" "fail-closed: Brain 5xx → SKIP" \
  "5xx" "cp-08101107-04e4690d" "4755"
assert_decision "SKIP" "fail-closed: 非法 JSON → SKIP" \
  "badjson" "cp-08101107-04e4690d" "4755"
assert_decision "SKIP" "fail-closed: curl 超时 → SKIP" \
  "timeout" "cp-08101107-04e4690d" "4755"

# ── auto-merge step 结构断言：以 $PR_NUMBER（非 $PR_TITLE）调脚本 ─────────────────
if echo "$AUTO_MERGE_JOB" | grep -Fq 'should-auto-merge.sh "$HEAD_BRANCH" "$PR_NUMBER"'; then
  echo "PASS: auto-merge step 以 \$PR_NUMBER 调脚本（Brain 求证归属）"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge step 未以 \$PR_NUMBER 调脚本（归属判据回退风险）"; FAIL=$((FAIL+1))
fi

# ── workflow 结构断言（保留不动）───────────────────────────────────────────────
# ci-passed 的依赖包含按路径跳过的 jobs。GitHub 会把 skip 沿 needs 链传播，
# 所以下游 auto-merge 必须显式使用 always()，再自行检查 ci-passed 的结果。
if grep -Fq "if: always() && needs.ci-passed.result == 'success' && github.event_name == 'pull_request'" "$WORKFLOW"; then
  echo "PASS: auto-merge 可越过 needs 链中的 skipped jobs"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge 缺少 always()，会被 needs 链中的 skipped jobs 连带跳过"; FAIL=$((FAIL+1))
fi

# ci-passed 只覆盖本 workflow；Smoke Glob、CodeQL 等必需检查可能仍在运行。
# 必须启用 GitHub 原生 auto-merge 排队，不能用短重试赌其他 workflow 已结束。
if echo "$AUTO_MERGE_JOB" | grep -Fq 'gh pr merge "$PR_NUMBER" --auto --squash --delete-branch'; then
  echo "PASS: auto-merge 排队等待全部分支保护条件"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge 未使用 --auto，会在其他 workflow 尚未完成时失败"; FAIL=$((FAIL+1))
fi

if echo "$AUTO_MERGE_JOB" | grep -Fq "contents: write" \
  && echo "$AUTO_MERGE_JOB" | grep -Fq "pull-requests: write"; then
  echo "PASS: auto-merge job 具备最小写权限"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge job 缺少启用原生 auto-merge 所需的写权限"; FAIL=$((FAIL+1))
fi

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
