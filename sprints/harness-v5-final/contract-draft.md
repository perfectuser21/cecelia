# Sprint Contract Draft (Round 4)

## Feature 1: Health 端点返回 evaluator_stats 字段且数据与数据库一致

**行为描述**:
调用 `GET /api/brain/health` 时，响应 JSON 顶级包含 `evaluator_stats` 对象，含 `total_runs`（整数）、`passed`（整数）、`failed`（整数）、`last_run_at`（ISO 时间戳字符串或 null）。这四个字段的值必须与数据库中 `task_type='harness_evaluate'` 的实际记录精确一致：`passed` = status 为 `completed` 的数量，`failed` = status 为 `canceled` 的数量，`total_runs` = passed + failed，`last_run_at` = 最近一条终态记录的 `updated_at` 时间戳（精度误差 ≤ 2 秒）。

**硬阈值**:
- `evaluator_stats` 不为 null 且为对象类型
- `total_runs` 为非负整数，等于 `passed + failed`
- `passed` 精确等于数据库中 `status='completed'` 的 harness_evaluate 任务数
- `failed` 精确等于数据库中 `status='canceled'` 的 harness_evaluate 任务数
- `last_run_at` 在有记录时为合法 ISO 时间戳，且与数据库 `MAX(updated_at)` 偏差 ≤ 2 秒
- `last_run_at` 在无记录时为 `null`

**验证命令**:
```bash
# C1: passed/failed 分别与 DB 核对（防止 total 正确但分配错误的假实现）
PASSED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status='completed'")
FAILED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status='canceled'")
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

# C2: last_run_at 与 DB 最近执行时间一致（含实际值比较，允许 2 秒精度差异）
DB_LAST=$(psql -t -A cecelia -c "SELECT COALESCE(to_char(max(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), 'null') FROM tasks WHERE task_type='harness_evaluate' AND status IN ('completed','canceled')")
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

# C3: 结构完整性 — 四个字段全部存在且类型正确（无条件分支，不因有数据就跳过检查）
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;
    if (!s || typeof s !== 'object') { console.log('FAIL: evaluator_stats 缺失'); process.exit(1); }
    const fields = ['total_runs','passed','failed','last_run_at'];
    for (const f of fields) {
      if (!(f in s)) { console.log('FAIL: 缺少字段 ' + f); process.exit(1); }
    }
    if (typeof s.total_runs !== 'number' || !Number.isInteger(s.total_runs) || s.total_runs < 0) { console.log('FAIL: total_runs 类型或值域错误: ' + s.total_runs); process.exit(1); }
    if (typeof s.passed !== 'number' || !Number.isInteger(s.passed) || s.passed < 0) { console.log('FAIL: passed 类型或值域错误: ' + s.passed); process.exit(1); }
    if (typeof s.failed !== 'number' || !Number.isInteger(s.failed) || s.failed < 0) { console.log('FAIL: failed 类型或值域错误: ' + s.failed); process.exit(1); }
    if (s.last_run_at !== null && (typeof s.last_run_at !== 'string' || isNaN(Date.parse(s.last_run_at)))) { console.log('FAIL: last_run_at 类型错误'); process.exit(1); }
    if (s.passed + s.failed !== s.total_runs) { console.log('FAIL: passed+failed != total_runs'); process.exit(1); }
    console.log('PASS: 结构完整，类型正确 — total=' + s.total_runs + ' passed=' + s.passed + ' failed=' + s.failed + ' last=' + s.last_run_at);
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
当数据库中不存在任何 `task_type='harness_evaluate'` 且处于终态（completed/canceled）的记录时，`evaluator_stats` 返回 `{total_runs: 0, passed: 0, failed: 0, last_run_at: null}`，而非 null、undefined 或缺失该字段。

**硬阈值**:
- 无记录时 `total_runs` 严格等于 0（非 null、非 undefined）
- 无记录时 `passed` 严格等于 0
- 无记录时 `failed` 严格等于 0
- 无记录时 `last_run_at` 严格等于 null（非空字符串、非 undefined）

**验证命令**:
```bash
# C5: 零值场景 — 通过 DB 实际记录数判断预期行为，无条件分支跳过
DB_COUNT=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status IN ('completed','canceled')")
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;
    const dbCount = parseInt(process.argv[1]);
    if (dbCount === 0) {
      // 无记录场景：严格验证零值
      if (s.total_runs !== 0) { console.log('FAIL: 无记录但 total_runs=' + s.total_runs); process.exit(1); }
      if (s.passed !== 0) { console.log('FAIL: 无记录但 passed=' + s.passed); process.exit(1); }
      if (s.failed !== 0) { console.log('FAIL: 无记录但 failed=' + s.failed); process.exit(1); }
      if (s.last_run_at !== null) { console.log('FAIL: 无记录但 last_run_at=' + s.last_run_at); process.exit(1); }
      console.log('PASS: 零值对象完全正确 {total_runs:0, passed:0, failed:0, last_run_at:null}');
    } else {
      // 有记录场景：验证非零值结构正确性（不跳过，仍然检查）
      if (s.total_runs <= 0) { console.log('FAIL: 有 ' + dbCount + ' 条记录但 total_runs=' + s.total_runs); process.exit(1); }
      if (s.total_runs !== s.passed + s.failed) { console.log('FAIL: total_runs != passed+failed'); process.exit(1); }
      if (typeof s.last_run_at !== 'string' || isNaN(Date.parse(s.last_run_at))) { console.log('FAIL: 有记录但 last_run_at 非法: ' + s.last_run_at); process.exit(1); }
      console.log('PASS: 有 ' + dbCount + ' 条记录，结构验证通过 — total=' + s.total_runs + ' passed=' + s.passed + ' failed=' + s.failed);
    }
  " "$DB_COUNT"

# C6: evaluator_stats 字段存在性（health 端点即使 DB 异常也不应缺失该字段）
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!('evaluator_stats' in h)) { console.log('FAIL: 响应缺少 evaluator_stats 顶级字段'); process.exit(1); }
    if (h.evaluator_stats === undefined) { console.log('FAIL: evaluator_stats 为 undefined'); process.exit(1); }
    console.log('PASS: evaluator_stats 字段存在，类型=' + typeof h.evaluator_stats);
  "
```

---

## Workstreams

workstream_count: 1

### Workstream 1: Health 端点新增 evaluator_stats 聚合查询

**范围**: 在 `packages/brain/src/routes/goals.js` 的 health 端点路由中新增一条 SQL 聚合查询（COUNT + MAX），将结果作为 `evaluator_stats` 字段加入响应 JSON。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] `GET /api/brain/health` 响应包含 `evaluator_stats` 对象，含 `total_runs`/`passed`/`failed`/`last_run_at` 四个字段，数值与 DB 中 `task_type='harness_evaluate'` 终态记录精确一致（passed/failed 分别核对，last_run_at 偏差 ≤ 2s）
  Test: manual:bash -c 'PASSED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='"'"'harness_evaluate'"'"' AND status='"'"'completed'"'"'") && FAILED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='"'"'harness_evaluate'"'"' AND status='"'"'canceled'"'"'") && curl -sf localhost:5221/api/brain/health | node -e "const s=JSON.parse(require('"'"'fs'"'"').readFileSync('"'"'/dev/stdin'"'"','"'"'utf8'"'"')).evaluator_stats;const ep=parseInt(process.argv[1]),ef=parseInt(process.argv[2]);if(s.passed!==ep||s.failed!==ef||s.total_runs!==ep+ef){console.log('"'"'FAIL'"'"');process.exit(1)}console.log('"'"'PASS'"'"')" "$PASSED" "$FAILED"'
- [ ] [BEHAVIOR] 无 Evaluator 终态记录时，`evaluator_stats` 返回零值对象 `{total_runs:0, passed:0, failed:0, last_run_at:null}` 而非 null 或缺失
  Test: manual:curl -sf localhost:5221/api/brain/health | node -e "const s=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;if(!s||typeof s!=='object'){process.exit(1)}if(!('total_runs' in s)||!('passed' in s)||!('failed' in s)||!('last_run_at' in s)){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Health 端点响应时间无显著退化（新增查询增量 < 200ms）
  Test: manual:node -e "const{execSync}=require('child_process');const s=Date.now();execSync('curl -sf localhost:5221/api/brain/health');const e=Date.now()-s;if(e>=200){console.log('FAIL:'+e+'ms');process.exit(1)}console.log('PASS:'+e+'ms')"
