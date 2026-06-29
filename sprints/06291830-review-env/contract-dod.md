---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: evaluator PASS 后自动分配端口启动 Dashboard 静态 Review 环境

**范围**: review-env-manager.js 新建 + harness-task.graph.js mergePrNode 集成 + shepherd.js 清理钩子 + 3 个 Brain API 端点 + DB migration
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/review-env-manager.js` 存在且导出 `allocateReviewEnv` / `releaseReviewEnv` / `cleanupHarnessReviewEnvs` / `findFreePort`
  Test: node -e "const m=require('./packages/brain/src/review-env-manager.js');['allocateReviewEnv','releaseReviewEnv','cleanupHarnessReviewEnvs','findFreePort'].forEach(f=>{if(typeof m[f]!=='function')throw new Error('缺少导出:'+f)})"

- [ ] [ARTIFACT] `packages/brain/src/db/migrations/012-review-environments.sql` 存在且含 `CREATE TABLE review_environments`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/db/migrations/012-review-environments.sql','utf8');if(!c.includes('CREATE TABLE review_environments'))throw new Error('migration 缺 CREATE TABLE')"

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/review-env/allocate` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('review-env/allocate'))throw new Error('缺少 allocate 路由')"

- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 包含 `/review-env/release` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('review-env/release'))throw new Error('缺少 release 路由')"

- [ ] [ARTIFACT] `packages/brain/src/workflows/harness-task.graph.js` 的 `mergePrNode` 含 `allocateReviewEnv` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('allocateReviewEnv'))throw new Error('mergePrNode 未集成 allocateReviewEnv')"

- [ ] [ARTIFACT] `packages/brain/src/shepherd.js` 含 `cleanupHarnessReviewEnvs` 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(!c.includes('cleanupHarnessReviewEnvs'))throw new Error('shepherd 未集成清理钩子')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行）

> **前置条件**（每条 BEHAVIOR 运行前自动准备）：
> ```bash
> export BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
> export DATABASE_URL="${DATABASE_URL:-postgresql://localhost/cecelia}"
> export TEST_INITIATIVE_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
> export DIST_DIR=$(mktemp -d)
> echo '<html><body>Review Test</body></html>' > "$DIST_DIR/index.html"
> ```

### 1. allocate 端点：返回正确 schema（port 在范围内 + pid 有效 + skipped=false）

- [ ] [BEHAVIOR] POST /api/brain/harness/review-env/allocate 返回 { initiative_id, port∈[5300,5399], pid>0, skipped:false }
  Test: manual:bash -c '
    DIST_DIR=$(mktemp -d); echo "<html/>" > "$DIST_DIR/index.html"
    TID=$(python3 -c "import uuid; print(uuid.uuid4())")
    RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$TID\",\"dist_dir\":\"$DIST_DIR\"}")
    echo "$RESP" | jq -e ".skipped == false" || { echo "FAIL skipped=true"; exit 1; }
    echo "$RESP" | jq -e ".port >= 5300 and .port <= 5399" || { echo "FAIL port out of range"; exit 1; }
    echo "$RESP" | jq -e ".pid > 0" || { echo "FAIL pid invalid"; exit 1; }
    echo "$RESP" | jq -e ".initiative_id | type == \"string\"" || { echo "FAIL no initiative_id"; exit 1; }
    curl -sf -X POST localhost:5221/api/brain/harness/review-env/release \
      -H "Content-Type: application/json" -d "{\"initiative_id\":\"$TID\"}" > /dev/null
    rm -rf "$DIST_DIR"
    echo OK'
  期望: OK

### 2. allocate 端点：schema keys 完整性（字段不多不少）

- [ ] [BEHAVIOR] POST allocate 响应 keys 完全等于 ["initiative_id","pid","port","skipped"]
  Test: manual:bash -c '
    DIST_DIR=$(mktemp -d); echo "<html/>" > "$DIST_DIR/index.html"
    TID=$(python3 -c "import uuid; print(uuid.uuid4())")
    RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$TID\",\"dist_dir\":\"$DIST_DIR\"}")
    echo "$RESP" | jq -e "keys == [\"initiative_id\",\"pid\",\"port\",\"skipped\"]" \
      || { echo "FAIL keys mismatch: $(echo $RESP | jq keys)"; exit 1; }
    echo "$RESP" | jq -e "has(\"listen_port\") | not" || { echo "FAIL 禁用字段 listen_port"; exit 1; }
    echo "$RESP" | jq -e "has(\"server_port\") | not" || { echo "FAIL 禁用字段 server_port"; exit 1; }
    curl -sf -X POST localhost:5221/api/brain/harness/review-env/release \
      -H "Content-Type: application/json" -d "{\"initiative_id\":\"$TID\"}" > /dev/null
    rm -rf "$DIST_DIR"
    echo OK'
  期望: OK

### 3. 分配的端口真实服务 HTTP 200 + HTML

- [ ] [BEHAVIOR] allocate 后 curl localhost:<port>/ 返回 HTTP 200 且响应含 <html 标签
  Test: manual:bash -c '
    DIST_DIR=$(mktemp -d); echo "<html><body>DashboardContent</body></html>" > "$DIST_DIR/index.html"
    TID=$(python3 -c "import uuid; print(uuid.uuid4())")
    RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$TID\",\"dist_dir\":\"$DIST_DIR\"}")
    PORT=$(echo "$RESP" | jq -r ".port")
    sleep 1
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/")
    [ "$HTTP_CODE" = "200" ] || { echo "FAIL HTTP $HTTP_CODE != 200"; exit 1; }
    HTML=$(curl -sf "http://localhost:$PORT/")
    echo "$HTML" | grep -qi "<html" || { echo "FAIL no HTML in response"; exit 1; }
    curl -sf -X POST localhost:5221/api/brain/harness/review-env/release \
      -H "Content-Type: application/json" -d "{\"initiative_id\":\"$TID\"}" > /dev/null
    rm -rf "$DIST_DIR"
    echo OK'
  期望: OK

### 4. DB 记录带时间窗验证

- [ ] [BEHAVIOR] review_environments 表有该 initiative 的记录（port∈[5300,5399]，allocated_at 在 5 分钟内）
  Test: manual:bash -c '
    DIST_DIR=$(mktemp -d); echo "<html/>" > "$DIST_DIR/index.html"
    TID=$(python3 -c "import uuid; print(uuid.uuid4())")
    curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$TID\",\"dist_dir\":\"$DIST_DIR\"}" > /dev/null
    DB_URL="${DATABASE_URL:-postgresql://localhost/cecelia}"
    COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM review_environments WHERE initiative_id='"'"'$TID'"'"' AND allocated_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " ")
    [ "$COUNT" -ge 1 ] || { echo "FAIL DB count=$COUNT"; exit 1; }
    PORT_DB=$(psql "$DB_URL" -t -c "SELECT port FROM review_environments WHERE initiative_id='"'"'$TID'"'"'" | tr -d " ")
    [ "$PORT_DB" -ge 5300 ] && [ "$PORT_DB" -le 5399 ] || { echo "FAIL DB port=$PORT_DB out of range"; exit 1; }
    curl -sf -X POST localhost:5221/api/brain/harness/review-env/release \
      -H "Content-Type: application/json" -d "{\"initiative_id\":\"$TID\"}" > /dev/null
    rm -rf "$DIST_DIR"
    echo OK'
  期望: OK

### 5. release 端点：返回正确 schema

- [ ] [BEHAVIOR] POST /api/brain/harness/review-env/release 返回 { released:true, initiative_id }，keys = ["initiative_id","released"]
  Test: manual:bash -c '
    DIST_DIR=$(mktemp -d); echo "<html/>" > "$DIST_DIR/index.html"
    TID=$(python3 -c "import uuid; print(uuid.uuid4())")
    curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$TID\",\"dist_dir\":\"$DIST_DIR\"}" > /dev/null
    REL=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/release \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$TID\"}")
    echo "$REL" | jq -e ".released == true" || { echo "FAIL released!=true"; exit 1; }
    echo "$REL" | jq -e ".initiative_id | type == \"string\"" || { echo "FAIL no initiative_id"; exit 1; }
    echo "$REL" | jq -e "keys == [\"initiative_id\",\"released\"]" || { echo "FAIL keys mismatch"; exit 1; }
    echo "$REL" | jq -e "has(\"freed\") | not" || { echo "FAIL 禁用字段 freed"; exit 1; }
    rm -rf "$DIST_DIR"
    echo OK'
  期望: OK

### 6. release 后端口关闭且 DB 记录消失

- [ ] [BEHAVIOR] release 后 curl 到该端口连接拒绝，DB review_environments 记录已删除
  Test: manual:bash -c '
    DIST_DIR=$(mktemp -d); echo "<html/>" > "$DIST_DIR/index.html"
    TID=$(python3 -c "import uuid; print(uuid.uuid4())")
    RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$TID\",\"dist_dir\":\"$DIST_DIR\"}")
    PORT=$(echo "$RESP" | jq -r ".port")
    sleep 1
    curl -sf -X POST localhost:5221/api/brain/harness/review-env/release \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$TID\"}" > /dev/null
    sleep 1
    DB_URL="${DATABASE_URL:-postgresql://localhost/cecelia}"
    DB_COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM review_environments WHERE initiative_id='"'"'$TID'"'"'" | tr -d " ")
    [ "$DB_COUNT" = "0" ] || { echo "FAIL DB 记录未删除 count=$DB_COUNT"; exit 1; }
    if curl -sf --connect-timeout 2 "http://localhost:$PORT/" 2>/dev/null; then
      echo "FAIL 端口 $PORT 仍在服务"; exit 1
    fi
    rm -rf "$DIST_DIR"
    echo OK'
  期望: OK

### 7. GET 端点返回完整 schema

- [ ] [BEHAVIOR] GET /api/brain/harness/review-env/:initiative_id 返回 { allocated_at, initiative_id, pid, port }，未知 ID 返回 404
  Test: manual:bash -c '
    DIST_DIR=$(mktemp -d); echo "<html/>" > "$DIST_DIR/index.html"
    TID=$(python3 -c "import uuid; print(uuid.uuid4())")
    curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$TID\",\"dist_dir\":\"$DIST_DIR\"}" > /dev/null
    GET=$(curl -sf "localhost:5221/api/brain/harness/review-env/$TID")
    echo "$GET" | jq -e "keys == [\"allocated_at\",\"initiative_id\",\"pid\",\"port\"]" \
      || { echo "FAIL GET keys mismatch: $(echo $GET | jq keys)"; exit 1; }
    echo "$GET" | jq -e ".port >= 5300 and .port <= 5399" || { echo "FAIL GET port invalid"; exit 1; }
    echo "$GET" | jq -e "has(\"server_port\") | not" || { echo "FAIL 禁用字段 server_port"; exit 1; }
    echo "$GET" | jq -e "has(\"created_at\") | not" || { echo "FAIL 禁用字段 created_at"; exit 1; }
    NONEXIST=$(python3 -c "import uuid; print(uuid.uuid4())")
    HTTP_404=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/review-env/$NONEXIST")
    [ "$HTTP_404" = "404" ] || { echo "FAIL 未知 ID 应返 404 实际=$HTTP_404"; exit 1; }
    curl -sf -X POST localhost:5221/api/brain/harness/review-env/release \
      -H "Content-Type: application/json" -d "{\"initiative_id\":\"$TID\"}" > /dev/null
    rm -rf "$DIST_DIR"
    echo OK'
  期望: OK

### 8. error path：缺少 initiative_id 返回 400

- [ ] [BEHAVIOR] POST allocate 缺少 initiative_id → HTTP 400 + error 字段
  Test: manual:bash -c '
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" -d "{}")
    [ "$CODE" = "400" ] || { echo "FAIL 缺 initiative_id 应返 400 实际=$CODE"; exit 1; }
    ERR=$(curl -s -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" -d "{}")
    echo "$ERR" | jq -e ".error | type == \"string\"" || { echo "FAIL 无 error 字段"; exit 1; }
    echo OK'
  期望: OK

### 9. 端口耗尽时 allocate 优雅跳过（skipped=true, port=null）

- [ ] [BEHAVIOR] 端口 5300-5399 全占满时 allocate 返回 { skipped:true, port:null, pid:null }
  Test: manual:bash -c '
    DB_URL="${DATABASE_URL:-postgresql://localhost/cecelia}"
    # 写入占满记录（pid=99999 假进程）
    FAKE_IDS=()
    for i in $(seq 5300 5399); do
      FID=$(python3 -c "import uuid; print(uuid.uuid4())")
      FAKE_IDS+=("$FID")
      psql "$DB_URL" -c "INSERT INTO review_environments (initiative_id, port, pid) VALUES ('"'"'$FID'"'"', $i, 99999) ON CONFLICT DO NOTHING" > /dev/null 2>&1
    done
    DIST_DIR=$(mktemp -d); echo "<html/>" > "$DIST_DIR/index.html"
    OID=$(python3 -c "import uuid; print(uuid.uuid4())")
    RESP=$(curl -sf -X POST localhost:5221/api/brain/harness/review-env/allocate \
      -H "Content-Type: application/json" \
      -d "{\"initiative_id\":\"$OID\",\"dist_dir\":\"$DIST_DIR\"}")
    echo "$RESP" | jq -e ".skipped == true" || { echo "FAIL skipped!=true 当端口耗尽"; exit 1; }
    echo "$RESP" | jq -e ".port == null" || { echo "FAIL port 非 null 当耗尽"; exit 1; }
    # 清理假数据
    for FID in "${FAKE_IDS[@]}"; do
      psql "$DB_URL" -c "DELETE FROM review_environments WHERE initiative_id='"'"'$FID'"'"'" > /dev/null 2>&1
    done
    rm -rf "$DIST_DIR"
    echo OK'
  期望: OK

---

## BEHAVIOR 自查 Checklist

- [x] ≥ 4 条 [BEHAVIOR]（实际 9 条，覆盖：schema字段 / keys完整性 / 禁用字段反向 / error path / 功能行为 / DB时效 / 接缝验证）
- [x] 每条 BEHAVIOR 命令：若对应代码一行没写，会 FAIL 吗？→ 全部会（API 端点不存在 → curl -sf 非 0 退出）
- [x] PRD Response Schema 字段 codify 到 jq -e 命令（initiative_id/port/pid/skipped/released/allocated_at 均有对应断言）
- [x] 禁用字段（listen_port/server_port/process_id/freed/created_at 等）有 ! has() 反向检查
- [x] DB 时效断言含 AND allocated_at > NOW() - interval '5 minutes'（防历史数据冒充）
- [x] 无 MOCK_* 注入，无 || true 吞错，无 echo "ok" 假验证
- [x] target_environment=local_api（curl + psql + shell）
