---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 验收证据

取证环境：本机临时库 verify_bd2b1556（从 cecelia_test 复制 decisions/schema_version 表结构，应用分支迁移 544），用 express 挂载分支真实路由 `packages/brain/src/routes/strategic-decisions.js` 起在 18791 端口，curl 实打。取证后已删除临时库和临时服务。

### E-1
对应: I-1
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:18791/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"workflow_bogus","topic":"verify-bogus","decision":"verify"}'
```

```output
{"success":false,"error":"category 非法，合法值：architecture|bug-fix|decision|deployment|feature|general|governance|infra|invariant|judgment|nfr|small-change|technical|testing","allowed_categories":["architecture","bug-fix","decision","deployment","feature","general","governance","infra","invariant","judgment","nfr","small-change","technical","testing"]}
HTTP 400
```

### E-2
对应: I-1
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:18791/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"workflow_bogus","topic":"verify-bogus2","decision":"verify"}' | grep -ciE 'decisions_category_chk|check constraint|violates|relation "decisions"'; psql -X -U cecelia -d verify_bd2b1556 -Atc "SELECT count(*) FROM decisions WHERE category='workflow_bogus'"
```

```output
0
0
```

### E-3
对应: I-1
verdict: PASS

```command
cd packages/brain && npx vitest run src/routes/__tests__/strategic-decisions-category.test.js 2>&1 | tail -30
```

```output
 ✓ src/routes/__tests__/strategic-decisions-category.test.js  (8 tests) 4ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

### E-4
对应: I-2
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:18791/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"topic":"verify-nocat","decision":"verify"}'
```

```output
{"success":true,"data":{"id":"be7ed7ee-8d69-4836-93be-a2915e904663","category":"general","topic":"verify-nocat","decision":"verify","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T05:05:19.673Z"}}
HTTP 201
```

### E-5
对应: I-3
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:18791/api/brain/strategic-decisions -H 'Content-Type: application/json' -d '{"category":"decision","topic":"verify-decision-cat","decision":"verify"}'; curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:18791/api/brain/strategic-decisions?category=decision&limit=10'
```

```output
{"success":true,"data":{"id":"55124d72-c3c8-43d7-add1-adc1eb5a8e21","category":"decision","topic":"verify-decision-cat","decision":"verify","reason":null,"status":"active","author":"user","made_by":"user","priority":"P2","created_at":"2026-10-10T05:05:21.069Z"}}
HTTP 201
{"success":true,"data":[{"id":"55124d72-c3c8-43d7-add1-adc1eb5a8e21","category":"decision","topic":"verify-decision-cat","decision":"verify","reason":null,"status":"active","confidence":null,"author":"user","made_by":"user","priority":"P2","area":null,"alternatives":null,"decided_at":null,"executed_at":null,"created_at":"2026-10-10T05:05:21.069Z","updated_at":"2026-10-10T05:05:21.069Z"}],"total":1}
HTTP 200
```
