contract_branch: cp-05271403-ws-9e9801e7-ws1
workstream_index: 1
sprint_dir: sprints/harness-journey-tracking

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: initiative_runs.journey_id + GET /initiative-runs/:id

**范围**: DB migration 添加 journey_id UUID NULL 列；harness-initiative.graph.js 两处 INSERT 补写 journey_id；packages/brain/src/routes/harness.js 新增 GET /initiative-runs/:id 路由（按 initiative_id 查最新 run，返回含 journey_id 字段）
**大小**: M（migration ~10 行 + graph.js 修改 2 处 + routes 新增路由 ~25 行）
**依赖**: 无（唯一 workstream ws1）

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/db/migrations/011-initiative-runs-journey-id.sql` 存在且含 journey_id
  Test: manual:bash -c 'node -e "const {existsSync,readFileSync}=require(\"fs\");const f=\"packages/brain/src/db/migrations/011-initiative-runs-journey-id.sql\";if(!existsSync(f)||!readFileSync(f,\"utf8\").includes(\"journey_id\")){console.error(\"FAIL\");process.exit(1);}console.log(\"OK\")"'

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] psql \d initiative_runs 输出含 journey_id 列（migration 已运行）
  Test: manual:bash -c 'PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "\d initiative_runs" | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c);process.stdin.on(\"end\",()=>d.includes(\"journey_id\")?(console.log(\"OK\"),process.exit(0)):(console.error(\"FAIL\"),process.exit(1)))"'
  期望: OK

- [x] [BEHAVIOR] curl localhost:5221/api/brain/initiative-runs/not-a-uuid 返回 400（路由已注册）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/initiative-runs/not-a-uuid); [ "$CODE" = "400" ] && echo OK || { echo "FAIL: got $CODE"; exit 1; }'
  期望: OK

- [x] [BEHAVIOR] harness-initiative.graph.js 两处 INSERT INTO initiative_runs 均含 journey_id 字段
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/workflows/harness-initiative.graph.js\",\"utf8\");const blocks=c.match(/INSERT INTO initiative_runs[\s\S]*?RETURNING id/g)||[];if(blocks.length<2){console.error(\"FAIL: 少于 2 个 INSERT 块\");process.exit(1);}blocks.forEach((b,i)=>{if(!b.includes(\"journey_id\")){console.error(\"FAIL: INSERT 块 \"+(i+1)+\" 缺 journey_id\");process.exit(1);}});console.log(\"OK\")"'
  期望: OK
