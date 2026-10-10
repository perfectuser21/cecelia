#!/usr/bin/env bash
# strategic-decisions-category-smoke — POST /strategic-decisions 非法 category 返回 400（允许值读自 decisions_category_chk，不透出 SQL 原文），
# 迁移 545 让 general 进白名单（不带 category 默认 general 能 201），coding-workflow 判定点（made_by=system）不被误伤。
set -euo pipefail
# 真 Brain 写入必须显式授权，并核对本机测试容器与 DATABASE_URL 指向同一安全库。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi
API="${BRAIN_URL:-${BRAIN:-http://localhost:5221}}/api/brain/strategic-decisions"
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
TS="$(date +%s)-$$"

# 1. 约束真身含 general（迁移 545），且 384 的取值都还在
if [[ -n "${DATABASE_URL:-}" ]]; then
  DEF="$(psql -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='decisions'::regclass AND conname='decisions_category_chk'")"
  for v in general decision judgment nfr testing; do
    [[ "$DEF" == *"'$v'"* ]] || fail "decisions_category_chk 缺 '$v'"
  done
  pass "迁移 545：decisions_category_chk 含 general 且保留 384 取值"
fi

# 2. 非法 category（字符串 / 数字 / 超长）→ 400 + allowed_categories，不透出约束名或 SQL 原文；不写库
check_reject() {
  local body="$1" label="$2" out code json
  out="$(curl -q -s -w '\n%{http_code}' -X POST "$API" -H 'Content-Type: application/json' -d "$body")"
  code="${out##*$'\n'}"; json="${out%$'\n'*}"
  [[ "$code" == "400" ]] || fail "$label 应 400，得 $code"
  echo "$json" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j = JSON.parse(s);
      if (j.success !== false) throw new Error("success 应为 false");
      if (!Array.isArray(j.allowed_categories) || !j.allowed_categories.includes("decision")) throw new Error("allowed_categories 缺 decision");
      if (!String(j.error).startsWith("category 非法，合法值：")) throw new Error("error 文案不对: " + j.error);
      if (/decisions_category_chk|check constraint|violates|relation "decisions"/i.test(s)) throw new Error("透出 SQL 原文");
    });' || fail "$label 响应体不合规"
  pass "$label → 400，带 allowed_categories，无 SQL 原文"
}
check_reject "{\"category\":\"workflow_bogus\",\"topic\":\"smoke-bogus-$TS\",\"decision\":\"smoke\"}" "category=workflow_bogus"
check_reject "{\"category\":123,\"topic\":\"smoke-num-$TS\",\"decision\":\"smoke\"}" "category=123"
check_reject "{\"category\":\"$(printf 'a%.0s' $(seq 1 5000))\",\"topic\":\"smoke-long-$TS\",\"decision\":\"smoke\"}" "category=5000 字符"
N="$(curl -q -s "$API?category=workflow_bogus&limit=10" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data.length))')"
[[ "$N" == "0" ]] || fail "非法 category 不应写入，得 $N 行"
pass "被拒请求未写库"

# 3. 写入路径：不带 category → 201 general；合法 decision → 201
for body in "{\"topic\":\"smoke-nocat-$TS\",\"decision\":\"smoke\"}" "{\"category\":\"decision\",\"topic\":\"smoke-dec-$TS\",\"decision\":\"smoke\"}"; do
  out="$(curl -q -s -w '\n%{http_code}' -X POST "$API" -H 'Content-Type: application/json' -d "$body")"
  [[ "${out##*$'\n'}" == "201" ]] || fail "合法写入应 201：$body → ${out}"
done
pass "不带 category 默认 general、合法 decision 均 201"

# 4. coding-workflow 写判定点 shape（spec-review.mjs 现行 made_by:'system'）→ 201 且能按 judgment 查到
for MB in system; do
  JT="判定点[smoke-$TS-$MB#1]: smoke"
  body="{\"category\":\"judgment\",\"topic\":\"$JT\",\"decision\":\"所选方法: x｜候选: y\",\"reason\":\"依据: z\",\"made_by\":\"$MB\",\"author\":\"coding-workflow\",\"source_ref\":\"coding-workflow:smoke-$TS\"}"
  out="$(curl -q -s -w '\n%{http_code}' -X POST "$API" -H 'Content-Type: application/json' -d "$body")"
  [[ "${out##*$'\n'}" == "201" ]] || fail "coding-workflow 判定点（made_by=$MB）写入应 201：${out}"
  N="$(curl -q -s "$API?category=judgment&limit=1000" | JT="$JT" MB="$MB" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data.filter(r=>r.topic===process.env.JT&&r.made_by===process.env.MB).length))')"
  [[ "$N" == "1" ]] || fail "判定点（made_by=$MB）应能按 judgment 查到 1 行，得 $N"
done
pass "coding-workflow 判定点（made_by=system）201 且可查"
