#!/usr/bin/env bash
# DoD BEHAVIOR 7 — postdeploy-verifier-smoke.sh 全脚本回归 — Step 3 清理命中新 DELETE
# 路由（200），脚本创建的任务最终 DB status='cancelled'（PRD 背景段描述的根因链路已断开）
set -e
DB="${DB:-postgresql://localhost/cecelia}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT=$(BRAIN_URL=http://localhost:5221 bash "${REPO_ROOT}/packages/brain/scripts/smoke/postdeploy-verifier-smoke.sh" 2>&1)
echo "$OUT"
TID4=$(echo "$OUT" | grep -oE 'id=[0-9a-f-]{36}' | head -1 | cut -d= -f2)
[ -n "$TID4" ]
DBSTATUS4=$(psql "$DB" -tAq -c "SELECT status FROM tasks WHERE id='$TID4'" | tr -d ' \n')
[ "$DBSTATUS4" = "cancelled" ]
echo OK
