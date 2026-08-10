#!/usr/bin/env bash
# 验证 should-auto-merge.sh 的合并决策逻辑。
#
# 背景：CI 通用 auto-merge 与 harness 自己的 evaluator+DeepSeek 裁判 gate 是两条独立的
# PR 合并通道。harness generator 产出的 PR 也用 cp-* 分支命名，会触发同一个 ci.yml；
# 通用通道只看「cp-* 分支 + CI 绿」就 squash merge，比裁判 gate 快，会抢先合并、架空
# 裁判裁决权。
#
# 归属判据（法源：决策 e8f6134f；事故 PR #4755）：不再用 PR 标题前缀（LLM 自由撰写、
# 不可靠——#4755 标题是 fix(orchestrator): 就漏过了闸），改为向 Brain 求证
# initiative_runs.pr_url（kernel 写入，非 LLM）。本测试用 BRAIN_CURL stub 模拟 Brain
# 的各种回应，验证 SKIP / MERGE 决策与 fail-closed 方向。
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/should-auto-merge.sh"
WORKFLOW="$(cd "$(dirname "$0")/../.." && pwd)/ci.yml"
AUTO_MERGE_JOB="$(awk '
  /^  auto-merge:/ { capture=1; next }
  capture && /^  [a-zA-Z0-9_-]+:/ { exit }
  capture { print }
' "$WORKFLOW")"
PASS=0; FAIL=0

# ── Brain HTTP 客户端 stub（脚本用 -w '\n%{http_code}' 拿 body+状态码）──────────────
STUB_DIR="$(mktemp -d)"
trap 'rm -rf "$STUB_DIR"' EXIT

mk_stub() { # <name> <exit_code> <printf_payload...>
  local name="$1" ec="$2"; shift 2
  {
    echo '#!/usr/bin/env bash'
    if [ "$ec" -ne 0 ]; then echo "exit $ec"; fi
    printf 'printf %s\n' "'$*'"
  } > "$STUB_DIR/$name"
  chmod +x "$STUB_DIR/$name"
}

# 属于某条 harness run（owned:true）→ 200
mk_stub curl_owned      0 '{"owned":true,"run_id":"r1"}\n200'
# 不属于任何 harness run（owned:false）→ 200
mk_stub curl_not_owned  0 '{"owned":false}\n200'
# 连接超时（curl 非零退出，模拟 -m 超时）
mk_stub curl_timeout   28 ''
# 服务端 5xx
mk_stub curl_5xx        0 '{"error":"boom"}\n503'
# 返回体不是合法 JSON
mk_stub curl_badjson    0 'not json at all\n200'

# run_script <stub> <branch> <title> [pr_number] → 打印 stdout+stderr，返回决策退出码
run_script() {
  local stub="$1" branch="$2" title="$3" num="${4:-}"
  BRAIN_CURL="$STUB_DIR/$stub" BRAIN_URL="http://localhost:5221" \
    bash "$SCRIPT" "$branch" "$title" "$num" 2>&1
}

# 决策语义与 ci.yml 消费方一致：以 SKIP: 开头 → SKIP；整行 MERGE → MERGE。
decision_of() {
  local out="$1"
  if printf '%s' "$out" | grep -q '^SKIP:'; then echo SKIP
  elif printf '%s' "$out" | grep -qx 'MERGE'; then echo MERGE
  else echo "UNKNOWN"; fi
}

# assert_decision <stub> <期望决策> <期望退出码> <描述> <branch> <title> [num]
assert_decision() {
  local stub="$1" expect="$2" expect_ec="$3" desc="$4" branch="$5" title="$6" num="${7:-}"
  local out ec got
  out="$(run_script "$stub" "$branch" "$title" "$num")"; ec=$?
  got="$(decision_of "$out")"
  if [ "$got" = "$expect" ] && [ "$ec" -eq "$expect_ec" ]; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (期望 决策=$expect 退出码=$expect_ec，实际 决策=$got 退出码=$ec；输出: $out)"; FAIL=$((FAIL+1))
  fi
}

# assert_failclosed <stub> <描述> <降级原因关键词> <branch> <title>
# fail-closed 红线：任何求证失败都必须 SKIP 且日志含降级原因；输出 MERGE 即判失败。
assert_failclosed() {
  local stub="$1" desc="$2" reason_kw="$3" branch="$4" title="$5"
  local out ec got
  out="$(run_script "$stub" "$branch" "$title")"; ec=$?
  got="$(decision_of "$out")"
  if printf '%s' "$out" | grep -qx 'MERGE'; then
    echo "FAIL: $desc — fail-closed 被违反：求证失败却输出 MERGE（红线）"; FAIL=$((FAIL+1)); return
  fi
  if [ "$got" = "SKIP" ] && printf '%s' "$out" | grep -q 'fail-closed' \
     && printf '%s' "$out" | grep -q "$reason_kw"; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (期望 SKIP + 含降级原因 '$reason_kw'；实际 决策=$got 输出: $out)"; FAIL=$((FAIL+1))
  fi
}

# ── 核心决策断言 ──────────────────────────────────────────────────────────────────
# 1) Brain 回答「属于 harness run」→ SKIP、退出码 0（把 merge 交回 harness gate）。
assert_decision curl_owned SKIP 0 "Brain owned → 跳过 auto-merge（退出码 0）" \
  "cp-0704084753-abc12345" "chore: 随便什么标题"

# 2) Brain 回答「不属于任何 harness run」+ cp-* 分支 → MERGE（手工 /dev PR 照旧合并）。
assert_decision curl_not_owned MERGE 0 "Brain not-owned + cp-* → 正常 auto-merge" \
  "cp-0704084753-abc12345" "fix(brain): 修复调度队头阻塞"

# ── fail-closed 红线：Brain 不可达 / 5xx / 非法 JSON → 一律 SKIP + 降级原因 ─────────
assert_failclosed curl_timeout "Brain 超时 → fail-closed SKIP" \
  "不可达" "cp-0704084753-abc12345" "fix(ci): 无所谓标题"
assert_failclosed curl_5xx "Brain 5xx → fail-closed SKIP" \
  "HTTP 503" "cp-0704084753-abc12345" "fix(ci): 无所谓标题"
assert_failclosed curl_badjson "Brain 非法 JSON → fail-closed SKIP" \
  "非法 JSON" "cp-0704084753-abc12345" "fix(ci): 无所谓标题"

# ── 零回归：非 cp-* 分支 → SKIP（根本不查 Brain，保留原有行为）──────────────────────
assert_decision curl_not_owned SKIP 0 "非 cp-* 分支 → 跳过 auto-merge" \
  "feature/manual-branch" "fix(brain): 随便改"

# ── 回归断言（真实历史数据 #4755）：分支 cp-08101107-04e4690d、标题 fix(orchestrator): ──
# 标题不匹配旧的 feat(harness): 判据（正是当年漏过闸的原因）；新判据向 Brain 求证归属，
# Brain 回答 owned → SKIP。断言本次事故在新判据下不会重演。
assert_decision curl_owned SKIP 0 "#4755 分支（fix(orchestrator): 标题）Brain owned → SKIP，事故不复现" \
  "cp-08101107-04e4690d" "fix(orchestrator): 基础设施触发的 fix 轮 SHA 不变不误判 no-progress [v1.271.3]"

# ── 工作流层守卫（与原测试一致，防 auto-merge job 配置回归）─────────────────────────
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
