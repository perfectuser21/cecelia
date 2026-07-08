#!/usr/bin/env bash
# eval-upload-no-tasks-insert-smoke.sh
# 回归验证：eval upload 不再向 tasks 表插行（migration 321 + eval.js fix）
# - skill_evals 无 tasks FK 约束
# - upload 返回 task_id（不是 500 type-column-error）
# - skill_evals 行存在，tasks 表无对应行
set -uo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── eval-upload no-tasks-insert smoke ──"

# 1. skill_evals 无 FK 指向 tasks（migration 321）
FK_CHECK=$(PGPASSWORD="${POSTGRES_PASSWORD:-cecelia}" psql -h "${POSTGRES_HOST:-localhost}" \
  -U "${POSTGRES_USER:-cecelia}" -d "${POSTGRES_DB:-cecelia}" -t \
  -c "SELECT count(*) FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON rc.constraint_name = kcu.constraint_name
      WHERE kcu.table_name = 'skill_evals'
        AND rc.unique_constraint_schema = 'public'" 2>/dev/null | tr -d ' ' || echo "-1")
[ "$FK_CHECK" = "0" ] \
  && ok "skill_evals 无 FK 约束（migration 321 已执行）" \
  || fail "skill_evals 仍有 FK 约束，count=$FK_CHECK（migration 321 未执行？）"

# 2. 生成最小合法 zip
TMP_ZIP=$(mktemp /tmp/smoke-eval-notasks-XXXXXX.zip)
python3 - <<'PYEOF' "$TMP_ZIP"
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('SKILL.md', '# No-Tasks Smoke Skill\n\n## 简介\n验证 upload 不污染 tasks 表\n')
PYEOF
[ -f "$TMP_ZIP" ] && ok "生成 smoke zip" || { fail "生成 zip 失败"; exit 1; }

# 3. POST upload，期望 200 返回 task_id
SKILL_NAME="smoke-notasks-$(date +%s)"
HTTP_CODE=$(curl -s -o /tmp/smoke-eval-resp.json -w "%{http_code}" -X POST \
  "$BRAIN/api/skill-eval/upload" \
  -F "file=@${TMP_ZIP};type=application/zip" \
  -F "skill_name=${SKILL_NAME}" \
  -F "platform=ci-smoke" \
  -F "submitter=smoke" 2>/dev/null || echo "000")
rm -f "$TMP_ZIP"
RESP=$(cat /tmp/smoke-eval-resp.json 2>/dev/null || echo '{}')

[ "$HTTP_CODE" = "200" ] \
  && ok "upload HTTP 200（无 type-column-error）" \
  || fail "upload HTTP $HTTP_CODE，响应: $RESP"

TASK_ID=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('task_id',''))" 2>/dev/null || echo "")
[ -n "$TASK_ID" ] && ok "task_id=$TASK_ID" || { fail "upload 响应无 task_id: $RESP"; echo "PASS:$PASS FAIL:$FAIL"; exit 1; }

# 4. skill_evals 行存在
SE_COUNT=$(PGPASSWORD="${POSTGRES_PASSWORD:-cecelia}" psql -h "${POSTGRES_HOST:-localhost}" \
  -U "${POSTGRES_USER:-cecelia}" -d "${POSTGRES_DB:-cecelia}" -t \
  -c "SELECT count(*) FROM skill_evals WHERE task_id='${TASK_ID}'" 2>/dev/null | tr -d ' ' || echo "0")
[ "$SE_COUNT" = "1" ] \
  && ok "skill_evals 行存在（task_id=${TASK_ID}）" \
  || fail "skill_evals 无对应行（count=$SE_COUNT）"

# 5. tasks 表无该 task_id（不再插行）
T_COUNT=$(PGPASSWORD="${POSTGRES_PASSWORD:-cecelia}" psql -h "${POSTGRES_HOST:-localhost}" \
  -U "${POSTGRES_USER:-cecelia}" -d "${POSTGRES_DB:-cecelia}" -t \
  -c "SELECT count(*) FROM tasks WHERE id='${TASK_ID}'" 2>/dev/null | tr -d ' ' || echo "0")
[ "$T_COUNT" = "0" ] \
  && ok "tasks 表无该行（upload 不再污染 tasks）" \
  || fail "tasks 表意外出现该行（count=$T_COUNT）"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
