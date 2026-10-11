#!/usr/bin/env bash
# runs-read-smoke — 执行记录总记录读接口 GET /api/brain/runs/:run_id（任务 05cfbcde）真 Brain 火：
# POST span → 立即 GET 编码 run_id 200（触发器建出的总记录）→ include=spans 附明细 → 不存在 404 → 201 字符 400。
# 写入与读取同一个 BRAIN_URL；任何断言失败或 Brain 不可达都 exit 1。
set -euo pipefail
: "${BRAIN_URL:?BRAIN_URL is required（真起的 Brain 地址，不写死）}"
# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "$BRAIN_URL"; then
  exit 0
fi

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
AUTH=()
[ -n "${CECELIA_INTERNAL_TOKEN:-}" ] && AUTH=(-H "x-internal-token: ${CECELIA_INTERNAL_TOKEN}")
ACTIVITY=c0de0000-0000-4000-8000-000000000102
RID="coding-workflow:$(node -e "process.stdout.write(require('node:crypto').randomUUID())")"
ENC=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$RID")
OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT
req() { curl -q -sS -o "$OUT" -w '%{http_code}' ${AUTH[@]+"${AUTH[@]}"} "$@" || fail "Brain 不可达: $BRAIN_URL"; }

CODE=$(req -X POST "$BRAIN_URL/api/brain/spans" -H 'content-type: application/json' -H 'x-session-id: coding-workflow-runner' \
  -d "[{\"run_id\":\"$RID\",\"activity_id\":\"$ACTIVITY\",\"occurrence_key\":\"smoke/b\",\"started_at\":\"2026-10-10T11:00:10.000Z\",\"ended_at\":\"2026-10-10T11:00:20.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\",\"cost_usd\":0.2},
       {\"run_id\":\"$RID\",\"activity_id\":\"$ACTIVITY\",\"occurrence_key\":\"smoke/a\",\"started_at\":\"2026-10-10T11:00:00.000Z\",\"ended_at\":\"2026-10-10T11:00:05.000Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\",\"tokens_in\":100,\"cost_usd\":0.1}]")
[ "$CODE" = 200 ] || fail "POST /spans 期望 200 实得 $CODE: $(cat "$OUT")"
jq -e '.inserted == 2' "$OUT" >/dev/null || fail "POST /spans inserted != 2: $(cat "$OUT")"

CODE=$(req "$BRAIN_URL/api/brain/runs/$ENC")
[ "$CODE" = 200 ] || fail "GET 编码 run_id 期望 200 实得 $CODE: $(cat "$OUT")"
jq -e --arg rid "$RID" '.run_id == $rid and .trigger_kind == "external" and .header_source == "spans" and .outcome == "pass"
  and (.cost_usd | tonumber) == 0.3 and (.tokens_in | tonumber) == 100 and has("workflow_id") and has("started_at") and has("ended_at")
  and has("tokens_out") and (has("spans") | not)' "$OUT" >/dev/null || fail "总记录字段不符: $(cat "$OUT")"
echo "PASS: POST span 后 GET 编码 run_id 200，总记录字段齐全"

CODE=$(req "$BRAIN_URL/api/brain/runs/$ENC?include=spans")
[ "$CODE" = 200 ] || fail "include=spans 期望 200 实得 $CODE"
jq -e '[.spans[].occurrence_key] == ["smoke/a","smoke/b"] and all(.spans[]; has("activity_id") and has("outcome") and has("cost_usd") and has("started_at") and has("ended_at"))' "$OUT" >/dev/null \
  || fail "include=spans 明细不符: $(cat "$OUT")"
echo "PASS: include=spans 按 started_at 升序附明细"

NORID=$(node -e "process.stdout.write(encodeURIComponent('coding-workflow:'+require('node:crypto').randomUUID()))")
CODE=$(req "$BRAIN_URL/api/brain/runs/$NORID")
[ "$CODE" = 404 ] && jq -e '.error | test("not found")' "$OUT" >/dev/null || fail "不存在 run 期望 404 实得 $CODE: $(cat "$OUT")"
echo "PASS: 不存在 run 404"

CODE=$(req "$BRAIN_URL/api/brain/runs/$(printf 'a%.0s' $(seq 1 201))")
[ "$CODE" = 400 ] && jq -e '.error == "run_id must be at most 200 characters"' "$OUT" >/dev/null || fail "201 字符期望 400 实得 $CODE: $(cat "$OUT")"
echo "PASS: 201 字符 run_id 400"
echo "PASS: runs-read-smoke.sh"
