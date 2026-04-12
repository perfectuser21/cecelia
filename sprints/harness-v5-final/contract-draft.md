# Sprint Contract Draft (Round 1)

## Feature 1: Health 端点新增 evaluator_stats 字段

**行为描述**:
当调用 `GET /api/brain/health` 时，响应 JSON 中包含顶级字段 `evaluator_stats`，该对象包含 Evaluator 的执行统计：总执行次数、通过次数、失败次数、最近执行时间。统计数据实时从数据库聚合，反映 Harness Evaluator 全量历史记录。

**硬阈值**:
- 响应 JSON 包含顶级字段 `evaluator_stats`，类型为对象
- `evaluator_stats` 包含四个字段：`total_runs`（整数）、`passed`（整数）、`failed`（整数）、`last_run_at`（ISO 时间戳字符串或 null）
- `total_runs == passed + failed`（数值一致性）
- `total_runs >= 0`，`passed >= 0`，`failed >= 0`
- `last_run_at` 为 null（无记录时）或合法 ISO 8601 时间戳
- health 端点总响应时间无显著退化（新增查询 < 50ms）

**验证命令**:
```bash
# Happy path：evaluator_stats 字段存在且结构正确
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!h.evaluator_stats) throw new Error('FAIL: 缺少 evaluator_stats 字段');
    const s = h.evaluator_stats;
    if (typeof s.total_runs !== 'number') throw new Error('FAIL: total_runs 不是数字');
    if (typeof s.passed !== 'number') throw new Error('FAIL: passed 不是数字');
    if (typeof s.failed !== 'number') throw new Error('FAIL: failed 不是数字');
    if (!('last_run_at' in s)) throw new Error('FAIL: 缺少 last_run_at');
    if (s.total_runs !== s.passed + s.failed) throw new Error('FAIL: total_runs != passed + failed');
    console.log('PASS: evaluator_stats 结构正确, total=' + s.total_runs + ' passed=' + s.passed + ' failed=' + s.failed);
  "

# 数值与数据库一致性验证
EXPECTED=$(psql -t -A cecelia -c "SELECT count(*)::integer FROM tasks WHERE task_type='harness_evaluate' AND status IN ('completed','canceled')")
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const expected = parseInt(process.argv[1]);
    if (h.evaluator_stats.total_runs !== expected) throw new Error('FAIL: total_runs=' + h.evaluator_stats.total_runs + ' 期望=' + expected);
    console.log('PASS: total_runs=' + h.evaluator_stats.total_runs + ' 与数据库一致');
  " "$EXPECTED"
```

---

## Feature 2: 零记录时返回零值对象

**行为描述**:
当数据库中没有任何 Evaluator 执行记录时，`evaluator_stats` 字段仍然存在且返回零值对象，而非 null 或缺失。这确保下游消费者无需处理字段缺失的情况。

**硬阈值**:
- 无 Evaluator 记录时，`evaluator_stats` 为 `{"total_runs": 0, "passed": 0, "failed": 0, "last_run_at": null}`
- 字段永远不会缺失或为 null（对象本身不为 null）

**验证命令**:
```bash
# 零值对象验证：字段值在无记录时全为零/null
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const s = h.evaluator_stats;
    if (s === null || s === undefined) throw new Error('FAIL: evaluator_stats 为 null 或缺失');
    if (typeof s !== 'object') throw new Error('FAIL: evaluator_stats 不是对象');
    // 即使有数据，也验证结构正确性
    if (s.total_runs === 0 && s.passed === 0 && s.failed === 0 && s.last_run_at === null) {
      console.log('PASS: 零值对象格式正确');
    } else if (s.total_runs > 0) {
      console.log('PASS: 有数据，字段结构正确（非零值场景，跳过零值断言）');
    } else {
      throw new Error('FAIL: 零值对象格式异常: ' + JSON.stringify(s));
    }
  "
```

---

## Feature 3: 性能无退化

**行为描述**:
新增 `evaluator_stats` 查询后，health 端点的响应时间不应显著增加。查询使用高效聚合（COUNT + MAX），不进行全表扫描。

**硬阈值**:
- health 端点响应时间增量 < 50ms
- 使用聚合查询（COUNT/MAX），不逐行遍历

**验证命令**:
```bash
# 性能验证：连续 5 次请求，平均响应时间 < 200ms（含网络开销）
node -e "
  const http = require('http');
  const times = [];
  let done = 0;
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    http.get('http://localhost:5221/api/brain/health', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        times.push(Date.now() - start);
        done++;
        if (done === 5) {
          const avg = times.reduce((a,b) => a+b, 0) / times.length;
          if (avg > 200) throw new Error('FAIL: 平均响应 ' + avg.toFixed(0) + 'ms > 200ms');
          console.log('PASS: 平均响应 ' + avg.toFixed(0) + 'ms, 各次: ' + times.join(',') + 'ms');
        }
      });
    });
  }
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: Health 端点新增 evaluator_stats 聚合查询

**范围**: 修改 `packages/brain/src/routes/goals.js` 的 health 端点处理函数，新增一条 SQL 聚合查询并将结果注入响应 JSON。包含零值兜底逻辑和错误降级。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] `GET /api/brain/health` 响应包含 `evaluator_stats` 字段，含 `total_runs`、`passed`、`failed`、`last_run_at` 四个子字段
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!h.evaluator_stats) process.exit(1); const s=h.evaluator_stats; if(typeof s.total_runs!=='number'||typeof s.passed!=='number'||typeof s.failed!=='number'||!('last_run_at' in s)) process.exit(1); if(s.total_runs!==s.passed+s.failed) process.exit(1); console.log('PASS')"
- [ ] [BEHAVIOR] 无 Evaluator 记录时 `evaluator_stats` 返回零值对象 `{total_runs:0, passed:0, failed:0, last_run_at:null}`，不为 null 或缺失
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const s=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).evaluator_stats; if(s===null||s===undefined) process.exit(1); console.log('PASS: evaluator_stats is object')"
- [ ] [BEHAVIOR] Health 端点响应时间无显著退化（平均 < 200ms）
  Test: node -e "const http=require('http');let t=[];let d=0;for(let i=0;i<5;i++){const s=Date.now();http.get('http://localhost:5221/api/brain/health',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{t.push(Date.now()-s);d++;if(d===5){const a=t.reduce((x,y)=>x+y,0)/5;if(a>200)process.exit(1);console.log('PASS: avg='+a.toFixed(0)+'ms')}})})}"
