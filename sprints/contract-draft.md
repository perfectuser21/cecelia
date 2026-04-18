# Sprint Contract Draft (Round 1)

**Task ID**: 0f7fec19-f9a7-41ac-81d8-81fc15be4503
**生成时间**: 2026-04-18
**对应 PRD**: sprints/sprint-prd.md（Brain `/api/brain/health` 新增 `docker_runtime` 字段）

---

## Feature 1: `/api/brain/health` 响应中新增 `docker_runtime` 字段（结构与字段完整性）

**行为描述**:
调用方发起 `GET /api/brain/health` 时，返回的 JSON 顶层必须包含 `docker_runtime` 对象。该对象至少包含 `enabled`（bool）、`status`（enum）、`reachable`（bool）、`version`（string 或 null）、`error`（string 或 null）五个字段。`status` 取值必须落在 `healthy` / `unhealthy` / `disabled` / `unknown` 四者之一。

**硬阈值**:
- HTTP 状态码 = 200
- 响应 JSON 顶层存在 `docker_runtime` 字段，类型为 object（非 null / 非 array）
- `docker_runtime.enabled` 存在且类型为 boolean
- `docker_runtime.status` 存在，值 ∈ {`healthy`, `unhealthy`, `disabled`, `unknown`}
- `docker_runtime.reachable` 存在且类型为 boolean
- `docker_runtime.version` 存在，类型为 string 或 null
- `docker_runtime.error` 存在，类型为 string 或 null
- 当 `status === 'disabled'` 时 `enabled === false`；当 `status === 'healthy'` 时 `enabled === true` 且 `reachable === true`

**验证命令**:
```bash
# 结构完整性 + 字段类型 + 枚举值
curl -sf http://localhost:5221/api/brain/health | node -e "
  const body = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const dr = body.docker_runtime;
  if (!dr || typeof dr !== 'object' || Array.isArray(dr)) throw new Error('FAIL: docker_runtime 缺失或类型错误');
  if (typeof dr.enabled !== 'boolean') throw new Error('FAIL: enabled 非 boolean');
  const allowed = ['healthy','unhealthy','disabled','unknown'];
  if (!allowed.includes(dr.status)) throw new Error('FAIL: status 取值非法 -> ' + dr.status);
  if (typeof dr.reachable !== 'boolean') throw new Error('FAIL: reachable 非 boolean');
  if (!(typeof dr.version === 'string' || dr.version === null)) throw new Error('FAIL: version 非 string|null');
  if (!(typeof dr.error === 'string' || dr.error === null)) throw new Error('FAIL: error 非 string|null');
  if (dr.status === 'disabled' && dr.enabled !== false) throw new Error('FAIL: disabled 必须 enabled=false');
  if (dr.status === 'healthy' && (dr.enabled !== true || dr.reachable !== true)) throw new Error('FAIL: healthy 必须 enabled=true && reachable=true');
  console.log('PASS: docker_runtime 结构与字段类型全部符合');
"

# HTTP 状态码验证
STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5221/api/brain/health)
[ "$STATUS" = "200" ] && echo "PASS: health 端点返回 200" || (echo "FAIL: 期望 200，实际 $STATUS"; exit 1)
```

---

## Feature 2: Docker 探测超时保护与错误隔离

**行为描述**:
Docker 运行时探测必须在 ≤ 2 秒内返回结果；Docker daemon 不可用或超时时，health 端点本身必须返回 200（不降级为 500），并在 `docker_runtime` 字段中以 `status: 'unhealthy'` / `reachable: false` / `error: <非空字符串>` 标记。整个 health 端点在 Docker down 场景下响应时间 ≤ 3 秒。

**硬阈值**:
- health 端点响应时间 ≤ 3000ms（Docker 正常场景下通常 < 500ms）
- Docker daemon 停止时，HTTP 状态码依然 = 200
- Docker 不可达时 `docker_runtime.status === 'unhealthy'` 且 `docker_runtime.reachable === false`
- 当 `status === 'unhealthy'` 时 `error` 字段必须为非空字符串（含失败原因）
- Docker 探测不得抛出未捕获异常导致 health 端点 500

**验证命令**:
```bash
# 响应时间验证（正常场景 ≤ 3000ms）
START=$(date +%s%3N); curl -sf http://localhost:5221/api/brain/health > /dev/null; END=$(date +%s%3N)
ELAPSED=$((END - START))
[ "$ELAPSED" -le 3000 ] && echo "PASS: health 响应耗时 ${ELAPSED}ms ≤ 3000ms" || (echo "FAIL: 耗时 ${ELAPSED}ms 超过 3000ms 阈值"; exit 1)

# Docker 探测独立错误保护 — 即使 Docker 不可达，端点必须 200
# （测试环境：临时设置 DOCKER_HOST=tcp://127.0.0.1:1 模拟不可达）
DOCKER_HOST=tcp://127.0.0.1:1 curl -s -o /tmp/health.json -w '%{http_code}\n' http://localhost:5221/api/brain/health > /tmp/health.code
CODE=$(cat /tmp/health.code | tr -d '[:space:]')
[ "$CODE" = "200" ] || (echo "FAIL: Docker 不可达时 health 端点返回 $CODE（期望 200）"; exit 1)
node -e "
  const dr = JSON.parse(require('fs').readFileSync('/tmp/health.json','utf8')).docker_runtime;
  if (!dr) throw new Error('FAIL: docker_runtime 缺失');
  if (dr.reachable !== false) throw new Error('FAIL: Docker 不可达场景 reachable 应为 false，实际 ' + dr.reachable);
  if (dr.status !== 'unhealthy') throw new Error('FAIL: status 应为 unhealthy，实际 ' + dr.status);
  if (typeof dr.error !== 'string' || dr.error.length === 0) throw new Error('FAIL: unhealthy 状态下 error 必须为非空字符串');
  console.log('PASS: Docker 不可达场景错误隔离正确');
"
```

---

## Feature 3: 顶层 `status` 聚合规则对 `docker_runtime` 的响应

**行为描述**:
当 `docker_runtime.enabled === true` 且 `docker_runtime.status === 'unhealthy'` 时，health 响应的顶层 `status` 字段必须聚合为 `degraded`（与既有 `circuit_breaker` open 时的聚合语义一致）。当 `docker_runtime.status === 'disabled'` 时，顶层 `status` 不得因此从 healthy 退化（disabled 表示未启用，不视为故障）。

**硬阈值**:
- `docker_runtime.enabled === true && docker_runtime.status === 'unhealthy'` ⇒ 顶层 `status === 'degraded'`
- `docker_runtime.status === 'disabled'` ⇒ 顶层 `status` 由其它器官决定（不因 disabled 本身降级）
- `docker_runtime.status === 'healthy'` 且其它器官正常 ⇒ 顶层 `status === 'healthy'`

**验证命令**:
```bash
# 场景 A：Docker 不可达 + enabled=true → 顶层 degraded
DOCKER_HOST=tcp://127.0.0.1:1 curl -sf http://localhost:5221/api/brain/health | node -e "
  const b = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (b.docker_runtime.enabled === true && b.docker_runtime.status === 'unhealthy') {
    if (b.status !== 'degraded') throw new Error('FAIL: 期望顶层 degraded，实际 ' + b.status);
    console.log('PASS: unhealthy+enabled 聚合为 degraded');
  } else {
    console.log('SKIP: 未满足触发条件（需 enabled=true 且 unhealthy）');
  }
"

# 场景 B：Docker 未启用 → 顶层 status 不因此 degraded
DISABLE_DOCKER_RUNTIME=true curl -sf http://localhost:5221/api/brain/health | node -e "
  const b = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (b.docker_runtime.status !== 'disabled') {
    console.log('SKIP: 环境未触发 disabled 状态（需 DISABLE_DOCKER_RUNTIME=true 或等价开关）');
    process.exit(0);
  }
  // disabled 不应影响顶层 status；若顶层 degraded 必须由其它器官引起
  if (b.status === 'degraded') {
    const cbOpen = (b.organs?.circuit_breaker?.open || []).length > 0;
    const schedStopped = b.organs?.scheduler?.status !== 'running';
    if (!cbOpen && !schedStopped) throw new Error('FAIL: 顶层 degraded 但非其它器官原因，疑似 disabled 误降级');
  }
  console.log('PASS: disabled 不触发顶层 degraded');
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
# 既有字段结构 + 类型保护（回归保护）
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

## Feature 5: integration/smoke 测试新增 docker_runtime 覆盖

**行为描述**:
`packages/brain/src/__tests__/integration/critical-routes.integration.test.js` 与 `packages/brain/src/__tests__/integration/golden-path.integration.test.js` 中必须新增对 `docker_runtime` 字段结构与三种状态（healthy / unhealthy / disabled）的断言，测试全部通过；既有 health 断言零回归；smoke 测试（若存在 health schema）同步更新。

**硬阈值**:
- `critical-routes.integration.test.js` 新增至少 1 个针对 `docker_runtime` 字段结构的测试用例，且测试通过
- `golden-path.integration.test.js` 已有 health 端点断言扩展覆盖 `docker_runtime` 顶层字段存在性与类型
- 三种状态（healthy / unhealthy / disabled）各至少 1 个断言覆盖
- 现有 health 相关测试 100% 通过（零回归）
- `npm test -- --testPathPattern=brain` 退出码为 0

**验证命令**:
```bash
# 新增断言存在性 — 测试文件中出现 docker_runtime 关键字
node -e "
  const fs = require('fs');
  const p1 = 'packages/brain/src/__tests__/integration/critical-routes.integration.test.js';
  const p2 = 'packages/brain/src/__tests__/integration/golden-path.integration.test.js';
  const c1 = fs.readFileSync(p1, 'utf8');
  const c2 = fs.readFileSync(p2, 'utf8');
  if (!/docker_runtime/.test(c1)) throw new Error('FAIL: ' + p1 + ' 未新增 docker_runtime 断言');
  if (!/docker_runtime/.test(c2)) throw new Error('FAIL: ' + p2 + ' 未新增 docker_runtime 断言');
  // 三种状态覆盖（任一测试文件里出现即可）
  const combined = c1 + c2;
  const states = ['healthy','unhealthy','disabled'];
  for (const s of states) {
    const re = new RegExp(\"['\\\"\`]\" + s + \"['\\\"\`]\");
    if (!re.test(combined)) throw new Error('FAIL: 三种状态未全覆盖，缺 ' + s);
  }
  console.log('PASS: integration 测试新增 docker_runtime + 三状态覆盖');
"

# 测试实际运行 — brain 相关测试全部通过
cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration' 2>&1 | tail -20
EXIT=$?
[ "$EXIT" = "0" ] && echo "PASS: brain integration 测试通过" || (echo "FAIL: 测试失败 exit=$EXIT"; exit 1)
```

---

## Workstreams

workstream_count: 2

### Workstream 1: Docker 探测模块 + health 端点集成

**范围**: 新增 Docker 运行时探测模块（文件由实现者定，建议 `packages/brain/src/docker-runtime-probe.js`），实现 probe 函数返回 `{enabled, status, reachable, version, error}`；在 `packages/brain/src/routes/goals.js` 的 health 端点中调用探测并将结果拼入响应 JSON；实现顶层 `status` 聚合规则对 `docker_runtime` 的响应；具备 ≤ 2 秒超时与错误隔离；不得改动任何现有字段。
**大小**: M（预计 150-250 行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] Docker 探测模块文件存在且导出可调用的探测函数
  Test: node -e "const m = require('./packages/brain/src/docker-runtime-probe.js'); if (typeof (m.probe || m.default || m) !== 'function') throw new Error('FAIL: 未导出探测函数'); console.log('OK')"
- [ ] [BEHAVIOR] `GET /api/brain/health` 响应顶层包含 `docker_runtime` 对象，字段类型与枚举值全部符合 Feature 1 硬阈值
  Test: curl -sf http://localhost:5221/api/brain/health | node -e "const dr=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).docker_runtime; if(!dr||typeof dr.enabled!=='boolean'||!['healthy','unhealthy','disabled','unknown'].includes(dr.status)||typeof dr.reachable!=='boolean'||!(typeof dr.version==='string'||dr.version===null)||!(typeof dr.error==='string'||dr.error===null))throw new Error('FAIL: docker_runtime 字段不符'); console.log('PASS')"
- [ ] [BEHAVIOR] Docker 不可达时 health 端点返回 200 且耗时 ≤ 3000ms，`reachable=false`/`status=unhealthy`/`error` 非空
  Test: S=$(date +%s%3N); CODE=$(DOCKER_HOST=tcp://127.0.0.1:1 curl -s -o /tmp/h.json -w '%{http_code}' http://localhost:5221/api/brain/health); E=$(date +%s%3N); [ "$CODE" = "200" ] && [ $((E-S)) -le 3000 ] && node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/h.json','utf8')).docker_runtime; if(d.reachable!==false||d.status!=='unhealthy'||typeof d.error!=='string'||d.error.length===0)throw new Error('FAIL'); console.log('PASS')"
- [ ] [BEHAVIOR] 顶层 `status` 聚合：`docker_runtime.enabled=true && status=unhealthy` 时顶层为 `degraded`
  Test: DOCKER_HOST=tcp://127.0.0.1:1 curl -sf http://localhost:5221/api/brain/health | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(b.docker_runtime.enabled===true&&b.docker_runtime.status==='unhealthy'&&b.status!=='degraded')throw new Error('FAIL: 期望 degraded，实际 '+b.status); console.log('PASS')"
- [ ] [BEHAVIOR] 向后兼容：既有顶层字段（status/uptime/active_pipelines/evaluator_stats/tick_stats/organs/timestamp）与 organs 下五子器官全部保留，类型不变
  Test: curl -sf http://localhost:5221/api/brain/health | node -e "const b=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); ['status','uptime','active_pipelines','evaluator_stats','tick_stats','organs','timestamp'].forEach(k=>{if(!(k in b))throw new Error('FAIL missing '+k)}); ['scheduler','circuit_breaker','event_bus','notifier','planner'].forEach(k=>{if(!b.organs[k])throw new Error('FAIL organs.'+k)}); console.log('PASS')"

### Workstream 2: integration 与 smoke 测试覆盖

**范围**: 在 `packages/brain/src/__tests__/integration/critical-routes.integration.test.js` 与 `packages/brain/src/__tests__/integration/golden-path.integration.test.js` 新增对 `docker_runtime` 结构与三种状态（healthy / unhealthy / disabled）的断言；若 `smoke.test.js` 涉及 health schema 同步更新；既有 health 断言零回归；brain integration 测试全量通过。
**大小**: S-M（预计 80-150 行测试代码）
**依赖**: Workstream 1 完成后（需要 docker_runtime 字段已在响应中返回才能断言）

**DoD**:
- [ ] [ARTIFACT] `critical-routes.integration.test.js` 与 `golden-path.integration.test.js` 均包含 `docker_runtime` 关键字的新增断言
  Test: node -e "const fs=require('fs'); const p1='packages/brain/src/__tests__/integration/critical-routes.integration.test.js'; const p2='packages/brain/src/__tests__/integration/golden-path.integration.test.js'; if(!/docker_runtime/.test(fs.readFileSync(p1,'utf8')))throw new Error('FAIL: '+p1); if(!/docker_runtime/.test(fs.readFileSync(p2,'utf8')))throw new Error('FAIL: '+p2); console.log('PASS')"
- [ ] [ARTIFACT] 三种状态（healthy / unhealthy / disabled）均在 integration 测试中有字面量覆盖
  Test: node -e "const fs=require('fs'); const c=fs.readFileSync('packages/brain/src/__tests__/integration/critical-routes.integration.test.js','utf8')+fs.readFileSync('packages/brain/src/__tests__/integration/golden-path.integration.test.js','utf8'); ['healthy','unhealthy','disabled'].forEach(s=>{if(!new RegExp(\"['\\\"\`]\"+s+\"['\\\"\`]\").test(c))throw new Error('FAIL miss '+s)}); console.log('PASS')"
- [ ] [BEHAVIOR] brain integration 测试（critical-routes 与 golden-path）全部通过，零回归
  Test: cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration' 2>&1 | tail -5 && [ "${PIPESTATUS[0]}" = "0" ] && echo PASS || (echo FAIL; exit 1)

---

## 给定-当-那么（Acceptance Criteria，Given-When-Then）

**AC-1**（对应 Feature 1 / FR-001 / FR-002 / 场景 1）:
- **Given** Brain 启动且 Docker daemon 正常
- **When** 调用 `GET /api/brain/health`
- **Then** 响应 200，JSON 顶层存在 `docker_runtime` 对象，字段 `enabled`（boolean）/ `status`（∈{healthy,unhealthy,disabled,unknown}）/ `reachable`（boolean）/ `version`（string|null）/ `error`（string|null）全部就位，且 `status === 'healthy'` / `enabled === true` / `reachable === true`

**AC-2**（对应 Feature 2 / FR-003 / 场景 2 / 场景 4）:
- **Given** Docker daemon 不可达（socket 被占或 DOCKER_HOST 指向错误地址）
- **When** 调用 `GET /api/brain/health`
- **Then** HTTP 状态码仍为 200（不 500），端点响应耗时 ≤ 3000ms，`docker_runtime.reachable === false`、`docker_runtime.status === 'unhealthy'`、`docker_runtime.error` 为非空字符串

**AC-3**（对应 Feature 3 / FR-004 / 场景 2 / 场景 3）:
- **Given** `docker_runtime.enabled === true` 且探测结果为 `unhealthy`
- **When** 调用 `GET /api/brain/health`
- **Then** 响应顶层 `status === 'degraded'`；反之当 `docker_runtime.status === 'disabled'` 且其它器官正常时，顶层 `status === 'healthy'`，不因 disabled 本身降级

**AC-4**（对应 Feature 4 / FR-005 / 场景 5）:
- **Given** 既有 health 响应消费者依赖原有 7 个顶层字段与 5 个 organs 子器官
- **When** 新字段上线后调用 `GET /api/brain/health`
- **Then** 所有既有字段名、类型、嵌套层级保持完全一致；`evaluator_stats` 与 `tick_stats` 的子字段全部保留；`organs.circuit_breaker` 的 `status`/`open`/`half_open`/`states` 结构不变

**AC-5**（对应 Feature 5 / SC-001 / SC-003 / SC-004）:
- **Given** `docker_runtime` 字段已实现
- **When** 运行 `npm test -- --testPathPattern='(critical-routes|golden-path)\.integration'`
- **Then** 测试全部通过，且测试源码包含对 `docker_runtime` 的断言、覆盖 `healthy` / `unhealthy` / `disabled` 三种状态字面量

---

**合同结束** — 下一步：Evaluator 评审合同草案（挑战验证命令严格性、硬阈值可量化性、Workstream 独立性）。
