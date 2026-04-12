# Sprint Contract Draft (Round 5)

## Feature 1: Health 端点返回 evaluator_stats 字段且数据与数据库一致

**行为描述**:
调用 `GET /api/brain/health` 时，响应 JSON 顶级包含 `evaluator_stats` 对象，含 `total_runs`（整数）、`passed`（整数）、`failed`（整数）、`last_run_at`（ISO 时间戳字符串或 null）四个字段。这些值必须与数据库中 `task_type='harness_evaluate'` 的终态记录精确一致：`passed` = `status='completed'` 的数量，`failed` = `status IN ('canceled','failed')` 的数量，`total_runs` = passed + failed，`last_run_at` = 最近一条终态记录的 `completed_at` 时间戳（精度误差 ≤ 2 秒）。查询通过 `Promise.all` 与现有查询并行执行，不阻塞其他字段返回。

**硬阈值**:
- `evaluator_stats` 不为 null 且为对象类型
- `evaluator_stats` 恰好包含 `total_runs`、`passed`、`failed`、`last_run_at` 四个键，无多余键
- `total_runs` 为非负整数，严格等于 `passed + failed`
- `passed` 精确等于数据库中 `task_type='harness_evaluate' AND status='completed'` 的数量
- `failed` 精确等于数据库中 `task_type='harness_evaluate' AND status IN ('canceled','failed')` 的数量
- `last_run_at` 在有终态记录时为合法 ISO 8601 时间戳，且与数据库 `MAX(completed_at)` 偏差 ≤ 2 秒
- `last_run_at` 在无终态记录时严格等于 `null`
- Health 端点整体响应时间 < 200ms（含新增查询）

**验证命令**:
```bash
# C1: passed/failed 分别与 DB 核对（防止 total 正确但分配错误的假实现）
PASSED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status='completed'")
FAILED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status IN ('canceled','failed')")
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;
    if (!s || typeof s !== 'object') { console.log('FAIL: evaluator_stats 缺失或非对象'); process.exit(1); }
    const ep = parseInt(process.argv[1]), ef = parseInt(process.argv[2]);
    if (typeof s.passed !== 'number' || s.passed !== ep) { console.log('FAIL: passed=' + s.passed + ' 期望=' + ep); process.exit(1); }
    if (typeof s.failed !== 'number' || s.failed !== ef) { console.log('FAIL: failed=' + s.failed + ' 期望=' + ef); process.exit(1); }
    if (typeof s.total_runs !== 'number' || s.total_runs !== ep + ef) { console.log('FAIL: total_runs=' + s.total_runs + ' 期望=' + (ep+ef)); process.exit(1); }
    console.log('PASS: passed=' + s.passed + ' failed=' + s.failed + ' total=' + s.total_runs + ' 均与 DB 一致');
  " "$PASSED" "$FAILED"

# C2: last_run_at 与 DB 最近完成时间一致（允许 2 秒精度差异）
DB_LAST=$(psql -t -A cecelia -c "SELECT COALESCE(to_char(max(completed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), 'null') FROM tasks WHERE task_type='harness_evaluate' AND status IN ('completed','canceled','failed')")
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;
    const dbLast = process.argv[1];
    if (dbLast === 'null') {
      if (s.last_run_at !== null) { console.log('FAIL: DB 无记录但 last_run_at=' + s.last_run_at); process.exit(1); }
    } else {
      if (s.last_run_at === null) { console.log('FAIL: DB 有记录但 last_run_at=null'); process.exit(1); }
      if (typeof s.last_run_at !== 'string' || isNaN(Date.parse(s.last_run_at))) { console.log('FAIL: last_run_at 不是合法 ISO 时间戳'); process.exit(1); }
      const dbMs = new Date(dbLast).getTime(), apiMs = new Date(s.last_run_at).getTime();
      if (Math.abs(dbMs - apiMs) > 2000) { console.log('FAIL: last_run_at 偏差超过 2s — DB=' + dbLast + ' API=' + s.last_run_at); process.exit(1); }
    }
    console.log('PASS: last_run_at 与 DB 一致 (' + s.last_run_at + ')');
  " "$DB_LAST"

# C3: 结构完整性 — 恰好四个字段，类型正确，无多余键
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;
    if (!s || typeof s !== 'object') { console.log('FAIL: evaluator_stats 缺失'); process.exit(1); }
    const expected = ['total_runs','passed','failed','last_run_at'];
    const actual = Object.keys(s).sort();
    const exp = expected.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(exp)) { console.log('FAIL: 键不匹配 — 实际=' + actual + ' 期望=' + exp); process.exit(1); }
    if (typeof s.total_runs !== 'number' || !Number.isInteger(s.total_runs) || s.total_runs < 0) { console.log('FAIL: total_runs 类型/值域错误: ' + s.total_runs); process.exit(1); }
    if (typeof s.passed !== 'number' || !Number.isInteger(s.passed) || s.passed < 0) { console.log('FAIL: passed 类型/值域错误: ' + s.passed); process.exit(1); }
    if (typeof s.failed !== 'number' || !Number.isInteger(s.failed) || s.failed < 0) { console.log('FAIL: failed 类型/值域错误: ' + s.failed); process.exit(1); }
    if (s.last_run_at !== null && (typeof s.last_run_at !== 'string' || isNaN(Date.parse(s.last_run_at)))) { console.log('FAIL: last_run_at 类型错误'); process.exit(1); }
    if (s.passed + s.failed !== s.total_runs) { console.log('FAIL: passed+failed != total_runs'); process.exit(1); }
    console.log('PASS: 结构完整，恰好 4 个字段，类型正确 — total=' + s.total_runs + ' passed=' + s.passed + ' failed=' + s.failed + ' last=' + s.last_run_at);
  "

# C4: 响应时间无显著退化（< 200ms）
START=$(node -e "console.log(Date.now())")
curl -sf "localhost:5221/api/brain/health" > /dev/null
END=$(node -e "console.log(Date.now())")
ELAPSED=$((END - START))
[ "$ELAPSED" -lt 200 ] && echo "PASS: health 响应 ${ELAPSED}ms < 200ms" || (echo "FAIL: health 响应 ${ELAPSED}ms >= 200ms"; exit 1)
```

---

## Feature 2: 无 Evaluator 记录时返回零值对象

**行为描述**:
当数据库中不存在任何 `task_type='harness_evaluate'` 且处于终态（completed/canceled/failed）的记录时，`evaluator_stats` 返回严格的零值对象 `{total_runs: 0, passed: 0, failed: 0, last_run_at: null}`，而非 null、undefined 或缺失该字段。这通过 SQL `COALESCE` 或应用层默认值实现，不依赖条件分支跳过。

**硬阈值**:
- 无终态记录时 `total_runs` 严格等于数字 0（非 null、非 undefined、非字符串 "0"）
- 无终态记录时 `passed` 严格等于数字 0
- 无终态记录时 `failed` 严格等于数字 0
- 无终态记录时 `last_run_at` 严格等于 `null`（非空字符串、非 undefined、非 0）

**验证命令**:
```bash
# C5: 零值场景全面验证（无论当前 DB 是否有数据，均验证结构正确性）
DB_COUNT=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status IN ('completed','canceled','failed')")
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;
    const dbCount = parseInt(process.argv[1]);
    if (dbCount === 0) {
      if (s.total_runs !== 0) { console.log('FAIL: 无记录但 total_runs=' + s.total_runs); process.exit(1); }
      if (s.passed !== 0) { console.log('FAIL: 无记录但 passed=' + s.passed); process.exit(1); }
      if (s.failed !== 0) { console.log('FAIL: 无记录但 failed=' + s.failed); process.exit(1); }
      if (s.last_run_at !== null) { console.log('FAIL: 无记录但 last_run_at=' + s.last_run_at); process.exit(1); }
      console.log('PASS: 零值对象完全正确 {total_runs:0, passed:0, failed:0, last_run_at:null}');
    } else {
      if (s.total_runs <= 0) { console.log('FAIL: 有 ' + dbCount + ' 条记录但 total_runs=' + s.total_runs); process.exit(1); }
      if (s.total_runs !== s.passed + s.failed) { console.log('FAIL: total_runs != passed+failed'); process.exit(1); }
      if (typeof s.last_run_at !== 'string' || isNaN(Date.parse(s.last_run_at))) { console.log('FAIL: 有记录但 last_run_at 非法: ' + s.last_run_at); process.exit(1); }
      console.log('PASS: 有 ' + dbCount + ' 条记录，结构验证通过 — total=' + s.total_runs + ' passed=' + s.passed + ' failed=' + s.failed);
    }
  " "$DB_COUNT"

# C6: evaluator_stats 字段存在性和类型检查（不依赖数据量）
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!('evaluator_stats' in h)) { console.log('FAIL: 响应缺少 evaluator_stats 顶级字段'); process.exit(1); }
    if (h.evaluator_stats === null || h.evaluator_stats === undefined) { console.log('FAIL: evaluator_stats 为 ' + h.evaluator_stats); process.exit(1); }
    if (typeof h.evaluator_stats !== 'object' || Array.isArray(h.evaluator_stats)) { console.log('FAIL: evaluator_stats 不是普通对象'); process.exit(1); }
    console.log('PASS: evaluator_stats 字段存在且为普通对象');
  "
```

---

## Feature 3: 数据库降级容错

**行为描述**:
如果 evaluator_stats 的 SQL 查询失败（例如数据库连接瞬时中断），health 端点不应因此返回 500 错误。其余字段（status、uptime、tick_stats、organs 等）应正常返回，`evaluator_stats` 降级为 `null` 并附带错误信息（或静默降级为零值对象）。

**硬阈值**:
- evaluator_stats 查询异常时，health 端点仍返回 HTTP 200
- 其余字段（status、uptime、organs）不受影响
- evaluator_stats 降级为 null 或零值对象（不能是 undefined 或缺失键）

**验证命令**:
```bash
# C7: health 端点在正常情况下始终返回 200 且包含所有核心字段
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const required = ['status','uptime','active_pipelines','tick_stats','organs','evaluator_stats','timestamp'];
    const missing = required.filter(k => !(k in h));
    if (missing.length > 0) { console.log('FAIL: 缺少顶级字段: ' + missing.join(',')); process.exit(1); }
    console.log('PASS: 所有 ' + required.length + ' 个顶级字段均存在');
  "

# C8: HTTP 状态码检查
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/health")
[ "$STATUS" = "200" ] && echo "PASS: health 返回 HTTP 200" || (echo "FAIL: health 返回 HTTP $STATUS"; exit 1)
```

---

## Workstreams

workstream_count: 1

### Workstream 1: Health 端点新增 evaluator_stats 聚合查询

**范围**: 在 `packages/brain/src/routes/goals.js` 的 `/health` 路由（第 89-143 行）中新增一条 SQL 聚合查询，加入现有 `Promise.all` 并行数组，将聚合结果作为 `evaluator_stats` 字段加入响应 JSON。查询使用单条 SQL（COUNT + CASE WHEN + MAX）一次获取 passed/failed/last_run_at，避免多次 DB 往返。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [x] [BEHAVIOR] `GET /api/brain/health` 响应顶级包含 `evaluator_stats` 对象，含 `total_runs`/`passed`/`failed`/`last_run_at` 四个字段且仅此四个字段，数值与 DB 中 `task_type='harness_evaluate'` 终态记录精确一致（passed=completed 数量，failed=canceled+failed 数量，total=passed+failed，last_run_at 偏差 ≤ 2s）
  Test: manual:bash -c 'PASSED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='"'"'harness_evaluate'"'"' AND status='"'"'completed'"'"'") && FAILED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='"'"'harness_evaluate'"'"' AND status IN ('"'"'canceled'"'"','"'"'failed'"'"')") && curl -sf localhost:5221/api/brain/health | node -e "const s=JSON.parse(require('"'"'fs'"'"').readFileSync('"'"'/dev/stdin'"'"','"'"'utf8'"'"')).evaluator_stats;const ep=parseInt(process.argv[1]),ef=parseInt(process.argv[2]);if(!s||s.passed!==ep||s.failed!==ef||s.total_runs!==ep+ef){console.log('"'"'FAIL:'"'"'+JSON.stringify(s));process.exit(1)}console.log('"'"'PASS: passed='"'"'+s.passed+'"'"' failed='"'"'+s.failed+'"'"' total='"'"'+s.total_runs)" "$PASSED" "$FAILED"'
- [x] [BEHAVIOR] 无 Evaluator 终态记录时，`evaluator_stats` 返回零值对象 `{total_runs:0, passed:0, failed:0, last_run_at:null}` 而非 null/undefined/缺失；有记录时字段存在且类型正确（整数+ISO字符串）
  Test: manual:curl -sf localhost:5221/api/brain/health | node -e "const s=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;if(!s||typeof s!=='object'||Array.isArray(s)){process.exit(1)}const k=Object.keys(s).sort();if(JSON.stringify(k)!==JSON.stringify(['failed','last_run_at','passed','total_runs'])){process.exit(1)}if(typeof s.total_runs!=='number'||typeof s.passed!=='number'||typeof s.failed!=='number'){process.exit(1)}if(s.passed+s.failed!==s.total_runs){process.exit(1)}console.log('PASS')"
- [x] [BEHAVIOR] Health 端点响应时间无显著退化（新增查询增量 < 200ms）
  Test: manual:node -e "const{execSync}=require('child_process');const s=Date.now();execSync('curl -sf localhost:5221/api/brain/health');const e=Date.now()-s;if(e>=200){console.log('FAIL:'+e+'ms');process.exit(1)}console.log('PASS:'+e+'ms')"
