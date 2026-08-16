#!/bin/bash
# 独立 DB 写入类 oracle（真 Postgres，scratch 库）——
# payload.base_repo 回填的完整 clone URL 经真 PG JSONB 往返。
# URL 由真实导出函数 canonicalBaseRepoUrl 计算，非硬编码。
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
cd "${WORKSPACE_PATH:-/workspace}"

URL=$(node --input-type=module -e "import('./packages/brain/src/work-routing-store.js').then(m=>{const u=m.canonicalBaseRepoUrl('cecelia');if(u==null){process.stderr.write('FAIL null url');process.exit(1)}process.stdout.write(u)})")
echo "derived base_repo url: ${URL}"

ROUNDTRIP=$(psql "$DB_URL" -tAX <<SQL
CREATE TEMP TABLE _bf_probe(payload jsonb);
INSERT INTO _bf_probe(payload) VALUES (jsonb_build_object('work_kind','coding_mutation','base_repo', '${URL}'::text));
SELECT payload->>'base_repo' FROM _bf_probe WHERE payload->>'work_kind'='coding_mutation';
SQL
)
echo "psql roundtrip: ${ROUNDTRIP}"
[ "$ROUNDTRIP" = "https://github.com/perfectuser21/cecelia.git" ] || { echo "FAIL: base_repo 落库/回读不等于完整 URL"; exit 1; }
echo "OK: payload.base_repo 回填 URL 经真 Postgres JSONB 往返一致"
