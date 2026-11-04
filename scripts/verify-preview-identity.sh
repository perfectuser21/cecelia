#!/usr/bin/env bash
# active 账本不代表本次代码已在正确数据库上运行；直接读取候选实例。
set -euo pipefail
: "${EXPECTED_SHA:?}" "${EXPECTED_DB_NAME:?}" "${PR_NUMBER:?}"
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "$EXPECTED_DB_NAME" == "cecelia_preview_${PR_NUMBER}" ]] || { echo 'unsafe preview database identity' >&2; exit 2; }
PREVIEW_URL="${PREVIEW_URL:-http://${PREVIEW_HOST:?}:${EXPECTED_PORT:?}}"
identity=$(curl -fsS --connect-timeout 5 --max-time 15 "${PREVIEW_URL}/api/brain/preview/identity")
printf '%s' "$identity" | python3 -c 'import json,os,sys
v=json.load(sys.stdin)
expected={"git_sha":os.environ["EXPECTED_SHA"],"db_name":os.environ["EXPECTED_DB_NAME"],"pr_number":int(os.environ["PR_NUMBER"]),"tick_enabled":False}
for field,value in expected.items():
 if type(v.get(field)) is not type(value) or v[field] != value:
  raise SystemExit("preview identity mismatch: " + field)
print("preview code/database/tick identity verified")'
echo "preview_url=$PREVIEW_URL" >> "${GITHUB_OUTPUT:?}"
