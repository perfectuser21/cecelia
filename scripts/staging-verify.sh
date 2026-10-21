#!/usr/bin/env bash
# 候选自身读回：固定来源、隔离运行、关闭 tick、任务 API 真连库。
set -euo pipefail
[[ "${EXPECTED_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || { echo '缺少固定候选 SHA' >&2; exit 1; }
[[ "${STAGING_CONTAINER:-}" == cecelia-admission-brain ]] || { echo '非法候选容器' >&2; exit 1; }
health=$(docker exec "$STAGING_CONTAINER" curl -fsS --max-time 15 http://localhost:5222/api/brain/health)
printf '%s' "$health" | node -e '
 const fs=require("fs"),d=JSON.parse(fs.readFileSync(0,"utf8"));
 if(d.status!=="healthy"||d.git_sha!==process.env.EXPECTED_SHA||d.version!==process.env.EXPECTED_VERSION||d.runtime?.isolated!==true||d.runtime?.background_automation!==false)throw Error("候选健康/来源/隔离核验失败");
'
docker exec "$STAGING_CONTAINER" curl -fsS --max-time 15 http://localhost:5222/api/brain/tick/status | node -e '
 const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.enabled!==false)throw Error("候选 tick 未关闭");
'
docker exec "$STAGING_CONTAINER" curl -fsS --max-time 15 'http://localhost:5222/api/brain/tasks?limit=1' | node -e '
 const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!d||typeof d!=="object")throw Error("候选任务读回无效");
'
echo 'STAGING_OK：候选同 SHA、隔离运行、关闭 tick 且任务 API 读回成功'
