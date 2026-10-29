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
 const d=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!Array.isArray(d)||d.some(t=>!t||typeof t!=="object"||!/^([a-f0-9]{8}-){1}[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(t.id)||typeof t.title!=="string"||typeof t.status!=="string"))throw Error("候选任务读回无效");
'
database=$(docker exec "$STAGING_CONTAINER" node --input-type=module -e '
 const {default:pg}=await import("pg"),{DB_DEFAULTS}=await import("./src/db-config.js");
 if(DB_DEFAULTS.host!=="stage-db"||DB_DEFAULTS.database!=="cecelia_staging")throw Error("候选连接配置不隔离");
 const c=new pg.Client({...DB_DEFAULTS,query_timeout:15000});await c.connect();
 try { const {rows:[r]}=await c.query("SELECT current_database() AS database,to_regclass($1) IS NOT NULL AS tasks_table",["public.tasks"]);process.stdout.write(JSON.stringify({...r,host:DB_DEFAULTS.host})); }finally{await c.end();}
')
printf '%s' "$database" | node -e '
 const fs=require("fs"),d=JSON.parse(fs.readFileSync(0,"utf8"));
 if(d.database!=="cecelia_staging"||d.host!=="stage-db"||d.tasks_table!==true)throw Error("候选数据库身份读回不符");
 if(process.env.STAGING_VERIFY_OUTPUT)fs.writeFileSync(process.env.STAGING_VERIFY_OUTPUT,JSON.stringify(d));
'
projection=$(docker exec "$STAGING_CONTAINER" node --input-type=module -e '
 import pg from "pg";
 import {DB_DEFAULTS} from "./src/db-config.js";
 import {loadDirectorySource,buildDirectoryRows,assertLeadgenStagingProjection} from "./src/projection/directory-source.js";
 if(DB_DEFAULTS.host!=="stage-db"||DB_DEFAULTS.database!=="cecelia_staging")throw Error("候选目录合同查询不在隔离库");
 const pool=new pg.Pool({...DB_DEFAULTS,query_timeout:120000});
 try {
   const source=await loadDirectorySource(pool);
   process.stdout.write(JSON.stringify(assertLeadgenStagingProjection(source,buildDirectoryRows(source,{}))));
 } finally { await pool.end(); }
')
printf '%s' "$projection" | node -e '
 const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
 if(d.workflows!==4||d.refs!==14||d.activities!==12)throw Error("候选 101–104 合同投影读回数量不符");
'
printf 'STAGING_LEADGEN_PROJECTION_OK %s\n' "$projection"
echo 'STAGING_OK：候选同 SHA、隔离运行、关闭 tick 且任务 API 读回成功'
