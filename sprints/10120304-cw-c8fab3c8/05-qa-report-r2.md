---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7"]
---
# QA 报告（第 2 轮，环境 http://localhost:5301）

本轮开始时间：2026-10-11T20:27:24Z。预览 Brain（git_sha 290d8ba1a，`runtime.isolated=true`）所连库为本机 `cecelia_preview_6319`；Q-5/Q-6 在本机 `cecelia_scratch` 上用本分支（HEAD 290d8ba1a）的 `node src/migrate.js` 执行。全程未访问 localhost:5221 / localhost:15432 或任何生产地址。本轮全是 API 和数据库场景，没有打开页面，所以没有截图。

### T-1
对应: Q-1
verdict: PASS
```command
TS=$(date +%s%N); TOPIC="判定点[qa-c8fab3c8-$TS#1]: 部署判定"; BODY=$(jq -nc --arg t "$TOPIC" --arg s "coding-workflow:qa-c8fab3c8-$TS" '{category:"judgment",topic:$t,decision:"所选: 健康检查｜候选: 健康检查/日志",reason:"依据: 双信号",made_by:"ai",author:"coding-workflow",source_ref:$s}'); RESP=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5301/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); echo "$RESP"; CODE=$(echo "$RESP" | tail -n1); JSON=$(echo "$RESP" | sed '$d'); LIST=$(curl -s 'http://localhost:5301/api/brain/strategic-decisions?category=judgment&limit=1000' | jq -c --arg t "$TOPIC" '[.data[] | select(.topic==$t) | {topic,made_by,author,category}]'); echo "$LIST"; [ "$CODE" = "201" ] && echo "$JSON" | jq -e '.success==true and .data.made_by=="ai" and .data.category=="judgment"' && ! echo "$JSON" | grep -q -e 'decisions_made_by_check' -e 'violates check constraint' && echo "$LIST" | jq -e 'length==1 and .[0].made_by=="ai" and .[0].author=="coding-workflow"'
```
```output
{"success":true,"data":{"id":"a57f9948-2fa4-4d9e-b1a1-ae5f176f8ae6","category":"judgment","topic":"判定点[qa-c8fab3c8-1791750456050777000#1]: 部署判定","decision":"所选: 健康检查｜候选: 健康检查/日志","reason":"依据: 双信号","status":"active","author":"coding-workflow","made_by":"ai","priority":"P2","created_at":"2026-10-11T15:27:36.080Z"}}
201
[{"topic":"判定点[qa-c8fab3c8-1791750456050777000#1]: 部署判定","made_by":"ai","author":"coding-workflow","category":"judgment"}]
true
true
```

### T-2
对应: Q-2
verdict: PASS
```command
TS=$(date +%s%N); OK=1; for MB in system user cecelia; do TOPIC="判定点[qa-c8fab3c8-$TS-$MB#1]: 部署判定"; BODY=$(jq -nc --arg t "$TOPIC" --arg m "$MB" --arg s "coding-workflow:qa-c8fab3c8-$TS" '{category:"judgment",topic:$t,decision:"所选: 健康检查｜候选: 健康检查/日志",reason:"依据: 双信号",made_by:$m,author:"coding-workflow",source_ref:$s}'); CODE=$(curl -s -o /tmp/qa_c8_q2_$MB.json -w '%{http_code}' -X POST http://localhost:5301/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); echo "$MB POST=$CODE $(jq -c '{success,made_by:.data.made_by}' /tmp/qa_c8_q2_$MB.json)"; N=$(curl -s 'http://localhost:5301/api/brain/strategic-decisions?category=judgment&limit=1000' | jq --arg t "$TOPIC" --arg m "$MB" '[.data[] | select(.topic==$t and .made_by==$m)] | length'); echo "$MB 查回行数(made_by=$MB)=$N"; [ "$CODE" = "201" ] && [ "$N" = "1" ] || OK=0; done; [ "$OK" = "1" ]
```
```output
system POST=201 {"success":true,"made_by":"system"}
system 查回行数(made_by=system)=1
user POST=201 {"success":true,"made_by":"user"}
user 查回行数(made_by=user)=1
cecelia POST=201 {"success":true,"made_by":"cecelia"}
cecelia 查回行数(made_by=cecelia)=1
```

### T-3
对应: Q-3
verdict: PASS
```command
TS=$(date +%s%N); TOPIC="判定点[qa-c8fab3c8-$TS-bogus#1]: 部署判定"; BODY=$(jq -nc --arg t "$TOPIC" --arg s "coding-workflow:qa-c8fab3c8-$TS" '{category:"judgment",topic:$t,decision:"所选: 健康检查｜候选: 健康检查/日志",reason:"依据: 双信号",made_by:"bogus_maker",author:"coding-workflow",source_ref:$s}'); RESP=$(curl -s -w '\n%{http_code}' -X POST http://localhost:5301/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); echo "$RESP"; CODE=$(echo "$RESP" | tail -n1); N=$(curl -s 'http://localhost:5301/api/brain/strategic-decisions?category=judgment&limit=1000' | jq --arg t "$TOPIC" '[.data[] | select(.topic==$t)] | length'); echo "查回行数=$N"; [ "$CODE" != "201" ] && echo "$RESP" | sed '$d' | jq -e '.success==false' && [ "$N" = "0" ]
```
```output
{"success":false,"error":"new row for relation \"decisions\" violates check constraint \"decisions_made_by_check\""}
500
查回行数=0
true
```

### T-4
对应: Q-4
verdict: PASS
```command
TS=$(date +%s%N); TOPIC="判定点[qa-c8fab3c8-$TS-dup#1]: 部署判定"; BODY=$(jq -nc --arg t "$TOPIC" --arg s "coding-workflow:qa-c8fab3c8-$TS" '{category:"judgment",topic:$t,decision:"所选: 健康检查｜候选: 健康检查/日志",reason:"依据: 双信号",made_by:"ai",author:"coding-workflow",source_ref:$s}'); C1=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:5301/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); C2=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:5301/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); echo "第1次=$C1 第2次=$C2"; LIST=$(curl -s 'http://localhost:5301/api/brain/strategic-decisions?category=judgment&limit=1000' | jq -c --arg t "$TOPIC" '[.data[] | select(.topic==$t) | .made_by]'); echo "查回 made_by=$LIST"; [ "$C1" = "201" ] && [ "$C2" = "201" ] && echo "$LIST" | jq -e 'length==2 and all(.=="ai")'
```
```output
第1次=201 第2次=201
查回 made_by=["ai","ai"]
true
```

### T-5
对应: Q-5
verdict: PASS
说明：在 `cecelia_scratch` 里先造出「迁移外加宽（多了 qa_extra）+ 552 未跑」的状态，然后用本分支跑两次 migrate。D1 与 D2 完全相同，五个取值都在，552 在 schema_version 里恰好 1 行，两次退出码都是 0。
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6319-2/packages/brain && DBU=postgresql://cecelia:cecelia@localhost/cecelia_scratch; Q="SELECT c.conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid='decisions'::regclass AND c.contype='c' AND a.attname='made_by'"; psql "$DBU" -c "ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_made_by_check; ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check CHECK (made_by IN ('user','cecelia','system','qa_extra')) NOT VALID; DELETE FROM schema_version WHERE version='552';" && echo "预置后: $(psql "$DBU" -Atc "$Q")" && DB_NAME=cecelia_scratch node src/migrate.js > /tmp/qa_c8_mig1.log 2>&1; R1=$?; grep -E '552|rror' /tmp/qa_c8_mig1.log | tail -5; echo "migrate#1 退出码=$R1"; D1=$(psql "$DBU" -Atc "$Q"); echo "D1=$D1"; psql "$DBU" -c "DELETE FROM schema_version WHERE version='552';" && DB_NAME=cecelia_scratch node src/migrate.js > /tmp/qa_c8_mig2.log 2>&1; R2=$?; grep -E '552|rror' /tmp/qa_c8_mig2.log | tail -5; echo "migrate#2 退出码=$R2"; D2=$(psql "$DBU" -Atc "$Q"); echo "D2=$D2"; SV=$(psql "$DBU" -Atc "SELECT count(*) FROM schema_version WHERE version='552'"); echo "schema_version 552 行数=$SV"; [ $R1 -eq 0 ] && [ $R2 -eq 0 ] && [ "$SV" = "1" ] && [ "$D1" = "$D2" ] && [ "$(echo "$D1" | wc -l | tr -d ' ')" = "1" ] && echo "$D1" | grep -q '^decisions_made_by_check|' && for v in user cecelia system qa_extra ai; do echo "$D1" | grep -q "'$v'" || { echo "缺 $v"; exit 1; }; done && echo "D1==D2，五值齐全"
```
```output
ALTER TABLE
ALTER TABLE
DELETE 1
预置后: decisions_made_by_check|CHECK (((made_by)::text = ANY ((ARRAY['user'::character varying, 'cecelia'::character varying, 'system'::character varying, 'qa_extra'::character varying])::text[]))) NOT VALID
[SKIP] 486_cleanup_final_and_restore_journey_mirrors.sql (already applied)
[SKIP] 540_leadgen_notion_mirror_registry.sql (already applied)
[APPLY] 552_decisions_made_by_allow_ai.sql ...
[DONE] 552_decisions_made_by_allow_ai.sql
[MIGRATE] Applied 1 migration(s): 552
migrate#1 退出码=0
D1=decisions_made_by_check|CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'qa_extra'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID
DELETE 1
[SKIP] 486_cleanup_final_and_restore_journey_mirrors.sql (already applied)
[SKIP] 540_leadgen_notion_mirror_registry.sql (already applied)
[APPLY] 552_decisions_made_by_allow_ai.sql ...
[DONE] 552_decisions_made_by_allow_ai.sql
[MIGRATE] Applied 1 migration(s): 552
migrate#2 退出码=0
D2=decisions_made_by_check|CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'qa_extra'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID
schema_version 552 行数=1
D1==D2，五值齐全
```

### T-6
对应: Q-6
verdict: PASS
说明：scratch 库里还有一个同名 decisions 表，在 `versions_c85c…` 这个 schema 下（是其他工具留下的版本快照 schema）。所以这里把 `information_schema` 的查询限定为 `table_schema='public'`，只看 Brain 实际用的那张表。
```command
DBU=postgresql://cecelia:cecelia@localhost/cecelia_scratch; COL=$(psql "$DBU" -Atc "SELECT data_type, character_maximum_length, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='decisions' AND column_name='made_by'"); echo "列定义=$COL"; MB=$(psql "$DBU" -Atc "INSERT INTO decisions (topic, decision, category) VALUES ('qa-default-c8fab3c8-$(date +%s)','x','judgment') RETURNING made_by" | head -1); echo "默认 made_by=$MB"; [ "$COL" = "character varying|20|'system'::character varying" ] && [ "$MB" = "system" ]; RC=$?; echo "exit=$RC"; exit $RC
```
```output
列定义=character varying|20|'system'::character varying
默认 made_by=system
exit=0
```

### T-7
对应: Q-7
verdict: PASS
说明：按 commander 裁决，用 Q-7' 替代 Q-7：对预览 Brain 所连的生产克隆库 `cecelia_preview_6319` 执行同一条 `$Q`，并强制会话只读，没有连 15432/5221。结果：552 有 1 行；DP 恰好 1 行，名为 `decisions_made_by_check`，`array_length=1`；存量取值 V 全都在约束里。注意 V 里的 `ai` 是本轮 T-1/T-4 写进去的，其余是克隆来的存量值。
```command
export PGOPTIONS='-c default_transaction_read_only=on'; DB=postgresql://cecelia:cecelia@localhost/cecelia_preview_6319; DP=$(psql "$DB" -Atc "SELECT c.conname, pg_get_constraintdef(c.oid), array_length(c.conkey,1) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid='decisions'::regclass AND c.contype='c' AND a.attname='made_by'"); echo "DP=$DP"; SV=$(psql "$DB" -Atc "SELECT count(*) FROM schema_version WHERE version='552'"); echo "schema_version 552 行数=$SV"; V=$(psql "$DB" -Atc "SELECT DISTINCT made_by FROM decisions WHERE made_by IS NOT NULL ORDER BY 1"); echo "V=$(echo $V)"; [ "$SV" = "1" ] && [ "$(echo "$DP" | wc -l | tr -d ' ')" = "1" ] && echo "$DP" | grep -q '^decisions_made_by_check|' && echo "$DP" | grep -q '|1$' && for v in user cecelia system ai $V; do echo "$DP" | grep -q "'$v'" || { echo "缺 $v"; exit 1; }; done && echo 全部取值均在约束内
```
```output
DP=decisions_made_by_check|CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID|1
schema_version 552 行数=1
V=ai
cecelia
system
user
全部取值均在约束内
```

### X-1
对应: Q-3
严重度: 建议
场景: 调用方传了约束不允许的 made_by（大写 `AI`、空串、`ai ` 带尾空格、null），接口一律返回 HTTP 500，并把数据库约束原文透给用户，没有返回 400 和一句说人话的提示。规格「未覆盖真实链路」已登记这是存量行为，不在本次范围；记在这里供另立任务。约束本身没被放开：这几种值都没写进去。
verdict: FAIL
```command
for MB in AI '' 'ai ' null; do BODY=$(jq -nc --arg m "$MB" --arg t "判定点[qa-c8fab3c8-x-$(date +%s%N)]: 探索" '{category:"judgment",topic:$t,decision:"x",made_by:(if $m=="null" then null else $m end),author:"coding-workflow"}'); echo "made_by=[$MB] -> $(curl -s -w ' HTTP%{http_code}' -X POST http://localhost:5301/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY" | head -c 300)"; done
```
```output
made_by=[AI] -> {"success":false,"error":"new row for relation \"decisions\" violates check constraint \"decisions_made_by_check\""} HTTP500
made_by=[] -> {"success":false,"error":"new row for relation \"decisions\" violates check constraint \"decisions_made_by_check\""} HTTP500
made_by=[ai ] -> {"success":false,"error":"new row for relation \"decisions\" violates check constraint \"decisions_made_by_check\""} HTTP500
made_by=[null] -> {"success":false,"error":"null value in column \"made_by\" of relation \"decisions\" violates not-null constraint"} HTTP500
```

### X-2
对应: I-1
verdict: PASS
场景: 查一个不存在的分类，返回空列表 200；limit 传非数字也不报错，正常返回 judgment 数据；POST 空 body 返回 400，提示「topic 和 decision 为必填项」，是人能看懂的话。
```command
curl -s -w ' HTTP%{http_code}\n' 'http://localhost:5301/api/brain/strategic-decisions?category=no_such_cat&limit=5' | head -c 300; echo; curl -s -w ' HTTP%{http_code}\n' 'http://localhost:5301/api/brain/strategic-decisions?category=judgment&limit=abc' | head -c 200; echo; curl -s -w ' HTTP%{http_code}\n' -X POST http://localhost:5301/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{}' | head -c 300
```
```output
{"success":true,"data":[],"total":0} HTTP200

{"success":true,"data":[{"id":"3799b66b-8146-4a59-9b8c-8307657708a7","category":"judgment","topic":"判定点[qa-c8fab3c8-1791750469757362000-dup#1]: 部署判定","decision":"所选: 健康检查…
{"success":false,"error":"topic 和 decision 为必填项"} HTTP400
```
