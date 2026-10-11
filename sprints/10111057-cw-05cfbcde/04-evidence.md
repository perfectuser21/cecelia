---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5"]
---
# 验收证据：GET /api/brain/runs/:run_id

取证环境：本机 /tmp PostgreSQL 的 cecelia_scratch 库（含 runs/spans 表及 spans 上 3 个触发器），用内联 node 起临时 express 服务（127.0.0.1:55291，挂载顺序与 server.js 一致：spans → runs-read → run-definitions → run-reconciliation）；另起 127.0.0.1:55292 只挂原两条路由作对照基线。

### E-1
对应: I-1
verdict: PASS

```command
RID="coding-workflow:9f1c0e7a-5b2d-4c11-8e0a-0verify000001"; ENC="coding-workflow%3A9f1c0e7a-5b2d-4c11-8e0a-0verify000001"; ACT=80a3d41e-9df6-4e59-a55d-08f98ff28aff; B=http://127.0.0.1:55291/api/brain
echo "== GET 写入前"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/$ENC"
echo "== POST span 1 (fail, later)"; curl -s -w ' HTTP=%{http_code}\n' -H 'content-type: application/json' -d "{\"run_id\":\"$RID\",\"activity_id\":\"$ACT\",\"occurrence_key\":\"verify/b/1\",\"started_at\":\"2026-10-10T10:05:00Z\",\"ended_at\":\"2026-10-10T10:06:00Z\",\"executor_kind\":\"agent\",\"outcome\":\"fail\",\"tokens_in\":50,\"tokens_out\":5,\"cost_usd\":0.25}" "$B/spans"
echo "== POST span 2 (pass, earlier)"; curl -s -w ' HTTP=%{http_code}\n' -H 'content-type: application/json' -d "{\"run_id\":\"$RID\",\"activity_id\":\"$ACT\",\"occurrence_key\":\"verify/a/1\",\"started_at\":\"2026-10-10T10:00:00Z\",\"ended_at\":\"2026-10-10T10:00:05Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\",\"tokens_in\":100,\"tokens_out\":20,\"cost_usd\":0.125}" "$B/spans"
echo "== 立即 GET（URL 编码）"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/$ENC"
echo "== GET（裸冒号）"; curl -s -o /dev/null -w 'HTTP=%{http_code}\n' "$B/runs/$RID"
echo "== DB 直查"; psql -h /tmp -d cecelia_scratch -Atc "select run_id, outcome, tokens_in, tokens_out, cost_usd from runs where run_id='$RID'"
```

```output
== 立即 GET（URL 编码）
{"id":"6fdd09b9-af4e-4ea5-a681-896c896445ab","run_id":"coding-workflow:9f1c0e7a-5b2d-4c11-8e0a-0verify000001","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:06:00.000Z","duration_ms":360000,"outcome":"fail","error":null,"model":null,"tokens_in":"150","tokens_out":"25","cost_usd":"0.375000","detail":null,"header_source":"spans","created_at":"2026-10-11T03:21:26.986Z","updated_at":"2026-10-11T03:21:26.999Z","notion_id":null,"notion_synced_at":null,"notion_digest":null} HTTP=200
== GET（裸冒号）
HTTP=200
```

### E-2
对应: I-4
verdict: PASS

```command
RID="coding-workflow:9f1c0e7a-5b2d-4c11-8e0a-0verify000001"; ENC="coding-workflow%3A9f1c0e7a-5b2d-4c11-8e0a-0verify000001"; ACT=80a3d41e-9df6-4e59-a55d-08f98ff28aff; B=http://127.0.0.1:55291/api/brain
echo "== GET 写入前"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/$ENC"
echo "== POST span 1 (fail, later)"; curl -s -w ' HTTP=%{http_code}\n' -H 'content-type: application/json' -d "{\"run_id\":\"$RID\",\"activity_id\":\"$ACT\",\"occurrence_key\":\"verify/b/1\",\"started_at\":\"2026-10-10T10:05:00Z\",\"ended_at\":\"2026-10-10T10:06:00Z\",\"executor_kind\":\"agent\",\"outcome\":\"fail\",\"tokens_in\":50,\"tokens_out\":5,\"cost_usd\":0.25}" "$B/spans"
echo "== POST span 2 (pass, earlier)"; curl -s -w ' HTTP=%{http_code}\n' -H 'content-type: application/json' -d "{\"run_id\":\"$RID\",\"activity_id\":\"$ACT\",\"occurrence_key\":\"verify/a/1\",\"started_at\":\"2026-10-10T10:00:00Z\",\"ended_at\":\"2026-10-10T10:00:05Z\",\"executor_kind\":\"agent\",\"outcome\":\"pass\",\"tokens_in\":100,\"tokens_out\":20,\"cost_usd\":0.125}" "$B/spans"
echo "== 立即 GET（URL 编码）"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/$ENC"
echo "== GET（裸冒号）"; curl -s -o /dev/null -w 'HTTP=%{http_code}\n' "$B/runs/$RID"
echo "== DB 直查"; psql -h /tmp -d cecelia_scratch -Atc "select run_id, outcome, tokens_in, tokens_out, cost_usd from runs where run_id='$RID'"
```

```output
== GET 写入前
{"error":"run not found: coding-workflow:9f1c0e7a-5b2d-4c11-8e0a-0verify000001"} HTTP=404
== POST span 1 (fail, later)
{"inserted":1,"skipped":0,"count":1,"ids":["b4e38743-c292-4b57-9e1a-79d2209383ff"]} HTTP=200
== POST span 2 (pass, earlier)
{"inserted":1,"skipped":0,"count":1,"ids":["4097d4b9-6341-496b-888c-8f672bc177b1"]} HTTP=200
== 立即 GET（URL 编码）
{"id":"6fdd09b9-af4e-4ea5-a681-896c896445ab","run_id":"coding-workflow:9f1c0e7a-5b2d-4c11-8e0a-0verify000001","workflow_id":null,"trigger_kind":"external","trigger_ref":null,"schedule_entry_id":null,"task_run_id":null,"executor_kind":null,"executor_id":null,"started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:06:00.000Z","duration_ms":360000,"outcome":"fail","error":null,"model":null,"tokens_in":"150","tokens_out":"25","cost_usd":"0.375000","detail":null,"header_source":"spans","created_at":"2026-10-11T03:21:26.986Z","updated_at":"2026-10-11T03:21:26.999Z","notion_id":null,"notion_synced_at":null,"notion_digest":null} HTTP=200
== DB 直查
coding-workflow:9f1c0e7a-5b2d-4c11-8e0a-0verify000001|fail|150|25|0.375000
```

### E-3
对应: I-2
verdict: PASS

```command
ENC="coding-workflow%3A9f1c0e7a-5b2d-4c11-8e0a-0verify000001"; B=http://127.0.0.1:55291/api/brain
echo "== include=spans"; curl -s "$B/runs/$ENC?include=spans" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("run_id",j.run_id,"has_spans",Array.isArray(j.spans),"len",j.spans.length);for(const x of j.spans)console.log(JSON.stringify({occurrence_key:x.occurrence_key,activity_id:x.activity_id,outcome:x.outcome,cost_usd:x.cost_usd,started_at:x.started_at,ended_at:x.ended_at}))})'
echo "== 不带 include"; curl -s "$B/runs/$ENC" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("has spans key:", "spans" in j)})'
```

```output
== include=spans
run_id coding-workflow:9f1c0e7a-5b2d-4c11-8e0a-0verify000001 has_spans true len 2
{"occurrence_key":"verify/a/1","activity_id":"80a3d41e-9df6-4e59-a55d-08f98ff28aff","outcome":"pass","cost_usd":"0.125000","started_at":"2026-10-10T10:00:00.000Z","ended_at":"2026-10-10T10:00:05.000Z"}
{"occurrence_key":"verify/b/1","activity_id":"80a3d41e-9df6-4e59-a55d-08f98ff28aff","outcome":"fail","cost_usd":"0.250000","started_at":"2026-10-10T10:05:00.000Z","ended_at":"2026-10-10T10:06:00.000Z"}
== 不带 include
has spans key: false
```

### E-4
对应: I-3
verdict: PASS

```command
B=http://127.0.0.1:55291/api/brain; L201=$(printf 'a%.0s' $(seq 1 201)); L200=$(printf 'a%.0s' $(seq 1 200))
echo "== 不存在"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/coding-workflow%3Anope-does-not-exist"
echo "== 不存在+include=spans"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/nope-x?include=spans"
echo "== 空串(编码空格)"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/%20"
echo "== 空路径段"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/"
echo "== 201 字符"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/$L201"
echo "== 200 字符(不存在应404)"; curl -s -o /dev/null -w 'HTTP=%{http_code}\n' "$B/runs/$L200"
echo "== 非法百分号编码"; curl -s -w ' HTTP=%{http_code}\n' "$B/runs/%E0%A4%A"
```

```output
== 不存在
{"error":"run not found: coding-workflow:nope-does-not-exist"} HTTP=404
== 不存在+include=spans
{"error":"run not found: nope-x"} HTTP=404
== 空串(编码空格)
{"error":"run_id is required"} HTTP=400
== 空路径段
{"error":"run_id is required"} HTTP=400
== 201 字符
{"error":"run_id must be at most 200 characters"} HTTP=400
== 200 字符(不存在应404)
HTTP=404
== 非法百分号编码
{"error":"run_id is not valid URL encoding"} HTTP=400
```

### E-5
对应: I-5
verdict: PASS

```command
EXIST=$(psql -h /tmp -d cecelia_scratch -Atc "select run_id from runs where run_id not like 'coding-workflow:9f1c0e7a%' limit 1"); echo "existing_run=$EXIST"
for P in "runs/external__a1/definition" "runs/coding-workflow%3Anope/definition" "runs/external__a1/reconciliation" "runs/$EXIST/reconciliation" "runs/$EXIST/definition"; do
  NEW=$(curl -s -w ' HTTP=%{http_code}' "http://127.0.0.1:55291/api/brain/$P"); OLD=$(curl -s -w ' HTTP=%{http_code}' "http://127.0.0.1:55292/api/brain/$P")
  echo "== GET /$P"; echo "  含新路由: $NEW"; echo "  无新路由: $OLD"; [ "$NEW" = "$OLD" ] && echo "  SAME" || echo "  DIFF"
done
echo "== POST definition 坏 body"; for port in 55291 55292; do curl -s -w " HTTP=%{http_code}\n" -H 'content-type: application/json' -d '{}' "http://127.0.0.1:$port/api/brain/runs/verify-x/definition"; done
```

```output
existing_run=coding-workflow:79fd1dac-bc8c-419d-bd8d-f0e404c5f4f9
== GET /runs/external__a1/definition
  含新路由: {"error":{"code":"RUN_DEFINITION_UNKNOWN","message":"运行缺少固定定义证据"}} HTTP=404
  无新路由: {"error":{"code":"RUN_DEFINITION_UNKNOWN","message":"运行缺少固定定义证据"}} HTTP=404
  SAME
== GET /runs/coding-workflow%3Anope/definition
  含新路由: {"error":{"code":"RUN_DEFINITION_UNKNOWN","message":"运行缺少固定定义证据"}} HTTP=404
  无新路由: {"error":{"code":"RUN_DEFINITION_UNKNOWN","message":"运行缺少固定定义证据"}} HTTP=404
  SAME
== GET /runs/external__a1/reconciliation
  含新路由: {"run_id":"external__a1","run_binding_id":null,"release_id":null,"task_run":null,"harness_attempts":[],"business_outcome":"unknown","evidence_status":"unknown","gaps":[{"code":"RUN_BINDING_MISSING"}],"missing":[],"unexpected":[],"duration_ms":{"wall":0,"activity":0,"step":0,"enabler":0},"links":{"task_run_id":null,"task_id":null,"initiative_run_id":null,"harness_attempt_ids":[]}} HTTP=200
  无新路由: {"run_id":"external__a1","run_binding_id":null,"release_id":null,"task_run":null,"harness_attempts":[],"business_outcome":"unknown","evidence_status":"unknown","gaps":[{"code":"RUN_BINDING_MISSING"}],"missing":[],"unexpected":[],"duration_ms":{"wall":0,"activity":0,"step":0,"enabler":0},"links":{"task_run_id":null,"task_id":null,"initiative_run_id":null,"harness_attempt_ids":[]}} HTTP=200
  SAME
== GET /runs/coding-workflow:79fd1dac-bc8c-419d-bd8d-f0e404c5f4f9/reconciliation
  SAME
== GET /runs/coding-workflow:79fd1dac-bc8c-419d-bd8d-f0e404c5f4f9/definition
  含新路由: {"error":{"code":"RUN_DEFINITION_UNKNOWN","message":"运行缺少固定定义证据"}} HTTP=404
  无新路由: {"error":{"code":"RUN_DEFINITION_UNKNOWN","message":"运行缺少固定定义证据"}} HTTP=404
  SAME
== POST definition 坏 body
{"error":{"code":"RELEASE_INPUT_INVALID","message":"release_id格式无效"}} HTTP=422
{"error":{"code":"RELEASE_INPUT_INVALID","message":"release_id格式无效"}} HTTP=422
```

### E-6
对应: I-5
verdict: PASS

```command
echo "token_set=${CECELIA_INTERNAL_TOKEN:+yes}"; env -u CECELIA_INTERNAL_TOKEN DB_HOST=/tmp DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js src/routes/__tests__/integration/runs-read.test.js src/routes/__tests__/integration/run-definitions.test.js src/routes/__tests__/integration/run-reconciliation.test.js --reporter=verbose 2>&1 | grep -E "✓|×|FAIL|Test Files|Tests "
```

```output
 ✓ src/routes/__tests__/integration/runs-read.test.js > 鉴权：缺/错 token 401 不泄露记录，正确 token 200；原两段路由鉴权与行为不变
 ✓ src/routes/__tests__/integration/runs-read.test.js > 带 token 的两段请求穿过新路由落到原路由，行为不变
 ✓ src/routes/__tests__/integration/run-reconciliation.test.js > 未知外部运行只给unknown且不会生成新的任务或运行
 ✓ src/routes/__tests__/integration/run-reconciliation.test.js > 已有冻结定义而无实际Span，HTTP明确列出缺失步骤
 ✓ src/routes/__tests__/integration/run-definitions.test.js > HTTP运行定义精确回读，未知历史返回404且无推断latest
 Test Files  3 passed (3)
      Tests  9 passed (9)
```

### E-7
对应: I-5
verdict: PASS

```command
grep -n "internalAuth\|router\.\(get\|post\|put\|use\)" packages/brain/src/routes/spans.js packages/brain/src/routes/run-definitions.js packages/brain/src/routes/run-reconciliation.js
```

```output
packages/brain/src/routes/run-reconciliation.js:27:  router.get('/:run_id/reconciliation',internalAuthOrLoopback,async(req,res)=>{
packages/brain/src/routes/run-definitions.js:8:  const router=Router();router.use(internalAuthOrLoopback);
packages/brain/src/routes/run-definitions.js:9:  router.post('/:run_id/definition',async(req,res)=>{try{
packages/brain/src/routes/run-definitions.js:12:  router.get('/:run_id/definition',async(req,res)=>{try{
```
