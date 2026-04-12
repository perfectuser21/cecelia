# Sprint Contract Draft (Round 1)

## PRD 来源

**Planner Task**: c57f1210-6f55-4448-be13-63d849b2fb7d
**需求**: 在 GET /api/brain/health 端点的响应中新增 `harness_pipeline_count` 字段，返回当前活跃的 harness pipeline 数量（status=in_progress 的 harness_planner 任务数）。
**目的**: 验证 Harness v5.0 全链路（Planner→GAN→Generator→Evaluator→Report）能否端到端跑通。

---

## Feature 1: health 端点新增 harness_pipeline_count 字段

**行为描述**:
调用 GET /api/brain/health 时，响应 JSON 中包含 `harness_pipeline_count` 字段，值为当前 tasks 表中 status='in_progress' 且 task_type='harness_planner' 的任务数量（整数 ≥ 0）。该字段位于响应顶层，与 status、uptime、organs 同级。

**硬阈值**:
- 响应 JSON 必须包含 `harness_pipeline_count` 字段
- `harness_pipeline_count` 值为非负整数（`typeof === 'number'` 且 `>= 0` 且 `Number.isInteger()`）
- 无 in_progress harness_planner 任务时，值为 `0`
- 有 N 个 in_progress harness_planner 任务时，值为 `N`
- 新增字段不影响已有字段（status、uptime、tick_stats、organs、timestamp 仍存在）
- 端点响应时间不因新增查询显著增加（<500ms）

**验证命令**:
```bash
# Happy path：字段存在且为非负整数
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!('harness_pipeline_count' in h)) throw new Error('FAIL: 缺少 harness_pipeline_count 字段');
    if (typeof h.harness_pipeline_count !== 'number') throw new Error('FAIL: harness_pipeline_count 不是数字，实际: ' + typeof h.harness_pipeline_count);
    if (!Number.isInteger(h.harness_pipeline_count)) throw new Error('FAIL: harness_pipeline_count 不是整数');
    if (h.harness_pipeline_count < 0) throw new Error('FAIL: harness_pipeline_count 为负数');
    console.log('PASS: harness_pipeline_count = ' + h.harness_pipeline_count);
  "

# 已有字段完整性验证（不破坏现有响应）
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const h = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const required = ['status', 'uptime', 'tick_stats', 'organs', 'timestamp', 'harness_pipeline_count'];
    const missing = required.filter(k => !(k in h));
    if (missing.length > 0) throw new Error('FAIL: 缺少字段: ' + missing.join(', '));
    if (typeof h.organs !== 'object') throw new Error('FAIL: organs 不是对象');
    console.log('PASS: 所有必要字段完整，organs 结构正常');
  "

# 数值一致性验证（与 DB 实际数据交叉校验）
psql cecelia -t -c "SELECT COUNT(*) FROM tasks WHERE status='in_progress' AND task_type='harness_planner'" | \
  xargs -I{} bash -c '
    DB_COUNT=$(echo "{}" | tr -d " ");
    API_COUNT=$(curl -sf "localhost:5221/api/brain/health" | node -e "process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).harness_pipeline_count))");
    if [ "$DB_COUNT" = "$API_COUNT" ]; then
      echo "PASS: API($API_COUNT) = DB($DB_COUNT)";
    else
      echo "FAIL: API($API_COUNT) != DB($DB_COUNT)"; exit 1;
    fi
  '
```

---

## Workstreams

workstream_count: 1

### Workstream 1: health 端点添加 harness_pipeline_count 查询

**范围**: 修改 `packages/brain/src/routes/goals.js` 中 GET /health 路由处理函数，新增一条 SQL 查询获取 in_progress harness_planner 任务数，将结果作为 `harness_pipeline_count` 字段加入响应 JSON。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] GET /api/brain/health 响应包含 `harness_pipeline_count` 字段，值为 status='in_progress' 且 task_type='harness_planner' 的任务数量（非负整数）
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!('harness_pipeline_count' in h))throw new Error('FAIL');if(typeof h.harness_pipeline_count!=='number'||!Number.isInteger(h.harness_pipeline_count)||h.harness_pipeline_count<0)throw new Error('FAIL');console.log('PASS: '+h.harness_pipeline_count)"
- [ ] [BEHAVIOR] 新增字段不破坏已有响应结构（status/uptime/tick_stats/organs/timestamp 均存在）
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const h=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));['status','uptime','tick_stats','organs','timestamp','harness_pipeline_count'].forEach(k=>{if(!(k in h))throw new Error('FAIL: missing '+k)});console.log('PASS')"
- [ ] [ARTIFACT] 单元测试文件存在且覆盖 harness_pipeline_count 字段
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/health-harness-count.test.js');console.log('OK')"
