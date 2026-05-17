# Sprint Contract Draft (Round 2)

**Task ID**: 0f7fec19-f9a7-41ac-81d8-81fc15be4503
**生成时间**: 2026-04-18
**对应 PRD**: sprints/sprint-prd.md（Brain `/api/brain/health` 新增 `docker_runtime` 字段）
**Round 1 反馈处理**:
- 修复 Issue 1/2：删除所有 `DOCKER_HOST=... curl ...` 与 `DISABLE_DOCKER_RUNTIME=true curl ...`（env var 不传递给已启动的 Brain 进程），将「Docker 不可达 / disabled / 聚合 degraded」三类场景的验证完全下沉到 WS2 integration 测试（Jest mock probe 模块）。
- 修复 Issue 3：Feature 3 删除 SKIP 假阳性分支，live 命令只做「happy path + 聚合一致性」断言，不可达/disabled 场景不在 live 命令中模拟。
- 修复 Issue 4：Feature 5 第二条命令改用 `PIPESTATUS[0]` + `set -o pipefail`，读正确的 npm test 退出码。
- 改进建议：WS1 范围明确 Docker 探测模块文件路径为 `packages/brain/src/docker-runtime-probe.js`（与 DoD Test 对齐）。

---

## Feature 1: `/api/brain/health` 响应中新增 `docker_runtime` 字段（结构与字段完整性）

**行为描述**:
调用方发起 `GET /api/brain/health` 时，返回的 JSON 顶层必须包含 `docker_runtime` 对象。该对象至少包含 `enabled`（bool）、`status`（enum）、`reachable`（bool）、`version`（string 或 null）、`error`（string 或 null）五个字段。`status` 取值必须落在 `healthy` / `unhealthy` / `disabled` / `unknown` 四者之一。Happy path 场景下（Docker daemon 正常 + enabled=true）必须返回 `status='healthy'` / `enabled=true` / `reachable=true`。

**硬阈值**:
- HTTP 状态码 = 200
- 响应 JSON 顶层存在 `docker_runtime` 字段，类型为 object（非 null / 非 array）
- `docker_runtime.enabled` 存在且类型为 boolean
- `docker_runtime.status` 存在，值 ∈ {`healthy`, `unhealthy`, `disabled`, `unknown`}
- `docker_runtime.reachable` 存在且类型为 boolean
- `docker_runtime.version` 存在，类型为 string 或 null
- `docker_runtime.error` 存在，类型为 string 或 null
- 结构不变量：当 `status === 'disabled'` 时 `enabled === false`；当 `status === 'healthy'` 时 `enabled === true` 且 `reachable === true`；当 `status === 'unhealthy'` 时 `error` 必须为非空字符串

**验证命令**:
```bash
# 结构完整性 + 字段类型 + 枚举值 + 状态不变量（合并 HTTP 状态码与 body 断言为单次调用）
TMP=$(mktemp)
CODE=$(curl -s -o "$TMP" -w '%{http_code}' http://localhost:5221/api/brain/health)
[ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE（期望 200）"; rm -f "$TMP"; exit 1; }
node -e "
  const dr = JSON.parse(require('fs').readFileSync('$TMP','utf8')).docker_runtime;
  if (!dr || typeof dr !== 'object' || Array.isArray(dr)) throw new Error('FAIL: docker_runtime 缺失或类型错误');
  if (typeof dr.enabled !== 'boolean') throw new Error('FAIL: enabled 非 boolean');
  const allowed = ['healthy','unhealthy','disabled','unknown'];
  if (!allowed.includes(dr.status)) throw new Error('FAIL: status 非法 -> ' + dr.status);
  if (typeof dr.reachable !== 'boolean') throw new Error('FAIL: reachable 非 boolean');
  if (!(typeof dr.version === 'string' || dr.version === null)) throw new Error('FAIL: version 非 string|null');
  if (!(typeof dr.error === 'string' || dr.error === null)) throw new Error('FAIL: error 非 string|null');
  if (dr.status === 'disabled' && dr.enabled !== false) throw new Error('FAIL: disabled 必须 enabled=false');
  if (dr.status === 'healthy' && (dr.enabled !== true || dr.reachable !== true)) throw new Error('FAIL: healthy 必须 enabled=true && reachable=true');
  if (dr.status === 'unhealthy' && (typeof dr.error !== 'string' || dr.error.length === 0)) throw new Error('FAIL: unhealthy 必须 error 非空');
  console.log('PASS: docker_runtime 结构与字段不变量全部符合');
"
RC=$?; rm -f "$TMP"; exit $RC
```

---

## Feature 2: Docker 探测超时保护与响应耗时（live 端点层）

**行为描述**:
health 端点整体响应时间在 Docker 探测正常与超时保护生效两种路径下均必须 ≤ 3000ms。Docker 探测本身必须有 ≤ 2 秒内部超时保护，超时不得抛出未捕获异常使 health 端点返回 500。「Docker 不可达时端点仍 200」以及「超时后 `status='unhealthy'` / `reachable=false` / `error` 非空」的行为断言不由 live 命令承担（`DOCKER_HOST` 对已启动的 Brain 进程不生效，Round 1 Issue 1/2），改由 Workstream 2 的 integration 测试（Jest mock probe 模块）强制触发并断言。

**硬阈值**:
- happy path（Docker daemon 正常）下 health 端点响应时间 ≤ 3000ms
- Docker 探测模块必须导出可被测试替换（mock）的探测函数（供 WS2 integration 测试注入 unhealthy / timeout / disabled 三种状态）
- Docker 探测模块内部超时常量 ≤ 2000ms（源码可静态检查）
- 探测模块必须用 try/catch 包裹底层调用，失败路径必须返回结构化错误对象（不得抛出）

**验证命令**:
```bash
# 1) live 响应耗时（happy path，Docker 正常）≤ 3000ms
START=$(date +%s%3N)
curl -sf http://localhost:5221/api/brain/health > /dev/null || { echo "FAIL: health 请求失败"; exit 1; }
END=$(date +%s%3N)
ELAPSED=$((END - START))
[ "$ELAPSED" -le 3000 ] && echo "PASS: health 响应耗时 ${ELAPSED}ms ≤ 3000ms" || { echo "FAIL: 耗时 ${ELAPSED}ms 超过 3000ms"; exit 1; }

# 2) Docker 探测模块可 mock + 超时常量 ≤ 2000ms（源码静态约束，防止探测阻塞主线程超过 PRD 约定）
node -e "
  const fs = require('fs');
  const path = 'packages/brain/src/docker-runtime-probe.js';
  if (!fs.existsSync(path)) throw new Error('FAIL: ' + path + ' 不存在');
  const src = fs.readFileSync(path, 'utf8');
  // 必须以 CommonJS 方式导出（WS2 测试需要 jest.mock / require 替换）
  if (!/module\.exports\s*=|exports\.probe\s*=|exports\.default\s*=/.test(src)) {
    throw new Error('FAIL: probe 模块未以 CommonJS 方式导出');
  }
  // 必须显式 try/catch 包裹（防止探测异常使 health 端点 500）
  if (!/\btry\b[\s\S]*\bcatch\b/.test(src)) {
    throw new Error('FAIL: probe 模块缺少 try/catch（Docker 异常会冒泡导致 500）');
  }
  // 超时常量（毫秒数值）≤ 2000
  const nums = [...src.matchAll(/(?:timeout|TIMEOUT|timeoutMs|TIMEOUT_MS)\s*[:=]\s*(\d+)/g)].map(m => parseInt(m[1], 10));
  if (nums.length === 0) throw new Error('FAIL: 未找到超时常量（timeout/TIMEOUT）');
  const maxTimeout = Math.max(...nums);
  if (maxTimeout > 2000) throw new Error('FAIL: 超时常量 ' + maxTimeout + 'ms 超过 2000ms 上限');
  console.log('PASS: probe 模块可 mock + 超时常量 ' + maxTimeout + 'ms ≤ 2000ms');
"
```

---

## Feature 3: 顶层 `status` 聚合规则一致性（live 层一致性 + 聚合逻辑源码约束）

**行为描述**:
当 `docker_runtime.enabled === true` 且 `docker_runtime.status === 'unhealthy'` 时，health 响应的顶层 `status` 聚合为 `degraded`（与既有 `circuit_breaker` open 的聚合语义一致）。当 `docker_runtime.status === 'disabled'` 时，顶层 `status` 不得因此从 healthy 退化。live 端点层只验证「当前 docker_runtime 状态下顶层 status 与聚合规则一致」，三种边界状态（unhealthy + degraded / disabled 不降级 / healthy）的强制触发与断言由 Workstream 2 的 integration 测试通过 mock probe 模块完成。

**硬阈值**:
- live 端点返回的 `(docker_runtime, status, organs.circuit_breaker.open)` 三者组合必须满足一致性规则：
  - 若 `docker_runtime.enabled=true && docker_runtime.status='unhealthy'` ⇒ 顶层 `status='degraded'`
  - 若 `docker_runtime.status='healthy'` 且无故障源（`organs.circuit_breaker.open=[]` 且其它器官无异常）⇒ 顶层 `status='healthy'`
  - 若 `docker_runtime.status='disabled'` 且无其它器官故障 ⇒ 顶层 `status` 不得为 `degraded`
- 聚合源码 `packages/brain/src/routes/goals.js` 必须显式引用 `docker_runtime` 且在附近出现 `degraded` 字面量（防止"仅添加字段、聚合逻辑遗漏"的应付实现）

**验证命令**:
```bash
# 1) live 一致性：无论当前 docker_runtime 处于何种状态，顶层 status 与聚合规则保持一致（无 SKIP 假阳性分支）
curl -sf http://localhost:5221/api/brain/health | node -e "
  const b = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const dr = b.docker_runtime;
  if (!dr) throw new Error('FAIL: docker_runtime 缺失');
  const cbOpen = (b.organs?.circuit_breaker?.open || []).length > 0;
  // 规则 1：unhealthy+enabled ⇒ 顶层必须 degraded（若触发则断言，未触发则规则自动满足，不走 SKIP 分支）
  if (dr.enabled === true && dr.status === 'unhealthy' && b.status !== 'degraded') {
    throw new Error('FAIL: docker unhealthy+enabled 但顶层 ' + b.status + '（期望 degraded）');
  }
  // 规则 2：docker healthy + 无 cb open ⇒ 顶层必须 healthy（其它器官异常才允许 degraded，且必须由 open/non-running 证据支持）
  if (dr.status === 'healthy' && !cbOpen && b.status !== 'healthy') {
    const nonRunning = ['scheduler','event_bus','notifier','planner']
      .filter(k => b.organs[k]?.status && b.organs[k].status !== 'running');
    if (nonRunning.length === 0) {
      throw new Error('FAIL: docker healthy 且无故障源，但顶层 ' + b.status + '（期望 healthy）');
    }
  }
  // 规则 3：disabled 且无其它器官故障 ⇒ 顶层不得 degraded
  if (dr.status === 'disabled' && b.status === 'degraded' && !cbOpen) {
    const nonRunning = ['scheduler','event_bus','notifier','planner']
      .filter(k => b.organs[k]?.status && b.organs[k].status !== 'running');
    if (nonRunning.length === 0) {
      throw new Error('FAIL: disabled 单独触发 degraded（非其它器官故障）');
    }
  }
  console.log('PASS: live 聚合规则一致 docker=' + dr.status + ' 顶层=' + b.status);
"

# 2) 源码约束：goals.js 聚合逻辑必须显式引用 docker_runtime + 附近含 degraded 关键字
node -e "
  const fs = require('fs');
  const src = fs.readFileSync('packages/brain/src/routes/goals.js', 'utf8');
  if (!/docker_runtime/.test(src)) throw new Error('FAIL: goals.js 未引用 docker_runtime');
  const lines = src.split('\n');
  let hasAggRef = false;
  for (let i = 0; i < lines.length; i++) {
    if (/docker_runtime/.test(lines[i])) {
      const start = Math.max(0, i - 20);
      const end = Math.min(lines.length, i + 20);
      const window = lines.slice(start, end).join('\n');
      if (/degraded/.test(window) || /aggregateStatus|overallStatus|topStatus/.test(window)) {
        hasAggRef = true;
        break;
      }
    }
  }
  if (!hasAggRef) throw new Error('FAIL: goals.js 中 docker_runtime 附近 20 行内未见 degraded/聚合关键字');
  console.log('PASS: goals.js 聚合逻辑显式引用 docker_runtime + degraded');
"
```

---

## Feature 4: 向后兼容（既有字段零改动）

**行为描述**:
新增 `docker_runtime` 后，既有消费者依赖的顶层字段（`status` / `uptime` / `active_pipelines` / `evaluator_stats` / `tick_stats` / `organs` / `timestamp`）以及 `organs` 下的 5 个子器官（`scheduler` / `circuit_breaker` / `event_bus` / `notifier` / `planner`）的字段名、类型、嵌套结构保持完全一致。`docker_runtime` 仅为追加字段，不得重命名或删除任何现有字段。

**硬阈值**:
- 响应顶层存在且类型正确：`status` (string) / `uptime` (number) / `active_pipelines` (number) / `evaluator_stats` (object) / `tick_stats` (object) / `organs` (object) / `timestamp` (string)
- `organs.scheduler` / `organs.circuit_breaker` / `organs.event_bus` / `organs.notifier` / `organs.planner` 五者均存在，类型为 object
- `organs.circuit_breaker.status` / `organs.circuit_breaker.open` / `organs.circuit_breaker.half_open` / `organs.circuit_breaker.states` 保留
- `evaluator_stats.total_runs` / `evaluator_stats.passed` / `evaluator_stats.failed` / `evaluator_stats.last_run_at` 保留
- `tick_stats.total_executions` / `tick_stats.last_executed_at` / `tick_stats.last_duration_ms` 保留

**验证命令**:
```bash
curl -sf http://localhost:5221/api/brain/health | node -e "
  const b = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const check = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); };
  check(typeof b.status === 'string', 'status 不是 string');
  check(typeof b.uptime === 'number', 'uptime 不是 number');
  check(typeof b.active_pipelines === 'number', 'active_pipelines 不是 number');
  check(b.evaluator_stats && typeof b.evaluator_stats === 'object', 'evaluator_stats 缺失');
  check(typeof b.evaluator_stats.total_runs === 'number', 'evaluator_stats.total_runs 缺失');
  check('passed' in b.evaluator_stats && 'failed' in b.evaluator_stats, 'evaluator_stats 字段不全');
  check('last_run_at' in b.evaluator_stats, 'evaluator_stats.last_run_at 缺失');
  check(b.tick_stats && typeof b.tick_stats === 'object', 'tick_stats 缺失');
  check('total_executions' in b.tick_stats && 'last_executed_at' in b.tick_stats && 'last_duration_ms' in b.tick_stats, 'tick_stats 字段不全');
  check(b.organs && typeof b.organs === 'object', 'organs 缺失');
  for (const k of ['scheduler','circuit_breaker','event_bus','notifier','planner']) {
    check(b.organs[k] && typeof b.organs[k] === 'object', 'organs.' + k + ' 缺失');
  }
  const cb = b.organs.circuit_breaker;
  check(typeof cb.status === 'string' && Array.isArray(cb.open) && Array.isArray(cb.half_open) && typeof cb.states === 'object', 'circuit_breaker 子字段异常');
  check(typeof b.timestamp === 'string', 'timestamp 不是 string');
  console.log('PASS: 既有字段全部保留，零回归');
"
```

---

## Feature 5: integration/smoke 测试新增 docker_runtime 覆盖（含三种状态 mock 注入）

**行为描述**:
`packages/brain/src/__tests__/integration/critical-routes.integration.test.js` 与 `packages/brain/src/__tests__/integration/golden-path.integration.test.js` 中必须新增针对 `docker_runtime` 的断言；必须使用 Jest mock（`jest.mock` / `jest.doMock` / `jest.spyOn`）对 probe 模块注入三种状态（healthy / unhealthy / disabled），并分别断言：healthy 下顶层 `status='healthy'`；unhealthy+enabled 下顶层 `status='degraded'` 且 `error` 非空；disabled 下顶层 `status` 不因此降级。既有 health 断言零回归，brain integration 测试套件全量通过。

**硬阈值**:
- 两个 integration 测试文件均出现 `docker_runtime` 关键字
- `docker-runtime-probe` 或 `dockerRuntimeProbe` 在测试中被 `jest.mock` / `jest.doMock` / `jest.spyOn` 显式替换（至少 1 处）
- 三种状态字面量 `'healthy'` / `'unhealthy'` / `'disabled'` 在 integration 测试中全部出现
- 出现针对顶层 `status` 为 `'degraded'` 的断言（证明聚合规则被真实测到，非仅结构断言）
- `cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration'` 以正确管道退出码（`PIPESTATUS[0]` 或 `set -o pipefail`）读取为 0

**验证命令**:
```bash
# 1) 测试文件包含 docker_runtime 关键字 + mock 调用 + 三种状态 + degraded 断言
node -e "
  const fs = require('fs');
  const p1 = 'packages/brain/src/__tests__/integration/critical-routes.integration.test.js';
  const p2 = 'packages/brain/src/__tests__/integration/golden-path.integration.test.js';
  const c1 = fs.readFileSync(p1, 'utf8');
  const c2 = fs.readFileSync(p2, 'utf8');
  const combined = c1 + '\n' + c2;
  if (!/docker_runtime/.test(c1)) throw new Error('FAIL: ' + p1 + ' 未新增 docker_runtime 断言');
  if (!/docker_runtime/.test(c2)) throw new Error('FAIL: ' + p2 + ' 未新增 docker_runtime 断言');
  const hasMock = /jest\.mock\s*\(\s*['\"][^'\"]*docker-runtime-probe/.test(combined)
    || /jest\.doMock\s*\(\s*['\"][^'\"]*docker-runtime-probe/.test(combined)
    || /jest\.spyOn\s*\([^)]*[dD]ockerRuntimeProbe/.test(combined)
    || /jest\.spyOn\s*\([^)]*,\s*['\"]probe['\"]/.test(combined);
  if (!hasMock) throw new Error('FAIL: integration 测试未使用 jest.mock/doMock/spyOn 替换 probe 模块');
  for (const s of ['healthy','unhealthy','disabled','degraded']) {
    const re = new RegExp(\"['\\\"\`]\" + s + \"['\\\"\`]\");
    if (!re.test(combined)) throw new Error('FAIL: 缺字面量 ' + s);
  }
  console.log('PASS: docker_runtime 新增断言 + mock 注入 + 三状态 + degraded 聚合全覆盖');
"

# 2) 实际运行测试 — 使用 pipefail 读正确的 npm test 退出码（修复 Round 1 Issue 3）
set -o pipefail
(cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration' 2>&1 | tail -30)
EXIT=$?
[ "$EXIT" = "0" ] && echo "PASS: brain integration 测试通过 (exit=$EXIT)" || { echo "FAIL: 测试失败 exit=$EXIT"; exit 1; }
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Docker 探测模块 + health 端点集成 + 聚合规则

**范围**:
- 新增 `packages/brain/src/docker-runtime-probe.js`（路径硬性约束，与 DoD Test 对齐），以 CommonJS 导出 probe 函数返回 `{enabled, status, reachable, version, error}`，内部超时常量 ≤ 2000ms，必须 try/catch 隔离底层异常；
- 在 `packages/brain/src/routes/goals.js` 的 health 端点中调用 probe 并将结果拼入响应 JSON；
- 实现顶层 `status` 聚合：`enabled=true && status='unhealthy'` ⇒ `degraded`；`disabled` 不降级；
- 不得改动任何现有字段名/类型/嵌套。

**大小**: M（预计 150-250 行，其中探测模块 ~80 行 + 路由改动 ~40 行 + 超时/错误隔离 ~30 行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/brain/src/docker-runtime-probe.js` 存在、以 CommonJS 导出 probe 函数、含 try/catch、超时常量 ≤ 2000ms
  Test: node -e "const fs=require('fs'); const p='packages/brain/src/docker-runtime-probe.js'; if(!fs.existsSync(p))throw new Error('FAIL: 文件不存在'); const s=fs.readFileSync(p,'utf8'); if(!/module\.exports\s*=|exports\.probe\s*=|exports\.default\s*=/.test(s))throw new Error('FAIL: 未 CJS 导出'); if(!/\btry\b[\s\S]*\bcatch\b/.test(s))throw new Error('FAIL: 缺 try/catch'); const nums=[...s.matchAll(/(?:timeout|TIMEOUT|timeoutMs|TIMEOUT_MS)\s*[:=]\s*(\d+)/g)].map(m=>parseInt(m[1],10)); if(nums.length===0)throw new Error('FAIL: 无超时常量'); const mx=Math.max(...nums); if(mx>2000)throw new Error('FAIL: 超时 '+mx+'ms > 2000ms'); console.log('PASS: probe 模块结构合规 timeout='+mx+'ms')"
- [ ] [BEHAVIOR] `GET /api/brain/health` 响应顶层包含 `docker_runtime` 对象，字段类型与状态不变量全部符合
  Test: T=$(mktemp); C=$(curl -s -o "$T" -w '%{http_code}' http://localhost:5221/api/brain/health); [ "$C" = "200" ] || { echo "FAIL http $C"; rm -f "$T"; exit 1; }; node -e "const dr=JSON.parse(require('fs').readFileSync('$T','utf8')).docker_runtime; if(!dr||typeof dr.enabled!=='boolean'||!['healthy','unhealthy','disabled','unknown'].includes(dr.status)||typeof dr.reachable!=='boolean'||!(typeof dr.version==='string'||dr.version===null)||!(typeof dr.error==='string'||dr.error===null))throw new Error('FAIL: 字段不符'); if(dr.status==='disabled'&&dr.enabled!==false)throw new Error('FAIL: disabled 必须 enabled=false'); if(dr.status==='healthy'&&(dr.enabled!==true||dr.reachable!==true))throw new Error('FAIL: healthy 不变量'); if(dr.status==='unhealthy'&&(typeof dr.error!=='string'||!dr.error.length))throw new Error('FAIL: unhealthy 必须 error 非空'); console.log('PASS')"; RC=$?; rm -f "$T"; exit $RC
- [ ] [BEHAVIOR] health 端点 happy path 响应耗时 ≤ 3000ms
  Test: S=$(date +%s%3N); curl -sf http://localhost:5221/api/brain/health > /dev/null || { echo "FAIL: req"; exit 1; }; E=$(date +%s%3N); D=$((E-S)); [ "$D" -le 3000 ] && echo "PASS: ${D}ms" || { echo "FAIL: ${D}ms > 3000ms"; exit 1; }
- [ ] [BEHAVIOR] live 端点聚合规则一致性（当前 docker_runtime 状态与顶层 status 不矛盾，无 SKIP 假阳性）
  Test: curl -sf http://localhost:5221/api/brain/health | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const dr=b.docker_runtime; if(!dr)throw new Error('FAIL: docker_runtime 缺失'); const cbOpen=(b.organs?.circuit_breaker?.open||[]).length>0; if(dr.enabled===true&&dr.status==='unhealthy'&&b.status!=='degraded')throw new Error('FAIL: unhealthy+enabled 应 degraded 实际 '+b.status); if(dr.status==='healthy'&&!cbOpen){const nr=['scheduler','event_bus','notifier','planner'].filter(k=>b.organs[k]?.status&&b.organs[k].status!=='running'); if(b.status!=='healthy'&&nr.length===0)throw new Error('FAIL: healthy 无故障源但顶层 '+b.status)} if(dr.status==='disabled'&&b.status==='degraded'&&!cbOpen){const nr=['scheduler','event_bus','notifier','planner'].filter(k=>b.organs[k]?.status&&b.organs[k].status!=='running'); if(nr.length===0)throw new Error('FAIL: disabled 单独触发 degraded')} console.log('PASS: 聚合一致 docker='+dr.status+' top='+b.status)"
- [ ] [ARTIFACT] `packages/brain/src/routes/goals.js` 聚合逻辑显式引用 `docker_runtime` 且附近 20 行内含 `degraded` 关键字（防止仅"加字段"不接入聚合）
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/goals.js','utf8'); if(!/docker_runtime/.test(s))throw new Error('FAIL: 未引用 docker_runtime'); const ls=s.split('\n'); let ok=false; for(let i=0;i<ls.length;i++){if(/docker_runtime/.test(ls[i])){const w=ls.slice(Math.max(0,i-20),Math.min(ls.length,i+20)).join('\n'); if(/degraded/.test(w)||/aggregateStatus|overallStatus|topStatus/.test(w)){ok=true;break}}} if(!ok)throw new Error('FAIL: docker_runtime 附近无 degraded/聚合关键字'); console.log('PASS')"
- [ ] [BEHAVIOR] 向后兼容：既有 7 顶层字段 + 5 organs 子器官全部保留且类型不变
  Test: curl -sf http://localhost:5221/api/brain/health | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); ['status','uptime','active_pipelines','evaluator_stats','tick_stats','organs','timestamp'].forEach(k=>{if(!(k in b))throw new Error('FAIL missing '+k)}); if(typeof b.status!=='string'||typeof b.uptime!=='number'||typeof b.active_pipelines!=='number')throw new Error('FAIL: 顶层类型'); ['scheduler','circuit_breaker','event_bus','notifier','planner'].forEach(k=>{if(!b.organs[k]||typeof b.organs[k]!=='object')throw new Error('FAIL organs.'+k)}); const cb=b.organs.circuit_breaker; if(typeof cb.status!=='string'||!Array.isArray(cb.open)||!Array.isArray(cb.half_open)||typeof cb.states!=='object')throw new Error('FAIL cb'); console.log('PASS')"

### Workstream 2: integration 与 smoke 测试覆盖（含三种状态 mock 注入）

**范围**:
- 在 `packages/brain/src/__tests__/integration/critical-routes.integration.test.js` 与 `packages/brain/src/__tests__/integration/golden-path.integration.test.js` 新增对 `docker_runtime` 结构与三种状态（healthy / unhealthy / disabled）的断言；
- 必须通过 `jest.mock` / `jest.doMock` / `jest.spyOn` 替换 `docker-runtime-probe` 模块，分别注入三种状态并断言：
  - healthy 下顶层 `status='healthy'`；
  - unhealthy+enabled 下顶层 `status='degraded'` 且 `error` 非空；
  - disabled 下顶层 `status` 不因此降级。
- brain integration 测试套件（critical-routes + golden-path）全量通过；既有 health 断言零回归。

**大小**: M（预计 120-200 行测试代码）
**依赖**: Workstream 1 完成后（需要 probe 模块与 health 端点字段已落地才能 mock + 断言）

**DoD**:
- [ ] [ARTIFACT] 两个 integration 测试文件均包含 `docker_runtime` 关键字
  Test: node -e "const fs=require('fs'); const p1='packages/brain/src/__tests__/integration/critical-routes.integration.test.js'; const p2='packages/brain/src/__tests__/integration/golden-path.integration.test.js'; if(!/docker_runtime/.test(fs.readFileSync(p1,'utf8')))throw new Error('FAIL: '+p1); if(!/docker_runtime/.test(fs.readFileSync(p2,'utf8')))throw new Error('FAIL: '+p2); console.log('PASS')"
- [ ] [ARTIFACT] integration 测试使用 `jest.mock` / `jest.doMock` / `jest.spyOn` 显式替换 probe 模块（至少 1 处）
  Test: node -e "const fs=require('fs'); const c=fs.readFileSync('packages/brain/src/__tests__/integration/critical-routes.integration.test.js','utf8')+'\n'+fs.readFileSync('packages/brain/src/__tests__/integration/golden-path.integration.test.js','utf8'); const ok=/jest\.mock\s*\(\s*['\"][^'\"]*docker-runtime-probe/.test(c)||/jest\.doMock\s*\(\s*['\"][^'\"]*docker-runtime-probe/.test(c)||/jest\.spyOn\s*\([^)]*[dD]ockerRuntimeProbe/.test(c)||/jest\.spyOn\s*\([^)]*,\s*['\"]probe['\"]/.test(c); if(!ok)throw new Error('FAIL: 未见 jest.mock/doMock/spyOn 对 probe 的替换'); console.log('PASS')"
- [ ] [ARTIFACT] 三种状态字面量 + `degraded` 聚合断言在 integration 测试中全部出现
  Test: node -e "const fs=require('fs'); const c=fs.readFileSync('packages/brain/src/__tests__/integration/critical-routes.integration.test.js','utf8')+'\n'+fs.readFileSync('packages/brain/src/__tests__/integration/golden-path.integration.test.js','utf8'); ['healthy','unhealthy','disabled','degraded'].forEach(s=>{if(!new RegExp(\"['\\\"\`]\"+s+\"['\\\"\`]\").test(c))throw new Error('FAIL miss '+s)}); console.log('PASS')"
- [ ] [BEHAVIOR] brain integration 测试（critical-routes + golden-path）全部通过；读取 npm test 真正的退出码（修复 Round 1 Issue 3）
  Test: set -o pipefail; (cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration' 2>&1 | tail -30); E=$?; [ "$E" = "0" ] && echo "PASS exit=$E" || { echo "FAIL exit=$E"; exit 1; }

---

## 给定-当-那么（Acceptance Criteria，Given-When-Then）

**AC-1**（对应 Feature 1 / FR-001 / FR-002 / 场景 1）:
- **Given** Brain 启动且 Docker daemon 正常
- **When** 调用 `GET /api/brain/health`
- **Then** 响应 200，JSON 顶层存在 `docker_runtime` 对象，字段 `enabled`（boolean）/ `status`（∈{healthy,unhealthy,disabled,unknown}）/ `reachable`（boolean）/ `version`（string|null）/ `error`（string|null）全部就位，且 `status='healthy'` / `enabled=true` / `reachable=true`

**AC-2**（对应 Feature 2 / FR-003 / 场景 2 / 场景 4 — 不可达场景下沉 WS2 mock 验证）:
- **Given** Docker 探测模块被 Jest mock 注入 `reachable=false` + `status='unhealthy'` + `error` 非空的结果
- **When** integration 测试调用 `GET /api/brain/health`
- **Then** HTTP 状态码 200（不 500），`docker_runtime.reachable=false` / `status='unhealthy'` / `error` 为非空字符串；且 live 端点 happy path 响应耗时 ≤ 3000ms、probe 模块源码超时常量 ≤ 2000ms、显式含 try/catch

**AC-3**（对应 Feature 3 / FR-004 / 场景 2 / 场景 3 — 聚合规则下沉 WS2 mock 验证）:
- **Given** probe 被 mock 为 `enabled=true` + `status='unhealthy'`
- **When** integration 测试调用 `GET /api/brain/health`
- **Then** 响应顶层 `status='degraded'`；反之 probe 被 mock 为 `status='disabled'` 且其它器官正常时，顶层 `status='healthy'`，不因 disabled 本身降级；live 端点聚合逻辑与当前 docker_runtime 状态保持一致（无 SKIP 假阳性分支），且 `goals.js` 源码显式引用 `docker_runtime` 并在附近出现 `degraded` 关键字

**AC-4**（对应 Feature 4 / FR-005 / 场景 5）:
- **Given** 既有 health 响应消费者依赖原有 7 个顶层字段与 5 个 organs 子器官
- **When** 新字段上线后调用 `GET /api/brain/health`
- **Then** 所有既有字段名、类型、嵌套层级保持完全一致；`evaluator_stats` 与 `tick_stats` 的子字段全部保留；`organs.circuit_breaker` 的 `status`/`open`/`half_open`/`states` 结构不变

**AC-5**（对应 Feature 5 / SC-001 / SC-003 / SC-004）:
- **Given** `docker_runtime` 字段与 probe 模块已实现
- **When** 运行 `set -o pipefail; cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration'`
- **Then** 测试全部通过（退出码 0，以 `PIPESTATUS[0]` 或 `pipefail` 读取真实 npm test 退出码，非 tail 的恒 0）；测试源码包含对 `docker_runtime` 的断言、`jest.mock`/`doMock`/`spyOn` 对 probe 模块的替换、`'healthy'` / `'unhealthy'` / `'disabled'` / `'degraded'` 四个字面量全部出现

---

**合同结束** — 下一步：Evaluator 评审合同草案（挑战验证命令严格性、硬阈值可量化性、Workstream 独立性）。
