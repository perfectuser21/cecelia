#!/usr/bin/env bash
set -euo pipefail
# 只读验证已部署API白名单，不启用策略、不发起清理。
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
curl -q --fail --silent --show-error --max-time 10 --max-filesize 262144 \
  "${BRAIN_URL}/api/brain/janitor/jobs" | node --input-type=module -e '
let body="";
for await (const chunk of process.stdin) { body+=chunk; if(body.length>262144)process.exit(1); }
const {jobs}=JSON.parse(body);
const target=Array.isArray(jobs)?jobs.filter(x=>x.id==="us-brain-image-retention-v1"):[];
if(target.length!==1 || typeof target[0].enabled!=="boolean" || typeof target[0].name!=="string"
    || jobs.some(x=>x.id==="docker-prune"))process.exit(1);
console.log("[us-image-retention-smoke] PASS");
'
