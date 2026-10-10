---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: verify
upstream: ["01-intent.md#I-1","01-intent.md#I-2","01-intent.md#I-3"]
---
# 验收证据

环境：本分支代码 packages/brain/src/routes/strategic-decisions.js 挂到临时 express 服务（端口 15921），连接本机 cecelia_test 测试库（该库 decisions 表带真实 CHECK 约束 decisions_category_chk）。验收完成后已删除测试数据并停掉临时服务。

### E-1
对应: I-1
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:15921/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"workflow_bogus","topic":"verify-4ea44bcf I-1","decision":"非法 category 测试"}'
```

```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
HTTP 400
```

### E-2
对应: I-1
verdict: PASS

响应体里约束名/SQL 关键字命中数为 0，且非法请求没有落库（count=0）。

```command
curl -s -X POST http://localhost:15921/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"workflow_bogus","topic":"verify-4ea44bcf I-1b","decision":"x"}' | grep -c -E 'decisions_category_chk|check constraint|violates|relation' ; psql -h localhost -U cecelia -d cecelia_test -tAc "select count(*) from decisions where topic like 'verify-4ea44bcf I-1%'"
```

```output
0
0
```

### E-3
对应: I-2
verdict: PASS

不带 category 返回 201，按默认值 decision 写入库。

```command
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:15921/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"topic":"verify-4ea44bcf I-2","decision":"不带 category"}'; psql -h localhost -U cecelia -d cecelia_test -tAc "select category, topic from decisions where topic='verify-4ea44bcf I-2'"
```

```output
{"success":true,"data":{"id":"85015ae8-0162-413a-9b29-572e70cbfe33","category":"decision","topic":"verify-4ea44bcf I-2","decision":"不带 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T02:54:10.768Z"}}
HTTP 201
decision|verify-4ea44bcf I-2
```

### E-4
对应: I-2
verdict: PASS

备注：改动前缺省值写的是 `general`（见下方 E-5），它本身就违反 decisions_category_chk，所以改动前不带 category 的请求实际会 500。改动后改为合法默认值 `decision`，结果符合 I-2 期望的「返回 201」。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-4ea44bcf && git show 8e2a8b363~1:packages/brain/src/routes/strategic-decisions.js | grep -n -A3 "INSERT INTO decisions"; git show 8e2a8b363~1:packages/brain/src/routes/strategic-decisions.js | grep -n "category || \|'decision'"
```

```output
91:      `INSERT INTO decisions
92-         (category, topic, decision, reason, status, trigger, author, made_by, priority, area, alternatives, decided_at, source_ref)
93-       VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, $8, $9, $10, $11, $12)
94-       RETURNING id, category, topic, decision, reason, status, author, made_by, priority, created_at`,
95:      [category || 'general', topic, decision, reason || null, status,
```

### E-5
对应: I-2
verdict: PASS

改动前的默认值 general 直接插库被约束拒绝，证明改用合法默认值 decision 是必要修正。

```command
psql -h localhost -U cecelia -d cecelia_test -c "BEGIN; INSERT INTO decisions (category, topic, decision, status, trigger, author, made_by, priority) VALUES ('general','verify-4ea44bcf old-default','x','active','user','user','user','P2'); ROLLBACK;" 2>&1
```

```output
BEGIN
ERROR:  new row for relation "decisions" violates check constraint "decisions_category_chk"
```

### E-6
对应: I-3
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:15921/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"decision","topic":"verify-4ea44bcf I-3","decision":"合法 category"}'
```

```output
{"success":true,"data":{"id":"24f5dca4-82a9-481a-885e-be95617687ce","category":"decision","topic":"verify-4ea44bcf I-3","decision":"合法 category","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T02:54:16.295Z"}}
HTTP 201
```

### E-7
对应: I-3
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:15921/api/brain/strategic-decisions?category=decision&limit=500' | grep -o -E '"id":"24f5dca4-82a9-481a-885e-be95617687ce","category":"decision","topic":"verify-4ea44bcf I-3"|HTTP [0-9]+'
```

```output
"id":"24f5dca4-82a9-481a-885e-be95617687ce","category":"decision","topic":"verify-4ea44bcf I-3"
HTTP 200
```

### E-8
对应: I-1
verdict: PASS

相关单测（含非法 category/made_by/priority 返回 400、兜底异常不回显原文、允许值与约束漂移守卫）全部通过。

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-4ea44bcf/packages/brain && npx vitest run src/routes/__tests__/strategic-decisions-category.test.js src/__tests__/decision-categories.test.js src/routes/strategic-decisions.test.js 2>&1 | tail -12
```

```output
 ✓ src/routes/__tests__/strategic-decisions-category.test.js  (19 tests) 23ms
 ✓ src/routes/strategic-decisions.test.js  (6 tests) 16ms
 ✓ src/__tests__/decision-categories.test.js  (6 tests) 1ms

 Test Files  3 passed (3)
      Tests  31 passed (31)
```
