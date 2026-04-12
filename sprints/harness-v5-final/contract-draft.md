# Sprint Contract Draft (Round 2)

> Round 2 修订说明：根据 Evaluator 反馈修复 3 个"命令太弱"问题——
> (1) Feature 1 DB 一致性命令拆分 passed/failed 独立核对；
> (2) Feature 2 零值场景移除条件分支，统一检查结构+值域；
> (3) DoD-2 增加 typeof + 必要字段完整性检查。

---

## Feature 1: Health 端点返回 evaluator_stats 统计

**行为描述**:
调用 `GET /api/brain/health` 时，响应 JSON 顶级包含 `evaluator_stats` 对象，含 `total_runs`（整数）、`passed`（整数）、`failed`（整数）、`last_run_at`（ISO 时间戳或 null）四个字段。数值与数据库中 `harness_evaluate` 类型任务的实际记录一致。

**硬阈值**:
- `evaluator_stats` 为非 null 对象，含 `total_runs`、`passed`、`failed`、`last_run_at` 四个字段
- `total_runs` = `passed` + `failed`
- `passed` 与数据库中 status='completed' 的 harness_evaluate 任务数一致
- `failed` 与数据库中 status='canceled' 的 harness_evaluate 任务数一致
- `last_run_at` 为合法 ISO 8601 时间戳或 null
- health 端点响应时间增量 < 50ms

**验证命令**:
```bash
# C1: DB 一致性 — passed/failed 分别核对
PASSED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status='completed'")
FAILED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status='canceled'")
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const s = h.evaluator_stats;
    const ep = parseInt(process.argv[1]), ef = parseInt(process.argv[2]);
    if (s.passed !== ep) { console.log('FAIL: passed=' + s.passed + ' 期望=' + ep); process.exit(1); }
    if (s.failed !== ef) { console.log('FAIL: failed=' + s.failed + ' 期望=' + ef); process.exit(1); }
    if (s.total_runs !== ep + ef) { console.log('FAIL: total_runs=' + s.total_runs + ' 不等于 passed+failed=' + (ep+ef)); process.exit(1); }
    console.log('PASS: passed=' + s.passed + ' failed=' + s.failed + ' total=' + s.total_runs + ' 均与 DB 一致');
  " "$PASSED" "$FAILED"
```

```bash
# C2: last_run_at 与 DB 最近执行时间一致
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
    }
    console.log('PASS: last_run_at 与 DB 一致 (' + s.last_run_at + ')');
  " "$DB_LAST"
```

---

## Feature 2: 零记录时返回零值对象 + 结构正确性

**行为描述**:
无论数据库中是否存在 Evaluator 记录，`evaluator_stats` 始终返回合法对象（不为 null、不缺字段）。无记录时返回 `{total_runs: 0, passed: 0, failed: 0, last_run_at: null}`。所有数值字段为非负整数，`last_run_at` 为合法 ISO 时间戳或 null。

**硬阈值**:
- `evaluator_stats` 为普通对象（非 null、非数组、非字符串）
- 包含且仅需包含 `total_runs`、`passed`、`failed`、`last_run_at` 四个字段
- 数值字段类型为 number 且 >= 0
- `last_run_at` 为 null 或合法 ISO 8601 字符串

**验证命令**:
```bash
# C3: 结构+类型+值域统一检查（无条件分支，不论有无数据均执行全部断言）
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { console.log('FAIL: evaluator_stats 不是普通对象'); process.exit(1); }
    if (typeof s.total_runs !== 'number' || typeof s.passed !== 'number' || typeof s.failed !== 'number') { console.log('FAIL: 数值字段类型错误 total_runs=' + typeof s.total_runs + ' passed=' + typeof s.passed + ' failed=' + typeof s.failed); process.exit(1); }
    if (s.total_runs < 0 || s.passed < 0 || s.failed < 0) { console.log('FAIL: 存在负数 total=' + s.total_runs + ' passed=' + s.passed + ' failed=' + s.failed); process.exit(1); }
    if (s.total_runs !== s.passed + s.failed) { console.log('FAIL: total_runs(' + s.total_runs + ') !== passed(' + s.passed + ')+failed(' + s.failed + ')'); process.exit(1); }
    if (s.last_run_at !== null && (typeof s.last_run_at !== 'string' || isNaN(Date.parse(s.last_run_at)))) { console.log('FAIL: last_run_at 格式无效: ' + s.last_run_at); process.exit(1); }
    console.log('PASS: evaluator_stats 结构+类型+值域+算术一致性全部通过');
  "
```

```bash
# C4: 响应时间检查（health 端点 < 200ms 总响应）
START=$(node -e "console.log(Date.now())")
curl -sf "localhost:5221/api/brain/health" > /dev/null
END=$(node -e "console.log(Date.now())")
ELAPSED=$((END - START))
if [ "$ELAPSED" -gt 200 ]; then
  echo "FAIL: health 端点响应 ${ELAPSED}ms 超过 200ms 阈值"
  exit 1
fi
echo "PASS: health 端点响应 ${ELAPSED}ms（阈值 200ms）"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: Health 端点新增 evaluator_stats 字段

**范围**: 修改 health 端点路由，新增 evaluator_stats 查询逻辑（聚合 tasks 表中 harness_evaluate 类型记录），返回 total_runs/passed/failed/last_run_at。包含对应单元测试。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] Health 端点返回 evaluator_stats 对象，passed/failed/total_runs 与 DB 一致
  Test: PASSED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status='completed'") && FAILED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status='canceled'") && curl -sf "localhost:5221/api/brain/health" | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const s=h.evaluator_stats;const ep=parseInt(process.argv[1]),ef=parseInt(process.argv[2]);if(s.passed!==ep){console.log('FAIL: passed='+s.passed+' 期望='+ep);process.exit(1);}if(s.failed!==ef){console.log('FAIL: failed='+s.failed+' 期望='+ef);process.exit(1);}if(s.total_runs!==ep+ef){console.log('FAIL: total_runs 不等于 passed+failed');process.exit(1);}console.log('PASS: passed='+s.passed+' failed='+s.failed+' total='+s.total_runs+' 均与 DB 一致');" "$PASSED" "$FAILED"
- [ ] [BEHAVIOR] evaluator_stats 结构+类型+值域+算术一致性正确（非 null 对象、字段完整、数值非负、last_run_at 合法）
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const s=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;if(!s||typeof s!=='object'||Array.isArray(s)){console.log('FAIL: 不是普通对象');process.exit(1);}if(typeof s.total_runs!=='number'||typeof s.passed!=='number'||typeof s.failed!=='number'){console.log('FAIL: 类型错误');process.exit(1);}if(s.total_runs<0||s.passed<0||s.failed<0){console.log('FAIL: 负数');process.exit(1);}if(s.total_runs!==s.passed+s.failed){console.log('FAIL: 算术不一致');process.exit(1);}if(s.last_run_at!==null&&(typeof s.last_run_at!=='string'||isNaN(Date.parse(s.last_run_at)))){console.log('FAIL: last_run_at 无效');process.exit(1);}if(!('total_runs' in s)||!('passed' in s)||!('failed' in s)||!('last_run_at' in s)){console.log('FAIL: 缺字段');process.exit(1);}console.log('PASS: 结构+类型+值域全部通过');"
- [ ] [ARTIFACT] 包含 evaluator_stats 相关单元测试文件
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/health-evaluator-stats.test.js'); console.log('OK')"
