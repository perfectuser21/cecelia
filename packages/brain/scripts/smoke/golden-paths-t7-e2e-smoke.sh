#!/usr/bin/env bash
# golden-paths-t7-e2e-smoke.sh
# GP7/T7 E2E proven-to-fire：真实 candidate 走完
# 圈选(/select) → proposed → 置 converged(PATCH) → 批准(/approve)
# → judgment 落库 + harness 任务注册，全链 DB 可查（DoD I1）
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
jq_field() { echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).$2||'')}catch(e){console.log('')}})" 2>/dev/null; }

GP_ID=""
TASK_ID=""
DEC_ID=""
HARNESS_ID=""

# ── 1. 建 candidate ────────────────────────────────────────────────────────
echo "── 1. POST /golden-paths 建 candidate ──"
post_resp=$(curl -s -X POST "$API/golden-paths" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E GP T7 smoke","one_liner":"端到端拍板回路验证","est_scale":"约2周/3个PR"}')
GP_ID=$(echo "$post_resp" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).golden_path?.id||'')}catch(e){console.log('')}})" 2>/dev/null)
if [[ -n "$GP_ID" ]]; then
  ok "建 candidate 成功，id=$GP_ID"
else
  fail "建 candidate 失败: $post_resp"
  echo "结果：PASS=$PASS FAIL=$FAIL"; exit 1
fi

# ── 2. /select → candidate→proposed + 建 golden_path_proposal 任务 ────────
echo "── 2. POST /golden-paths/$GP_ID/select ──"
select_resp=$(curl -s -X POST "$API/golden-paths/$GP_ID/select" \
  -H "Content-Type: application/json" -d '{}')
select_code=$(echo "$select_resp" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).golden_path?.status||'')}catch(e){console.log('')}})" 2>/dev/null)
TASK_ID=$(echo "$select_resp" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).proposal_task_id||'')}catch(e){console.log('')}})" 2>/dev/null)

if [[ "$select_code" == "proposed" ]]; then
  ok "圈选成功，status=proposed"
else
  fail "圈选失败，期望 status=proposed，得: $select_resp"
fi

if [[ -n "$TASK_ID" ]]; then
  ok "golden_path_proposal 任务已建，task_id=$TASK_ID"
else
  fail "/select 未返回 proposal_task_id: $select_resp"
fi

# DB 校验：task 存在且 task_type=golden_path_proposal
if command -v psql >/dev/null 2>&1 && psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1 && [[ -n "$TASK_ID" ]]; then
  tt=$(psql "$DB" -tAc "SELECT task_type FROM tasks WHERE id = '$TASK_ID'")
  [[ "$tt" == "golden_path_proposal" ]] \
    && ok "DB: tasks.$TASK_ID task_type=golden_path_proposal" \
    || fail "DB: tasks.$TASK_ID task_type 期望 golden_path_proposal，得 $tt"
fi

# ── 3. 测试跳过对抗，直接 PATCH 置 converged ───────────────────────────────
echo "── 3. PATCH golden-paths/$GP_ID → converged（跳过对抗阶段）──"
patch_resp=$(curl -s -o /tmp/gp-t7-patch.json -w "%{http_code}" -X PATCH "$API/golden-paths/$GP_ID" \
  -H "Content-Type: application/json" \
  -d '{"status":"converged","proposal_doc":"# E2E Demo\\n朋友圈 v2.1 提案（smoke 版本）"}')
[[ "$patch_resp" == "200" ]] \
  && ok "PATCH proposed→converged 成功" \
  || fail "PATCH proposed→converged 期望 200，得 $patch_resp: $(cat /tmp/gp-t7-patch.json 2>/dev/null)"
rm -f /tmp/gp-t7-patch.json

# ── 4. /approve → converged→approved + judgment 判定点 + harness 任务 ──────
echo "── 4. POST /golden-paths/$GP_ID/approve ──"
approve_resp=$(curl -s -X POST "$API/golden-paths/$GP_ID/approve" \
  -H "Content-Type: application/json" -d '{}')
approve_status=$(echo "$approve_resp" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).golden_path?.status||'')}catch(e){console.log('')}})" 2>/dev/null)
DEC_ID=$(echo "$approve_resp" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).judgment_decision_id||'')}catch(e){console.log('')}})" 2>/dev/null)
HARNESS_ID=$(echo "$approve_resp" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).harness_task_id||'')}catch(e){console.log('')}})" 2>/dev/null)

if [[ "$approve_status" == "approved" ]]; then
  ok "批准成功，status=approved"
else
  fail "批准失败，期望 status=approved，得: $approve_resp"
fi

if [[ -n "$DEC_ID" ]]; then
  ok "judgment 判定点已建，decision_id=$DEC_ID"
else
  fail "/approve 未返回 judgment_decision_id: $approve_resp"
fi

if [[ -n "$HARNESS_ID" ]]; then
  ok "harness 实现任务已注册，task_id=$HARNESS_ID"
else
  fail "/approve 未返回 harness_task_id: $approve_resp"
fi

# ── 5. DB 全链断言 ────────────────────────────────────────────────────────
if command -v psql >/dev/null 2>&1 && psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "── 5. DB 全链断言 ──"
  # GP 状态 = approved
  gp_status=$(psql "$DB" -tAc "SELECT status FROM golden_paths WHERE id = '$GP_ID'" | xargs)
  [[ "$gp_status" == "approved" ]] \
    && ok "DB: golden_paths[$GP_ID].status=approved" \
    || fail "DB: golden_paths[$GP_ID].status 期望 approved，得 $gp_status"

  # GP judgment_refs 含 dec_id
  if [[ -n "$DEC_ID" ]]; then
    refs=$(psql "$DB" -tAc "SELECT judgment_refs::text FROM golden_paths WHERE id = '$GP_ID'" | xargs)
    echo "$refs" | grep -q "$DEC_ID" \
      && ok "DB: golden_paths[$GP_ID].judgment_refs 含 $DEC_ID" \
      || fail "DB: judgment_refs 未包含 $DEC_ID，得 $refs"

    # decisions(category=judgment, reason 含 gp:<id>)
    dec_cat=$(psql "$DB" -tAc "SELECT category FROM decisions WHERE id = '$DEC_ID'" | xargs)
    [[ "$dec_cat" == "judgment" ]] \
      && ok "DB: decisions[$DEC_ID].category=judgment" \
      || fail "DB: decisions[$DEC_ID].category 期望 judgment，得 $dec_cat"

    dec_reason=$(psql "$DB" -tAc "SELECT reason FROM decisions WHERE id = '$DEC_ID'" | xargs)
    echo "$dec_reason" | grep -q "gp:$GP_ID" \
      && ok "DB: decisions[$DEC_ID].reason 含 gp:$GP_ID" \
      || fail "DB: decisions[$DEC_ID].reason 未含 gp:$GP_ID，得: $dec_reason"

    dec_ra=$(psql "$DB" -tAc "SELECT review_after FROM decisions WHERE id = '$DEC_ID'" | xargs)
    [[ -n "$dec_ra" ]] \
      && ok "DB: decisions[$DEC_ID].review_after 已设置 ($dec_ra)" \
      || fail "DB: decisions[$DEC_ID].review_after 为空"
  fi

  # harness 任务存在且 task_type=harness_initiative（真正路由到 harness-controller 写代码；
  # 用 golden_path_proposal 会被 controllerSkillFor 误路由回只产提案文档的 golden-path-controller，issue bfaac776）
  if [[ -n "$HARNESS_ID" ]]; then
    h_tt=$(psql "$DB" -tAc "SELECT task_type FROM tasks WHERE id = '$HARNESS_ID'" | xargs)
    [[ "$h_tt" == "harness_initiative" ]] \
      && ok "DB: tasks[$HARNESS_ID].task_type=harness_initiative" \
      || fail "DB: tasks[$HARNESS_ID].task_type 期望 harness_initiative，得 $h_tt"
  fi

  # GP review_after 已设置（approved_at + 14d）
  gp_ra=$(psql "$DB" -tAc "SELECT review_after FROM golden_paths WHERE id = '$GP_ID'" | xargs)
  [[ -n "$gp_ra" ]] \
    && ok "DB: golden_paths[$GP_ID].review_after 已设置 ($gp_ra)" \
    || fail "DB: golden_paths[$GP_ID].review_after 为空"
fi

# ── 6. 清理 ───────────────────────────────────────────────────────────────
echo "── 6. 清理测试数据 ──"
if command -v psql >/dev/null 2>&1 && psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  [[ -n "$HARNESS_ID" ]] && psql "$DB" -tAc "DELETE FROM tasks WHERE id = '$HARNESS_ID'" >/dev/null 2>&1
  [[ -n "$TASK_ID" ]] && psql "$DB" -tAc "DELETE FROM tasks WHERE id = '$TASK_ID'" >/dev/null 2>&1
  [[ -n "$DEC_ID" ]] && psql "$DB" -tAc "DELETE FROM decisions WHERE id = '$DEC_ID'" >/dev/null 2>&1
  psql "$DB" -tAc "DELETE FROM golden_paths WHERE id = '$GP_ID'" >/dev/null 2>&1
  ok "清理完成"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
