# Contract Review Feedback (Round 2)

## 必须修改项

### 1. [命令太弱] Feature 1 — C2 last_run_at 不比较实际时间戳值

**原始命令**:
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

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：返回任意合法但完全错误的 ISO 时间戳
app.get('/api/brain/health', async (req, res) => {
  // 不查 DB，hardcode 一个 1999 年的时间戳
  res.json({
    evaluator_stats: {
      total_runs: 0, passed: 0, failed: 0,
      last_run_at: '1999-01-01T00:00:00.000Z'  // 与 DB 实际值完全不一致
    }
  });
});
// C2 只检查：DB 有记录时 API 返回非 null + 合法 ISO 格式
// 从不比较 API 返回的时间戳与 DB MAX(updated_at) 的实际值
// → 假时间戳 '1999-01-01T00:00:00.000Z' 蒙混过关 PASS
```

**建议修复命令**:
```bash
# C2-fix: last_run_at 与 DB 最近执行时间一致（含实际值比较）
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
```

核心改动：加入 `Math.abs(dbMs - apiMs) > 2000` 实际值比较（允许 2 秒精度差异，因为 DB `to_char` 格式化到毫秒级，API 可能有微小精度差异）。

## 可选改进

- C4 响应时间测量：两次 `node -e "console.log(Date.now())"` 各启动一个 node 进程（约 50-100ms），会叠加到 ELAPSED 中。可考虑用单个 node 进程内完成整个测量（`node -e "const s=Date.now();require('child_process').execSync('curl -sf localhost:5221/api/brain/health');const e=Date.now();..."`），但 200ms 阈值足够宽松，当前实现可接受。
