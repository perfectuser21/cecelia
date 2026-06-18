---
skeleton: false
journey_type: dev_pipeline
target_environment: mac_web
---
# Contract DoD — Sprint: Harness Cockpit Phase 3 决策面板（可见可改可点火）

**范围**: (1) migration 304 补 decisions 表 `verify_layer/round/generated_by/default_value` 列；(2) Brain `POST /api/brain/dev/decisions`（append/update 指定行）+ `GET /api/brain/dev/decisions?target=`（按 target 过滤读）+ `POST /api/brain/dev/submit`（建 harness_initiative）；(3) HarnessPipelineDetailPage 决策面板从 read-only 升级为可编辑/可标记 v1·backlog/再来一轮 stub + dashboard API 层。
**不在范围**: /dev skill 决策扫描前移；无头红队 agent 真实实现（再来一轮仅 append round+1 占位）；decision_catalog；Notion 同步。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 304 幂等补 decisions 新列（IF NOT EXISTS）
  Test: bash -c 'F=$(ls packages/brain/migrations/304_*.sql 2>/dev/null | head -1); [ -n "$F" ] || { echo "FAIL: 无 304 migration"; exit 1; }; for col in verify_layer round generated_by default_value; do grep -q "ADD COLUMN IF NOT EXISTS $col" "$F" || { echo "FAIL: 缺列 $col"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [ARTIFACT] Brain 三端点已在路由层注册（dev/decisions GET+POST、dev/submit POST）
  Test: bash -c 'grep -rqE "/dev/decisions" packages/brain/src/routes/*.js || { echo "FAIL: 无 /dev/decisions 路由"; exit 1; }; grep -rqE "/dev/submit" packages/brain/src/routes/*.js || { echo "FAIL: 无 /dev/submit 路由"; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] 决策面板升级落在 HarnessPipelineDetailPage（非 TaskPrdPage），含可编辑/再来一轮控件 testid
  Test: bash -c 'F=apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx; for t in decision-panel decision-save-btn decision-next-round-btn; do grep -q "$t" "$F" || { echo "FAIL: 缺 testid $t"; exit 1; }; done; echo OK'
  期望: OK

## BEHAVIOR 条目（dev_pipeline；模式A = evaluator 跑 curl Brain 5221 + psql；前置 migration 304 已应用）

- [ ] [BEHAVIOR] 场景A：POST /dev/decisions 无 id → append 新行，DB 落库且字段一致（带时间窗）
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; TID=$(psql "$DB" -t -c "SELECT gen_random_uuid()" | tr -d " "); RESP=$(curl -sf -X POST localhost:5221/api/brain/dev/decisions -H "Content-Type: application/json" -d "{\"topic\":\"用什么框架\",\"decision\":\"vitest\",\"default_value\":\"vitest\",\"level\":\"step\",\"target_id\":\"$TID\",\"scope\":\"v1\",\"verify_layer\":\"unit\",\"round\":1,\"generated_by\":\"cockpit-user\"}"); echo "$RESP" | jq -e ".level==\"step\" and .verify_layer==\"unit\" and .round==1 and .generated_by==\"cockpit-user\" and .target==\"$TID\"" || exit 1; ID=$(echo "$RESP" | jq -r ".id"); C=$(psql "$DB" -t -c "SELECT count(*) FROM decisions WHERE id=\x27$ID\x27 AND target_id=\x27$TID\x27 AND verify_layer=\x27unit\x27 AND round=1 AND generated_by=\x27cockpit-user\x27 AND created_at > NOW() - interval \x275 minutes\x27" | tr -d " "); [ "$C" = "1" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 场景C3：POST /dev/decisions 带 id → UPDATE 指定行，不新增行，新值落库
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; TID=$(psql "$DB" -t -c "SELECT gen_random_uuid()" | tr -d " "); ID=$(curl -sf -X POST localhost:5221/api/brain/dev/decisions -H "Content-Type: application/json" -d "{\"topic\":\"t\",\"decision\":\"vitest\",\"level\":\"step\",\"target_id\":\"$TID\"}" | jq -r ".id"); B=$(psql "$DB" -t -c "SELECT count(*) FROM decisions WHERE target_id=\x27$TID\x27" | tr -d " "); curl -sf -X POST localhost:5221/api/brain/dev/decisions -H "Content-Type: application/json" -d "{\"id\":\"$ID\",\"topic\":\"t\",\"decision\":\"jest\",\"level\":\"step\",\"target_id\":\"$TID\"}" | jq -e ".decision==\"jest\"" || exit 1; A=$(psql "$DB" -t -c "SELECT count(*) FROM decisions WHERE target_id=\x27$TID\x27" | tr -d " "); [ "$B" = "$A" ] || { echo "FAIL: 编辑 append 了行"; exit 1; }; psql "$DB" -t -c "SELECT decision FROM decisions WHERE id=\x27$ID\x27" | grep -q jest || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 场景C4：再来一轮 append round+1，历史 round 不被覆盖（DISTINCT round≥2）
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; TID=$(psql "$DB" -t -c "SELECT gen_random_uuid()" | tr -d " "); curl -sf -X POST localhost:5221/api/brain/dev/decisions -H "Content-Type: application/json" -d "{\"topic\":\"t\",\"decision\":\"r1\",\"level\":\"step\",\"target_id\":\"$TID\",\"round\":1}" | jq -e ".round==1" >/dev/null || exit 1; curl -sf -X POST localhost:5221/api/brain/dev/decisions -H "Content-Type: application/json" -d "{\"topic\":\"t\",\"decision\":\"<占位>\",\"level\":\"step\",\"target_id\":\"$TID\",\"round\":2,\"generated_by\":\"redteam-stub\"}" | jq -e ".round==2" || exit 1; D=$(psql "$DB" -t -c "SELECT count(DISTINCT round) FROM decisions WHERE target_id=\x27$TID\x27" | tr -d " "); [ "$D" -ge 2 ] || { echo "FAIL: round 历史被覆盖"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 场景C1：GET /dev/decisions?target 只返回该 target 行（target 别名等于查询值）
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; TID=$(psql "$DB" -t -c "SELECT gen_random_uuid()" | tr -d " "); curl -sf -X POST localhost:5221/api/brain/dev/decisions -H "Content-Type: application/json" -d "{\"topic\":\"t\",\"decision\":\"d\",\"level\":\"step\",\"target_id\":\"$TID\"}" | jq -e ".id | type==\"string\"" >/dev/null || exit 1; curl -sf "localhost:5221/api/brain/dev/decisions?target=$TID" | jq -e "type==\"array\" and length>=1 and all(.[]; .target==\"$TID\")" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 场景C1 空态：GET /dev/decisions?target=<无匹配> → HTTP 200 + 空数组，不报错
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; RND=$(psql "$DB" -t -c "SELECT gen_random_uuid()" | tr -d " "); CODE=$(curl -s -o /tmp/dev_dec_empty.json -w "%{http_code}" "localhost:5221/api/brain/dev/decisions?target=$RND"); [ "$CODE" = "200" ] || { echo "FAIL code=$CODE"; exit 1; }; jq -e "type==\"array\" and length==0" /tmp/dev_dec_empty.json || { echo "FAIL: 非空数组"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 场景B：POST /dev/submit → 建 harness_initiative 任务，DB 存在（带时间窗）
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; TID=$(psql "$DB" -t -c "SELECT gen_random_uuid()" | tr -d " "); SUB=$(curl -sf -X POST localhost:5221/api/brain/dev/submit -H "Content-Type: application/json" -d "{\"target_id\":\"$TID\",\"journey_id\":\"line-harness\",\"title\":\"phase3 fire\"}"); echo "$SUB" | jq -e ".task_type==\"harness_initiative\" and .status==\"queued\"" || exit 1; SID=$(echo "$SUB" | jq -r ".id"); C=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE id=\x27$SID\x27 AND task_type=\x27harness_initiative\x27 AND created_at > NOW() - interval \x275 minutes\x27" | tr -d " "); [ "$C" = "1" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path：场景B 边界 — submit 缺 target_id → 400 且不建脏任务（计数不变）
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; N0=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type=\x27harness_initiative\x27" | tr -d " "); CODE=$(curl -s -o /tmp/dev_submit_err.json -w "%{http_code}" -X POST localhost:5221/api/brain/dev/submit -H "Content-Type: application/json" -d "{}"); [ "$CODE" = "400" ] || { echo "FAIL code=$CODE"; exit 1; }; jq -e ".error | type==\"string\"" /tmp/dev_submit_err.json || exit 1; N1=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE task_type=\x27harness_initiative\x27" | tr -d " "); [ "$N0" = "$N1" ] || { echo "FAIL: 建出脏任务"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path：POST /dev/decisions 缺 level → 400 + error 字段
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/dev_dec_err.json -w "%{http_code}" -X POST localhost:5221/api/brain/dev/decisions -H "Content-Type: application/json" -d "{\"topic\":\"t\",\"decision\":\"d\",\"target_id\":\"x\"}"); [ "$CODE" = "400" ] || { echo "FAIL code=$CODE"; exit 1; }; jq -e ".error | type==\"string\"" /tmp/dev_dec_err.json || exit 1; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 面板交互，Mode B final-e2e 跑 Playwright，target_environment=mac_web）

- [ ] [BEHAVIOR:E2E] 用户在 pipeline 详情页 docs tab 走完决策面板 Golden Path（列出→编辑→标记→再来一轮），截图可视化验证
  Screenshots:
    - 01-initial.png   期望：pipeline 详情页 docs tab 决策面板（data-testid=decision-panel）可见，列出本 pipeline 决策行（topic/decision/default_value/verify_layer/round）
    - 02-action.png    期望：用户编辑某条决策值并保存后，该行 decision-value 显示新值（playwright-edited-value）
    - 03-result.png    期望：点「再来一轮」后面板新增 round+1 行，决策行数增加
  路径格式：${SPRINT_DIR}/screenshots/<step>.png
  期望：所有截图与描述一致，且 Playwright 脚本后端交叉验证（GET /dev/decisions?target= 含编辑值 + DISTINCT round≥2）通过，Claude Read 图自验通过

> evaluator 完成 mac_web E2E 后执行：`mkdir -p "${SPRINT_DIR}/screenshots/" && cp screenshots/*.png "${SPRINT_DIR}/screenshots/" 2>/dev/null || true`

## gate-allow 留痕

gate-allow: db/no-timewindow Step C3/C1 的 `SELECT count(*) ... WHERE target_id=` 是按主键/外键定点读同一行做编辑前后对比与 target 过滤断言（非"历史数据冒充本轮产出"场景），刻意不加时间窗以验证 update 不新增历史行；append 类断言（场景A/B/C4）均已带 `created_at > NOW() - interval '5 minutes'` 时间窗。
