# Contract Draft: relay-runs 过滤与详情

**Sprint**: 07041800-relay-runs-filter
**Task ID**: c66bbedc-5804-4d53-9eb9-4385d0b8d325
**版本**: v1（Proposer 首轮草稿）
**日期**: 2026-07-04

---

## BEHAVIOR 断言列表

### GP-1：按 phase 过滤列表

[BEHAVIOR] GET /relay-runs?phase=A_planning → HTTP 200 JSON 数组，每条记录 phase == "A_planning" 且 orchestrator_version == "v2"

[BEHAVIOR] GET /relay-runs?phase=done → HTTP 200 JSON 数组，每条记录 phase == "done"

[BEHAVIOR] GET /relay-runs?phase=A_planning&limit=5 → HTTP 200 JSON 数组，长度 ≤ 5，每条 phase == "A_planning"

[BEHAVIOR] SQL 含 ?phase= 时查询语句必须含 WHERE phase=$N 条件（不含 phase 过滤时 SQL 不含 phase 条件）

### GP-2：查单条 run 详情

[BEHAVIOR] GET /relay-runs/:initiative_id（存在）→ HTTP 200 JSON 对象，含 failure_reason / completed_at / orchestrator_version / orchestrator_pid / round / evaluate_verdict / judge_verdict 全量字段

[BEHAVIOR] GET /relay-runs/:initiative_id 响应字段必须包含：id, initiative_id, phase, started_at, deadline_at, completed_at, failure_reason, orchestrator_version, orchestrator_heartbeat_at, orchestrator_host, orchestrator_pid, pr_url, round, evaluate_verdict, judge_verdict

### GP-3：查不存在的 initiative_id

[BEHAVIOR] GET /relay-runs/nonexistent-id → HTTP 404 + { "error": "not found" }，body 中不包含 SQL 错误信息或表名

### 错误场景

[BEHAVIOR] GET /relay-runs?phase=invalid_phase → HTTP 400 + { "error": "...", "allowed": ["A_planning", "A_contract", "B_task_loop", "C_final_e2e", "done", "failed", "planning", "gan", "generate", "evaluate"] }

[BEHAVIOR] GET /relay-runs?phase= （空字符串）→ HTTP 400 + { "error": "...", "allowed": [...] }

[BEHAVIOR] GET /relay-runs?phase=SQL_INJECTION → HTTP 400（拒绝非枚举值，不执行 SQL）

[BEHAVIOR] DB 连接失败时 GET /relay-runs → HTTP 500 + { "error": "..." }（JSON body，非 HTML）

[BEHAVIOR] DB 连接失败时 GET /relay-runs/:initiative_id → HTTP 500 + { "error": "..." }（JSON body，进程不崩溃）

### INV-5 向后兼容

[BEHAVIOR] GET /relay-runs（不带 ?phase）→ HTTP 200 JSON 数组，返回全部 v2 runs（行为与原有一致）

[BEHAVIOR] GET /relay-runs?limit=10（不带 ?phase）→ HTTP 200 JSON 数组，最多 10 条，SQL 不含 phase 过滤条件

[BEHAVIOR] GET /relay-runs（不带任何参数）默认 limit=20，SQL 参数含 20

---

## ARTIFACT 验收命令列表

[ARTIFACT] curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs?phase=A_planning" | python3 -c "import sys,json; runs=json.load(sys.stdin); assert isinstance(runs, list), 'not array'; assert all(r['phase']=='A_planning' for r in runs), 'phase filter failed'; print('GP-1 OK')"

[ARTIFACT] curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs?phase=invalid_phase" -o /tmp/resp.json -w "%{http_code}" | grep -q "^400$" && python3 -c "import json; r=json.load(open('/tmp/resp.json')); assert 'error' in r; assert 'allowed' in r; assert 'A_planning' in r['allowed']; print('GP-1-error OK')"

[ARTIFACT] INIT_ID=$(curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs?limit=1" | python3 -c "import sys,json; runs=json.load(sys.stdin); print(runs[0]['initiative_id']) if runs else exit(1)") && curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs/${INIT_ID}" | python3 -c "import sys,json; r=json.load(sys.stdin); [r[k] for k in ['id','initiative_id','phase','started_at','failure_reason','completed_at','orchestrator_version','orchestrator_pid','round','evaluate_verdict','judge_verdict']]; print('GP-2 OK')"

[ARTIFACT] curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000" -o /tmp/resp404.json -w "%{http_code}" | grep -q "^404$" && python3 -c "import json; r=json.load(open('/tmp/resp404.json')); assert r.get('error')=='not found'; assert 'sql' not in str(r).lower(); assert 'table' not in str(r).lower(); print('GP-3 OK')"

[ARTIFACT] curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs" | python3 -c "import sys,json; runs=json.load(sys.stdin); assert isinstance(runs, list); print(f'backward-compat OK, {len(runs)} runs')"

[ARTIFACT] curl -I -s "http://localhost:5221/api/brain/orchestrator/relay-runs?phase=A_planning" | grep -i "content-type" | grep -q "application/json" && echo "Content-Type OK"

[ARTIFACT] curl -I -s "http://localhost:5221/api/brain/orchestrator/relay-runs/nonexistent" | grep -i "content-type" | grep -q "application/json" && echo "Content-Type 404 OK"

---

## NFR 非功能性需求约束

[NFR] 响应时间：所有端点 P99 < 500ms（本地 PostgreSQL，正常负载）

[NFR] 错误不泄露：4xx/5xx 响应 body 不含 stack trace、SQL 语句、表名、列名

[NFR] Content-Type：所有响应（200/400/404/500）必须含 Content-Type: application/json header

[NFR] 只读约束：两个端点实现代码中不含 INSERT、UPDATE、DELETE 关键字（grep 可验证）

[NFR] 进程稳定性：DB 失败不导致 Node.js 进程崩溃（unhandled rejection），后续请求仍可响应

[NFR] 枚举白名单同步：ALLOWED_PHASES 数组必须与 migration 312 的 CHECK 约束值集合完全一致，不允许运行时分叉

---

## 场景覆盖矩阵

| 场景 | BEHAVIOR 断言 | ARTIFACT 命令 |
|------|-------------|--------------|
| GP-1 phase 过滤 | 4 条 | 2 条 |
| GP-2 详情存在 | 2 条 | 1 条 |
| GP-3 详情不存在 | 1 条 | 1 条 |
| 无效 phase 400 | 3 条 | 1 条 |
| DB 失败 500 | 2 条 | 0（单测覆盖） |
| INV-5 向后兼容 | 3 条 | 2 条 |
| Content-Type NFR | 0（NFR） | 2 条 |
| **合计** | **15 条** | **9 条** |
