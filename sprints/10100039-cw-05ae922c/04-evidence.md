---
task_id: 05ae922c-4f2a-4c1c-9f86-d24937fc32d3
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5"]
---
# 验收证据

取证环境：本地起一个临时 express 服务（/tmp/cw05-verify/server.mjs，监听 127.0.0.1:5399），挂载本分支的 task-projects / task-goals / journeys / dev-records 四个路由，路径与 server.js 一致，连本地 cecelia_test 库，用真实 HTTP 请求验收。

### E-1
对应: I-1
verdict: PASS

```command
curl -s -m 10 -w '\nHTTP=%{http_code} TIME=%{time_total}\n' http://127.0.0.1:5399/api/brain/projects/not-a-uuid
```

```output
{"error":"Invalid project id: must be a UUID"}
HTTP=400 TIME=0.001029
```

### E-2
对应: I-2
verdict: PASS

```command
curl -s -m 10 -w '\nHTTP=%{http_code} TIME=%{time_total}\n' http://127.0.0.1:5399/api/brain/goals/not-a-uuid
```

```output
{"error":"Invalid goal id: must be a UUID"}
HTTP=400 TIME=0.000763
```

### E-3
对应: I-3
verdict: PASS

```command
curl -s -m 10 -w '\nHTTP=%{http_code} TIME=%{time_total}\n' http://127.0.0.1:5399/api/brain/journeys/not-a-uuid
```

```output
{"error":"Invalid journey id: must be a UUID"}
HTTP=400 TIME=0.001280
```

### E-4
对应: I-4
verdict: PASS

```command
curl -s -m 10 -w '\nHTTP=%{http_code} TIME=%{time_total}\n' 'http://127.0.0.1:5399/api/brain/dev-records?limit=-1'
```

```output
{"success":false,"error":"limit must be a non-negative integer"}
HTTP=400 TIME=0.001044
```

### E-5
对应: I-5
verdict: PASS

```command
for p in projects goals journeys; do echo "== $p"; curl -s -m 10 -w '\nHTTP=%{http_code} TIME=%{time_total}\n' http://127.0.0.1:5399/api/brain/$p/00000000-0000-4000-8000-000000000000; done
```

```output
== projects
{"error":"project not found"}
HTTP=404 TIME=0.002849
== goals
{"error":"goal not found"}
HTTP=404 TIME=0.015470
== journeys
{"error":"not found"}
HTTP=404 TIME=0.011375
```

### E-6
对应: I-4
verdict: PASS

```command
cd packages/brain && npx vitest run src/__tests__/routes/task-goals.test.js src/routes/__tests__/task-projects.test.js src/routes/__tests__/journeys.test.js src/routes/__tests__/dev-records.test.js 2>&1 | tail -12
```

```output
 ✓ src/routes/__tests__/task-projects.test.js  (28 tests) 98ms
 ✓ src/routes/__tests__/dev-records.test.js  (8 tests) 16ms
stderr | src/routes/__tests__/dev-records.test.js > GET /api/brain/dev-records limit/offset 校验 > 查库抛错 → 500，响应体不含错误原文
[dev-records] GET / error: boom db detail


 Test Files  4 passed (4)
      Tests  110 passed (110)
```
