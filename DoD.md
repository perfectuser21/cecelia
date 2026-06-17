contract_branch: cp-harness-propose-r1-466e5b2a-a0
sprint_dir: sprints/06171509-golden-path-step-nfr-decisions

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Golden Path 重塑为 owner_task_id 模型 + step 级 NFR 决策读写

**范围**: migration 303 重塑 golden_path 表（owner_task_id/order_no/feature_id/note）；重写 3 个 golden_path 端点；POST /decisions 补 golden_path target 校验；2 个决策读回视图。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 303 重塑 golden_path 表（新列 owner_task_id/feature_id，移除旧 scope_type/scope_id/ability_id，含 (owner_task_id, order_no) index）
  Test: bash -c 'F=$(ls packages/brain/migrations/303_*.sql 2>/dev/null | head -1); [ -n "$F" ] || { echo "FAIL: 无 303 migration"; exit 1; } ; grep -q "owner_task_id" "$F" && grep -q "feature_id" "$F" && grep -qi "order_no" "$F" || { echo "FAIL: 缺新模型列"; exit 1; }; echo OK'

- [ ] [ARTIFACT] golden_path 端点已重写为 owner_task_id 模型（abilities.js 不再含旧 scope_type/ability_id 写入）
  Test: bash -c 'grep -q "owner_task_id" packages/brain/src/routes/abilities.js && grep -q "golden-path-decisions" packages/brain/src/routes/abilities.js || { echo "FAIL: 端点未重写"; exit 1; }; echo OK'

## BEHAVIOR 条目（内嵌可执行 manual: 命令 — autonomous，测真实 Brain localhost:5221 + DB）

> 以下 BEHAVIOR 由 evaluator 顺序执行；前置夹具（TASK_ID/FEATURE_ID/STEP_ID）在第 1 条建立后由后续条目复用。
> DB_URL 默认 postgresql://localhost/cecelia（evaluator 注入）。

- [ ] [BEHAVIOR] POST /golden_path 用真实 owner_task_id + feature_id 建步返回 201 且回吐新模型字段，无旧列（Golden Path Step 1 用户可观察输出）
  Test: manual:bash -c 'set -e; DB_URL="${DB_URL:-postgresql://localhost/cecelia}"; TASK_ID=$(psql "$DB_URL" -t -c "INSERT INTO tasks (title) VALUES ('"'"'gp-dod-task'"'"') RETURNING id" | tr -d " "); FEATURE_ID=$(psql "$DB_URL" -t -c "INSERT INTO journey_features (name) VALUES ('"'"'gp-dod-feature'"'"') RETURNING id" | tr -d " "); STEP=$(curl -sf -X POST localhost:5221/api/brain/golden_path -H "Content-Type: application/json" -d "{\"owner_task_id\":\"$TASK_ID\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}"); echo "$STEP" | jq -e ".owner_task_id and .feature_id and (.order_no == 1) and (has(\"scope_type\") | not) and (has(\"ability_id\") | not)" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /golden_path owner_task_id 不存在 → 400 + error(string)（Golden Path Step 1 边界：悬空引用拒写）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/gp_e.json -w "%{http_code}" -X POST localhost:5221/api/brain/golden_path -H "Content-Type: application/json" -d "{\"owner_task_id\":\"00000000-0000-0000-0000-000000000000\",\"order_no\":1,\"feature_id\":\"00000000-0000-0000-0000-000000000000\"}"); [ "$CODE" = "400" ] || { echo "FAIL got $CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/gp_e.json || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /golden_path owner_task_id 非法 uuid → 400（不可 500）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/golden_path -H "Content-Type: application/json" -d "{\"owner_task_id\":\"not-a-uuid\",\"order_no\":1,\"feature_id\":\"not-a-uuid\"}"); [ "$CODE" = "400" ] || { echo "FAIL: 非法 uuid 应 400 got $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /decisions target_type=golden_path 指向真实步 → 201 且 level=step/target_type=golden_path（Golden Path Step 2 用户可观察输出）
  Test: manual:bash -c 'set -e; DB_URL="${DB_URL:-postgresql://localhost/cecelia}"; TASK_ID=$(psql "$DB_URL" -t -c "INSERT INTO tasks (title) VALUES ('"'"'gp-dod-task2'"'"') RETURNING id" | tr -d " "); FEATURE_ID=$(psql "$DB_URL" -t -c "INSERT INTO journey_features (name) VALUES ('"'"'gp-dod-feat2'"'"') RETURNING id" | tr -d " "); STEP_ID=$(curl -sf -X POST localhost:5221/api/brain/golden_path -H "Content-Type: application/json" -d "{\"owner_task_id\":\"$TASK_ID\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}" | jq -r ".id"); DEC=$(curl -sf -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"step\",\"target_type\":\"golden_path\",\"target_id\":\"$STEP_ID\",\"scope\":\"v1\"}"); echo "$DEC" | jq -e ".level == \"step\" and .target_type == \"golden_path\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /decisions golden_path target_id 不存在 → 400 + error(string)（Golden Path Step 2 边界：悬空引用拒写）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/dec_e.json -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"category\":\"nfr\",\"level\":\"step\",\"target_type\":\"golden_path\",\"target_id\":\"00000000-0000-0000-0000-000000000000\",\"scope\":\"v1\"}"); [ "$CODE" = "400" ] || { echo "FAIL got $CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/dec_e.json || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /decisions golden_path target_id 非法 uuid → 400（不可 500）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"category\":\"nfr\",\"level\":\"step\",\"target_type\":\"golden_path\",\"target_id\":\"not-a-uuid\",\"scope\":\"v1\"}"); [ "$CODE" = "400" ] || { echo "FAIL: 非法 uuid 应 400 got $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /golden_path/:id/decisions?scope=v1 读回该步刚写决策 + DB 时间窗确认本轮写入（Golden Path Step 3 用户可观察输出）
  Test: manual:bash -c 'set -e; DB_URL="${DB_URL:-postgresql://localhost/cecelia}"; TASK_ID=$(psql "$DB_URL" -t -c "INSERT INTO tasks (title) VALUES ('"'"'gp-dod-task3'"'"') RETURNING id" | tr -d " "); FEATURE_ID=$(psql "$DB_URL" -t -c "INSERT INTO journey_features (name) VALUES ('"'"'gp-dod-feat3'"'"') RETURNING id" | tr -d " "); STEP_ID=$(curl -sf -X POST localhost:5221/api/brain/golden_path -H "Content-Type: application/json" -d "{\"owner_task_id\":\"$TASK_ID\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}" | jq -r ".id"); curl -sf -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"step\",\"target_type\":\"golden_path\",\"target_id\":\"$STEP_ID\",\"scope\":\"v1\"}" > /dev/null; LIST=$(curl -sf "localhost:5221/api/brain/golden_path/$STEP_ID/decisions?scope=v1"); echo "$LIST" | jq -e --arg s "$STEP_ID" "any(.[]; .target_id == \$s and .scope == \"v1\")" || exit 1; CNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM decisions WHERE target_type='"'"'golden_path'"'"' AND target_id='"'"'$STEP_ID'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$CNT" -ge 1 ] || { echo "FAIL: 决策非本轮写入 CNT=$CNT"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /golden_path/:id/decisions 不存在的步 → 200 + 空数组（Golden Path Step 3 边界：无匹配不报错）
  Test: manual:bash -c 'LIST=$(curl -sf "localhost:5221/api/brain/golden_path/00000000-0000-0000-0000-000000000000/decisions?scope=v1"); echo "$LIST" | jq -e "type == \"array\" and length == 0" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /tasks/:id/golden-path-decisions?category=nfr&scope=v1 按 owner_task_id join 出整条 golden path NFR 验收单含刚写决策（Golden Path Step 4 用户可观察输出）
  Test: manual:bash -c 'set -e; DB_URL="${DB_URL:-postgresql://localhost/cecelia}"; TASK_ID=$(psql "$DB_URL" -t -c "INSERT INTO tasks (title) VALUES ('"'"'gp-dod-task4'"'"') RETURNING id" | tr -d " "); FEATURE_ID=$(psql "$DB_URL" -t -c "INSERT INTO journey_features (name) VALUES ('"'"'gp-dod-feat4'"'"') RETURNING id" | tr -d " "); STEP_ID=$(curl -sf -X POST localhost:5221/api/brain/golden_path -H "Content-Type: application/json" -d "{\"owner_task_id\":\"$TASK_ID\",\"order_no\":1,\"feature_id\":\"$FEATURE_ID\"}" | jq -r ".id"); curl -sf -X POST localhost:5221/api/brain/decisions -H "Content-Type: application/json" -d "{\"category\":\"nfr\",\"topic\":\"前后台\",\"decision\":\"后台静默\",\"level\":\"step\",\"target_type\":\"golden_path\",\"target_id\":\"$STEP_ID\",\"scope\":\"v1\"}" > /dev/null; SHEET=$(curl -sf "localhost:5221/api/brain/tasks/$TASK_ID/golden-path-decisions?category=nfr&scope=v1"); echo "$SHEET" | jq -e --arg s "$STEP_ID" "any(.[]; .target_id == \$s and .category == \"nfr\" and .scope == \"v1\")" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /tasks/:id/golden-path-decisions 不存在的 task → 200 + 空数组（Golden Path Step 4 边界：无匹配不报错）
  Test: manual:bash -c 'SHEET=$(curl -sf "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000000/golden-path-decisions?category=nfr&scope=v1"); echo "$SHEET" | jq -e "type == \"array\" and length == 0" || exit 1; echo OK'
  期望: OK
