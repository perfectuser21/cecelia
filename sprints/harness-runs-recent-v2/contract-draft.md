# Contract Draft — GET /api/brain/harness/runs/recent

> **被测对象**: `packages/brain/src/routes/harness.js` 新增路由 + 测试文件
> **验证目标**: 新接口正确返回最近 3 条 initiative_runs 记录，字段精确（id/phase/started_at），空表返回 []

---

## Feature 1: 路由代码存在于 harness.js

**行为描述**:
`packages/brain/src/routes/harness.js` 中存在 `router.get('/runs/recent'` 路由定义，且该路由位于 `router.get('/runs/:id'` 之前（避免 Express 路径匹配歧义）。

**硬阈值**:
- 文件中存在字符串 `router.get('/runs/recent'`
- `/runs/recent` 路由定义出现在 `/runs/:id` 定义之前

**验证命令**:
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/harness.js', 'utf8');
if (!src.includes(\"router.get('/runs/recent'\")) throw new Error('FAIL: 未找到 /runs/recent 路由定义');
const recentIdx = src.indexOf(\"router.get('/runs/recent'\");
const paramIdx = src.indexOf(\"router.get('/runs/\");
// /runs/recent 必须在 /runs/:id 之前
const runsParamIdx = src.indexOf(\"router.get('/runs/:\");
if (runsParamIdx !== -1 && recentIdx > runsParamIdx) throw new Error('FAIL: /runs/recent 定义在 /runs/:id 之后，Express 会匹配错误');
console.log('PASS: /runs/recent 路由存在且顺序正确，位置=' + recentIdx);
"
```

---

## Feature 2: 接口返回 JSON 数组，最多 3 条记录

**行为描述**:
GET /api/brain/harness/runs/recent 返回 HTTP 200，body 为 JSON 数组。有数据时最多返回 3 条，SQL 中硬编码 `LIMIT 3`。

**硬阈值**:
- 测试文件存在且描述 `/runs/recent` 路由
- 测试覆盖"返回数组"断言
- SQL 查询中使用 `LIMIT 3` 或等效参数（验证 mock 调用传参为 3）

**验证命令**:
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/harness.js', 'utf8');
// 检查 SQL 中 LIMIT 3 硬编码
const routeMatch = src.match(/router\.get\('\/runs\/recent'[\s\S]{1,800}?LIMIT\s+(\d+|\$\d+)/);
if (!routeMatch) throw new Error('FAIL: /runs/recent 路由中未找到 LIMIT');
console.log('PASS: LIMIT 存在于路由定义中，匹配内容=' + routeMatch[0].slice(-30));
"
```

```bash
node -e "
const fs = require('fs');
const test = fs.readFileSync('packages/brain/src/routes/__tests__/harness-runs-recent.test.js', 'utf8');
if (!test.includes('/runs/recent')) throw new Error('FAIL: 测试文件未覆盖 /runs/recent 路径');
if (!test.includes('Array.isArray') && !test.includes('toEqual([])') && !test.includes('toBeInstanceOf(Array)')) {
  throw new Error('FAIL: 测试缺少数组断言');
}
console.log('PASS: 测试文件存在且含 /runs/recent + 数组断言');
"
```

---

## Feature 3: 每条记录仅含 id、phase、started_at 三个字段

**行为描述**:
响应数组中每条记录的 key 集合严格等于 `{id, phase, started_at}`，无多余字段（如 initiative_id、completed_at 等）。SQL SELECT 仅选这三列。

**硬阈值**:
- harness.js 中 `/runs/recent` 路由的 SELECT 语句仅包含 `id`, `phase`, `started_at` 三列
- 测试中有断言验证字段完整性（无多余字段）

**验证命令**:
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/harness.js', 'utf8');
// 提取 /runs/recent 路由块（从路由定义到下一个 router. 之前）
const routeStart = src.indexOf(\"router.get('/runs/recent'\");
if (routeStart === -1) throw new Error('FAIL: 路由未找到');
const routeEnd = src.indexOf('router.', routeStart + 1);
const routeBlock = routeEnd === -1 ? src.slice(routeStart) : src.slice(routeStart, routeEnd);
// 检查 SELECT 语句
const selectMatch = routeBlock.match(/SELECT\s+([\s\S]+?)\s+FROM\s+initiative_runs/i);
if (!selectMatch) throw new Error('FAIL: 未找到 SELECT...FROM initiative_runs');
const cols = selectMatch[1].replace(/\s+/g, ' ').trim();
// 验证只有三列
const allowed = new Set(['id', 'phase', 'started_at']);
const colList = cols.split(',').map(c => c.trim().replace(/['\"\`]/g, ''));
const extras = colList.filter(c => c && !allowed.has(c));
if (extras.length > 0) throw new Error('FAIL: SELECT 包含多余字段: ' + extras.join(', '));
if (!colList.includes('id') || !colList.includes('phase') || !colList.includes('started_at')) {
  throw new Error('FAIL: SELECT 缺少必要字段，实际=' + cols);
}
console.log('PASS: SELECT 字段精确 = [id, phase, started_at]');
"
```

```bash
node -e "
const fs = require('fs');
const test = fs.readFileSync('packages/brain/src/routes/__tests__/harness-runs-recent.test.js', 'utf8');
// 测试中必须有对字段的精确断言
const hasFieldCheck = test.includes('Object.keys') || test.includes('toEqual({') || 
                      test.includes('toMatchObject') || test.includes('initiative_id');
if (!hasFieldCheck) throw new Error('FAIL: 测试缺少字段精确性断言');
// 测试中必须检查不存在多余字段（initiative_id 不应出现在响应中）
const checksExtraFields = test.includes('initiative_id') || test.includes('Object.keys');
if (!checksExtraFields) throw new Error('FAIL: 测试未验证多余字段不存在');
console.log('PASS: 测试含字段精确性断言');
"
```

---

## Feature 4: 空表返回 []（HTTP 200）

**行为描述**:
当 initiative_runs 表为空（mock 返回 `{ rows: [] }`），接口返回 HTTP 200 + body `[]`，不返回 404 或错误。

**硬阈值**:
- 测试中存在 mock `rows: []` 场景
- 该场景下断言 HTTP 状态 200 且 body 为 `[]`

**验证命令**:
```bash
node -e "
const fs = require('fs');
const test = fs.readFileSync('packages/brain/src/routes/__tests__/harness-runs-recent.test.js', 'utf8');
// 找到空表测试场景
const hasEmptyRows = test.includes('rows: []') || test.includes('rows:[]');
if (!hasEmptyRows) throw new Error('FAIL: 测试缺少空表场景（rows: []）');
// 空表场景下必须断言 200 + []
const has200 = test.includes('toBe(200)') || test.includes('status).toBe(200)');
const hasEmptyArray = test.includes('toEqual([])') || test.includes('[]');
if (!has200) throw new Error('FAIL: 空表测试缺少 HTTP 200 断言');
if (!hasEmptyArray) throw new Error('FAIL: 空表测试缺少 [] 断言');
console.log('PASS: 空表场景存在，含 HTTP 200 + [] 断言');
"
```

---

## Feature 5: 超过 3 条时仅返回最新 3 条（started_at DESC）

**行为描述**:
当 mock 返回 4 条或更多记录时，路由通过 SQL `ORDER BY started_at DESC LIMIT 3` 确保只取最新 3 条。测试验证 mock 被调用时 SQL 参数正确。

**硬阈值**:
- harness.js 中路由 SQL 含 `ORDER BY started_at DESC`
- 测试中验证返回数组长度 <= 3

**验证命令**:
```bash
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/harness.js', 'utf8');
const routeStart = src.indexOf(\"router.get('/runs/recent'\");
if (routeStart === -1) throw new Error('FAIL: 路由未找到');
const routeEnd = src.indexOf('router.', routeStart + 1);
const routeBlock = routeEnd === -1 ? src.slice(routeStart) : src.slice(routeStart, routeEnd);
if (!routeBlock.match(/ORDER\s+BY\s+started_at\s+DESC/i)) {
  throw new Error('FAIL: SQL 缺少 ORDER BY started_at DESC');
}
if (!routeBlock.match(/LIMIT\s+3\b/i) && !routeBlock.match(/LIMIT\s+\\\$\d+/i)) {
  throw new Error('FAIL: SQL 缺少 LIMIT 3');
}
console.log('PASS: SQL 含 ORDER BY started_at DESC + LIMIT 3');
"
```

```bash
node -e "
const fs = require('fs');
const test = fs.readFileSync('packages/brain/src/routes/__tests__/harness-runs-recent.test.js', 'utf8');
// 验证测试覆盖 >3 条场景
const hasLimitTest = test.includes('length').toString() && 
                     (test.includes('3') || test.includes('toHaveLength'));
if (!test.includes('toHaveLength') && !test.includes('.length')) {
  throw new Error('FAIL: 测试未验证返回数量限制');
}
console.log('PASS: 测试含数量限制断言');
"
```

---

## Workstreams

workstream_count: 1

### Workstream 1: 新增 /runs/recent 路由 + 单元测试

**范围**: 在 `packages/brain/src/routes/harness.js` 插入 `/runs/recent` 路由（SELECT id,phase,started_at FROM initiative_runs ORDER BY started_at DESC LIMIT 3），并在 `packages/brain/src/routes/__tests__/harness-runs-recent.test.js` 编写覆盖所有 PRD 场景的 vitest 测试
**大小**: S（新增 ~20 行路由代码 + ~80 行测试）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/brain/src/routes/harness.js` 含 `router.get('/runs/recent'`
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!s.includes(\"router.get('/runs/recent'\"))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] GET /runs/recent 返回 JSON 数组，最多 3 条
  Test: node -e "const t=require('fs').readFileSync('packages/brain/src/routes/__tests__/harness-runs-recent.test.js','utf8');if(!t.includes('/runs/recent'))throw new Error('FAIL:无/runs/recent测试');console.log('PASS')"
- [ ] [BEHAVIOR] 每条记录仅含 id、phase、started_at 三个字段
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const i=s.indexOf(\"'/runs/recent'\");const b=s.slice(i,s.indexOf('router.',i+1));if(!b.match(/SELECT\s+id\s*,\s*phase\s*,\s*started_at/i))throw new Error('FAIL:SELECT字段不对');console.log('PASS')"
- [ ] [BEHAVIOR] 空表返回 [] （HTTP 200）
  Test: node -e "const t=require('fs').readFileSync('packages/brain/src/routes/__tests__/harness-runs-recent.test.js','utf8');if(!t.includes('rows: []'))throw new Error('FAIL:无空表测试');if(!t.includes('toEqual([])'))throw new Error('FAIL:无[]断言');console.log('PASS')"
- [ ] [BEHAVIOR] 超过 3 条时仅返回最新 3 条（started_at DESC）
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const i=s.indexOf(\"'/runs/recent'\");const b=s.slice(i,s.indexOf('router.',i+1));if(!b.match(/ORDER BY started_at DESC/i))throw new Error('FAIL:无ORDER BY');if(!b.match(/LIMIT 3/i))throw new Error('FAIL:无LIMIT 3');console.log('PASS')"
