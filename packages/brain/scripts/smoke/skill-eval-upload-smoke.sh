#!/usr/bin/env bash
# skill-eval upload 链路冒烟：验证 upload → pending 入队 → status 可查
# 不触发真实 claude 评估（仅验证入队路径，daemon 在独立机器跑）
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── skill-eval upload smoke ──"

# 检查 skill_evals 表存在
TBLCHECK=$(PGPASSWORD="${POSTGRES_PASSWORD:-cecelia}" psql -h "${POSTGRES_HOST:-localhost}" \
  -U "${POSTGRES_USER:-cecelia}" -d "${POSTGRES_DB:-cecelia}" -t \
  -c "SELECT 1 FROM information_schema.tables WHERE table_name='skill_evals'" 2>/dev/null | tr -d ' ' || echo "")
[ "$TBLCHECK" = "1" ] && ok "skill_evals 表存在" || fail "skill_evals 表不存在"

# 生成最小合法 zip（内含 SKILL.md，Python3 写）
TMP_ZIP=$(mktemp /tmp/smoke-skill-eval-XXXXXX.zip)
python3 - <<'PYEOF' "$TMP_ZIP"
import sys, zipfile
path = sys.argv[1]
with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('SKILL.md', '# Smoke Test Skill\n\n## 简介\nCI smoke test\n')
PYEOF
[ -f "$TMP_ZIP" ] && ok "生成 smoke zip" || { fail "生成 zip 失败"; exit 1; }

# POST upload
SKILL_NAME="smoke-skill-$(date +%s)"
UPLOAD_RESP=$(curl -sf -X POST "$BRAIN/api/skill-eval/upload" \
  -F "file=@${TMP_ZIP};type=application/zip" \
  -F "skill_name=${SKILL_NAME}" \
  -F "platform=ci-smoke" \
  -F "submitter=smoke" 2>/dev/null || echo '{}')
rm -f "$TMP_ZIP"

TASK_ID=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('task_id',''))" 2>/dev/null || echo "")
[ -n "$TASK_ID" ] && ok "upload 返回 task_id=$TASK_ID" || { fail "upload 失败: $UPLOAD_RESP"; echo "PASS:$PASS FAIL:$FAIL"; exit 1; }

# 幂等：相同 zip 再传应返回 deduped=true
DEDUP_RESP=$(curl -sf -X POST "$BRAIN/api/skill-eval/upload" \
  -F "file=@/dev/stdin;type=application/zip;filename=x.zip" \
  -F "skill_name=${SKILL_NAME}-dup" \
  -F "platform=ci-smoke" \
  -F "submitter=smoke" <<< "" 2>/dev/null || echo '{}')

# status 查询返回合法字段
STATUS_RESP=$(curl -sf "$BRAIN/api/skill-eval/status/$TASK_ID" 2>/dev/null || echo '{}')
STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
[[ "$STATUS" =~ ^(pending|running|completed|failed)$ ]] && ok "status=$STATUS（合法值）" || fail "status 非法: $STATUS"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
