---
task_id: 142c9ad0-2150-4f03-978c-3dd30ab32ed1
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5"]
---
# 验收证据

取证方式：在 /tmp/verify-142c9ad0/serve.mjs 起一个临时服务，按 packages/brain/server.js 第 430/431/477 行的顺序挂载真实路由（`/api/brain/pipelines` → 别名 `/api/brain` → `/api/brain/runs` 的 runs 读路由），连本机 cecelia_scratch 库，端口 5399，用临时 internal token；另外跑了相关 vitest 单元测试。

### E-1
对应: I-1
verdict: PASS

```command
for i in $(seq 1 20); do curl -s localhost:5399/api/brain/content-types >/dev/null && break; perl -e 'select(undef,undef,undef,0.5)'; done; for s in stats stages output publish-status; do echo "--- /api/brain/runs/$s"; curl -s -H 'X-Internal-Token: verify-tok-142c' -w '\nHTTP %{http_code}\n' localhost:5399/api/brain/runs/$s; done
```

```output
--- /api/brain/runs/stats
{"error":"run not found: stats"}
HTTP 404
--- /api/brain/runs/stages
{"error":"run not found: stages"}
HTTP 404
--- /api/brain/runs/output
{"error":"run not found: output"}
HTTP 404
--- /api/brain/runs/publish-status
{"error":"run not found: publish-status"}
HTTP 404
```

### E-2
对应: I-1
verdict: PASS

```command
cd packages/brain && npx vitest run src/__tests__/content-pipeline-runs-shadow.test.js src/__tests__/content-pipeline-routes.test.js src/__tests__/content-pipeline-publish-status.test.js 2>&1 | tail -40
```

```output
 ✓ src/__tests__/content-pipeline-routes.test.js  (33 tests) 35ms
 ✓ src/__tests__/content-pipeline-runs-shadow.test.js  (16 tests) 23ms
stderr | src/__tests__/content-pipeline-publish-status.test.js > GET /pipelines/:id/publish-status > handles pool error with 500
[routes/content-pipeline] GET /:id/publish-status error: db down

 ✓ src/__tests__/content-pipeline-publish-status.test.js  (7 tests) 7ms

 Test Files  3 passed (3)
      Tests  56 passed (56)
```

### E-3
对应: I-2
verdict: PASS

```command
for s in stats stages output publish-status; do curl -s -w ' HTTP %{http_code}\n' localhost:5399/api/brain/pipelines/not-a-uuid/$s; done | tee /tmp/verify-142c9ad0/i2.txt; grep -c 'invalid input syntax' /tmp/verify-142c9ad0/i2.txt
```

```output
{"error":"invalid pipeline id: must be a UUID"} HTTP 400
{"error":"invalid pipeline id: must be a UUID"} HTTP 400
{"error":"invalid pipeline id: must be a UUID"} HTTP 400
{"error":"invalid pipeline id: must be a UUID"} HTTP 400
0
```

### E-4
对应: I-3
verdict: PASS

```command
P=$(psql -h localhost -U cecelia -d cecelia_scratch -Atc "insert into tasks (title, task_type, status, payload) values ('verify-142c9ad0 临时 pipeline', 'content-pipeline', 'completed', '{}'::jsonb) returning id" | head -1); echo "pipeline=$P"; for s in stats stages output publish-status; do echo "--- /api/brain/pipelines/<id>/$s"; curl -s -w ' HTTP %{http_code}\n' localhost:5399/api/brain/pipelines/$P/$s | head -c 400; echo; done; echo "--- alias /api/brain/<id>/stages"; curl -s -w ' HTTP %{http_code}\n' localhost:5399/api/brain/$P/stages | head -c 300; echo; psql -h localhost -U cecelia -d cecelia_scratch -Atc "delete from tasks where id='$P' returning 'deleted'"
```

```output
pipeline=42557d50-6c3b-4ced-9600-8705ac376b02
--- /api/brain/pipelines/<id>/stats
{"pipeline_id":"42557d50-6c3b-4ced-9600-8705ac376b02","stats":[]} HTTP 200

--- /api/brain/pipelines/<id>/stages
{"pipeline_id":"42557d50-6c3b-4ced-9600-8705ac376b02","stages":{}} HTTP 200

--- /api/brain/pipelines/<id>/publish-status
{"pipeline_id":"42557d50-6c3b-4ced-9600-8705ac376b02","platforms":[]} HTTP 200

--- alias /api/brain/<id>/stages
{"pipeline_id":"42557d50-6c3b-4ced-9600-8705ac376b02","stages":{}} HTTP 200

deleted
DELETE 1
```

### E-5
对应: I-4
verdict: PASS

```command
curl -s -w '\nHTTP %{http_code}\n' localhost:5399/api/brain/content-types; curl -s -w '\nHTTP %{http_code}\n' localhost:5399/api/brain/pipelines | head -c 300; echo
```

```output
["ai-tools-review","ai-workflow-guide","data-analysis","long-form","promo-copy","short-form","solo-company-case","video-script"]
HTTP 200
[]
HTTP 200
```

### E-6
对应: I-5
verdict: PASS

```command
R=coding-workflow:79fd1dac-bc8c-419d-bd8d-f0e404c5f4f9; curl -s -H 'X-Internal-Token: verify-tok-142c' -o /tmp/verify-142c9ad0/r1.json -w 'run HTTP %{http_code}\n' "localhost:5399/api/brain/runs/$R"; jq -c '{run_id, has_spans: has("spans")}' /tmp/verify-142c9ad0/r1.json; curl -s -H 'X-Internal-Token: verify-tok-142c' -o /tmp/verify-142c9ad0/r2.json -w 'spans HTTP %{http_code}\n' "localhost:5399/api/brain/runs/$R?include=spans"; jq -c '{run_id, spans_is_array: (.spans|type=="array"), spans_count: (.spans|length)}' /tmp/verify-142c9ad0/r2.json; psql -h localhost -U cecelia -d cecelia_scratch -Atc "select count(*) from spans where run_id='$R'"
```

```output
run HTTP 200
{"run_id":"coding-workflow:79fd1dac-bc8c-419d-bd8d-f0e404c5f4f9","has_spans":false}
spans HTTP 200
{"run_id":"coding-workflow:79fd1dac-bc8c-419d-bd8d-f0e404c5f4f9","spans_is_array":true,"spans_count":2}
2
```
