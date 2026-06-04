---
skeleton: false
journey_type: dev_pipeline
target_environment: local_api
---
# Contract DoD — Sprint: harness pipeline 各阶段真实指标埋点

**范围**: Migration 293 给 `initiative_run_events` 加 3 列（`ts_end BIGINT` / `cost_usd NUMERIC(10,4)` / `model TEXT`）+ status CHECK 扩 `'completed'`；Brain POST 接 model + 新增 PATCH `/phase-event/:id`；5 个 harness skill SKILL.md（PRD 字面：planner / contract-proposer / generator / evaluator / report，**不含 reviewer**）首尾各加 phase-event 调用（含吞错兜底）；harness-report Step 6 + index.html 模板从 events 表读 Phase 维度数据
**大小**: M

> 重要 schema 事实：当前 `initiative_run_events` 实际生产 schema 是 migration 279 — PK 列名是 `id`（BIGSERIAL），时间列是 `ts`（BIGINT, Unix 秒）。不是 `event_id` / `created_at`。所有 psql / jq 必须用 `id` 和 `ts`。

## ARTIFACT 条目

- [ ] [ARTIFACT] Migration 293 文件存在且含 3 列 ADD COLUMN + status CHECK 扩 'completed'
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/293_initiative_run_events_phase_metrics.sql','utf8');const r=[/ADD COLUMN[^;]*ts_end[^;]*BIGINT/i,/ADD COLUMN[^;]*cost_usd[^;]*NUMERIC/i,/ADD COLUMN[^;]*model[^;]*TEXT/i,/(CHECK[^;]*completed|status[^;]*IN[^;]*completed)/i];for(const re of r){if(!re.test(c)){console.error('miss',re);process.exit(1)}}"

- [ ] [ARTIFACT] EXPECTED_SCHEMA_VERSION bump 到 '293'
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!c.includes(\"EXPECTED_SCHEMA_VERSION = '293'\"))process.exit(1)"

- [ ] [ARTIFACT] writeInitiativeRunEvent 签名 + INSERT 含 model 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/events/initiativeRunEvents.js','utf8');if(!/writeInitiativeRunEvent[^}]*model/s.test(c)){console.error('fn sig no model');process.exit(1)}if(!/INSERT INTO initiative_run_events[\\s\\S]*model/.test(c)){console.error('INSERT no model');process.exit(1)}"

- [ ] [ARTIFACT] updateInitiativeRunEvent 函数存在（PATCH 路由用它写 ts_end + cost_usd）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/events/initiativeRunEvents.js','utf8');if(!/export[^=]*function\\s+updateInitiativeRunEvent|export[^=]*const\\s+updateInitiativeRunEvent/.test(c))process.exit(1);if(!/ts_end/.test(c)||!/cost_usd/.test(c))process.exit(1)"

- [ ] [ARTIFACT] harness.js 注册 POST /phase-event 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/router\\.post\\(['\\\"]\\/phase-event/.test(c))process.exit(1)"

- [ ] [ARTIFACT] harness.js 注册 PATCH /phase-event/:id 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/router\\.patch\\(['\\\"]\\/phase-event\\/:id/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 5 个 harness skill SKILL.md 全部含 phase-event 调用 + 吞错兜底（PRD 字面：Planner/Proposer/Generator/Evaluator/Reporter，不含 Reviewer）
  Test: node -e "const fs=require('fs');const skills=['harness-planner','harness-contract-proposer','harness-generator','harness-evaluator','harness-report'];for(const s of skills){const p='packages/workflows/skills/'+s+'/SKILL.md';if(!fs.existsSync(p)){console.error('missing',p);process.exit(1)}const c=fs.readFileSync(p,'utf8');if(!c.includes('phase-event')){console.error(s,'no phase-event call');process.exit(1)}if(!/(phase-event[\\s\\S]{0,200}\\|\\|\\s*true|phase-event[\\s\\S]{0,200}2>\\/dev\\/null|set \\+e[\\s\\S]{0,200}phase-event|phase-event[\\s\\S]{0,200}set \\+e|#[^\\n]*phase-event[^\\n]*non-fatal|#[^\\n]*non-fatal[^\\n]*phase-event)/.test(c)){console.error(s,'no swallow-error guard around phase-event');process.exit(1)}}"

- [ ] [ARTIFACT] harness-report SKILL.md Step 6 引用 initiative_run_events + 含 3 个指标字段
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-report/SKILL.md','utf8');if(!c.includes('initiative_run_events'))process.exit(1);if(!/ts_end|duration|耗时/.test(c))process.exit(1);if(!/cost_usd|成本/.test(c))process.exit(1);if(!/model|模型/.test(c))process.exit(1)"

- [ ] [ARTIFACT] harness-report index.html 模板含 phase 指标字段占位符
  Test: node -e "const fs=require('fs');const path=require('path');const dir='packages/workflows/skills/harness-report';function walk(d){const out=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())out.push(...walk(p));else if(p.endsWith('index.html'))out.push(p)}return out}const files=walk(dir);if(files.length===0){console.error('no index.html under',dir);process.exit(1)}const c=fs.readFileSync(files[0],'utf8');if(!/cost_usd|model|duration|ts_end/.test(c)){console.error('index.html lacks phase metric placeholder');process.exit(1)}"

- [ ] [ARTIFACT] executor.js 保留 writeInitiativeRunEvent 非致命 warn（回归保护）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('writeInitiativeRunEvent failed (non-fatal)'))process.exit(1)"

## BEHAVIOR 条目（autonomous 模式 — curl localhost:5221 + psql cecelia，验证真实 Brain/DB）

- [ ] [BEHAVIOR] POST /api/brain/harness/phase-event 返回 JSON 含 id + 回显 model + status='running'
  Test: manual:bash -c 'set -e; INIT=$(uuidgen); RESP=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}"); echo "$RESP" | jq -e ".id" >/dev/null || { echo "FAIL: 缺 id"; exit 1; }; echo "$RESP" | jq -e ".model == \"claude-opus-4-7\"" >/dev/null || { echo "FAIL: model 未回显"; exit 1; }; echo "$RESP" | jq -e ".status == \"running\"" >/dev/null || { echo "FAIL: status 不对"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST 响应 schema 完整性 (keys 含 id/initiative_id/node/status/model/ts) + 禁用字段反向（不出现 event_id/phase/model_id/cost/created_at）
  Test: manual:bash -c 'set -e; INIT=$(uuidgen); RESP=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"proposer\",\"status\":\"running\",\"model\":\"claude-sonnet-4-6\"}"); echo "$RESP" | jq -e "has(\"id\") and has(\"initiative_id\") and has(\"node\") and has(\"status\") and has(\"model\") and has(\"ts\")" >/dev/null || { echo "FAIL: schema 不全"; exit 1; }; echo "$RESP" | jq -e "(has(\"event_id\") | not) and (has(\"phase\") | not) and (has(\"model_id\") | not) and (has(\"cost\") | not) and (has(\"created_at\") | not)" >/dev/null || { echo "FAIL: 出现禁用字段"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST 后 DB 行落库 — model 列字面匹配 + ts_end/cost_usd 此时为 NULL
  Test: manual:bash -c 'set -e; INIT=$(uuidgen); EID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" | jq -r ".id"); [ -n "$EID" ] && [ "$EID" != "null" ] || { echo "FAIL: 无 id"; exit 1; }; MODEL=$(psql cecelia -tAc "SELECT model FROM initiative_run_events WHERE id=$EID" | tr -d " "); [ "$MODEL" = "claude-opus-4-7" ] || { echo "FAIL: model 列 got=\"$MODEL\""; exit 1; }; NULLS=$(psql cecelia -tAc "SELECT count(*) FROM initiative_run_events WHERE id=$EID AND ts_end IS NULL AND cost_usd IS NULL"); [ "$NULLS" = "1" ] || { echo "FAIL: POST 阶段 ts_end/cost_usd 应当为 NULL"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] PATCH /api/brain/harness/phase-event/:id 返回 JSON ts_end(number) + cost_usd(number) + status='completed'，PRD 字面 `jq -e .ts_end and .cost_usd` truthy
  Test: manual:bash -c 'set -e; INIT=$(uuidgen); EID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"generator\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" | jq -r ".id"); TS=$(date +%s%3N); RESP=$(curl -fsS -X PATCH "localhost:5221/api/brain/harness/phase-event/$EID" -H "Content-Type: application/json" -d "{\"status\":\"completed\",\"ts_end\":$TS,\"cost_usd\":0.42}"); echo "$RESP" | jq -e ".ts_end and .cost_usd" >/dev/null || { echo "FAIL: truthy"; exit 1; }; echo "$RESP" | jq -e ".ts_end | type == \"number\"" >/dev/null || { echo "FAIL: ts_end 非 number"; exit 1; }; echo "$RESP" | jq -e ".cost_usd | type == \"number\"" >/dev/null || { echo "FAIL: cost_usd 非 number"; exit 1; }; echo "$RESP" | jq -e ".status == \"completed\"" >/dev/null || { echo "FAIL: status 未翻 completed"; exit 1; }; echo "$RESP" | jq -e "(has(\"endTs\") | not) and (has(\"end_ts\") | not) and (has(\"cost\") | not) and (has(\"usdCost\") | not)" >/dev/null || { echo "FAIL: 出现禁用字段"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] PATCH response 含 model 字段（回显 POST 时写入值）+ schema 完整性（5 必填字段）+ event_id/created_at 不存在（Reviewer R4 oracle completeness）
  Test: manual:bash -c 'set -e; INIT=$(uuidgen); EID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"reporter\",\"status\":\"running\",\"model\":\"claude-sonnet-4-6\"}" | jq -r ".id"); RESP=$(curl -fsS -X PATCH "localhost:5221/api/brain/harness/phase-event/$EID" -H "Content-Type: application/json" -d "{\"status\":\"completed\",\"ts_end\":$(date +%s%3N),\"cost_usd\":0.22}"); echo "$RESP" | jq -e "has(\"model\")" >/dev/null || { echo "FAIL: PATCH response 缺 model"; exit 1; }; echo "$RESP" | jq -e "has(\"id\") and has(\"status\") and has(\"ts_end\") and has(\"cost_usd\") and has(\"model\")" >/dev/null || { echo "FAIL: PATCH schema 不全"; exit 1; }; echo "$RESP" | jq -e "(has(\"event_id\") | not) and (has(\"created_at\") | not)" >/dev/null || { echo "FAIL: 禁用字段出现"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] PATCH 后 DB 同一行 ts_end/cost_usd/model 三列均非 NULL 且 ts 在 5min 窗口内（防造假）
  Test: manual:bash -c 'set -e; INIT=$(uuidgen); EID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"evaluator\",\"status\":\"running\",\"model\":\"claude-sonnet-4-6\"}" | jq -r ".id"); curl -fsS -X PATCH "localhost:5221/api/brain/harness/phase-event/$EID" -H "Content-Type: application/json" -d "{\"status\":\"completed\",\"ts_end\":$(date +%s%3N),\"cost_usd\":0.55}" >/dev/null; FOUND=$(psql cecelia -tAc "SELECT 1 FROM initiative_run_events WHERE id=$EID AND ts_end IS NOT NULL AND cost_usd IS NOT NULL AND model IS NOT NULL AND ts > EXTRACT(EPOCH FROM NOW() - interval '"'"'5 minutes'"'"')::BIGINT"); [ "$FOUND" = "1" ] || { echo "FAIL: 三列写入不全或 ts 不在 5min 窗口"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Migration 293 已 apply — information_schema 三列齐 + status CHECK 接受 'completed'（试插立刻回滚）
  Test: manual:bash -c 'set -e; COLS=$(psql cecelia -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'initiative_run_events'"'"' AND column_name IN ('"'"'ts_end'"'"','"'"'cost_usd'"'"','"'"'model'"'"')"); [ "$COLS" = "3" ] || { echo "FAIL: 三列不齐 got=$COLS"; exit 1; }; psql cecelia -tAc "BEGIN; INSERT INTO initiative_run_events (initiative_id, node, status) VALUES (gen_random_uuid(), '"'"'planner'"'"', '"'"'completed'"'"') RETURNING 1; ROLLBACK;" | grep -q "^1$" || { echo "FAIL: status='"'"'completed'"'"' 被 CHECK 拒"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Error path — PATCH 不存在的 BIGINT id → HTTP 404 + .error 是字符串
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/_patch_err.json -w "%{http_code}" -X PATCH "localhost:5221/api/brain/harness/phase-event/99999999999999" -H "Content-Type: application/json" -d "{\"status\":\"completed\",\"ts_end\":1,\"cost_usd\":0}"); [ "$CODE" = "404" ] || { echo "FAIL: 期望 404 实际 $CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/_patch_err.json >/dev/null || { echo "FAIL: 404 缺 error 字符串字段"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Reporter SKILL Step 6 引用 initiative_run_events + 模拟 5 phase 注入后 events 表至少 5 行齐（PRD 字面 5 phase：planner/proposer/generator/evaluator/reporter，验收第 4 条间接验证）
  Test: manual:bash -c 'set -e; INIT=$(uuidgen); for N in planner proposer generator evaluator reporter; do EID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"$N\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" | jq -r ".id"); curl -fsS -X PATCH "localhost:5221/api/brain/harness/phase-event/$EID" -H "Content-Type: application/json" -d "{\"status\":\"completed\",\"ts_end\":$(date +%s%3N),\"cost_usd\":0.1}" >/dev/null; done; COUNT=$(psql cecelia -tAc "SELECT count(*) FROM initiative_run_events WHERE initiative_id='"'"'$INIT'"'"' AND ts_end IS NOT NULL AND cost_usd IS NOT NULL AND model IS NOT NULL AND ts > EXTRACT(EPOCH FROM NOW() - interval '"'"'5 minutes'"'"')::BIGINT"); [ "$COUNT" = "5" ] || { echo "FAIL: events 应为 5 行 got=$COUNT"; exit 1; }; grep -q "initiative_run_events" packages/workflows/skills/harness-report/SKILL.md || { echo "FAIL: harness-report SKILL 未读 events"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 同一 phase 重复 POST → DB 最终 model = 第二次传入值（PRD 边界情况3: 以最后一次为准）
  Test: manual:bash -c 'set -e; INIT=$(uuidgen); curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" >/dev/null; EID2=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-sonnet-4-6\"}" | jq -r ".id"); [[ "$EID2" =~ ^[0-9]+$ ]] || { echo "FAIL: id非数字 $EID2"; exit 1; }; MODEL=$(psql cecelia -tAc "SELECT model FROM initiative_run_events WHERE id=$EID2" | tr -d " "); [ "$MODEL" = "claude-sonnet-4-6" ] || { echo "FAIL: model 未覆盖 got=$MODEL"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] cost_usd NULL 时 Reporter SKILL 含 null 守卫逻辑（PRD 边界情况2: Report 显示 '-'）+ DB 行 POST 后 cost_usd 为 NULL
  Test: manual:bash -c 'set -e; grep -qE "cost_usd.*null|cost_usd.*IS NULL|cost_usd.*\\?.*-|cost_usd.*:-|null.*cost_usd|cost_usd.*'"'"'-'"'"'" packages/workflows/skills/harness-report/SKILL.md || { echo "FAIL: SKILL 无 NULL cost_usd 守卫"; exit 1; }; INIT=$(uuidgen); EID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event -H "Content-Type: application/json" -d "{\"initiative_id\":\"$INIT\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" | jq -r ".id"); [[ "$EID" =~ ^[0-9]+$ ]] || { echo "FAIL: POST id非数字"; exit 1; }; NULL_CHECK=$(psql cecelia -tAc "SELECT 1 FROM initiative_run_events WHERE id=$EID AND cost_usd IS NULL" | tr -d " "); [ "$NULL_CHECK" = "1" ] || { echo "FAIL: POST 后 cost_usd 应为 NULL"; exit 1; }; echo OK'
  期望: OK
