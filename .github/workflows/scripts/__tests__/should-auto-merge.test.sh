#!/usr/bin/env bash
# 验证 should-auto-merge.sh 的合并决策逻辑（Brain 归属求证版）。
#
# 背景（决策 e8f6134f / 事故 PR #4755）：CI 通用 auto-merge 与 harness 自己的
# evaluator+DeepSeek 裁判 gate 是两条独立的 PR 合并通道。旧判据用 PR 标题前缀
# `feat(harness):` 识别 harness-owned PR，而标题是 LLM 自由撰写字段——标题写成
# `fix(orchestrator): ...` 的 harness 产出（#4755）不匹配前缀，被通用通道抢先合并，
# 架空了裁判裁决权（evaluate_verdict / judge_verdict 均为 NULL）。
#
# 新判据：向 Brain 只读端点 /api/brain/harness/pr-ownership 求证（唯一非 LLM 撰写的
# 权威来源）。命中 harness run → SKIP（交裁判 gate）；明确不属于 → MERGE。
# fail-closed 红线：Brain 不可达/超时/5xx/非法 JSON 一律 SKIP（宁可误拦一个 /dev PR
# 让人点一下合并，绝不误放一个 harness PR 架空裁判权）。
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/should-auto-merge.sh"
WORKFLOW="$(cd "$(dirname "$0")/../.." && pwd)/ci.yml"
AUTO_MERGE_JOB="$(awk '
  /^  auto-merge:/ { capture=1; next }
  capture && /^  [a-zA-Z0-9_-]+:/ { exit }
  capture { print }
' "$WORKFLOW")"
PASS=0; FAIL=0

TMPDIR_MOCK="$(mktemp -d)"
MOCK_PID=""
cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  rm -rf "$TMPDIR_MOCK"
}
trap cleanup EXIT

# start_mock_brain <http_status> <json_body> [delay_seconds]
# 起一个只读 mock Brain（ephemeral port），返回固定 (status, body)，可选延迟用于超时测试。
# 端口写入 $TMPDIR_MOCK/port，之后用 BRAIN_URL=http://127.0.0.1:<port> 打到它。
start_mock_brain() {
  local status="$1" body="$2" delay="${3:-0}"
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  rm -f "$TMPDIR_MOCK/port"
  MOCK_STATUS="$status" MOCK_BODY="$body" MOCK_DELAY="$delay" \
    MOCK_PORT_FILE="$TMPDIR_MOCK/port" python3 - <<'PY' &
import os, time
from http.server import BaseHTTPRequestHandler, HTTPServer
status = int(os.environ['MOCK_STATUS'])
body = os.environ['MOCK_BODY'].encode()
delay = float(os.environ['MOCK_DELAY'])
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if delay:
            time.sleep(delay)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        pass
srv = HTTPServer(('127.0.0.1', 0), H)
with open(os.environ['MOCK_PORT_FILE'], 'w') as f:
    f.write(str(srv.server_address[1]))
srv.serve_forever()
PY
  MOCK_PID=$!
  local i
  for i in $(seq 1 50); do
    [ -s "$TMPDIR_MOCK/port" ] && break
    sleep 0.1
  done
  MOCK_PORT="$(cat "$TMPDIR_MOCK/port")"
  BRAIN_URL="http://127.0.0.1:${MOCK_PORT}"
}

# assert_decision <期望关键词> <描述> <BRAIN_URL> <branch> <pr_number> [timeout]
assert_decision() {
  local expect="$1" desc="$2" brain="$3" branch="$4" pr="$5" timeout="${6:-10}"
  local out
  out="$(BRAIN_URL="$brain" AUTO_MERGE_BRAIN_TIMEOUT="$timeout" \
    bash "$SCRIPT" "$branch" "$pr" 2>&1)"
  if echo "$out" | grep -q "$expect"; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (期望含 '$expect'，实际: $out)"; FAIL=$((FAIL+1))
  fi
}

# ── 核心行为 1：Brain 返回「属于 harness run」→ SKIP（交裁判 gate），退出码 0 ──
start_mock_brain 200 '{"ok":true,"harness_owned":true,"matched_by":"pr_url"}'
assert_decision "SKIP" "Brain 命中 harness run → 跳过通用 auto-merge" \
  "$BRAIN_URL" "cp-08101107-04e4690d" "4755"
# 退出码必须为 0（SKIP 是正常放行下游 exit 0，不是错误）
BRAIN_URL="$BRAIN_URL" AUTO_MERGE_BRAIN_TIMEOUT=10 bash "$SCRIPT" "cp-08101107-04e4690d" "4755" >/dev/null 2>&1
if [ "$?" -eq 0 ]; then echo "PASS: harness-owned SKIP 退出码 0"; PASS=$((PASS+1)); else echo "FAIL: harness-owned SKIP 退出码非 0"; FAIL=$((FAIL+1)); fi

# ── 核心行为 2：Brain 返回「不属于任何 harness run」+ cp-* 分支 → MERGE ──
start_mock_brain 200 '{"ok":true,"harness_owned":false,"matched_by":null}'
assert_decision "MERGE" "Brain 明确不属于 + cp-* 分支 → 正常 auto-merge（不误伤 /dev）" \
  "$BRAIN_URL" "cp-08081317-gate3-deploy-fix-cd7e0028" "9001"

# ── fail-closed 红线：Brain 连接超时 → SKIP 且日志含降级原因（任一输出 MERGE 即失败）──
start_mock_brain 200 '{"ok":true,"harness_owned":false}' 3
assert_decision "SKIP" "fail-closed：Brain 超时 → SKIP" \
  "$BRAIN_URL" "cp-08101107-04e4690d" "4755" 1
start_mock_brain 200 '{"ok":true,"harness_owned":false}' 3
assert_decision "degraded" "fail-closed：Brain 超时 → 日志含降级原因" \
  "$BRAIN_URL" "cp-08101107-04e4690d" "4755" 1
# 断言超时情形绝不输出 MERGE
start_mock_brain 200 '{"ok":true,"harness_owned":false}' 3
TIMEOUT_OUT="$(BRAIN_URL="$BRAIN_URL" AUTO_MERGE_BRAIN_TIMEOUT=1 bash "$SCRIPT" "cp-08101107-04e4690d" "4755" 2>&1)"
if echo "$TIMEOUT_OUT" | grep -qx "MERGE"; then
  echo "FAIL: fail-closed 被击穿——超时竟输出 MERGE"; FAIL=$((FAIL+1))
else
  echo "PASS: fail-closed——超时绝不输出 MERGE"; PASS=$((PASS+1))
fi

# ── fail-closed 红线：Brain 返回 5xx → SKIP 且日志含降级原因 ──
start_mock_brain 500 'internal server error'
assert_decision "SKIP" "fail-closed：Brain 5xx → SKIP" \
  "$BRAIN_URL" "cp-08101107-04e4690d" "4755"
start_mock_brain 500 'internal server error'
assert_decision "degraded" "fail-closed：Brain 5xx → 日志含降级原因" \
  "$BRAIN_URL" "cp-08101107-04e4690d" "4755"

# ── fail-closed 红线：Brain 返回非法 JSON → SKIP 且日志含降级原因 ──
start_mock_brain 200 'this is <not> json at all'
assert_decision "SKIP" "fail-closed：Brain 非法 JSON → SKIP" \
  "$BRAIN_URL" "cp-08101107-04e4690d" "4755"
start_mock_brain 200 'this is <not> json at all'
assert_decision "degraded" "fail-closed：Brain 非法 JSON → 日志含降级原因" \
  "$BRAIN_URL" "cp-08101107-04e4690d" "4755"

# ── fail-closed 红线：Brain 完全不可达（连接被拒）→ SKIP ──
# 指向一个没有服务在监听的地址
assert_decision "SKIP" "fail-closed：Brain 不可达（连接被拒）→ SKIP" \
  "http://127.0.0.1:1" "cp-08101107-04e4690d" "4755" 3

# ── 零回归：非 cp-* 分支 → SKIP（不归通用 auto-merge 管），且根本不该打 Brain ──
assert_decision "SKIP" "非 cp-* 分支 → 跳过 auto-merge（保留原有行为）" \
  "http://127.0.0.1:1" "feature/manual-branch" "123" 1

# ── 回归断言（真实历史数据形状）：PR #4755 分支 cp-08101107-04e4690d，Brain 求证命中
#    harness run → SKIP，即本次事故在新判据下不重演 ──
start_mock_brain 200 '{"ok":true,"harness_owned":true,"matched_by":"branch_task_id","run_id":"32b221b4-0000-0000-0000-000000000000"}'
assert_decision "SKIP" "回归 #4755：cp-08101107-04e4690d 命中 harness run → SKIP（事故不重演）" \
  "$BRAIN_URL" "cp-08101107-04e4690d" "4755"

# ── 反向红线：新脚本必须真的改向 Brain 求证，而非仍用标题判据 ──
# 正向断言（comment-proof）：脚本调用 pr-ownership 端点、有 fail-closed 降级路径。
if grep -q 'pr-ownership' "$SCRIPT"; then
  echo "PASS: 脚本向 Brain /pr-ownership 端点求证归属"; PASS=$((PASS+1))
else
  echo "FAIL: 脚本未调用 Brain /pr-ownership 端点，未真正改向 Brain 求证"; FAIL=$((FAIL+1))
fi
if grep -q 'skip_degraded' "$SCRIPT"; then
  echo "PASS: 脚本具备 fail-closed 降级路径"; PASS=$((PASS+1))
else
  echo "FAIL: 脚本缺 fail-closed 降级路径"; FAIL=$((FAIL+1))
fi
# 负向断言：脚本不得再有「基于 PR 标题做 grep 决策」的活代码（注释里解释旧判据不算）。
# 剥掉注释行后再 grep，避免命中说明性注释。
if grep -vE '^[[:space:]]*#' "$SCRIPT" | grep -qE 'PR_TITLE'; then
  echo "FAIL: 脚本活代码仍引用 PR_TITLE（未脱离标题判据）"; FAIL=$((FAIL+1))
else
  echo "PASS: 脚本活代码不再引用 PR_TITLE"; PASS=$((PASS+1))
fi

# ── 结构守卫（延续原有）：ci.yml auto-merge job 的越 needs 链 / 原生排队 / 最小权限 ──
if grep -Fq "if: always() && needs.ci-passed.result == 'success' && github.event_name == 'pull_request'" "$WORKFLOW"; then
  echo "PASS: auto-merge 可越过 needs 链中的 skipped jobs"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge 缺少 always()，会被 needs 链中的 skipped jobs 连带跳过"; FAIL=$((FAIL+1))
fi

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

# ── 接线守卫：ci.yml 必须把 PR 号传给决策脚本（新判据依赖 PR 号/分支求证 Brain）──
if echo "$AUTO_MERGE_JOB" | grep -Fq 'should-auto-merge.sh "$HEAD_BRANCH" "$PR_NUMBER"'; then
  echo "PASS: ci.yml 传 PR_NUMBER 给决策脚本"; PASS=$((PASS+1))
else
  echo "FAIL: ci.yml 未把 PR_NUMBER 传给 should-auto-merge.sh（新判据无法求证 Brain）"; FAIL=$((FAIL+1))
fi

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
