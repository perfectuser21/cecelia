---
skeleton: false
journey_type: user_facing
target_environment: mac_web
---
# Contract DoD — Sprint: Cockpit Phase 3 · Gate 1 决策面板 + 点火（Round 2）

**范围**: cockpit 详情页在 decisions 分区扩出 Gate 1 决策面板（列出**该 pipeline** active 待决策项，list 源 = `decisions` 表，与 edit 同源）；改单条决策写回 Brain（复用 PUT strategic-decisions）；「再来一轮」触发无头红队再质询（新端点 rechallenge）；「确定点火」推进 pipeline 离开 Gate 1（新端点 fire，A_contract→B_task_loop，并写 node='fire' 留痕）；非 Gate 1 降级 / 空态占位 / 写失败内联报错保留输入不崩。先写 failing test 再实现。
**大小**: M
**不在范围**: Phase 4（Gate 2 闭环/题库回灌）；批量改多条决策；红队算法实现细节；Gate 1 之外状态机改造。

## ARTIFACT 条目

- [ ] [ARTIFACT] 前端详情页 decisions 分区扩出 Gate 1 决策面板组件（testid gate1-decision-panel / gate1-fire-btn / gate1-rechallenge-btn）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('gate1-decision-panel')||!c.includes('gate1-fire-btn')||!c.includes('gate1-rechallenge-btn'))process.exit(1)"

- [ ] [ARTIFACT] 前端命中三个写端点（PUT strategic-decisions / POST .../fire / POST .../rechallenge）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('/api/brain/strategic-decisions/')||!c.includes('/fire')||!c.includes('/rechallenge'))process.exit(1)"

- [ ] [ARTIFACT] 前端覆盖边界态 testid（空态 gate1-empty / 改决策内联报错 gate1-decision-error / 点火内联报错 gate1-fire-error / 降级提示 gate1-fire-disabled-hint）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');for(const t of ['gate1-empty','gate1-decision-error','gate1-fire-error','gate1-fire-disabled-hint'])if(!c.includes(t))process.exit(1)"

- [ ] [ARTIFACT] Brain 注册 fire + rechallenge 写路由
  Test: node -e "const g=require('child_process').execSync('grep -rl \"/fire\" packages/brain/src/routes/ 2>/dev/null',{encoding:'utf8'});if(!g.trim())process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，user_facing 模式 A / API-level，测真实 Brain 5221 + DB）

- [ ] [BEHAVIOR] 该 pipeline 待决策项 list 与 edit 同源（注入 decisions 表 active 行可被 list 源列出）
  Test: manual:bash -c 'DID=$(psql $DB -t -c "INSERT INTO decisions (category,topic,decision,status) VALUES ('"'"'gate1'"'"','"'"'t'"'"','"'"'old'"'"','"'"'active'"'"') RETURNING id" | tr -d " "); curl -sf "localhost:5221/api/brain/strategic-decisions?status=active" | jq -e --arg id "$DID" ".data | map(.id) | index(\$id) != null" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 改单条决策写回 Brain：PUT strategic-decisions/:id 更新 decision（response + DB 定点读双校验 + 禁用字段反向 value/content）
  Test: manual:bash -c 'DID=$(psql $DB -t -c "INSERT INTO decisions (category,topic,decision,status) VALUES ('"'"'gate1'"'"','"'"'t'"'"','"'"'old-val'"'"','"'"'active'"'"') RETURNING id" | tr -d " "); RESP=$(curl -sf -X PUT "localhost:5221/api/brain/strategic-decisions/$DID" -H "Content-Type: application/json" -d "{\"decision\":\"new-val-e2e\"}"); echo "$RESP" | jq -e ".success == true and .data.decision == \"new-val-e2e\"" || exit 1; echo "$RESP" | jq -e ".data | (has(\"value\") or has(\"content\")) | not" || { echo "FAIL 禁用字段漏网"; exit 1; }; NEW=$(psql $DB -t -c "SELECT decision FROM decisions WHERE id='"'"'$DID'"'"'" | tr -d " "); [ "$NEW" = "new-val-e2e" ] || { echo "FAIL DB=$NEW"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 确定点火端点存在并推进 phase A_contract→B_task_loop（端点未注册则 curl -f FAIL，禁 404-acceptable；禁用字段反向 phase/status）
  Test: manual:bash -c 'IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'"'"'A_contract'"'"') RETURNING initiative_id" | tr -d " "); RESP=$(curl -sf -X POST "localhost:5221/api/brain/harness/initiative/$IID/fire" -H "Content-Type: application/json" -d "{}"); echo "$RESP" | jq -e ".ok == true and .from_phase == \"A_contract\" and .to_phase == \"B_task_loop\"" || exit 1; echo "$RESP" | jq -e "(has(\"phase\") or has(\"status\")) | not" || { echo "FAIL 禁用字段 phase/status 漏网"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 点火副作用 1：initiative_runs.phase 真被更新为 B_task_loop（DB 定点读 by id）
  Test: manual:bash -c 'IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'"'"'A_contract'"'"') RETURNING initiative_id" | tr -d " "); curl -sf -X POST "localhost:5221/api/brain/harness/initiative/$IID/fire" -H "Content-Type: application/json" -d "{}" | jq -e ".to_phase == \"B_task_loop\"" || exit 1; PH=$(psql $DB -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'" | tr -d " "); [ "$PH" = "B_task_loop" ] || { echo "FAIL phase=$PH"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 点火副作用 2：点火留痕写入 initiative_run_events node='fire' status='done'（PRD step6，带时间窗防历史冒充）
  Test: manual:bash -c 'IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'"'"'A_contract'"'"') RETURNING initiative_id" | tr -d " "); curl -sf -X POST "localhost:5221/api/brain/harness/initiative/$IID/fire" -H "Content-Type: application/json" -d "{}" | jq -e ".ok == true" || exit 1; CNT=$(psql $DB -t -c "SELECT count(*) FROM initiative_run_events WHERE initiative_id='"'"'$IID'"'"' AND node='"'"'fire'"'"' AND status='"'"'done'"'"' AND ts > EXTRACT(EPOCH FROM NOW())::BIGINT - 300" | tr -d " "); [ "$CNT" -ge 1 ] || { echo "FAIL 点火留痕缺失 count=$CNT"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 越权防护：非 Gate 1（phase=done）点火返回 4xx + error 字段，phase 不被改动（防纯前端禁用绕过）
  Test: manual:bash -c 'IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'"'"'done'"'"') RETURNING initiative_id" | tr -d " "); CODE=$(curl -s -o /tmp/fr.json -w "%{http_code}" -X POST "localhost:5221/api/brain/harness/initiative/$IID/fire" -H "Content-Type: application/json" -d "{}"); { [ "$CODE" = "409" ] || [ "$CODE" = "400" ]; } || { echo "FAIL code=$CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/fr.json || exit 1; PH=$(psql $DB -t -c "SELECT phase FROM initiative_runs WHERE initiative_id='"'"'$IID'"'"'" | tr -d " "); [ "$PH" = "done" ] || { echo "FAIL 越权改 phase=$PH"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 再来一轮红队端点存在并触发（Gate 1 状态返回 ok:true + rechallenge_triggered，端点未注册则 FAIL）
  Test: manual:bash -c 'IID=$(psql $DB -t -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES (gen_random_uuid(),'"'"'A_contract'"'"') RETURNING initiative_id" | tr -d " "); curl -sf -X POST "localhost:5221/api/brain/harness/initiative/$IID/rechallenge" -H "Content-Type: application/json" -d "{}" | jq -e ".ok == true and .rechallenge_triggered == true" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path：点火不存在的 initiative_id 返回 404 + error 字段
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/nf.json -w "%{http_code}" -X POST "localhost:5221/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/fire" -H "Content-Type: application/json" -d "{}"); [ "$CODE" = "404" ] || { echo "FAIL code=$CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/nf.json || exit 1; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑，Playwright localhost:5174）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Gate 1 Golden Path（打开 → 列出该 pipeline 待决策项 → 改决策 → 点火 → 离开 Gate 1 + 留痕），截图可视化验证
  Screenshots:
    - 01-initial.png   期望：停在 Gate 1 的详情页 docs tab，Gate 1 决策面板可见并列出该 pipeline 待决策项，确定点火按钮可用
    - 02-action.png    期望：编辑某条决策取值后页面状态（输入框含新值 / 保存中态）
    - 03-result.png    期望：点火完成后页面反映 pipeline 已离开 Gate 1（确定点火按钮按离开 Gate 1 降级 / 状态更新可见）
  期望：所有截图与期望描述一致，Claude Read 图自验通过；evaluator 验收后截图复制到 sprints/screenshots/<step>.png

- [ ] [BEHAVIOR:E2E] 边界态（PRD 边界 1/2/3）：非 Gate1 降级 / Gate1 空态占位 / 写失败内联报错保留输入不崩
  Test 期望（Playwright 断言，详见 contract-draft.md ## E2E 验收「边界用例」）:
    - 非 Gate1（phase=done）: gate1-fire-btn toBeDisabled + gate1-fire-disabled-hint toBeVisible + docs-tab-content 仍可见（不崩）
    - Gate1 无待决策: gate1-empty toBeVisible + docs-tab-content 仍可见（不崩）
    - PUT/fire 失败（page.route 拦截 500）: gate1-decision-error / gate1-fire-error toBeVisible + gate1-decision-edit-input toHaveValue 保留输入 + 不崩页
  期望：三种边界态对应断言全过，整页不崩、不静默吞错
