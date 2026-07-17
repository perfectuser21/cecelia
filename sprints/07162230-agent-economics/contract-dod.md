# Contract DoD — 代理经济学仪表盘

sprint: 07162230-agent-economics
task_id: 40386870-31b0-4d24-b18a-fdfb129715d9
target_environment: local_api

---

## BEHAVIOR 条目（journey_type = autonomous — curl 真实 Brain localhost:5221）

- [ ] [BEHAVIOR] B1 — relay 回调携带 usage 时，cost_usd / tokens_in / tokens_out 落库非 NULL
  Test: manual:bash -c 'IREVENT_ID=$(psql cecelia -t -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('"'"'00000000-0000-0000-0000-000000000099'"'"', '"'"'proposer'"'"', '"'"'running'"'"', 1, EXTRACT(EPOCH FROM NOW())::BIGINT) RETURNING id;" | tr -d " \n"); curl -sf -X POST localhost:5221/api/brain/harness/callback/cecelia-relay-00000000-test-b1 -H "Content-Type: application/json" -d "{\"result\":\"done\",\"exit_code\":0,\"usage\":{\"input_tokens\":5000,\"output_tokens\":2000,\"total_cost_usd\":0.035}}" | jq -e ".relayAck == true" || exit 1; RESULT=$(psql cecelia -t -c "SELECT cost_usd, tokens_in, tokens_out FROM initiative_run_events WHERE initiative_id='"'"'00000000-0000-0000-0000-000000000099'"'"' ORDER BY id DESC LIMIT 1;"); echo "$RESULT" | grep -q "0.035" || exit 1; echo "$RESULT" | grep -q "5000" || exit 1; echo "$RESULT" | grep -q "2000" || exit 1; psql cecelia -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'00000000-0000-0000-0000-000000000099'"'"';"; echo OK'

- [ ] [BEHAVIOR] B2 — relay 回调不含 usage 时，200 ack 不中断，cost_usd 保持 NULL
  Test: manual:bash -c 'curl -sf -X POST localhost:5221/api/brain/harness/callback/cecelia-relay-00000000-test-b2 -H "Content-Type: application/json" -d "{\"result\":\"done\",\"exit_code\":0}" | jq -e ".relayAck == true" || exit 1; echo OK'

- [ ] [BEHAVIOR] B3 — relay 回调含 usage 且 cost_usd=0 时写 0（区分 0 与 NULL）
  Test: manual:bash -c 'IREVENT_ID=$(psql cecelia -t -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('"'"'00000000-0000-0000-0000-000000000098'"'"', '"'"'proposer'"'"', '"'"'running'"'"', 1, EXTRACT(EPOCH FROM NOW())::BIGINT) RETURNING id;" | tr -d " \n"); curl -sf -X POST localhost:5221/api/brain/harness/callback/cecelia-relay-00000000-test-b3 -H "Content-Type: application/json" -d "{\"result\":\"done\",\"exit_code\":0,\"usage\":{\"input_tokens\":100,\"output_tokens\":50,\"total_cost_usd\":0}}" | jq -e ".relayAck == true" || exit 1; RESULT=$(psql cecelia -t -c "SELECT cost_usd, tokens_in, tokens_out FROM initiative_run_events WHERE initiative_id='"'"'00000000-0000-0000-0000-000000000098'"'"' ORDER BY id DESC LIMIT 1;"); echo "$RESULT" | grep -qE "^\s*0\s*\|\s*100\s*\|\s*50" || exit 1; psql cecelia -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'00000000-0000-0000-0000-000000000098'"'"';"; echo OK'

- [ ] [BEHAVIOR] B4 — relay 回调含负数 cost_usd 时写 NULL（禁止写入负值），tokens 仍正常写入
  Test: manual:bash -c 'IREVENT_ID=$(psql cecelia -t -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('"'"'00000000-0000-0000-0000-000000000097'"'"', '"'"'proposer'"'"', '"'"'running'"'"', 1, EXTRACT(EPOCH FROM NOW())::BIGINT) RETURNING id;" | tr -d " \n"); curl -sf -X POST localhost:5221/api/brain/harness/callback/cecelia-relay-00000000-test-b4 -H "Content-Type: application/json" -d "{\"result\":\"done\",\"exit_code\":0,\"usage\":{\"input_tokens\":100,\"output_tokens\":50,\"total_cost_usd\":-1}}" | jq -e ".relayAck == true" || exit 1; RESULT=$(psql cecelia -t -c "SELECT cost_usd, tokens_in, tokens_out FROM initiative_run_events WHERE initiative_id='"'"'00000000-0000-0000-0000-000000000097'"'"' ORDER BY id DESC LIMIT 1;"); echo "$RESULT" | grep -qE "^\s*\|\s*100\s*\|\s*50" || exit 1; psql cecelia -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'00000000-0000-0000-0000-000000000097'"'"';"; echo OK'

- [ ] [BEHAVIOR] B5 — updateInitiativeRunEvent 支持 tokensIn / tokensOut 参数，落库正确
  Test: manual:bash -c 'IREVENT_ID=$(psql cecelia -t -c "INSERT INTO initiative_run_events (initiative_id, node, status, attempt, ts) VALUES ('"'"'00000000-0000-0000-0000-000000000096'"'"', '"'"'proposer'"'"', '"'"'running'"'"', 1, EXTRACT(EPOCH FROM NOW())::BIGINT) RETURNING id;" | tr -d " \n"); node -e "const {updateInitiativeRunEvent}=require('"'"'/workspace/packages/brain/src/events/initiativeRunEvents.js'"'"');updateInitiativeRunEvent({id:process.env.IRID,costUsd:0.035,tokensIn:5000,tokensOut:2000}).then(r=>{if(r.tokens_in!=5000||r.tokens_out!=2000||r.cost_usd!=0.035)process.exit(1);console.log('"'"'OK'"'"')}).catch(e=>{console.error(e);process.exit(1)})" IRID="$IREVENT_ID"; psql cecelia -c "DELETE FROM initiative_run_events WHERE initiative_id='"'"'00000000-0000-0000-0000-000000000096'"'"';" || true; echo OK'

- [ ] [BEHAVIOR] B6 — migration 351 幂等：重复执行两次无错，tokens_in / tokens_out 列存在
  Test: manual:bash -c 'psql cecelia < packages/brain/migrations/351_initiative_run_events_tokens.sql || exit 1; psql cecelia < packages/brain/migrations/351_initiative_run_events_tokens.sql || exit 1; psql cecelia -c "\d initiative_run_events" | grep -E "tokens_in|tokens_out" | wc -l | grep -q "^[2-9]" || exit 1; echo OK'

- [ ] [BEHAVIOR] B7 — GET /api/brain/economics/prs?days=7 返回含 prs 数组和 summary 对象
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/economics/prs?days=7") || exit 1; echo "$RESP" | jq -e "has(\"prs\") and has(\"summary\")" || exit 1; echo "$RESP" | jq -e ".prs | type == \"array\"" || exit 1; echo "$RESP" | jq -e ".summary | has(\"total_cost_usd\") and has(\"avg_cost_per_pr\") and has(\"total_attempts\")" || exit 1; echo OK'

- [ ] [BEHAVIOR] B8 — GET /api/brain/economics/prs?days=7 不包含 days 范围外的记录
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/economics/prs?days=7") || exit 1; echo "$RESP" | jq -e ".prs | type == \"array\"" || exit 1; echo OK'

- [ ] [BEHAVIOR] B9 — GET /api/brain/economics/prs 无记录时返回空数组 + summary 均为 0
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/economics/prs?days=0") || exit 1; echo "$RESP" | jq -e ".prs == [] or (.prs | length == 0)" || exit 1; echo OK'

- [ ] [BEHAVIOR] B10 — GET /api/brain/langfuse/recent 凭据存在时返回 success:true，缺失时返回 credentials_missing 降级（均不 500）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/langfuse/recent) || exit 1; echo "$RESP" | jq -e ".success == true or .error == \"credentials_missing\"" || exit 1; echo OK'

- [ ] [BEHAVIOR] B11 — Langfuse 凭据缺失时降级：HTTP 200，success:false，error 为 credentials_missing
  Test: manual:bash -c 'RESP=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/langfuse/recent); [ "$RESP" = "200" ] || exit 1; curl -sf localhost:5221/api/brain/langfuse/recent | jq -e "(.success == true) or (.error == \"credentials_missing\")" || exit 1; echo OK'

- [ ] [BEHAVIOR] B12 — relay 回调写库失败时 non-fatal，仍返回 200 ack（不阻断回调链）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/callback/cecelia-relay-00000000-test-b12-noevent -H "Content-Type: application/json" -d "{\"result\":\"done\",\"exit_code\":0,\"usage\":{\"input_tokens\":100,\"output_tokens\":50,\"total_cost_usd\":0.01}}"); echo "$RESP" | jq -e ".relayAck == true" || exit 1; echo OK'

- [ ] [BEHAVIOR] B13 — economics 路由已在 server.js 注册，端点可访问（非 404/非 Cannot GET）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/economics/prs?days=7"); [ "$CODE" != "404" ] || exit 1; [ "$CODE" = "200" ] || [ "$CODE" = "400" ] || exit 1; echo OK'

---

## DoD 检查清单（Planner 执行，Evaluator 验收）

### 代码实现

- [ ] **D1** `packages/brain/migrations/351_initiative_run_events_tokens.sql` 已创建，使用 `IF NOT EXISTS` 加 `tokens_in BIGINT` 和 `tokens_out BIGINT` 列
- [ ] **D2** `packages/brain/src/events/initiativeRunEvents.js` 中 `updateInitiativeRunEvent` 函数已扩展参数：新增 `tokensIn`、`tokensOut`，并在 UPDATE 语句中写入对应列
- [ ] **D3** `packages/brain/src/routes/harness-callback.js` relay 分支（`cecelia-relay-*`）已解析 `req.body.usage`：提取 `input_tokens`、`output_tokens`、`total_cost_usd`，并调用 `updateInitiativeRunEvent`
- [ ] **D4** relay 回调 usage 写库失败时使用 `console.warn`（non-fatal），不返回 500，不中断 200 ack
- [ ] **D5** 负数 `total_cost_usd` 不写库（写 NULL 或跳过）；`tokens_in`/`tokens_out` 独立校验（不受 cost 影响）
- [ ] **D6** `packages/brain/src/routes/economics.js` 已创建，实现 `GET /economics/prs?days=N`，JOIN `initiative_run_events` 按 task 聚合，返回 `{ prs: [...], summary: {...} }`
- [ ] **D7** `packages/brain/server.js` 已 import `economicsRoutes` 并注册 `app.use('/api/brain/economics', economicsRoutes)`

### 测试

- [ ] **D8** `packages/brain/src/__tests__/economics-relay-usage.test.js` 已创建，T1 failing test（修复前 FAIL，修复后 PASS）
  - 不 mock `updateInitiativeRunEvent`，真实走 DB 落库断言
  - 断言 `cost_usd = 0.035`（非 NULL）、`tokens_in = 5000`、`tokens_out = 2000`
- [ ] **D9** `packages/brain/src/__tests__/economics-prs.test.js` 已创建，T2 failing test（修复前 FAIL，修复后 PASS）
  - 预置 fixture 数据（3 个 task，已知 cost_usd）
  - 断言 `summary.total_cost_usd` 之和（±0.0001）
  - 断言超出 days 范围的 event 不出现

### 现有测试回归

- [ ] **D10** `packages/brain/src/events/__tests__/initiativeRunEvents.test.js` 全通（无回退）
- [ ] **D11** `packages/brain/src/routes/__tests__/relay-smoke.contract.test.js` 全通（无回退）
- [ ] **D12** `packages/brain/src/__tests__/harness-skill-relay.test.js` 全通（无回退）

### 数据库

- [ ] **D13** migration 351 已在 Brain 启动时执行（或手动 `psql cecelia < migration.sql`）
- [ ] **D14** migration 351 幂等性验证：重复执行不报错

### Langfuse 凭据（条件性）

- [ ] **D15** 已执行 `op item get "langfuse" --vault CS --format json` 尝试获取凭据
  - 若存在：落 `~/.credentials/langfuse.env`（chmod 600），Brain 进程 reload
  - 若不存在：PR description 注明缺少的 key（`LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_BASE_URL`），不造假凭据，`/api/brain/langfuse/recent` 保持 `credentials_missing` 降级

### E2E 验收

- [ ] **D16** E2E-1：relay 回调 usage 落库验证（见 contract-draft.md ## E2E 验收 E2E-1）
- [ ] **D17** E2E-2：`GET /api/brain/economics/prs?days=7` 返回含 `prs` + `summary` 的 JSON
- [ ] **D18** E2E-3：Langfuse 端点返回 `success:true`（若凭据存在）或合法降级（若缺失）
- [ ] **D19** E2E-4：migration 351 幂等性（重复执行两次无错，列存在）

### Invariant 检查

- [ ] **D20** 无 `cost_usd` 负数写入（禁估算造假）
- [ ] **D21** secrets 不进 git（`.env` 不 commit）
- [ ] **D22** migration 使用 `IF NOT EXISTS`（migration 幂等）
- [ ] **D23** economics 端点鉴权与现有 Brain 路由模式一致（无裸露端点）
- [ ] **D24** 日志脱敏：relay 回调日志不打印 usage 中的 token 内容

---

## 验收标准（Evaluator 判定通过的门槛）

所有 D1~D24 均为必须项。D15 中 Langfuse 凭据条件：

- 若 1Password CS 中有 Langfuse 凭据 → D18 必须 `success:true`
- 若 1Password CS 中无 Langfuse 凭据 → D18 降级 `credentials_missing` 为合法，PR description 注明缺失条目即可通过

---

## 版本 Bump 要求

Brain 本次新增 migration（351）+ 新端点，需 semver bump（patch 或 minor，取决于 Brain 当前版本策略）。

---

## 测试命令参考

```bash
# 单跑 T1
cd /workspace && npx vitest run packages/brain/src/__tests__/economics-relay-usage.test.js

# 单跑 T2
cd /workspace && npx vitest run packages/brain/src/__tests__/economics-prs.test.js

# 全量回归（被影响测试）
cd /workspace && npx vitest run \
  packages/brain/src/events/__tests__/initiativeRunEvents.test.js \
  packages/brain/src/routes/__tests__/relay-smoke.contract.test.js \
  packages/brain/src/__tests__/harness-skill-relay.test.js
```
