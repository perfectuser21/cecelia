---
skeleton: false
journey_type: dev_pipeline
target_environment: local_api
---
# Contract DoD — Sprint: Decision System 地基（level/target_type/scope 流程走通 + Notion 同步）

**范围**: Brain API 写 ability/feature 级决策（带 level/target_type/target_id/scope 校验）+ 读某 ability 的决策清单；扩 pushDecisions 映射 Level/Scope/ability relation 进 Notion AI Notes；新路由必须挂载到 routes.js 真实可达。**不碰 migration**。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] POST /api/brain/decisions 路由已实现且挂载（routes.js 链路可达）
  Test: manual:bash -c 'C=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{}"); [ "$C" = "400" ] || [ "$C" = "201" ] || { echo "FAIL: 路由未挂载 code=$C（404=未注册）"; exit 1; }; echo OK'
  期望: OK（返回 400 业务校验或 201，非 404 路由缺失）

- [ ] [ARTIFACT] notion-push-sync.js 导出纯映射函数 buildDecisionNotionProperties
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/notion-push-sync.js\").then(m=>{if(typeof m.buildDecisionNotionProperties!==\"function\"){console.error(\"FAIL: 未导出 buildDecisionNotionProperties\");process.exit(1)}console.log(\"OK\")}).catch(e=>{console.error(\"FAIL:\",e.message);process.exit(1)})"'
  期望: OK

## BEHAVIOR 条目（journey_type=dev_pipeline / target_environment=local_api — curl localhost:5221 + psql + node 确定性）

- [ ] [BEHAVIOR] POST 决策 → 201 + 返回 id(string) + level/target_id/scope 回显（Golden Path Step 1）
  Test: manual:bash -c 'AB=$(psql "$DB" -t -c "SELECT id FROM journey_features WHERE kind='"'"'ability'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " "); R=$(curl -sf -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"$AB\",\"scope\":\"v1\"}"); echo "$R" | jq -e ".id | type == \"string\"" && echo "$R" | jq -e ".level == \"ability\"" && echo "$R" | jq -e ".scope == \"v1\"" && echo "$R" | jq -e ".target_id == \"$AB\""'
  期望: exit 0

- [ ] [BEHAVIOR] 决策落库 — decisions 表新增行 level/target_type/target_id/scope 正确（带时间窗防造假，Golden Path Step 1b）
  Test: manual:bash -c 'AB=$(psql "$DB" -t -c "SELECT id FROM journey_features WHERE kind='"'"'ability'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " "); R=$(curl -sf -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"$AB\",\"scope\":\"v1\"}"); ID=$(echo "$R" | jq -r ".id"); ROW=$(psql "$DB" -t -c "SELECT level||'"'"'|'"'"'||target_type||'"'"'|'"'"'||scope FROM decisions WHERE id='"'"'$ID'"'"' AND target_id='"'"'$AB'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$ROW" = "ability|journey_feature|v1" ] || { echo "FAIL: $ROW"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/brain/abilities/:id/decisions?scope=v1 → 200 + 数组含该决策且全部 scope=v1（Golden Path Step 3）
  Test: manual:bash -c 'AB=$(psql "$DB" -t -c "SELECT id FROM journey_features WHERE kind='"'"'ability'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " "); R=$(curl -sf -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"topic\":\"t\",\"decision\":\"d\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"$AB\",\"scope\":\"v1\"}"); ID=$(echo "$R" | jq -r ".id"); L=$(curl -sf "localhost:5221/api/brain/abilities/$AB/decisions?scope=v1"); echo "$L" | jq -e "type == \"array\"" && echo "$L" | jq -e --arg id "$ID" "any(.[]; .id == \$id)" && echo "$L" | jq -e "all(.[]; .scope == \"v1\")"'
  期望: exit 0

- [ ] [BEHAVIOR] error path — 非法 level → 400 + error(string)（Golden Path Step 4）
  Test: manual:bash -c 'AB=$(psql "$DB" -t -c "SELECT id FROM journey_features WHERE kind='"'"'ability'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " "); C=$(curl -s -o /tmp/dod_e1.json -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"topic\":\"x\",\"decision\":\"y\",\"level\":\"galaxy\",\"target_type\":\"journey_feature\",\"target_id\":\"$AB\",\"scope\":\"v1\"}"); [ "$C" = "400" ] || { echo "FAIL: code=$C"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/dod_e1.json'
  期望: exit 0

- [ ] [BEHAVIOR] error path — 非法 target_id（不存在 journey_features）→ 400 + error(string)（Golden Path Step 4）
  Test: manual:bash -c 'C=$(curl -s -o /tmp/dod_e2.json -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"topic\":\"x\",\"decision\":\"y\",\"level\":\"ability\",\"target_type\":\"journey_feature\",\"target_id\":\"00000000-0000-0000-0000-000000000000\",\"scope\":\"v1\"}"); [ "$C" = "400" ] || { echo "FAIL: code=$C"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/dod_e2.json'
  期望: exit 0

- [ ] [BEHAVIOR] 空清单 — 无决策的 ability GET → 200 + [] 非报错（Golden Path Step 5）
  Test: manual:bash -c 'EMPTY=$(psql "$DB" -t -c "INSERT INTO journey_features (name, kind, status) VALUES ('"'"'e2e-empty-'"'"'||floor(extract(epoch from now()))::text, '"'"'ability'"'"', '"'"'planned'"'"') RETURNING id" | tr -d " "); curl -sf "localhost:5221/api/brain/abilities/$EMPTY/decisions?scope=v1" | jq -e "type == \"array\" and length == 0"'
  期望: exit 0

- [ ] [BEHAVIOR] Notion 映射 — buildDecisionNotionProperties 把 level→Level、scope→Scope、ability→relation（确定性，不打 Notion 网络，Golden Path Step 2）
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/notion-push-sync.js\").then(m=>{const p=m.buildDecisionNotionProperties({level:\"ability\",scope:\"v1\",topic:\"t\",decision:\"d\"},\"ab-notion-id\");const lv=p.Level&&(p.Level.select?p.Level.select.name:(p.Level.status?p.Level.status.name:null));const sc=p.Scope&&(p.Scope.select?p.Scope.select.name:(p.Scope.status?p.Scope.status.name:null));if(lv!==\"ability\"){console.error(\"FAIL: Level\",JSON.stringify(p.Level));process.exit(1)}if(sc!==\"v1\"){console.error(\"FAIL: Scope\",JSON.stringify(p.Scope));process.exit(1)}const rel=Object.values(p).some(v=>v&&Array.isArray(v.relation)&&v.relation.some(r=>r.id===\"ab-notion-id\"));if(!rel){console.error(\"FAIL: 缺 ability relation\");process.exit(1)}console.log(\"OK\")}).catch(e=>{console.error(\"FAIL:\",e.message);process.exit(1)})"'
  期望: OK

- [ ] [BEHAVIOR] Notion 去重 — pushDecisions 保留 notion_synced_at IS NULL 过滤（已同步不重推，Golden Path Step 2 边界）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/notion-push-sync.js\",\"utf8\");const i=c.indexOf(\"function pushDecisions\");if(i<0){console.error(\"FAIL: 无 pushDecisions\");process.exit(1)}const seg=c.slice(i,i+1200);if(!/FROM decisions[\s\S]*?notion_synced_at IS NULL/.test(seg)){console.error(\"FAIL: pushDecisions 缺 notion_synced_at IS NULL 去重\");process.exit(1)}console.log(\"OK\")"'
  期望: OK
