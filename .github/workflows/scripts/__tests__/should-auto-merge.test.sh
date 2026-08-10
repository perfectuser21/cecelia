#!/usr/bin/env bash
# 验证 should-auto-merge.sh 的合并决策逻辑（v2：判据由 PR 标题换成 Brain 归属求证）。
#
# 背景：CI 通用 auto-merge / engine-pr-watchdog / harness kernel gate 是三条独立的 PR 合并
# 通道。harness generator 产出的 PR 也用 cp-* 分支命名，会触发通用 auto-merge，比裁判 gate 快、
# 抢先合并、架空裁判裁决权。2026-08-10 #4755（按标题漏判、无裁决被合）/#4759（judge FAIL 仍被
# 强合）两起实证：**按 PR 标题判归属不可靠**（标题是 LLM 自由撰写字段）。
#
# v2 语义迁移：判据由「标题 feat(harness): → SKIP」换成「Brain 归属端点 owned=true → SKIP」，
# 归属只凭 kernel 写入的 initiative_runs 记录；Brain 任意异常 → fail-closed SKIP（绝不 MERGE）。
# 本文件用真实 node http stub server（真 socket、真 curl）驱动脚本，验 owned 语义 + fail-closed；
# 并保留 auto-merge job 的机制断言（--auto / 写权限 / always()）不回退。
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/should-auto-merge.sh"
WORKFLOW="$(cd "$(dirname "$0")/../.." && pwd)/ci.yml"
AUTO_MERGE_JOB="$(awk '
  /^  auto-merge:/ { capture=1; next }
  capture && /^  [a-zA-Z0-9_-]+:/ { exit }
  capture { print }
' "$WORKFLOW")"
PASS=0; FAIL=0

# run_with_stub <mode> <branch> <title>
#   mode: true|false|5xx|badjson — 起一个临时真 http stub 返回对应归属应答，异步 execFile
#   跑脚本（异步让 node 事件循环空闲应答 curl），把脚本 stdout 打到本函数 stdout。
run_with_stub() {
  node -e '
    const [mode, branch, title, script] = process.argv.slice(1);
    const http = require("http"), cp = require("child_process");
    const s = http.createServer((q, r) => {
      if (mode === "5xx") { r.writeHead(500); r.end("boom"); return; }
      if (mode === "badjson") { r.writeHead(200, {"content-type":"application/json"}); r.end("{ bad"); return; }
      r.writeHead(200, {"content-type":"application/json"});
      r.end(JSON.stringify({ owned: mode === "true", run_id: mode === "true" ? "r1" : null }));
    });
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      cp.execFile("bash", [script, branch, title],
        { env: { ...process.env, BRAIN_URL: "http://127.0.0.1:" + p }, encoding: "utf8" },
        (e, out) => { s.close(); process.stdout.write(String(out || (e && e.stdout) || "")); });
    });
  ' "$1" "$2" "$3" "$SCRIPT"
}

# assert_out <期望关键词> <描述> <脚本输出>
assert_out() {
  local expect="$1" desc="$2" out="$3"
  if echo "$out" | grep -q "$expect"; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (期望含 '$expect'，实际: $out)"; FAIL=$((FAIL+1))
  fi
}
# assert_not <禁止关键词> <描述> <脚本输出>
assert_not() {
  local forbid="$1" desc="$2" out="$3"
  if echo "$out" | grep -q "$forbid"; then
    echo "FAIL: $desc (不应含 '$forbid'，实际: $out)"; FAIL=$((FAIL+1))
  else
    echo "PASS: $desc"; PASS=$((PASS+1))
  fi
}

# ── 归属语义（Brain owned 决定，非标题）──────────────────────────────────
# Brain owned=true 的 cp-* PR → 跳过通用 auto-merge，交 harness kernel gate（本次修复核心断言）。
assert_out "SKIP" "owned=true（harness-owned）→ 跳过 auto-merge" \
  "$(run_with_stub true "cp-0704084753-abc" "fix(brain): 标题非 feat(harness): 也照样识别")"

# Brain owned=false 的手动 /dev cp-* PR → 正常走 auto-merge（不能误伤 /dev 流程，红线）。
assert_out "MERGE" "owned=false（手动 /dev）cp-* → 正常 auto-merge" \
  "$(run_with_stub false "cp-0704084753-abc" "fix(brain): 手动 dev")"

# 归属凭 Brain 记录、不看标题：即便标题是 feat(harness):，owned=false 仍 MERGE（旧标题判据已废）。
assert_out "MERGE" "owned=false 即便标题 feat(harness): 仍 MERGE（不再按标题判）" \
  "$(run_with_stub false "cp-0704084753-abc" "feat(harness): 标题不再是判据")"

# 非 cp-* 分支 → 跳过（保留原有行为）。
assert_out "SKIP" "非 cp-* 分支 → 跳过 auto-merge" \
  "$(run_with_stub false "feature/manual-branch" "fix(brain): 随便改")"

# ── fail-closed（Brain 异常一律 SKIP，绝不 MERGE，红线）──────────────────
# 不可达（连接被拒 exit7）→ SKIP。
UNREACH_OUT="$(BRAIN_URL="http://127.0.0.1:1" bash "$SCRIPT" "cp-0704084753-abc" "fix(brain): x" || true)"
assert_out "SKIP" "Brain 不可达 → fail-closed SKIP" "$UNREACH_OUT"
assert_not "MERGE" "Brain 不可达 fail-closed 绝不 MERGE" "$UNREACH_OUT"

# 5xx → SKIP。
FIVEXX_OUT="$(run_with_stub 5xx "cp-0704084753-abc" "fix(brain): x")"
assert_out "SKIP" "Brain 5xx → fail-closed SKIP" "$FIVEXX_OUT"
assert_not "MERGE" "Brain 5xx fail-closed 绝不 MERGE" "$FIVEXX_OUT"

# 非法 JSON → SKIP。
BADJSON_OUT="$(run_with_stub badjson "cp-0704084753-abc" "fix(brain): x")"
assert_out "SKIP" "Brain 非法 JSON → fail-closed SKIP" "$BADJSON_OUT"
assert_not "MERGE" "Brain 非法 JSON fail-closed 绝不 MERGE" "$BADJSON_OUT"

# ── auto-merge job 机制断言（v2 保留不回退）─────────────────────────────
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

# not-owned(MERGE) 分支必须对 head SHA 置 harness-judge=success，否则 required check 卡死 /dev。
if echo "$AUTO_MERGE_JOB" | grep -Fq "context=harness-judge" \
  && echo "$AUTO_MERGE_JOB" | grep -Fq "state=success"; then
  echo "PASS: not-owned PR 置 harness-judge=success（防 required check 卡死 /dev）"; PASS=$((PASS+1))
else
  echo "FAIL: auto-merge job 缺少 not-owned 置 harness-judge=success 兜底"; FAIL=$((FAIL+1))
fi

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
