#!/usr/bin/env bash
# content-pipeline-runs-shadow-smoke — 真 Brain 火（只读，不写库）：
# /api/brain/runs/<stats|stages|output|publish-status> 落到 runs 读路由 404（不再被内容流水线别名挂载接走 500）；
# /api/brain/pipelines/<非UUID>/<同四后缀> 返回 400 固定文案，不回显 PG 错误。任何断言失败或 Brain 不可达都 exit 1。
set -euo pipefail
: "${BRAIN_URL:?BRAIN_URL is required（真起的 Brain 地址，不写死）}"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
AUTH=()
[ -n "${CECELIA_INTERNAL_TOKEN:-}" ] && AUTH=(-H "x-internal-token: ${CECELIA_INTERNAL_TOKEN}")
OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT
req() { curl -q -sS -o "$OUT" -w '%{http_code}' ${AUTH[@]+"${AUTH[@]}"} "$@" || fail "Brain 不可达: $BRAIN_URL"; }

for SEG in stats stages output publish-status; do
  CODE=$(req "$BRAIN_URL/api/brain/runs/$SEG")
  [ "$CODE" = 404 ] || fail "GET /runs/$SEG 期望 404 实得 $CODE: $(cat "$OUT")"
  jq -e --arg seg "$SEG" '.error == "run not found: \($seg)" and (has("pipeline_id") | not)' "$OUT" >/dev/null \
    || fail "GET /runs/$SEG 不是 runs 读路由的响应: $(cat "$OUT")"
  echo "PASS: /api/brain/runs/$SEG 由 runs 读路由处理（404）"

  CODE=$(req "$BRAIN_URL/api/brain/pipelines/not-a-uuid/$SEG")
  [ "$CODE" = 400 ] || fail "GET /pipelines/not-a-uuid/$SEG 期望 400 实得 $CODE: $(cat "$OUT")"
  jq -e '.error == "invalid pipeline id: must be a UUID"' "$OUT" >/dev/null || fail "400 文案不符: $(cat "$OUT")"
  grep -q 'invalid input syntax' "$OUT" && fail "400 body 回显了 PG 错误: $(cat "$OUT")"
  echo "PASS: /api/brain/pipelines/not-a-uuid/$SEG 400"
done

U=$(node -e "process.stdout.write(require('node:crypto').randomUUID())")
CODE=$(req "$BRAIN_URL/api/brain/pipelines/$U/stats")
[ "$CODE" = 200 ] && jq -e --arg u "$U" '.pipeline_id == $u and (.stats | type == "array")' "$OUT" >/dev/null \
  || fail "合法 UUID /stats 期望 200 实得 $CODE: $(cat "$OUT")"
echo "PASS: 合法 UUID /stats 照旧 200"
echo "PASS: content-pipeline-runs-shadow-smoke.sh"
