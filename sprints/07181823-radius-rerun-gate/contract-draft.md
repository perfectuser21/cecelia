# Contract Draft: radius-rerun-gate

task_id: 2a8a33c5-bc62-43bd-a562-3c755766b950
sprint_dir: sprints/07181823-radius-rerun-gate
created: 2026-07-18

---

## 背景与范围

本合同约束将 `cascade-list.js` 的波及计算输入端从 `journey_step_links` 格子查询切换到 `/api/brain/graph/radius` 图引擎。图引擎为优先路径；格子查询为永久回退底。radius 不可达（网络超时、HTTP 错误）或返回 `freshness.stale=true` 时，必须显式触发回退并打印 WARN，禁止静默降级。

---

## 实现文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/brain/src/lib/radius-client.js` | 新建 | 封装 POST /api/brain/graph/radius，超时 3s，stale=true 返回 null |
| `packages/brain/src/cascade-list.js` | 修改 | 输入端切换：优先 radius，回退格子查询，回退必须打 WARN |
| `packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js` | 新建 | 场景 A（正常路径 CRM 点名）+ 场景 B（radius 停摆回退 + WARN 断言）|

---

## 功能规约

### FR-1：radius-client.js 接口规约

```
callRadius(changedFiles: string[]) → Promise<RadiusResult | null>

interface RadiusResult {
  affected_features: Array<{
    feature_id: string,
    name: string,
    promises: Array<{ journey_name: string, ... }>
  }>,
  affected_tests: string[],
  freshness: { stale: boolean, ... }
}
```

行为约束：
- POST `{BRAIN_URL}/api/brain/graph/radius` with body `{ changed_files: changedFiles }`
- 超时：3000ms（AbortController 或等价机制）
- 任何网络错误、HTTP 非 2xx：捕获后返回 `null`，不抛出
- `result.freshness.stale === true`：返回 `null`（视同不可达）
- 不引入新的第三方依赖（使用 Node.js 内置 fetch 或 `node-fetch`，若已在 package.json）

### FR-2：cascade-list.js 输入端切换规约

新增入口函数 `getCascadeList(changedFiles: string[])` 或修改现有入口：

```
优先路径：
  1. result = await callRadius(changedFiles)
  2. if result !== null → 使用 result.affected_tests 和 result.affected_features

回退路径（result === null）：
  1. console.warn('[WARN][rerun-gate] radius unavailable or stale — falling back to journey_step_links')
  2. 执行现行 journey_step_links DB 查询逻辑（不重写，直接复用）
```

格子路径永久保留，不删除任何现有 DB 查询代码。

### FR-3：WARN 哨兵语义

回退路径触发时：
- 必须调用 `console.warn(...)` 或写 `process.stderr`
- 日志内容必须包含字符串 `WARN`
- 禁止：仅打 `console.log`（不含 WARN）、静默继续

---

## E2E 验收

### 场景 A（正常路径 — radius 引擎命中 CRM）

**前置条件**：
- Brain 本地运行（localhost:5221）
- `/api/brain/graph/radius` 端点可访问
- 图数据库已有 CRM 表底座（feature_id: `0b70f2ff-1a16-4029-a71a-e6cb5a523ea2`）的边数据

**输入**：
```
changedFiles = ['packages/brain/src/__tests__/integration/blast-radius.integration.test.js']
```

**断言**：
1. `affected_features` 数组中存在 `feature_id === '0b70f2ff-1a16-4029-a71a-e6cb5a523ea2'`
2. `affected_tests` 数组包含 `'packages/brain/src/__tests__/integration/blast-radius.integration.test.js'`
3. 未触发 WARN 回退日志

**bash 验收命令**：
```bash
# 手动验证 radius 端点响应
curl -s -X POST http://localhost:5221/api/brain/graph/radius \
  -H "Content-Type: application/json" \
  -d '{"changed_files":["packages/brain/src/__tests__/integration/blast-radius.integration.test.js"]}' \
  | node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const hasFeature = data.affected_features?.some(f => f.feature_id === '0b70f2ff-1a16-4029-a71a-e6cb5a523ea2');
    const hasTest = data.affected_tests?.includes('packages/brain/src/__tests__/integration/blast-radius.integration.test.js');
    console.log('CRM feature:', hasFeature ? 'PASS' : 'FAIL');
    console.log('test path:', hasTest ? 'PASS' : 'FAIL');
    process.exit(hasFeature && hasTest ? 0 : 1);
  "
```

### 场景 B（radius 停摆 — 回退格子路径 + WARN）

**前置条件**：
- Brain DB 可访问（journey_step_links 表存在）
- radius 被 mock 为不可达（测试内部 mock）

**输入**：
```
mock callRadius → null（模拟网络超时或 stale=true）
```

**断言**：
1. `cascade-list.js` 调用了 DB 查询（`journey_step_links` 被查询）
2. `console.warn` 被调用，且参数含字符串 `WARN`

**bash 验收命令（集成测试层面）**：
```bash
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js \
  --reporter=verbose 2>&1 | tee /tmp/rerun-gate-test.log
grep -q "PASS\|✓" /tmp/rerun-gate-test.log && echo "ALL TESTS PASS" || echo "TESTS FAILED"
```

### 场景 C（stale 回退）

**输入**：
```
mock callRadius → { affected_features: [...], affected_tests: [...], freshness: { stale: true } }
```
（注：radius-client.js 在此场景返回 null，外层 cascade-list.js 走回退路径）

**断言**：同场景 B（WARN 触发，DB 被查询）

**bash 验收命令**：
```bash
# stale 回退由场景 B 的 stale mock 分支覆盖，同一测试文件
npx vitest run packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js \
  --reporter=verbose -t "stale"
```

---

## 禁止事项

- 禁止删除 `cascade-list.js` 中任何现有的格子查询逻辑
- 禁止将回退日志降级为 `console.log`（必须用 `console.warn` 或 `console.error`）
- 禁止在 radius 不可达时静默继续（无 WARN 输出）
- 禁止引入新的第三方 HTTP 依赖（仅用原生 fetch 或已有依赖）
- 禁止让 radius-client.js 抛出异常（必须内部捕获返回 null）

---

## 不变量映射

| 合同条款 | 来源不变量 |
|---------|----------|
| 回退必须打 WARN | I-1（decisions:9202c14e，部署链失败路径禁 warning 降级）|
| 格子路径永久保留 | I-2（任务描述）|
| stale=true 视同不可达 | I-3（thin_prd stale 约束）|
| 测试必须 commit 进 repo | I-4（CLAUDE.md Bug Fix 流程）|
| 工厂域同挂闸 | I-5（decisions:2d28de45）|
