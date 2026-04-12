# Contract Review Feedback (Round 1)

## 必须修改项

### 1. [命令太弱] Feature 1 DB 一致性 — passed/failed 分别核对缺失

**原始命令**:
```bash
EXPECTED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status IN ('completed','canceled')")
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const expected = parseInt(process.argv[1]);
    if (h.evaluator_stats.total_runs !== expected) throw new Error('FAIL');
    console.log('PASS');
  " "$EXPECTED"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：total_runs 正确，但 passed/failed 分配完全错误
// DB 实际: 5 completed(passed), 3 canceled(failed) = 8 total
// 假实现返回:
const evaluator_stats = { total_runs: 8, passed: 8, failed: 0, last_run_at: new Date().toISOString() };
// C1 检查: 8 === 8 + 0 ✓ (算术一致)
// C2 检查: 8 === 8 ✓ (total 与 DB 一致)
// 但 passed=8 failed=0 完全错误，两条命令都 PASS
```

**建议修复命令**:
```bash
# 分别核对 passed 和 failed
PASSED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status='completed'")
FAILED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status='canceled'")
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const s = h.evaluator_stats;
    const ep = parseInt(process.argv[1]), ef = parseInt(process.argv[2]);
    if (s.passed !== ep) { console.log('FAIL: passed=' + s.passed + ' 期望=' + ep); process.exit(1); }
    if (s.failed !== ef) { console.log('FAIL: failed=' + s.failed + ' 期望=' + ef); process.exit(1); }
    if (s.total_runs !== ep + ef) { console.log('FAIL: total_runs 不等于 passed+failed'); process.exit(1); }
    console.log('PASS: passed=' + s.passed + ' failed=' + s.failed + ' total=' + s.total_runs + ' 均与 DB 一致');
  " "$PASSED" "$FAILED"
```

### 2. [命令太弱] Feature 2 — 零值场景命令在有数据时为 no-op

**原始命令**:
```bash
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const s = ...evaluator_stats;
    if (s.total_runs === 0 && ...) {
      console.log('PASS: 零值对象格式正确');
    } else if (s.total_runs > 0) {
      console.log('PASS: 有数据...跳过零值断言');  // ← 这里直接 PASS，什么都没验证
    }
  "
```

**假实现片段**（proof-of-falsification）:
```javascript
// 当 DB 已有 evaluator 记录（常态），命令走 else-if 分支
// 假实现返回荒谬值，命令仍然 PASS：
const evaluator_stats = {
  total_runs: 1,
  passed: 999,
  failed: -998,
  last_run_at: 'not-a-valid-date'
};
// total_runs > 0 → 直接打印 "PASS: 有数据"，跳过所有检查
```

**建议修复命令**:
```bash
# 移除条件分支，统一检查结构正确性（类型 + 值域 + last_run_at 格式）
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;
    if (s === null || s === undefined || typeof s !== 'object') { console.log('FAIL: evaluator_stats 不是对象'); process.exit(1); }
    if (typeof s.total_runs !== 'number' || typeof s.passed !== 'number' || typeof s.failed !== 'number') { console.log('FAIL: 字段类型错误'); process.exit(1); }
    if (s.total_runs < 0 || s.passed < 0 || s.failed < 0) { console.log('FAIL: 存在负数'); process.exit(1); }
    if (s.last_run_at !== null && (typeof s.last_run_at !== 'string' || isNaN(Date.parse(s.last_run_at)))) { console.log('FAIL: last_run_at 格式无效'); process.exit(1); }
    console.log('PASS: evaluator_stats 结构+值域正确');
  "
```

### 3. [命令太弱] DoD-2 — 只检查非 null/undefined，不检查类型和字段

**原始命令**:
```bash
curl -sf "localhost:5221/api/brain/health" | node -e "const s=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats; if(s===null||s===undefined) process.exit(1); console.log('PASS: evaluator_stats is object')"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：返回字符串而非对象
app.get('/api/brain/health', (req, res) => res.json({
  status: 'ok',
  evaluator_stats: 'this is not an object'
}));
// 命令检查：s === null? No. s === undefined? No. → PASS
// 但 evaluator_stats 不是对象，没有 total_runs/passed/failed/last_run_at
```

**建议修复命令**:
```bash
curl -sf "localhost:5221/api/brain/health" | node -e "
  const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats;
  if (!s || typeof s !== 'object' || Array.isArray(s)) { console.log('FAIL: evaluator_stats 不是普通对象'); process.exit(1); }
  if (!('total_runs' in s) || !('passed' in s) || !('failed' in s) || !('last_run_at' in s)) { console.log('FAIL: 缺少必要字段'); process.exit(1); }
  console.log('PASS: evaluator_stats 是合法对象且字段完整');
"
```

## 可选改进

- **DB 降级测试**：PRD 边界情况提到"数据库连接异常时 evaluator_stats 可降级"，但无对应验证命令。建议增加（但实现较复杂，需模拟 DB 断连，可作为后续增强）。
- **last_run_at ISO 格式严格校验**：Feature 1 的 happy path 命令检查了 `'last_run_at' in s`（存在性），但未验证其值为合法 ISO 8601 时间戳。建议在 Feature 1 命令中增加 `isNaN(Date.parse(s.last_run_at))` 检查。
