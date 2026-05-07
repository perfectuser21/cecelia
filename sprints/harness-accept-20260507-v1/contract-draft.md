# Sprint Contract Draft (Round 2)

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

**可观测行为**: 真实启动 Brain（`node packages/brain/server.js`），等端口 LISTEN 后，`curl localhost:$PORT/api/brain/harness/health` 返回 HTTP 200，`Content-Type` 含 `application/json`，body 解析后必须同时含三个 key：`langgraph_version`（字符串）、`last_attempt_at`（字符串或 null）、`healthy`（=== true）。

**验证命令**:
```bash
# 在真实 Brain 进程已起的前提下（E2E 脚本会负责拉起，独跑该步骤前请先启动 Brain 并 export PORT）
PORT=${PORT:-5221}
HTTP_CODE=$(curl -s -o /tmp/health-body.json -w "%{http_code}" \
  --max-time 5 \
  -H "Accept: application/json" \
  "http://localhost:$PORT/api/brain/harness/health")

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
# 用 JSON reporter + node 解析，避免 reporter 输出格式漂移导致 grep 假绿/假红（R3）
mkdir -p /tmp
( cd packages/brain && npx vitest run \
  ../../sprints/harness-accept-20260507-v1/tests/ws1/harness-health.test.ts \
  --reporter=json --outputFile=/tmp/vitest-ws1.json ) 2>&1 | tee /tmp/ws1-green.log

node -e "
const fs = require('fs');
let report;
try { report = JSON.parse(fs.readFileSync('/tmp/vitest-ws1.json','utf8')); }
catch (e) { console.error('FAIL: cannot parse /tmp/vitest-ws1.json:', e.message); process.exit(1); }
if (typeof report.numFailedTests !== 'number') { console.error('FAIL: report missing numFailedTests'); process.exit(1); }
if (report.numFailedTests !== 0) { console.error('FAIL: numFailedTests =', report.numFailedTests); process.exit(1); }
const allTests = (report.testResults || []).flatMap(f => f.assertionResults || []);
const fallback = allTests.find(t => /falls back to .*unknown.*when langgraph/.test(t.fullName || t.title || ''));
if (!fallback) { console.error('FAIL: fallback test case not found in report'); process.exit(1); }
if (fallback.status !== 'passed') { console.error('FAIL: fallback test status =', fallback.status); process.exit(1); }
console.log('OK: ws1 vitest all green incl. fallback path; numFailedTests=0');
"
```

**硬阈值**: vitest JSON 报告 `numFailedTests === 0`，且包含 fallback 用例（fullName 含 `falls back to ... unknown ... when langgraph`）且 `status === "passed"`。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
# 注意：故意不用 set -e。每个 stage 独立收集 exit code，全部跑完后统一汇总判 PASS/FAIL（R4）。
# 这样 Step 3 vitest 红不会让 Step 2 真启 curl 被跳过，能一次看清所有红点。
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

STAGES_LOG=/tmp/e2e-stages.log
: > "$STAGES_LOG"

stage_done () {
  # $1 = stage name, $2 = exit code
  if [ "$2" -eq 0 ]; then
    echo "$1=PASS" | tee -a "$STAGES_LOG"
  else
    echo "$1=FAIL(exit=$2)" | tee -a "$STAGES_LOG"
  fi
}

# ===== 阶段 0：依赖 =====
[ -d packages/brain/node_modules ] || (cd packages/brain && npm install --no-audit --no-fund --silent)
DEP_RC=$?
stage_done "STAGE_0_DEPS" "$DEP_RC"

# ===== 阶段 1：合同 Step 1 — 静态产出物 =====
echo "[E2E] Stage 1: ARTIFACT shape check"
node -e "
const fs = require('fs');
const route = fs.readFileSync('packages/brain/src/routes/harness-health.js', 'utf8');
if (!/export\s+default\s+router|export\s*{\s*router\s+as\s+default\s*}/.test(route)) { console.error('FAIL route default export'); process.exit(1); }
if (!/router\.get\(['\"]\/health['\"]/.test(route)) { console.error('FAIL route GET /health'); process.exit(1); }
const server = fs.readFileSync('packages/brain/server.js', 'utf8');
if (!/from\s+['\"]\.\/src\/routes\/harness-health\.js['\"]/.test(server)) { console.error('FAIL server.js missing import'); process.exit(1); }
if (!/app\.use\(['\"]\/api\/brain\/harness['\"]\s*,\s*\w+/.test(server)) { console.error('FAIL server.js missing mount on /api/brain/harness'); process.exit(1); }
console.log('Stage 1 PASS');
"
S1_RC=$?
stage_done "STAGE_1_ARTIFACT" "$S1_RC"

# ===== 阶段 2：合同 Step 3 — 单元 fallback 路径（JSON reporter 防 grep 漂移，R3） =====
echo "[E2E] Stage 2: vitest fallback coverage (json reporter)"
mkdir -p /tmp
( cd packages/brain && npx vitest run \
  ../../sprints/harness-accept-20260507-v1/tests/ws1/harness-health.test.ts \
  --reporter=json --outputFile=/tmp/vitest-ws1.json ) >/tmp/vitest-ws1.stdout 2>&1
VITEST_RC=$?
node -e "
const fs = require('fs');
let report;
try { report = JSON.parse(fs.readFileSync('/tmp/vitest-ws1.json','utf8')); }
catch (e) { console.error('FAIL: cannot parse /tmp/vitest-ws1.json:', e.message); process.exit(1); }
if (typeof report.numFailedTests !== 'number') { console.error('FAIL: report missing numFailedTests'); process.exit(1); }
if (report.numFailedTests !== 0) { console.error('FAIL: numFailedTests =', report.numFailedTests); process.exit(1); }
const allTests = (report.testResults || []).flatMap(f => f.assertionResults || []);
const fallback = allTests.find(t => /falls back to .*unknown.*when langgraph/.test(t.fullName || t.title || ''));
if (!fallback) { console.error('FAIL: fallback test case not found in report'); process.exit(1); }
if (fallback.status !== 'passed') { console.error('FAIL: fallback test status =', fallback.status); process.exit(1); }
console.log('Stage 2 PASS: numFailedTests=0, fallback case passed');
"
S2_RC=$?
# vitest 进程本身失败也要计入红
if [ "$VITEST_RC" -ne 0 ] && [ "$S2_RC" -eq 0 ]; then S2_RC=$VITEST_RC; fi
stage_done "STAGE_2_VITEST" "$S2_RC"

# ===== 阶段 3：合同 Step 2 — 真启 Brain + curl 实打 =====
echo "[E2E] Stage 3: live Brain curl"

# --- 端口选择（R2）：5221 → 25221 → 随机 30000-39999；都被占 exit E_PORT_BUSY ---
E_PORT_BUSY=87
PORT=""
for CAND in 5221 25221; do
  if ! lsof -iTCP:$CAND -sTCP:LISTEN -n -P >/dev/null 2>&1; then PORT=$CAND; break; fi
done
if [ -z "$PORT" ]; then
  RAND_PORT=$((30000 + RANDOM % 10000))
  if lsof -iTCP:$RAND_PORT -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "FAIL: ports 5221/25221/$RAND_PORT all busy (E_PORT_BUSY=$E_PORT_BUSY)"
    stage_done "STAGE_3_LIVE" "$E_PORT_BUSY"
    S3_RC=$E_PORT_BUSY
  else
    PORT=$RAND_PORT
  fi
fi

if [ -n "$PORT" ]; then
  export PORT
  echo "[E2E] Stage 3: using PORT=$PORT"

  # 启动 Brain（后台）
  LOG=/tmp/brain-e2e-$$.log
  ( cd packages/brain && PORT=$PORT node server.js >"$LOG" 2>&1 ) &
  BRAIN_PID=$!
  trap 'kill $BRAIN_PID 2>/dev/null || true' EXIT

  # 等端口 LISTEN（R1）：READY_TIMEOUT 默认 30s，可 env 覆盖至 60s；超时 tail log 50 行
  READY_TIMEOUT=${READY_TIMEOUT:-30}
  echo "[E2E] Stage 3: waiting up to ${READY_TIMEOUT}s for Brain ready"
  DEADLINE=$((SECONDS + READY_TIMEOUT))
  READY=0
  until curl -sf -o /dev/null --max-time 1 "http://localhost:$PORT/api/brain/harness/health"; do
    if [ $SECONDS -gt $DEADLINE ]; then break; fi
    sleep 1
  done
  if curl -sf -o /dev/null --max-time 2 "http://localhost:$PORT/api/brain/harness/health"; then
    READY=1
  fi

  if [ "$READY" -ne 1 ]; then
    echo "FAIL: Brain not ready within ${READY_TIMEOUT}s. Re-run with READY_TIMEOUT=60 to retry. Brain log tail (50):"
    echo "----- brain log tail -----"
    tail -50 "$LOG" || true
    echo "--------------------------"
    S3_RC=1
  else
    # 实打 + 校验三字段
    HTTP_CODE=$(curl -s -o /tmp/e2e-health.json -w "%{http_code}" --max-time 5 \
      -H "Accept: application/json" \
      "http://localhost:$PORT/api/brain/harness/health")
    if [ "$HTTP_CODE" != "200" ]; then
      echo "FAIL: status $HTTP_CODE"; cat /tmp/e2e-health.json
      S3_RC=2
    else
      node -e "
        const body = JSON.parse(require('fs').readFileSync('/tmp/e2e-health.json', 'utf8'));
        const errs = [];
        if (typeof body.langgraph_version !== 'string') errs.push('langgraph_version not string');
        if (body.last_attempt_at !== null && typeof body.last_attempt_at !== 'string') errs.push('last_attempt_at not null|string');
        if (body.healthy !== true) errs.push('healthy !== true');
        if (errs.length) { console.error('FAIL', errs, body); process.exit(1); }
        console.log('Stage 3 PASS body=', JSON.stringify(body));
      "
      S3_RC=$?
    fi
  fi

  # 关 Brain
  kill $BRAIN_PID 2>/dev/null || true
  wait $BRAIN_PID 2>/dev/null || true
  trap - EXIT
  stage_done "STAGE_3_LIVE" "$S3_RC"
fi

# ===== 汇总（R4） =====
echo "===== E2E STAGES SUMMARY ====="
cat "$STAGES_LOG"
echo "=============================="

if grep -q "FAIL" "$STAGES_LOG"; then
  echo "❌ Golden Path E2E FAIL — see /tmp/e2e-stages.log"
  exit 1
fi
echo "✅ Golden Path E2E PASS (autonomous)"
exit 0
```

**通过标准**: 脚本 exit 0，且 `/tmp/e2e-stages.log` 全部 `STAGE_*=PASS`。

**防造假说明**:
- Step 2（真启）用 `--max-time 5` 卡 curl，避免 Brain 假死被当成成功。
- Step 2 用 `curl -s -w "%{http_code}"` 显式抓 HTTP 状态码，不依赖 `-f`（`-f` 在非 2xx 才报错，但我们要 body）。
- 端口 LISTEN 探测用 `curl -sf` 而非 `nc`，确保不仅 socket 在听、还要应用层正常响应 health。
- vitest 改用 `--reporter=json` + `node` 解析（R3），不再依赖 `grep ✓` 易漂移的人类输出。
- 静态校验用 regex 而非 `grep -q "harness-health"` 这种宽松匹配，防止注释里写一行就当成实现。
- E2E 脚本去掉 `set -e`（仅留 `set -uo pipefail`）+ 每阶段写 `STAGE_N=PASS|FAIL` 到 `/tmp/e2e-stages.log`（R4），任何阶段失败不中断后续阶段，避免 Step 3 vitest 红遮蔽 Step 2 curl 红，最后统一汇总判定。
- 端口选择策略 5221 → 25221 → 30000-39999 随机（R2），都被占就以专用错误码 `E_PORT_BUSY=87` 退出，避免 silently 挂在错误端口上。
- Brain 启动等待用 `READY_TIMEOUT` env 可覆盖（R1）默认 30s，超时打印 `tail -50` Brain 日志并明确提示 `Re-run with READY_TIMEOUT=60`，便于人工延长后重跑判红。

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

---

## Round 2 变更说明（针对 R1–R4）

- **R1（READY_TIMEOUT）**: E2E Stage 3 引入 `READY_TIMEOUT=${READY_TIMEOUT:-30}`，超时打印 `tail -50` Brain 日志并提示 `Re-run with READY_TIMEOUT=60` 便于人工延长重跑。
- **R2（端口冲突）**: 端口选择改为 5221 → 25221 → `30000 + RANDOM%10000` 随机端口三段；三段都被占即以 `E_PORT_BUSY=87` 退出，stage 标记 FAIL。
- **R3（vitest 输出漂移）**: Step 3 与 E2E Stage 2 改用 `--reporter=json --outputFile=/tmp/vitest-ws1.json`，再用 `node -e` 解析 `numFailedTests===0` 并定位 fallback 用例 `status==='passed'`，告别 grep 假绿/假红。
- **R4（cascade 遮蔽）**: 去掉 `set -e`，改为每阶段独立收集 exit code 写 `/tmp/e2e-stages.log`，全部跑完后 `grep FAIL` 统一汇总判定，任意阶段红都能在同一次运行中被看到。
