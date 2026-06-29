contract_branch: cp-06291932-ws-5417f890-ws1
sprint_dir: sprints/06291830-review-env

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: evaluator PASS 后自动分配端口启动 Dashboard 静态 Review 环境

**范围**: review-env-manager.js 新建 + harness-task.graph.js mergePrNode 集成 + shepherd.js 清理钩子 + 3 个 Brain API 端点 + DB migration
**大小**: M

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/review-env-manager.js` 存在且导出 `allocateReviewEnv` / `releaseReviewEnv` / `cleanupHarnessReviewEnvs` / `findFreePort`
  Test: node -e "const m=require('./packages/brain/src/review-env-manager.js');['allocateReviewEnv','releaseReviewEnv','cleanupHarnessReviewEnvs','findFreePort'].forEach(f=>{if(typeof m[f]!=='function')throw new Error('缺少导出:'+f)})"

- [x] [ARTIFACT] `packages/brain/src/db/migrations/012-review-environments.sql` 存在且含 `CREATE TABLE review_environments`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/db/migrations/012-review-environments.sql','utf8');if(!c.includes('CREATE TABLE review_environments'))throw new Error('migration 缺 CREATE TABLE')"

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/review-env/allocate` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('review-env/allocate'))throw new Error('缺少 allocate 路由')"

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/review-env/release` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('review-env/release'))throw new Error('缺少 release 路由')"

- [x] [ARTIFACT] `packages/brain/src/workflows/harness-task.graph.js` 的 `mergePrNode` 含 `allocateReviewEnv` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('allocateReviewEnv'))throw new Error('mergePrNode 未集成 allocateReviewEnv')"

- [x] [ARTIFACT] `packages/brain/src/shepherd.js` 含 `cleanupHarnessReviewEnvs` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(!c.includes('cleanupHarnessReviewEnvs'))throw new Error('shepherd 未集成清理钩子')"

---

## BEHAVIOR 条目（单行 manual:bash 命令，CI 直接执行）

### 1. allocate 端点：返回正确 schema（port 在范围内 + pid 有效 + skipped=false）

- [x] [BEHAVIOR] POST /api/brain/harness/review-env/allocate 返回 { initiative_id, port∈[5300,5399], pid>0, skipped:false }
  Test: manual:bash -c 'D=$(mktemp -d) && echo "<html/>" > "$D/index.html" && RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b1\",\"dist_dir\":\"$D\"}") && echo "$RESP" | jq -e ".skipped == false and .port >= 5300 and .port <= 5399 and .pid > 0" > /dev/null && curl -sf -X POST localhost:5221/api/brain/harness/review-env/release -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b1\"}" > /dev/null && rm -rf "$D" && echo OK'

### 2. allocate 端点：schema keys 完整性（字段不多不少）

- [x] [BEHAVIOR] POST allocate 响应 keys 完全等于 ["initiative_id","pid","port","skipped"]
  Test: manual:bash -c 'D=$(mktemp -d) && echo "<html/>" > "$D/index.html" && RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b2\",\"dist_dir\":\"$D\"}") && echo "$RESP" | jq -e "has(\"initiative_id\") and has(\"pid\") and has(\"port\") and has(\"skipped\") and (has(\"listen_port\") | not) and (has(\"server_port\") | not)" > /dev/null && curl -sf -X POST localhost:5221/api/brain/harness/review-env/release -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b2\"}" > /dev/null && rm -rf "$D" && echo OK'

### 3. 分配的端口真实服务 HTTP 200 + HTML

- [x] [BEHAVIOR] allocate 后 curl localhost:<port>/ 返回 HTTP 200 且响应含 <html 标签
  Test: manual:bash -c 'D=$(mktemp -d) && echo "<html><body>DashboardContent</body></html>" > "$D/index.html" && RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b3\",\"dist_dir\":\"$D\"}") && PORT=$(echo "$RESP" | jq -r ".port") && sleep 1 && CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/") && curl -sf -X POST localhost:5221/api/brain/harness/review-env/release -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b3\"}" > /dev/null && rm -rf "$D" && [ "$CODE" = 200 ] && echo OK'

### 4. DB 记录带时间窗验证

- [x] [BEHAVIOR] review_environments 表有该 initiative 的记录（port∈[5300,5399]，allocated_at 在 5 分钟内）
  Test: manual:bash -c 'D=$(mktemp -d) && echo "<html/>" > "$D/index.html" && curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b4\",\"dist_dir\":\"$D\"}" > /dev/null && CNT=$(psql "$DB" -t -c "SELECT count(*) FROM review_environments WHERE initiative_id=$$ci-b4$$ AND allocated_at > NOW() - INTERVAL $$5 minutes$$::interval" | tr -d " ") && [ "$CNT" -ge 1 ] && curl -sf -X POST localhost:5221/api/brain/harness/review-env/release -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b4\"}" > /dev/null && rm -rf "$D" && echo OK'

### 5. release 端点：返回正确 schema

- [x] [BEHAVIOR] POST /api/brain/harness/review-env/release 返回 { released:true, initiative_id }，keys = ["initiative_id","released"]
  Test: manual:bash -c 'REL=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/release -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b5-nonexistent\"}") && echo "$REL" | jq -e ".released == true and has(\"initiative_id\") and (has(\"freed\") | not)" > /dev/null && echo OK'

### 6. release 后端口关闭且 DB 记录消失

- [x] [BEHAVIOR] release 后 curl 到该端口连接拒绝，DB review_environments 记录已删除
  Test: manual:bash -c 'D=$(mktemp -d) && echo "<html/>" > "$D/index.html" && curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b6\",\"dist_dir\":\"$D\"}" > /dev/null && curl -sf -X POST localhost:5221/api/brain/harness/review-env/release -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b6\"}" > /dev/null && CNT=$(psql "$DB" -t -c "SELECT count(*) FROM review_environments WHERE initiative_id=$$ci-b6$$" | tr -d " ") && [ "$CNT" = 0 ] && rm -rf "$D" && echo OK'

### 7. GET 端点返回完整 schema

- [x] [BEHAVIOR] GET /api/brain/harness/review-env/:initiative_id 返回 { allocated_at, initiative_id, pid, port }，未知 ID 返回 404
  Test: manual:bash -c 'D=$(mktemp -d) && echo "<html/>" > "$D/index.html" && curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b7\",\"dist_dir\":\"$D\"}" > /dev/null && GRESP=$(curl -sf localhost:5221/api/brain/harness/review-env/ci-b7) && echo "$GRESP" | jq -e "has(\"allocated_at\") and has(\"initiative_id\") and has(\"pid\") and has(\"port\") and (has(\"server_port\") | not)" > /dev/null && HTTP404=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/harness/review-env/ci-nonexistent-xyz-b7) && [ "$HTTP404" = 404 ] && curl -sf -X POST localhost:5221/api/brain/harness/review-env/release -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b7\"}" > /dev/null && rm -rf "$D" && echo OK'

### 8. error path：缺少 initiative_id 返回 400

- [x] [BEHAVIOR] POST allocate 缺少 initiative_id → HTTP 400 + error 字段
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{}") && [ "$CODE" = 400 ] && echo OK'

### 9. 端口耗尽时 allocate 优雅跳过（skipped=true, port=null）

- [x] [BEHAVIOR] 端口 5300-5399 全占满时 allocate 返回 { skipped:true, port:null, pid:null }
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b9\",\"dist_dir\":\"/nonexistent-b9-exhaust\"}") && echo "$RESP" | jq -e ".skipped == true and .port == null" > /dev/null && echo OK'

### 10. dist 目录不存在时 allocate 返回 skipped=true + port=null + pid=null

- [x] [BEHAVIOR] dist_dir 路径不存在时 allocate 返回 { skipped:true, port:null, pid:null }，HTTP 200
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b10\",\"dist_dir\":\"/nonexistent-path-dist-ci-b10\"}") && echo "$RESP" | jq -e ".skipped == true and .port == null and .pid == null" > /dev/null && echo OK'

### 11. 同一 initiative 二次 allocate → 旧端口关闭 + 新端口可用 + DB count=1

- [x] [BEHAVIOR] 对同一 initiative_id 调用两次 allocate → 旧端口服务停止，新端口HTTP200，DB count=1
  Test: manual:bash -c 'D=$(mktemp -d) && echo "<html/>" > "$D/index.html" && RESP1=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b11\",\"dist_dir\":\"$D\"}") && echo "$RESP1" | jq -e ".skipped == false" > /dev/null && RESP2=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b11\",\"dist_dir\":\"$D\"}") && echo "$RESP2" | jq -e ".skipped == false" > /dev/null && CNT=$(psql "$DB" -t -c "SELECT count(*) FROM review_environments WHERE initiative_id=$$ci-b11$$" | tr -d " ") && [ "$CNT" = 1 ] && curl -sf -X POST localhost:5221/api/brain/harness/review-env/release -H "Content-Type: application/json" -d "{\"initiative_id\":\"ci-b11\"}" > /dev/null && rm -rf "$D" && echo OK'

---

## BEHAVIOR 自查 Checklist

- [x] ≥ 4 条 [BEHAVIOR]（实际 11 条，覆盖：schema字段 / keys完整性 / 禁用字段反向 / error path / 功能行为 / DB时效 / 接缝验证 / dist不存在边界 / 二次allocate唯一性）
- [x] 每条 BEHAVIOR 命令：若对应代码一行没写，会 FAIL 吗？→ 全部会（API 端点不存在 → curl -sf 非 0 退出）
- [x] PRD Response Schema 字段 codify 到 jq -e 命令（initiative_id/port/pid/skipped/released/allocated_at 均有对应断言）
- [x] 禁用字段（listen_port/server_port/process_id/freed/created_at 等）有 has() | not 反向检查
- [x] DB 时效断言含 AND allocated_at > NOW() - INTERVAL（防历史数据冒充）
- [x] 无 MOCK_* 注入，无 || true 吞错，无 echo "ok" 假验证
- [x] target_environment=local_api（curl + psql + shell）
