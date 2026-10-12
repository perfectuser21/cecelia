---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7"]
---
# QA 报告（第 1 轮，环境 http://localhost:5301）

本轮开始时间：2026-10-11T19:48:02Z。预览 Brain `/health` 返回 `runtime.isolated=true`；Q-1~Q-4 在预览环境执行，Q-5/Q-6 按规格在本机隔离库 `cecelia_scratch` 执行（本 PR 分支 worktree 的 `packages/brain`），Q-7 需要连生产库，按 QA 禁令不执行。

### T-1
对应: Q-1
verdict: PASS
```command
B=http://localhost:5301; TS=$(date +%s%N); T="判定点[qa-c8fab3c8-$TS#1]: 部署判定"; BODY=$(jq -nc --arg t "$T" --arg s "coding-workflow:qa-c8fab3c8-$TS" '{category:"judgment",topic:$t,decision:"所选: 健康检查｜候选: 健康检查/日志",reason:"依据: 双信号",made_by:"ai",author:"coding-workflow",source_ref:$s}'); R=$(curl -s -w '\n%{http_code}' -X POST $B/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); echo "$R"; CODE=$(echo "$R" | tail -1); RESP=$(echo "$R" | sed '$d'); L=$(curl -s "$B/api/brain/strategic-decisions?category=judgment&limit=1000" | jq -c --arg t "$T" '[.data[] | select(.topic==$t) | {topic,made_by,author,category}]'); echo "$L"; [ "$CODE" = 201 ] && echo "$RESP" | jq -e '.success==true and .data.made_by=="ai" and .data.category=="judgment"' >/dev/null && ! echo "$RESP" | grep -qE 'decisions_made_by_check|violates check constraint' && echo "$L" | jq -e 'length==1 and .[0].made_by=="ai" and .[0].author=="coding-workflow"' && echo Q1_OK
```
```output
{"success":true,"data":{"id":"edcc515a-789d-4036-bd9c-ad4a17f45153","category":"judgment","topic":"判定点[qa-c8fab3c8-1791748091321620000#1]: 部署判定","decision":"所选: 健康检查｜候选: 健康检查/日志","reason":"依据: 双信号","status":"active","author":"coding-workflow","made_by":"ai","priority":"P2","created_at":"2026-10-11T14:48:11.351Z"}}
201
[{"topic":"判定点[qa-c8fab3c8-1791748091321620000#1]: 部署判定","made_by":"ai","author":"coding-workflow","category":"judgment"}]
true
Q1_OK
```

### T-2
对应: Q-2
verdict: PASS
```command
B=http://localhost:5301; TS=$(date +%s%N); FAIL=0; for MB in system user cecelia; do T="判定点[qa-c8fab3c8-$TS#$MB]: 部署判定"; BODY=$(jq -nc --arg t "$T" --arg m "$MB" --arg s "coding-workflow:qa-c8fab3c8-$TS" '{category:"judgment",topic:$t,decision:"所选: 健康检查｜候选: 健康检查/日志",reason:"依据: 双信号",made_by:$m,author:"coding-workflow",source_ref:$s}'); CODE=$(curl -s -o /tmp/qa6319_q2.json -w '%{http_code}' -X POST $B/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); L=$(curl -s "$B/api/brain/strategic-decisions?category=judgment&limit=1000" | jq -c --arg t "$T" '[.data[] | select(.topic==$t) | .made_by]'); echo "$MB code=$CODE resp_made_by=$(jq -r .data.made_by /tmp/qa6319_q2.json) list=$L"; [ "$CODE" = 201 ] && echo "$L" | jq -e --arg m "$MB" '. == [$m]' >/dev/null || FAIL=1; done; [ $FAIL = 0 ] && echo Q2_OK
```
```output
system code=201 resp_made_by=system list=["system"]
user code=201 resp_made_by=user list=["user"]
cecelia code=201 resp_made_by=cecelia list=["cecelia"]
Q2_OK
```

### T-3
对应: Q-3
verdict: PASS
```command
B=http://localhost:5301; TS=$(date +%s%N); T="判定点[qa-c8fab3c8-$TS#bogus]: 部署判定"; BODY=$(jq -nc --arg t "$T" --arg s "coding-workflow:qa-c8fab3c8-$TS" '{category:"judgment",topic:$t,decision:"x",reason:"y",made_by:"bogus_maker",author:"coding-workflow",source_ref:$s}'); CODE=$(curl -s -o /tmp/qa6319_q3.json -w '%{http_code}' -X POST $B/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); echo "code=$CODE"; cat /tmp/qa6319_q3.json; echo; L=$(curl -s "$B/api/brain/strategic-decisions?category=judgment&limit=1000" | jq -c --arg t "$T" '[.data[] | select(.topic==$t)] | length'); echo "rows=$L"; [ "$CODE" != 201 ] && jq -e '.success==false' /tmp/qa6319_q3.json >/dev/null && [ "$L" = 0 ] && echo Q3_OK
```
```output
code=500
{"success":false,"error":"new row for relation \"decisions\" violates check constraint \"decisions_made_by_check\""}
rows=0
Q3_OK
```

### T-4
对应: Q-4
verdict: PASS
```command
B=http://localhost:5301; TS=$(date +%s%N); T="判定点[qa-c8fab3c8-$TS#dup]: 部署判定"; BODY=$(jq -nc --arg t "$T" --arg s "coding-workflow:qa-c8fab3c8-$TS" '{category:"judgment",topic:$t,decision:"所选: 健康检查｜候选: 健康检查/日志",reason:"依据: 双信号",made_by:"ai",author:"coding-workflow",source_ref:$s}'); C1=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); C2=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); L=$(curl -s "$B/api/brain/strategic-decisions?category=judgment&limit=1000" | jq -c --arg t "$T" '[.data[] | select(.topic==$t) | .made_by]'); echo "c1=$C1 c2=$C2 list=$L"; [ "$C1" = 201 ] && [ "$C2" = 201 ] && echo "$L" | jq -e '. == ["ai","ai"]' && echo Q4_OK
```
```output
c1=201 c2=201 list=["ai","ai"]
true
Q4_OK
```

### T-5
对应: Q-5
verdict: PASS
说明：本机隔离库 `cecelia_scratch`，先造「迁移外加宽（qa_extra）+ 552 未跑」状态，跑本分支 migrate 两次（中间删掉 552 记录强制重跑），比较前后约束定义。
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6319-1 && psql cecelia_scratch -c "ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_made_by_check; ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check CHECK (made_by IN ('user','cecelia','system','qa_extra')) NOT VALID; DELETE FROM schema_version WHERE version='552';" && (cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js > /tmp/qa6319_m1.log 2>&1; echo "migrate1 exit=$?"; tail -3 /tmp/qa6319_m1.log) && Q="SELECT c.conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid='decisions'::regclass AND c.contype='c' AND a.attname='made_by'" && D1=$(psql cecelia_scratch -Atc "$Q") && echo "D1=$D1" && psql cecelia_scratch -c "DELETE FROM schema_version WHERE version='552';" && (cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js > /tmp/qa6319_m2.log 2>&1; echo "migrate2 exit=$?"; tail -3 /tmp/qa6319_m2.log) && D2=$(psql cecelia_scratch -Atc "$Q") && echo "D2=$D2" && N=$(psql cecelia_scratch -Atc "SELECT count(*) FROM schema_version WHERE version='552'") && echo "sv552=$N" && [ "$(echo "$D1" | wc -l | tr -d ' ')" = 1 ] && echo "$D1" | grep -q '^decisions_made_by_check|' && for v in user cecelia system qa_extra ai; do echo "$D1" | grep -q "'$v'" || exit 1; done && [ "$D1" = "$D2" ] && [ "$N" = 1 ] && echo Q5_OK
```
```output
ALTER TABLE
ALTER TABLE
DELETE 1
migrate1 exit=0
[DONE] 552_decisions_made_by_allow_ai.sql
[MIGRATE] Applied 1 migration(s): 552
Migration complete. Applied: 1
D1=decisions_made_by_check|CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'qa_extra'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID
DELETE 1
migrate2 exit=0
[DONE] 552_decisions_made_by_allow_ai.sql
[MIGRATE] Applied 1 migration(s): 552
Migration complete. Applied: 1
D2=decisions_made_by_check|CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'qa_extra'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID
sv552=1
Q5_OK
```

### T-6
对应: Q-6
verdict: PASS
说明：第一次照规格原样查 information_schema 返回 2 行——`cecelia_scratch` 里另有一个 `versions_c85c…` schema 也有 decisions 表（两行内容相同，都是 `character varying|20|'system'`），属本机库遗留，非产品问题；改为限定 `table_schema='public'` 重跑如下。
```command
C=$(psql cecelia_scratch -Atc "SELECT data_type, character_maximum_length, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='decisions' AND column_name='made_by'"); echo "col=$C"; TS=$(date +%s%N); M=$(psql cecelia_scratch -Atqc "INSERT INTO decisions (topic, decision, category) VALUES ('qa-default-c8fab3c8-$TS','x','judgment') RETURNING made_by"); echo "inserted made_by=$M"; [ "$C" = "character varying|20|'system'::character varying" ] && [ "$M" = system ] && echo Q6_OK
```
```output
col=character varying|20|'system'::character varying
inserted made_by=system
Q6_OK
```

### T-7
对应: Q-7
verdict: CANNOT_VERIFY
原因: Q-7 要求经 pg-tunnel `localhost:15432` 连 us-vps **生产库** `cecelia` 做合并前/部署后对比；QA 禁令明确「只能访问 PREVIEW_URL，绝不访问生产地址，只读也不行」，且「部署后 D1」在合并前本就无法取得。本项未执行任何生产查询，交由人工/部署后流程核对。预览库（生产克隆）中约束已是单个 `decisions_made_by_check`，取值 `ai/cecelia/system/user`，仅作旁证，不能替代生产验收。
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6319-1 && grep -n '15432' sprints/10120304-cw-c8fab3c8/02-spec.md
```
```output
119:- 前提: 生产库真库只读验收。执行地 MMV 本机，经已有 pg-tunnel `localhost:15432` 连 us-vps 生产 `cecelia`（DEFINITION.md:1095 同一通道）；只发 SELECT，会话强制只读，不在 us-vps 上起任何进程（INV-96054a8b）。查询记为 `$Q`：
121:  PGOPTIONS='-c default_transaction_read_only=on' psql -h localhost -p 15432 -d cecelia -Atc "SELECT c.conname, pg_get_constraintdef(c.oid), array_length(c.conkey,1) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid='decisions'::regclass AND c.contype='c' AND a.attname='made_by'"
```

### X-1
对应: I-1
verdict: PASS
场景: 用户传大小写不对的 `AI`、空串、null，以及完全不传 made_by。约束未被放宽成任意值（`AI`/空串仍被拒）；不传 made_by 时路由给默认 `user` 并 201。非法值返回 500 并透出约束原文属规格「未覆盖真实链路」已登记的存量行为，不计入本次缺陷。
```command
B=http://localhost:5301; TS=$(date +%s%N); OUT=""; for MB in '"AI"' '""' 'null'; do T="qa-c8fab3c8-x-$TS-$MB"; BODY=$(jq -nc --arg t "$T" --argjson m "$MB" '{category:"judgment",topic:$t,decision:"x",reason:"y",made_by:$m,author:"coding-workflow"}'); R=$(curl -s -w ' %{http_code}' -X POST $B/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$BODY"); echo "made_by=$MB -> $R"; OUT="$OUT ${R##* }"; done; T="qa-c8fab3c8-x-$TS-absent"; R=$(curl -s -w ' %{http_code}' -X POST $B/api/brain/strategic-decisions -H 'Content-Type: application/json' -d "$(jq -nc --arg t "$T" '{category:"judgment",topic:$t,decision:"x",reason:"y",author:"coding-workflow"}')"); echo "made_by=ABSENT -> $R"; [ "$OUT" = " 500 500 500" ] && [ "${R##* }" = 201 ]
```
```output
made_by="AI" -> {"success":false,"error":"new row for relation \"decisions\" violates check constraint \"decisions_made_by_check\""} 500
made_by="" -> {"success":false,"error":"new row for relation \"decisions\" violates check constraint \"decisions_made_by_check\""} 500
made_by=null -> {"success":false,"error":"null value in column \"made_by\" of relation \"decisions\" violates not-null constraint"} 500
made_by=ABSENT -> {"success":true,"data":{"id":"b0bd2fb7-b8cc-40fb-a894-43e1474a27ea","category":"judgment","topic":"qa-c8fab3c8-x-1791748130718266000-absent","decision":"x","reason":"y","status":"active","author":"coding-workflow","made_by":"user","priority":"P2","created_at":"2026-10-11T14:48:50.782Z"}} 201
```

### X-2
对应: I-2
verdict: PASS
场景: 直接看预览库（PR 版本已跑迁移）上 decisions 的全部 CHECK：涉及 made_by 的只有一个 `decisions_made_by_check`，含 ai 与原三值，且为 NOT VALID（不扫存量）；其他约束未受影响。
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6319-1 && ls packages/brain/migrations | grep -E '^55'; psql cecelia_preview_6319 -Atc "SELECT version FROM schema_version WHERE version='552'"; psql cecelia_preview_6319 -Atc "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='decisions'::regclass AND contype='c'"; psql cecelia_scratch -Atc "SELECT max(version::int) FROM schema_version WHERE version ~ '^[0-9]+$'"
```
```output
550_skill_factory_coding_workflow_task_types.sql
551_dispatch_gate_stuck_task_cleanup.sql
552_decisions_made_by_allow_ai.sql
552
decisions_category_chk|CHECK (((category IS NULL) OR ((category)::text = ANY ((ARRAY['architecture'::character varying, … 'testing'::character varying])::text[])))) NOT VALID
decisions_level_chk|CHECK (((level IS NULL) OR ((level)::text = ANY (ARRAY[('global'::character varying)::text, … ('step'::character varying)::text]))))
decisions_made_by_check|CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID
decisions_priority_check|CHECK (((priority)::text = ANY (ARRAY[('P0'::character varying)::text, … ('P3'::character varying)::text])))
decisions_scope_chk|CHECK (((scope IS NULL) OR ((scope)::text = ANY (ARRAY[('v1'::character varying)::text, ('backlog'::character varying)::text]))))
decisions_target_type_chk|CHECK (((target_type IS NULL) OR ((target_type)::text = ANY (ARRAY[('journey_feature'::character varying)::text, … ('area'::character varying)::text]))))
552
```
