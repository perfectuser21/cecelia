#!/usr/bin/env bash
# initiative-detail-smoke.sh
# 验证 GET /api/brain/harness/initiative/:id/detail 端点行为
# 覆盖：200 schema / 404 / prd_content null / screenshot_urls array / gan_rounds number|null
set -euo pipefail

BASE="${BASE:-localhost:5221}"
DB="${DB:-postgresql://localhost/cecelia}"

echo "=== initiative-detail smoke ==="

# 1. 404 路径
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail")
[ "$CODE" = "404" ] || { echo "FAIL: 不存在 ID 应返回 404，实际 $CODE"; exit 1; }
RESP404=$(curl -s "$BASE/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail")
node -e "const r=JSON.parse(process.argv[1]); if(r.error!=='initiative not found') { console.error('FAIL: error 字段错误',r.error); process.exit(1); }" "$RESP404"
echo "✓ 404 路径通过"

# 2. 插入测试 initiative（sprint_dir 指向不存在目录）
INIT_ID=$(psql "$DB" -t -c "INSERT INTO tasks (task_type, status, title, payload) VALUES ('harness_initiative', 'queued', 'smoke-initiative-detail', '{\"sprint_dir\":\"sprints/smoke-nonexistent-xyz\"}') RETURNING id" | tr -d ' \n')
[ -n "$INIT_ID" ] || { echo "FAIL: 无法插入 initiative"; exit 1; }
echo "✓ 测试 initiative 已插入: $INIT_ID"

# 3. 200 + schema 验证
RESP=$(curl -sf "$BASE/api/brain/harness/initiative/${INIT_ID}/detail")
node -e "
const r = JSON.parse(process.argv[1]);
const keys = Object.keys(r).sort().join(',');
const expected = 'contract_content,gan_rounds,initiative_id,prd_content,screenshot_urls,step_timing';
if (keys !== expected) { console.error('FAIL: schema keys 不符', keys); process.exit(1); }
if (r.initiative_id !== process.argv[2]) { console.error('FAIL: initiative_id 不匹配'); process.exit(1); }
if (r.prd_content !== null) { console.error('FAIL: prd_content 应为 null（文件不存在）'); process.exit(1); }
if (r.contract_content !== null) { console.error('FAIL: contract_content 应为 null（文件不存在）'); process.exit(1); }
if (!Array.isArray(r.screenshot_urls)) { console.error('FAIL: screenshot_urls 应为 array'); process.exit(1); }
if (r.gan_rounds !== null && typeof r.gan_rounds !== 'number') { console.error('FAIL: gan_rounds 应为 null 或 number'); process.exit(1); }
if (['prd','contract','timeline','screenshots','stages','details','data'].some(k => k in r)) { console.error('FAIL: 含禁用字段'); process.exit(1); }
" "$RESP" "$INIT_ID"
echo "✓ schema/类型/禁用字段 全部通过"

# 4. 清理
psql "$DB" -c "DELETE FROM tasks WHERE id = '${INIT_ID}'" > /dev/null

echo "=== initiative-detail smoke PASSED ==="
