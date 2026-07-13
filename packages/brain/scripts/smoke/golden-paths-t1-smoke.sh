#!/usr/bin/env bash
# golden-paths-t1-smoke.sh
# GP1/T1 smoke：golden_paths 表存在 + 非法状态 INSERT 被 CHECK 拒 + 三端点全链（DoD F1）
# L3 真库：psql 探表 + CHECK 约束。API 全链：POST 建 candidate → GET 过滤 → PATCH 合法/非法流转 → 清理。
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# ── 1. 表存在 + 非法状态 INSERT 被 CHECK 拒（psql）──
echo "── 1. golden_paths 表 + CHECK 约束（psql）──"
if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] SKIP: psql 不可用"
elif ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] SKIP: DB 不可达"
else
  psql "$DB" -tAc "SELECT 1 FROM golden_paths LIMIT 0" >/dev/null 2>&1 \
    && ok "golden_paths 表存在" || fail "golden_paths 表不存在"

  psql "$DB" -tAc "BEGIN; INSERT INTO golden_paths(title, one_liner, status) VALUES('smoke bogus','smoke','bogus'); ROLLBACK;" >/dev/null 2>&1 \
    && fail "status CHECK 未生效（非法值 bogus 竟被接受）" \
    || ok "status CHECK 生效（拒绝非法值 bogus）"
fi

# ── 2. POST 建 candidate 取回 id ──
echo "── 2. POST /golden-paths 建 candidate ──"
GP_ID=""
post_resp=$(curl -s -X POST "$API/golden-paths" \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke GP","one_liner":"smoke 用例"}')
GP_ID=$(echo "$post_resp" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).golden_path.id||'')}catch(e){console.log('')}})" 2>/dev/null)

if [[ -n "$GP_ID" ]]; then
  ok "POST 建 candidate 成功，id=$GP_ID"
else
  fail "POST 建 candidate 失败: $post_resp"
fi

# ── 3. GET ?status=candidate 能看到该 id ──
if [[ -n "$GP_ID" ]]; then
  echo "── 3. GET /golden-paths?status=candidate ──"
  get_resp=$(curl -s "$API/golden-paths?status=candidate")
  echo "$get_resp" | grep -q "$GP_ID" \
    && ok "GET ?status=candidate 含该 id" \
    || fail "GET ?status=candidate 未见该 id: $get_resp"
else
  fail "跳过 GET 校验（无 GP_ID）"
fi

# ── 4. PATCH 合法流转成功；非法流转 409 ──
if [[ -n "$GP_ID" ]]; then
  echo "── 4. PATCH 合法/非法流转 ──"
  patch_ok_code=$(curl -s -o /tmp/gp-patch-ok.json -w "%{http_code}" -X PATCH "$API/golden-paths/$GP_ID" \
    -H "Content-Type: application/json" \
    -d '{"status":"proposed"}')
  [[ "$patch_ok_code" == "200" ]] \
    && ok "PATCH candidate→proposed 成功 (200)" \
    || fail "PATCH candidate→proposed 期望 200，得 $patch_ok_code: $(cat /tmp/gp-patch-ok.json 2>/dev/null)"

  patch_bad_code=$(curl -s -o /tmp/gp-patch-bad.json -w "%{http_code}" -X PATCH "$API/golden-paths/$GP_ID" \
    -H "Content-Type: application/json" \
    -d '{"status":"delivered"}')
  [[ "$patch_bad_code" == "409" ]] \
    && ok "PATCH proposed→delivered 被拒 (409)" \
    || fail "PATCH proposed→delivered 期望 409，得 $patch_bad_code: $(cat /tmp/gp-patch-bad.json 2>/dev/null)"
  rm -f /tmp/gp-patch-ok.json /tmp/gp-patch-bad.json
else
  fail "跳过 PATCH 校验（无 GP_ID）"
fi

# ── 5. 清理该测试行 ──
if [[ -n "$GP_ID" ]] && command -v psql >/dev/null 2>&1 && psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "── 5. 清理测试行 ──"
  psql "$DB" -tAc "DELETE FROM golden_paths WHERE id = '$GP_ID'" >/dev/null 2>&1 \
    && ok "清理测试行 $GP_ID" || fail "清理测试行失败"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
