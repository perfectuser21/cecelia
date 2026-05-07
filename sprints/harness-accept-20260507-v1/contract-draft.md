# Sprint Contract Draft (Round 1)

## Golden Path

[Brain 进程已启动 :5221] → [运维 / 自检脚本发起 GET /api/brain/harness/health] → [Express 路由命中 harness-health.js 处理函数] → [读 LangGraph 包元数据 + 查 last_attempt_at（可降级）] → [返回 HTTP 200 + JSON {langgraph_version, last_attempt_at, healthy:true}]

---

### Step 1: Brain 启动后路由文件存在并被 server.js 注册

**可观测行为**: `packages/brain/src/routes/harness-health.js` 文件存在并 export Express Router；`packages/brain/server.js` 中能找到对该路由的 import 语句和挂载语句，挂载前缀必须是 `/api/brain/harness`（不能新建顶层前缀）。

**验证命令**:
```bash
# 1.1 路由文件存在且导出 Router
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/harness-health.js', 'utf8');
if (!/export\s+default\s+router|export\s*{\s*router\s+as\s+default\s*}/.test(src)) {
  console.error('FAIL: harness-health.js missing default export of Router');
  process.exit(1);
}
if (!/router\.get\(['\"]\/health['\"]/.test(src)) {
  console.error('FAIL: harness-health.js missing GET /health handler');
  process.exit(1);
}
console.log('OK: harness-health.js shape correct');
"

# 1.2 server.js 已 import 并挂载
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/server.js', 'utf8');
if (!/from\s+['\"]\.\/src\/routes\/harness-health\.js['\"]/.test(src)) {
  console.error('FAIL: server.js missing import of harness-health.js');
  process.exit(1);
}
if (!/app\.use\(['\"]\/api\/brain\/harness['\"]\s*,\s*\w+/.test(src)) {
  console.error('FAIL: server.js missing app.use mount on /api/brain/harness');
  process.exit(1);
}
console.log('OK: server.js wires harness-health route');
"
```

**硬阈值**: 两条命令均 exit 0；任何一条 exit 非 0 即视为 Step 1 不通过。

---

### Step 2: GET /api/brain/harness/health 在真实 Brain 进程上返回 200 + 完整 JSON 三字段

**可观测行为**: 真实启动 Brain（`node packages/brain/server.js`），等端口 5221 LISTEN 后，`curl localhost:5221/api/brain/harness/health` 返回 HTTP 200，`Content-Type` 含 `application/json`，body 解析后必须同时含三个 key：`langgraph_version`（字符串）、`last_attempt_at`（字符串或 null）、`healthy`（=== true）。

**验证命令**:
```bash
# 在真实 Brain 进程已起的前提下（E2E 脚本会负责拉起，独跑该步骤前请先启动 Brain）
HTTP_CODE=$(curl -s -o /tmp/health-body.json -w "%{http_code}" \
  --max-time 5 \
  -H "Accept: application/json" \
  http://localhost:5221/api/brain/harness/health)

[ "$HTTP_CODE" = "200" ] || { echo "FAIL: expected 200, got $HTTP_CODE"; cat /tmp/health-body.json; exit 1; }

# 三字段全在
node -e "
const body = JSON.parse(require('fs').readFileSync('/tmp/health-body.json', 'utf8'));
const missing = ['langgraph_version', 'last_attempt_at', 'healthy'].filter(k => !(k in body));
if (missing.length) { console.error('FAIL: missing keys', missing, 'body=', body); process.exit(1); }
if (typeof body.langgraph_version !== 'string') { console.error('FAIL: langgraph_version not string, got', typeof body.langgraph_version); process.exit(1); }
if (body.last_attempt_at !== null && typeof body.last_attempt_at !== 'string') { console.error('FAIL: last_attempt_at not null|string, got', typeof body.last_attempt_at); process.exit(1); }
if (body.healthy !== true) { console.error('FAIL: healthy !== true, got', body.healthy); process.exit(1); }
console.log('OK: body shape =', JSON.stringify(body));
"
```

**硬阈值**: HTTP 200 + 三字段全在 + 类型校验通过；任何一项失败即 Step 2 不通过。`--max-time 5` 防止 Brain 假死时无限挂起。

---

### Step 3: 边界 — LangGraph 元数据读取失败时降级 `"unknown"`，端点仍返回 200 + healthy:true

**可观测行为**: 即使 `@langchain/langgraph` 包元数据读不到（被删 / 被 mock 抛错），health 端点也必须返回 200 且 `healthy === true`，仅 `langgraph_version` 字段返回字符串 `"unknown"`。这是 PRD 明确的强制要求（health endpoint 不能因为版本探测失败就 503，否则会污染 Brain 整体健康信号）。

**验证命令**:
```bash
# 单元测试覆盖此降级路径（vitest，mock 掉 langgraph 元数据读取）
cd packages/brain && npx vitest run \
  ../../sprints/harness-accept-20260507-v1/tests/ws1/harness-health.test.ts \
  --reporter=verbose 2>&1 | tee /tmp/ws1-green.log

# 必须看到"version unknown fallback"那个 it 块 PASS
grep -E "✓.*falls back to .*unknown.*when langgraph.*unreadable" /tmp/ws1-green.log \
  || { echo "FAIL: fallback test not found in PASS list"; exit 1; }

# 整体没有 FAIL
grep -E "Tests.*[0-9]+ failed" /tmp/ws1-green.log \
  && { echo "FAIL: vitest reported failures"; exit 1; }
echo "OK: ws1 vitest all green incl. fallback path"
```

**硬阈值**: vitest 退出码 0 且 grep 命中 fallback 用例 PASS 行；不允许出现 `Tests N failed`。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ===== 阶段 0：依赖 =====
[ -d packages/brain/node_modules ] || (cd packages/brain && npm install --no-audit --no-fund --silent)

# ===== 阶段 1：合同 Step 1 — 静态产出物 =====
echo "[E2E] Step 1: ARTIFACT shape check"
node -e "
const fs = require('fs');
const route = fs.readFileSync('packages/brain/src/routes/harness-health.js', 'utf8');
if (!/export\s+default\s+router|export\s*{\s*router\s+as\s+default\s*}/.test(route)) { console.error('FAIL route default export'); process.exit(1); }
if (!/router\.get\(['\"]\/health['\"]/.test(route)) { console.error('FAIL route GET /health'); process.exit(1); }
const server = fs.readFileSync('packages/brain/server.js', 'utf8');
if (!/from\s+['\"]\.\/src\/routes\/harness-health\.js['\"]/.test(server)) { console.error('FAIL server.js missing import'); process.exit(1); }
if (!/app\.use\(['\"]\/api\/brain\/harness['\"]\s*,\s*\w+/.test(server)) { console.error('FAIL server.js missing mount on /api/brain/harness'); process.exit(1); }
console.log('Step 1 PASS');
"

# ===== 阶段 2：合同 Step 3 — 单元 fallback 路径 =====
echo "[E2E] Step 3: vitest fallback coverage"
(cd packages/brain && npx vitest run \
  ../../sprints/harness-accept-20260507-v1/tests/ws1/harness-health.test.ts \
  --reporter=verbose) 2>&1 | tee /tmp/e2e-vitest.log
grep -E "Tests.*[0-9]+ failed" /tmp/e2e-vitest.log && { echo "FAIL: vitest failed"; exit 1; }
grep -E "✓.*falls back to .*unknown.*when langgraph.*unreadable" /tmp/e2e-vitest.log \
  || { echo "FAIL: fallback case not green"; exit 1; }

# ===== 阶段 3：合同 Step 2 — 真启 Brain + curl 实打 =====
echo "[E2E] Step 2: live Brain curl"

# 选一个空闲端口（默认 5221，被占则用 25221）
PORT=5221
if lsof -iTCP:$PORT -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  PORT=25221
fi
export PORT

# 启动 Brain（后台），把 stdout/stderr 写到日志，捕获 PID
LOG=/tmp/brain-e2e-$$.log
( cd packages/brain && PORT=$PORT node server.js >"$LOG" 2>&1 ) &
BRAIN_PID=$!
trap 'kill $BRAIN_PID 2>/dev/null || true' EXIT

# 等端口 LISTEN，最多 30s（Brain 冷启动含 OTel + DB 初始化可能 10s+）
DEADLINE=$((SECONDS + 30))
until curl -sf -o /dev/null --max-time 1 "http://localhost:$PORT/api/brain/harness/health"; do
  if [ $SECONDS -gt $DEADLINE ]; then
    echo "FAIL: Brain did not become ready within 30s"
    echo "----- brain log tail -----"
    tail -50 "$LOG"
    exit 1
  fi
  sleep 1
done

# 实打 + 校验三字段
HTTP_CODE=$(curl -s -o /tmp/e2e-health.json -w "%{http_code}" --max-time 5 \
  -H "Accept: application/json" \
  "http://localhost:$PORT/api/brain/harness/health")
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: status $HTTP_CODE"; cat /tmp/e2e-health.json; exit 1; }

node -e "
const body = JSON.parse(require('fs').readFileSync('/tmp/e2e-health.json', 'utf8'));
const errs = [];
if (typeof body.langgraph_version !== 'string') errs.push('langgraph_version not string');
if (body.last_attempt_at !== null && typeof body.last_attempt_at !== 'string') errs.push('last_attempt_at not null|string');
if (body.healthy !== true) errs.push('healthy !== true');
if (errs.length) { console.error('FAIL', errs, body); process.exit(1); }
console.log('Step 2 PASS body=', JSON.stringify(body));
"

# 关 Brain
kill $BRAIN_PID 2>/dev/null || true
wait $BRAIN_PID 2>/dev/null || true
trap - EXIT

echo "✅ Golden Path E2E PASS (autonomous)"
```

**通过标准**: 脚本 exit 0；任意 Step 失败立即 exit 非 0 并打印 Brain 日志末尾 50 行供排查。

**防造假说明**:
- Step 2 用 `--max-time 5` 卡 curl 超时，避免假死被当成成功。
- Step 2 用 `curl -s -w "%{http_code}"` 显式抓 HTTP 状态码，不依赖 `-f`（`-f` 在 200 时不写 body 到 stdout，但我们要 body）。
- 端口 LISTEN 探测用 `curl -sf` 而非 `nc`，确保不仅 socket 在听、还要应用层正常响应 health。
- vitest grep 同时校验"无 failed 行"且"目标用例 PASS"，避免 PASS 行被吃但 fallback 用例其实没跑。
- 静态校验用 regex 而非 `grep -q "harness-health"` 这种宽松匹配，防止注释里写一行就当成实现。

---

## Workstreams

workstream_count: 1

### Workstream 1: harness-health endpoint 实现 + 注册

**范围**:
- 新建 `packages/brain/src/routes/harness-health.js`：导出 Express Router，含 `GET /health` 处理函数；从 `node_modules/@langchain/langgraph/package.json` 读 version；查询 `tasks` 表中 `task_type='harness_initiative'` 的最近 `started_at`；任一失败均降级（version → `"unknown"`，last_attempt_at → `null`），仍返回 200 + `healthy:true`。
- 修改 `packages/brain/server.js`：在 `app.use('/api/brain/harness', harnessRoutes)` **之前**新增一行 `app.use('/api/brain/harness', harnessHealthRoutes)`（Express 多次 mount 同前缀走顺序匹配，确保 `/health` 不被既有 harnessRoutes 内任何 wildcard 拦截）；同时新增对应 `import` 语句。

**大小**: S（< 100 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/harness-health.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/harness-accept-20260507-v1/tests/ws1/harness-health.test.ts` | (1) GET /api/brain/harness/health 返 200 + 三字段；(2) 三字段类型正确；(3) langgraph 元数据读取失败时降级 `"unknown"` 仍 200；(4) DB 查询失败时 `last_attempt_at` 降级 `null` 仍 200 | Round 1 测试无法 import 不存在的 `harness-health.js` → vitest 报 ERR_MODULE_NOT_FOUND，4 个 it 块全 FAIL |
