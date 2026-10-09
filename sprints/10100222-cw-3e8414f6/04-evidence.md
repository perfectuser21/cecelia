---
task_id: 3e8414f6-19a4-415a-9b27-8e6353e9c6e2
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# Verify 证据

取证方式：在本地起临时 express 服务（端口 5399），按 server.js 的顺序挂载真实路由（brainRoutes 的 status.js 挂 /api/brain，task-tasks.js 兜底挂 /api/brain/tasks），连只读的 cecelia_staging 库（27 条 queued），用 curl 真实请求。另外跑了相关单测作为补充证据。

### E-1
对应: I-1
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5399/api/brain/tasks?status=bogus'
```

```output
{"error":"invalid_status","message":"status 取值非法：bogus","allowed":["pending","queued","in_progress","blocked","quota_exhausted","paused","quarantined","canceled","cancelled","dep_failed","pending_postdeploy","completed","completed_no_pr","failed","archived"]}
HTTP 400
```

### E-2
对应: I-2
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5399/api/brain/tasks?limit=abc'; curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5399/api/brain/tasks?limit=-1'
```

```output
{"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"abc"}
HTTP 400
{"error":"invalid_limit","message":"limit 必须是 1~1000 的正整数","got":"-1"}
HTTP 400
```

### E-3
对应: I-3
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5399/api/brain/tasks?status=queued&limit=5' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const [b,c]=s.split("\nHTTP ");const a=JSON.parse(b);console.log("HTTP",c.trim(),"isArray",Array.isArray(a),"count",a.length,"statuses",JSON.stringify([...new Set(a.map(t=>t.status))]))})'
```

```output
HTTP 200 isArray true count 5 statuses ["queued"]
```

### E-4
对应: I-4
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' 'http://localhost:5399/api/brain/tasks' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const [b,c]=s.split("\nHTTP ");const a=JSON.parse(b);console.log("HTTP",c.trim(),"isArray",Array.isArray(a),"count",a.length)})'
```

```output
HTTP 200 isArray true count 100
```

### E-5
对应: I-1
verdict: PASS

```command
cd packages/brain && npx vitest run src/__tests__/routes/status-tasks-query-validation.test.js src/__tests__/routes/task-tasks.test.js src/lib/__tests__/task-list-query.test.js 2>&1 | tail -30
```

```output
 ✓ src/__tests__/routes/task-tasks.test.js  (30 tests) 213ms
 ✓ src/__tests__/routes/status-tasks-query-validation.test.js  (7 tests) 74ms
 ✓ src/lib/__tests__/task-list-query.test.js  (15 tests) 2ms

 Test Files  3 passed (3)
      Tests  52 passed (52)
```
