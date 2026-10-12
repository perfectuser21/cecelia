---
task_id: c8fab3c8-c85e-4e7e-a610-ce776c4aefe2
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2"]
---
# 验收证据：decisions_made_by_check 补 ai（迁移 552）

验收环境：本机 postgres 新建空库 cw_verify_c8fab3c8，用仓库 migrate.js 从 000 跑全量迁移到 552（迁移建出的库）；再起一个只挂真实 `src/routes/strategic-decisions.js` 路由（真实 db.js）的 express 进程（端口 5399）指向该库。

## 备注

迁移 552 自带的集成测试 `migration-552-decisions-made-by-ai.pg.integration.test.js` 在本机 cecelia_scratch 上 8 条全失败：首条用例先加一个**已校验**（非 NOT VALID）且不含 ai 的约束，而 cecelia_scratch 里已经有 1 行 made_by=ai（`ai|1 / system|1 / user|14`），所以报 `check constraint ... is violated by some row`，后面 7 条跟着报事务已中止。这说明测试夹具依赖"库里没有 ai 行"，不是迁移本身的问题；CI 的 cecelia_test 是空库，可能不受影响。I-2 的判定以下面 E-4/E-5 的真库命令结果为准。

### E-1
对应: I-1
verdict: PASS

```command
createdb -U cecelia cw_verify_c8fab3c8 2>&1 || createdb cw_verify_c8fab3c8 -O cecelia; cd packages/brain && DB_NAME=cw_verify_c8fab3c8 NODE_ENV=production node src/migrate.js > /tmp/cw_verify_c8fab3c8_migrate.log 2>&1; echo exit=$?; tail -5 /tmp/cw_verify_c8fab3c8_migrate.log
```

```output
exit=0
[DONE] 551_dispatch_gate_stuck_task_cleanup.sql
[APPLY] 552_decisions_made_by_allow_ai.sql ...
[DONE] 552_decisions_made_by_allow_ai.sql
```

### E-2
对应: I-1
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:5399/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"judgment","topic":"判定点[verify-c8fab3c8-ai#1]: made_by ai","decision":"所选方法: x｜候选: y","reason":"依据: z","made_by":"ai","author":"coding-workflow","source_ref":"coding-workflow:verify-c8fab3c8"}'
```

```output
{"success":true,"data":{"id":"700d3c31-66d4-4782-94da-2551b97771ff","category":"judgment","topic":"判定点[verify-c8fab3c8-ai#1]: made_by ai","decision":"所选方法: x｜候选: y","reason":"依据: z","status":"active","author":"coding-workflow","made_by":"ai","priority":"P2","created_at":"2026-10-11T14:14:54.546Z"}}
HTTP 201
```

### E-3
对应: I-1
verdict: PASS

```command
curl -s 'http://localhost:5399/api/brain/strategic-decisions?category=judgment&limit=1000' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).data.filter(x=>x.topic==="判定点[verify-c8fab3c8-ai#1]: made_by ai");console.log("matched:",r.length);r.forEach(x=>console.log(x.category,x.made_by,x.author,x.topic))})'
```

```output
matched: 1
judgment ai coding-workflow 判定点[verify-c8fab3c8-ai#1]: made_by ai
```

### E-4
对应: I-2
verdict: PASS

```command
psql -X -U cecelia -d cw_verify_c8fab3c8 -Atc "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='decisions'::regclass AND contype='c' AND conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='decisions'::regclass AND attname='made_by')]"
```

```output
decisions_made_by_check|CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID
```

### E-5
对应: I-2
verdict: PASS

```command
Q="SELECT conname||' | '||pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='decisions'::regclass AND contype='c' AND (SELECT attnum FROM pg_attribute WHERE attrelid='decisions'::regclass AND attname='made_by') = ANY(conkey)"; D=cw_verify_c8fab3c8; F=/Users/administrator/worktrees/cecelia-cw/cw-c8fab3c8/packages/brain/migrations/552_decisions_made_by_allow_ai.sql; echo "== 迁移外加宽 owner_x（并另加一个改名约束 legacy_made_by_chk 含 owner_y）"; psql -X -U cecelia -d $D -v ON_ERROR_STOP=1 -Atc "ALTER TABLE decisions DROP CONSTRAINT decisions_made_by_check; ALTER TABLE decisions ADD CONSTRAINT decisions_made_by_check CHECK (made_by IN ('user','cecelia','system','owner_x')) NOT VALID; ALTER TABLE decisions ADD CONSTRAINT legacy_made_by_chk CHECK (made_by IN ('user','owner_y')) NOT VALID"; psql -X -U cecelia -d $D -Atc "$Q"; echo "== 重跑 552 第1次"; psql -X -U cecelia -d $D -v ON_ERROR_STOP=1 -q -f $F; echo exit=$?; A=$(psql -X -U cecelia -d $D -Atc "$Q"); echo "$A"; echo "== 重跑 552 第2次"; psql -X -U cecelia -d $D -v ON_ERROR_STOP=1 -q -f $F; echo exit=$?; B=$(psql -X -U cecelia -d $D -Atc "$Q"); echo "$B"; [ "$A" = "$B" ] && echo "IDEMPOTENT: 两次重跑约束定义完全一致" || echo "DIFF"; for v in user cecelia system owner_x owner_y ai; do case "$B" in *"'$v'"*) echo "保留/含 $v";; *) echo "缺 $v";; esac; done; psql -X -U cecelia -d $D -Atc "SELECT made_by, count(*) FROM decisions GROUP BY made_by ORDER BY 1"
```

```output
== 迁移外加宽 owner_x（并另加一个改名约束 legacy_made_by_chk 含 owner_y）
ALTER TABLE
ALTER TABLE
ALTER TABLE
decisions_made_by_check | CHECK (((made_by)::text = ANY ((ARRAY['user'::character varying, 'cecelia'::character varying, 'system'::character varying, 'owner_x'::character varying])::text[]))) NOT VALID
legacy_made_by_chk | CHECK (((made_by)::text = ANY ((ARRAY['user'::character varying, 'owner_y'::character varying])::text[]))) NOT VALID
== 重跑 552 第1次
exit=0
decisions_made_by_check | CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'owner_x'::character varying, 'owner_y'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID
== 重跑 552 第2次
exit=0
decisions_made_by_check | CHECK (((made_by)::text = ANY ((ARRAY['ai'::character varying, 'cecelia'::character varying, 'owner_x'::character varying, 'owner_y'::character varying, 'system'::character varying, 'user'::character varying])::text[]))) NOT VALID
IDEMPOTENT: 两次重跑约束定义完全一致
保留/含 user
保留/含 cecelia
保留/含 system
保留/含 owner_x
保留/含 owner_y
保留/含 ai
ai|1
user|10
```
