---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 实测各 harness 角色容器真实 RSS 峰值（跑到 evaluator 后即停）

**范围**: 给 harness 角色运行链路插入 RSS 采样 + 峰值聚合 + evaluator 后即停控制；2 个 Brain 端点（触发/查报告）+ DB 表 `harness_role_rss` + run 目录报告文件。
**不在范围**: CPU/磁盘/网络指标；evaluator 之后节点（PR/回写/多轮 GAN）；配额调优。
**大小**: L

## 接缝清单（真目标验证 — 见 contract-draft.md）

- 接缝 #1：真实 `docker stats` 读 `harness-{role}-*` 容器 RSS → final-e2e 真实 run 验；CI 仅验 process-path 采样逻辑 → docker-path 标 `logic-done-pending`
- 接缝 #2：真实 graph 执行到 evaluator 后真截断、本 run 无 PR → final-e2e 验；CI 仅验截断控制纯逻辑

## ARTIFACT 条目

- [ ] [ARTIFACT] RSS 采样器模块存在并导出 sample/peak 能力
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-rss-sampler.js','utf8');if(!/export\s+(async\s+)?function\s+(sampleRss|samplePeak|sampleProcessRss)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 采样 CLI probe 存在（供 BEHAVIOR 对真实进程读真实 RSS）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/scripts/rss-sample-probe.mjs','utf8');if(!c.includes('--interval-ms')||!c.includes('peak_rss_mb'))process.exit(1)"

- [ ] [ARTIFACT] 测量编排模块存在并导出 computeStopBoundary + buildReport
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-rss-measure.js','utf8');if(!c.includes('computeStopBoundary')||!c.includes('buildReport'))process.exit(1)"

- [ ] [ARTIFACT] 迁移建表 harness_role_rss
  Test: node -e "const fs=require('fs');const d='packages/brain/migrations';const f=fs.readdirSync(d).find(x=>/harness_role_rss/i.test(fs.readFileSync(d+'/'+x,'utf8')));if(!f)process.exit(1)"

- [ ] [ARTIFACT] 两个端点注册在 routes/harness.js
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('rss-measure')||!c.includes('rss-report'))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash，autonomous — 测真实 Brain/DB/真实进程，禁 mock）

- [ ] [BEHAVIOR] POST /rss-measure 触发测量 run，返回 200 + uuid run_id + status="started"（404=路由未注册=FAIL）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/rss-measure -H "Content-Type: application/json" -d "{}") || { echo FAIL-no200; exit 1; }; echo "$RESP" | jq -e ".status==\"started\"" || exit 1; echo "$RESP" | jq -e "(.run_id|type==\"string\") and (.run_id|test(\"^[0-9a-f-]{36}$\"))" || exit 1; echo "$RESP" | jq -e "keys==[\"run_id\",\"status\"]" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] RSS 采样器对真实子进程读真实 RSS：峰值 > 0、采样次数 >= 2（无 mock，env 无关逻辑断言）
  Test: manual:bash -c 'node -e "const a=[];for(let i=0;i<2e6;i++)a.push(i);setTimeout(()=>{},2500)" & CPID=$!; OUT=$(node packages/brain/src/scripts/rss-sample-probe.mjs --pid "$CPID" --interval-ms 200 --max-ms 2000); echo "$OUT" | jq -e ".peak_rss_mb > 0" || { echo FAIL-peak; exit 1; }; echo "$OUT" | jq -e ".sample_count >= 2" || { echo FAIL-count; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] computeStopBoundary 在 evaluator 后截断：返回恰 4 角色、不含 openPr/writeback（接缝 #2 的逻辑断言）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/harness-rss-measure.js\").then(m=>{const r=m.computeStopBoundary([\"planner\",\"proposer\",\"generator\",\"evaluator\",\"openPr\",\"writeback\"],\"evaluator\");if(JSON.stringify(r)!==JSON.stringify([\"planner\",\"proposer\",\"generator\",\"evaluator\"])){console.error(\"FAIL\",r);process.exit(1)}console.log(\"OK\")}).catch(e=>{console.error(\"FAIL\",e.message);process.exit(1)})"'
  期望: OK

- [ ] [BEHAVIOR] buildReport 聚合 schema：顶层 keys=={roles,run_id,run_ts,stopped_after}、4 角色、peak=max、sample_count、禁用字段不漏网（Step 4 逻辑断言）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/harness-rss-measure.js\").then(m=>{const rep=m.buildReport(\"00000000-0000-4000-8000-000000000000\",1718900000000,[{role:\"planner\",samples:[100,312.5,200],status:\"complete\"},{role:\"proposer\",samples:[287.1],status:\"complete\"},{role:\"generator\",samples:[540.8,10],status:\"complete\"},{role:\"evaluator\",samples:[410.2],status:\"complete\"}]);const J=JSON.stringify;const keys=Object.keys(rep).sort();if(J(keys)!==J([\"roles\",\"run_id\",\"run_ts\",\"stopped_after\"])){console.error(\"FAIL-keys\",keys);process.exit(1)}if(rep.stopped_after!==\"evaluator\"){console.error(\"FAIL-stop\");process.exit(1)}if(rep.roles.length!==4){console.error(\"FAIL-len\");process.exit(1)}const p=rep.roles.find(r=>r.role===\"planner\");if(p.peak_rss_mb!==312.5||p.sample_count!==3){console.error(\"FAIL-agg\",p);process.exit(1)}const ik=Object.keys(p).sort();if(J(ik)!==J([\"peak_rss_mb\",\"role\",\"sample_count\",\"status\"])){console.error(\"FAIL-itemkeys\",ik);process.exit(1)}if(\"rss_mb\" in p||\"memory\" in p||\"samples\" in p||\"id\" in rep){console.error(\"FAIL-banned\");process.exit(1)}console.log(\"OK\")}).catch(e=>{console.error(\"FAIL\",e.message);process.exit(1)})"'
  期望: OK

- [ ] [BEHAVIOR] buildReport 边界：角色提前退出 status=incomplete 但 peak_rss_mb 仍 > 0（两点保底，Step 6）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/harness-rss-measure.js\").then(m=>{const rep=m.buildReport(\"00000000-0000-4000-8000-000000000000\",1718900000000,[{role:\"generator\",samples:[180,260],status:\"incomplete\"}]);const g=rep.roles.find(r=>r.role===\"generator\");if(g.status!==\"incomplete\"){console.error(\"FAIL-status\");process.exit(1)}if(!(g.peak_rss_mb>0)){console.error(\"FAIL-peak0\");process.exit(1)}console.log(\"OK\")}).catch(e=>{console.error(\"FAIL\",e.message);process.exit(1)})"'
  期望: OK

- [ ] [BEHAVIOR] error path — GET /rss-report 非 UUID 返 400（路由未注册会给 404 → 此断言连带 FAIL）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/rss-report/not-a-uuid"); [ "$CODE" = "400" ] || { echo "FAIL got=$CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — GET /rss-report 未知合法 UUID 返 404 + error 字段为 string
  Test: manual:bash -c 'ERR=$(curl -s "localhost:5221/api/brain/harness/rss-report/00000000-0000-4000-8000-000000000000"); echo "$ERR" | jq -e ".error | type==\"string\"" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] DB 表 harness_role_rss 结构正确（run_id/role/peak_rss_mb/sample_count/status/created_at 列 + UNIQUE(run_id,role)）
  Test: manual:bash -c 'COLS=$(psql "${DB_URL:-cecelia}" -t -c "SELECT string_agg(column_name, \",\" ORDER BY column_name) FROM information_schema.columns WHERE table_name=\x27harness_role_rss\x27" | tr -d " "); echo "$COLS" | grep -q "created_at" && echo "$COLS" | grep -q "peak_rss_mb" && echo "$COLS" | grep -q "sample_count" && echo "$COLS" | grep -q "run_id" && echo "$COLS" | grep -q "role" && echo "$COLS" | grep -q "status" || { echo "FAIL cols=$COLS"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（final-e2e 跑真实 measurement run — 接缝 #1/#2 真目标验证，见 contract-draft.md ## E2E 验收）

- [ ] [BEHAVIOR:E2E] 触发真实 measurement run → 4 角色各有真实 RSS 峰值 > 0、evaluator 后即停、无 PR 产出、本 run DB 恰 4 行（时间窗内）
  Test: 见 contract-draft.md ## E2E 验收 脚本（local_api，curl localhost:5221 + psql + run_ts/created_at 时间窗防伪）
  期望: 脚本 exit 0
  备注: 接缝 #1/#2 未在真 docker+真 graph 上跑过前，docker-path 采样与真实 graph 截断标 logic-done-pending，不得标 done
