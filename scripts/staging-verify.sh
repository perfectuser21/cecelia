#!/usr/bin/env bash
# 候选自身读回：固定来源、隔离运行、关闭 tick、任务 API 真连库。
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/brain-candidate-docker.sh"
[[ "${EXPECTED_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || { echo '缺少固定候选 SHA' >&2; exit 1; }
[[ "${STAGING_CONTAINER:-}" == cecelia-admission-brain ]] || { echo '非法候选容器' >&2; exit 1; }
health=$(candidate_docker exec "$STAGING_CONTAINER" curl -fsS --max-time 15 http://localhost:5222/api/brain/health)
printf '%s' "$health" | node -e '
 const fs=require("fs"),d=JSON.parse(fs.readFileSync(0,"utf8"));
 if(d.status!=="healthy"||d.git_sha!==process.env.EXPECTED_SHA||d.version!==process.env.EXPECTED_VERSION||d.runtime?.isolated!==true||d.runtime?.background_automation!==false)throw Error("候选健康/来源/隔离核验失败");
'
candidate_docker exec "$STAGING_CONTAINER" curl -fsS --max-time 15 http://localhost:5222/api/brain/tick/status | node -e '
 const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(d.enabled!==false)throw Error("候选 tick 未关闭");
'
candidate_docker exec "$STAGING_CONTAINER" curl -fsS --max-time 15 'http://localhost:5222/api/brain/tasks?limit=1' | node -e '
 const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!Array.isArray(d)||d.some(t=>!t||typeof t!=="object"||!/^([a-f0-9]{8}-){1}[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(t.id)||typeof t.title!=="string"||typeof t.status!=="string"))throw Error("候选任务读回无效");
'
database=$(candidate_docker exec "$STAGING_CONTAINER" node --input-type=module -e '
 const {default:pg}=await import("pg"),{DB_DEFAULTS}=await import("./src/db-config.js");
 if(DB_DEFAULTS.host!=="stage-db"||DB_DEFAULTS.database!=="cecelia_staging")throw Error("候选连接配置不隔离");
 const c=new pg.Client({...DB_DEFAULTS,query_timeout:15000});await c.connect();
 try { const {rows:[r]}=await c.query("SELECT current_database() AS database,to_regclass($1) IS NOT NULL AS tasks_table",["public.tasks"]);process.stdout.write(JSON.stringify({...r,host:DB_DEFAULTS.host})); }finally{await c.end();}
')
business=$(candidate_docker exec -e EXPECTED_SHA="$EXPECTED_SHA" "$STAGING_CONTAINER" node scripts/native-agent/staging-business.mjs)
business=$(printf '%s' "$business" | node -e '
 const text=require("fs").readFileSync(0,"utf8"),rows=text.split("\n").filter(line=>line.startsWith("STAGING_BUSINESS_RECEIPT "));
 if(rows.length!==1)throw Error("候选业务收据缺失或重复");
 const b=JSON.parse(rows[0].slice("STAGING_BUSINESS_RECEIPT ".length));
 if(b.protocol!=="brain-staging-business/v1"||b.status!=="passed"||b.git_sha!==process.env.EXPECTED_SHA
   ||b.task_status!=="completed_no_pr"||b.run_status!=="success"||b.artifact_verified!==true||b.execution_stopped!==true
   ||!/^[a-f0-9]{64}$/.test(b.artifact_sha256??"")||b.external_services!=="not_evaluated"||![b.task_id,b.run_id].every(id=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)))throw Error("候选业务合同未通过");
 process.stdout.write(JSON.stringify(b));
')
export STAGING_BUSINESS_RECEIPT="$business"
printf '%s' "$database" | node -e '
 const fs=require("fs"),d=JSON.parse(fs.readFileSync(0,"utf8"));
 if(d.database!=="cecelia_staging"||d.host!=="stage-db"||d.tasks_table!==true)throw Error("候选数据库身份读回不符");
 d.business=JSON.parse(process.env.STAGING_BUSINESS_RECEIPT);
 if(process.env.STAGING_VERIFY_OUTPUT)fs.writeFileSync(process.env.STAGING_VERIFY_OUTPUT,JSON.stringify(d));
'
echo 'STAGING_OK：固定来源、隔离数据库与原生任务/运行/产物/停止合同通过；外部服务未评估'
