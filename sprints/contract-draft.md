# 合同草案（第 1 轮）

> propose_task_id: 6bed4f90-ffa1-474c-b3d0-9a99e1466b17
> propose_round: 1

---

## 本次实现的功能

- Feature 1: 修复 `execution-callback` 中 `input_tokens`/`output_tokens` 提取逻辑 — 从 `result.usage.*` 正确读取，而非错误地读 `result.input_tokens`（顶层不存在，默认为 0）
- Feature 2: 任务 `result` 字段经由现有 `GET /api/brain/tasks/:id` 可查到完整的 5 字段成本数据（`duration_ms`、`total_cost_usd`、`num_turns`、`input_tokens`、`output_tokens`）
- Feature 3: 上线前已完成的旧任务 `result` 字段不受影响（不做回填，不覆盖已有内容）

---

## 验收标准（DoD）

### Feature 1: 修复 input_tokens / output_tokens 提取

**行为描述**：

执行回调处理逻辑（`packages/brain/src/routes/execution.js`，`EXEC_META_KEYS` 提取块，约第 212-222 行）中，`input_tokens` 和 `output_tokens` 应优先从 `result.input_tokens`（顶层，向后兼容）取值，回退到 `result.usage.input_tokens` / `result.usage.output_tokens`，而非直接读 `result[k]`（顶层通常不存在，导致默认写 0）。

**硬阈值**：

- 修复后的代码中，`input_tokens` 的赋值逻辑包含对 `result.usage` 的引用
- 修复后当 Claude 输出 JSON 含 `usage.input_tokens: 5000` 时，写入 `result` 的 `input_tokens` 应为 5000，不为 0

**验证命令**：

```bash
# Happy path: 验证修复后代码包含 usage 引用
manual:node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
const hasFix = src.includes('result.usage') || src.includes('usage?.input') || src.includes('usage?.[');
if (!hasFix) throw new Error('FAIL: execution.js EXEC_META_KEYS 块未包含 result.usage 引用');
console.log('PASS: execution.js 包含 usage 引用');
"

# 边界: 验证旧写法已不存在（直接 result[k] 对 input/output tokens 单独处理）
manual:node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
// 查找 EXEC_META_KEYS 块，确认 input_tokens 的赋值使用了 usage fallback
const blockMatch = src.match(/EXEC_META_KEYS[\s\S]{0,800}execMetaJson\s*=/);
if (!blockMatch) throw new Error('FAIL: 未找到 EXEC_META_KEYS 提取块');
const block = blockMatch[0];
const hasUsageFallback = block.includes('usage') && (block.includes('input_tokens') || block.includes('output_tokens'));
if (!hasUsageFallback) throw new Error('FAIL: EXEC_META_KEYS 块未对 input/output_tokens 做 usage fallback');
console.log('PASS: EXEC_META_KEYS 块正确引用 usage');
"
```

---

### Feature 2: API 可查询完整成本数据

**行为描述**：

`GET /api/brain/tasks/:id` 返回的任务中，`result` 字段包含 `duration_ms`（正整数）、`total_cost_usd`（非负浮点数）、`num_turns`（正整数）、`input_tokens`（正整数）、`output_tokens`（正整数）。当以上字段来自真实执行时，`input_tokens` 和 `output_tokens` 不应为 0。

**硬阈值**：

- DB 中已存在 `result` 含完整 5 字段且 `input_tokens > 0` 的任务（测试任务或真实任务均可）
- 通过 API 查询该任务，`result` 字段中 5 个字段均可见

**验证命令**：

```bash
# Happy path: 查询 DB 确认存在 input_tokens > 0 的任务
manual:node -e "
const { Client } = require('pg');
const client = new Client({ database: 'cecelia' });
client.connect().then(async () => {
  const res = await client.query(\"SELECT id, result FROM tasks WHERE result->>'input_tokens' IS NOT NULL AND (result->>'input_tokens')::int > 0 LIMIT 1\");
  await client.end();
  if (res.rows.length === 0) throw new Error('FAIL: 没有 input_tokens > 0 的任务');
  const r = res.rows[0].result;
  const missing = ['duration_ms','total_cost_usd','num_turns','input_tokens','output_tokens'].filter(k => !(k in r));
  if (missing.length > 0) throw new Error('FAIL: result 缺失字段: ' + missing.join(','));
  console.log('PASS: 任务', res.rows[0].id.slice(0,8), '有完整 5 字段，input_tokens=' + r.input_tokens);
}).catch(e => { console.error(e.message); process.exit(1); });
"

# 边界: API 路由返回 result 字段（不被过滤掉）
manual:node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/tasks.js', 'utf8');
// result 字段不应在 SELECT 中被排除
const hasResultSelect = src.includes('result') && !src.match(/SELECT[^;]*(?<!result)[,;]/);
if (!src.includes('result')) throw new Error('FAIL: tasks.js SELECT 未包含 result 字段');
console.log('PASS: tasks.js SELECT 包含 result 字段');
"
```

---

### Feature 3: 旧任务 result 字段不受影响

**行为描述**：

本次修改仅改变新执行的任务在写入时的 `input_tokens`/`output_tokens` 值，不做任何回填迁移。旧任务已有的 `result` 内容（含 `merged`、`pr_url`、`verdict` 等业务字段）保持不变。

**硬阈值**：

- 没有任何 `UPDATE tasks SET result = ...` 的迁移脚本存在于 `packages/brain/migrations/` 中（特指本次 PR 新增的 migration 中不含批量覆盖 result 的操作）
- 现有含 `verdict` 或 `merged` 的 result 数据不被清空

**验证命令**：

```bash
# Happy path: 确认本 PR 不含批量更新 result 的 migration
manual:node -e "
const fs = require('fs');
const path = require('path');
const dir = 'packages/brain/migrations';
const files = fs.readdirSync(dir).sort().reverse().slice(0, 3); // 最新 3 个
let found = false;
for (const f of files) {
  const content = fs.readFileSync(path.join(dir, f), 'utf8');
  if (content.includes('UPDATE tasks') && content.includes('result') && content.toLowerCase().includes('set result')) {
    console.error('FAIL: migration', f, '含批量 UPDATE tasks SET result');
    found = true;
  }
}
if (!found) console.log('PASS: 最新 migration 无批量覆盖 result 操作');
"

# 边界: 旧任务 verdict/merged 字段存在
manual:node -e "
const { Client } = require('pg');
const client = new Client({ database: 'cecelia' });
client.connect().then(async () => {
  const res = await client.query(\"SELECT COUNT(*) AS n FROM tasks WHERE result->>'verdict' IS NOT NULL OR result->>'merged' IS NOT NULL\");
  await client.end();
  const n = parseInt(res.rows[0].n);
  if (n === 0) throw new Error('FAIL: 旧任务 verdict/merged 字段全部消失');
  console.log('PASS: 旧任务保留 verdict/merged 字段，共', n, '条');
}).catch(e => { console.error(e.message); process.exit(1); });
"
```

---

## 技术实现方向（高层）

- **修改文件**：`packages/brain/src/routes/execution.js`，`EXEC_META_KEYS` 提取块（约第 212-222 行）
- **修改逻辑**：将 `execMeta[k] = result[k] ?? 0` 中对 `input_tokens` / `output_tokens` 的处理改为 `result.input_tokens ?? result.usage?.input_tokens ?? 0`（`output_tokens` 同理）
- **测试文件**：`packages/brain/src/__tests__/task-run-metrics-parse.test.js` 已有 LLM metrics 解析逻辑单元测试，可增补 EXEC_META_KEYS 写入路径的测试用例

## 不在本次范围内

- `task_run_metrics` 表的任何修改（已正确写入 `usage.*`，无需动）
- 成本聚合报表或图表展示
- 按 agent/模型维度的成本汇总
- 成本预警或限额控制
- 旧任务回填
- `tasks` 表 schema 变更（`result` 已是 jsonb，无需新字段）
