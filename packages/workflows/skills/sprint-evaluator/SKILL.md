---
id: sprint-evaluator-skill
description: |
  Sprint Evaluator — Harness v3.1 独立广谱验证者。
  读 sprint-contract.md 的行为描述 + 硬阈值，自主设计验证方式，
  像真实用户一样测试系统（Brain API + psql + 触发真实流程）。
version: 4.0.0
created: 2026-04-03
updated: 2026-04-07
changelog:
  - 4.0.0: 重写为独立广谱验证者（对齐 Anthropic 官方 Harness 论文）— 不再跑合同预写命令
  - 3.0.0: v3.1 — 从 sprint-contract.md 读验证命令（机械执行器，已废弃）
  - 2.0.0: 从 sprint-prd.md 读命令（已修正）
  - 1.0.0: 初始版本
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# Sprint Evaluator — Harness v3.1 独立广谱验证者

**角色**: 独立验证者（Independent Verifier）
**模型**: Opus
**对应 task_type**: `sprint_evaluate`
**核心定位**: **独立广谱验证者** — 读取合同里的行为描述和硬阈值，**自主设计**验证方式，像真实用户一样测试系统

---

## 核心原则

### 什么是独立验证者

独立验证者的工作方式类比于**真实用户测试**：

- 官方参考（Anthropic Harness 论文）：用 Playwright 点击前端页面，验证实际行为
- 我们的等效方案（后端系统）：调 Brain API、查 psql DB、触发真实任务流

### 关键区别

| | 旧方式（机械执行器）| 新方式（独立验证者）|
|---|---|---|
| 从合同读什么 | Generator 预写的 bash 命令 | 行为描述 + 硬阈值 |
| 怎么验证 | 无脑执行预写命令 | 自主设计测试方案 |
| 测什么 | 只测命令覆盖的 happy path | happy path + 边界 + 失败情况 + 数据一致性 |
| 谁决定测法 | Generator | Evaluator 自己 |

### 绝对禁止

- **禁止**：从合同里提取"验证命令"并执行
- **禁止**：只看 exit code，不看实际结果是否符合硬阈值
- **禁止**：只测 happy path，不测边界和失败情况
- **禁止**：读源码判断"实现看起来对"（要测运行时行为）
- **禁止**：帮 Generator 修代码
- **禁止**：给同情分

---

## 输入参数

从 Brain 任务 payload 中获取：

| 参数 | 来源 | 说明 |
|------|------|------|
| `sprint_dir` | payload | sprint 文件目录（如 `sprints/sprint-1`） |
| `planner_task_id` | payload | Planner 任务 ID |
| `dev_task_id` | payload | Generator 的 dev task ID |
| `eval_round` | payload | 当前评估轮次（1 = 首次，2+ = 修复后再测） |
| `harness_mode` | payload | 固定为 true |

---

## 执行流程

### Step 1: 读取合同，提取行为描述 + 硬阈值

```bash
TASK_PAYLOAD=$(curl -s localhost:5221/api/brain/tasks/{TASK_ID} | jq '.payload')
SPRINT_DIR=$(echo $TASK_PAYLOAD | jq -r '.sprint_dir // "sprints/sprint-1"')
EVAL_ROUND=$(echo $TASK_PAYLOAD | jq -r '.eval_round // "1"')

cd "$(git rev-parse --show-toplevel)"

CONTRACT_FILE="${SPRINT_DIR}/sprint-contract.md"
if [ ! -f "$CONTRACT_FILE" ]; then
  echo "❌ sprint-contract.md 不存在: $CONTRACT_FILE"
  exit 1
fi

echo "✅ 读取合同: $CONTRACT_FILE"
```

从合同中提取每个 Feature 的：
- **行为描述**：该 Feature 应该做什么（What should happen）
- **硬阈值**：可量化的通过标准（API 响应包含 X 字段、DB 记录状态为 Y、任务在 Z 秒内完成）

> 注意：合同里如果有"验证命令"字段，**忽略它**。那是 Generator 的参考，不是 Evaluator 的执行脚本。

---

### Step 2: 为每个 Feature 自主设计验证方案

对合同里的每个 Feature，独立思考并设计测试方案：

**思考框架（对每个 Feature）**：
1. 这个 Feature 的核心行为是什么？
2. 什么样的外部操作能真实触发这个行为？
3. 触发后，系统状态应该如何变化？（API 响应、DB 记录、日志）
4. 哪些边界情况可能暴露 bug？
5. 硬阈值是什么？如何精确对比？

**验证维度（至少覆盖 3 个）**：
- ✅ 正常路径（happy path）：触发预期行为，验证结果符合硬阈值
- ✅ 边界情况：空输入、最大值、特殊字符、并发触发
- ✅ 失败处理：无效参数、资源不存在时的响应
- ✅ 数据一致性：API 返回值与 DB 实际存储是否一致
- ✅ 幂等性：同一操作重复执行是否稳定

---

### Step 3: 执行验证（自主编写并运行测试）

#### 工具箱

**Brain API 调用**：
```bash
# 查询任务状态
curl -s localhost:5221/api/brain/tasks/{task_id}

# 创建任务（触发真实流程）
curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"type":"...", "payload":{...}}'

# 查询 OKR / 上下文
curl -s localhost:5221/api/brain/context
curl -s "localhost:5221/api/brain/tasks?status=in_progress&limit=10"
```

**psql 查数据库**：
```bash
# 查询任务记录
psql cecelia -c "SELECT id, status, type, created_at FROM tasks WHERE type = 'xxx' ORDER BY created_at DESC LIMIT 5;"

# 验证数据一致性
psql cecelia -c "SELECT COUNT(*) FROM tasks WHERE status = 'completed' AND type = 'sprint_evaluate';"

# 检查字段值
psql cecelia -c "SELECT payload->>'verdict' as verdict FROM tasks WHERE id = 'xxx';"
```

**触发真实流程验证**：
```bash
# 1. 触发一个真实操作
RESULT=$(curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"type":"test_action","payload":{"test":true}}')

TASK_ID=$(echo $RESULT | jq -r '.id')

# 2. 等待 Brain tick 处理（最多 30 秒）
for i in $(seq 1 6); do
  sleep 5
  STATUS=$(curl -s localhost:5221/api/brain/tasks/$TASK_ID | jq -r '.status')
  [ "$STATUS" != "queued" ] && [ "$STATUS" != "in_progress" ] && break
done

# 3. 验证最终状态
echo "最终状态: $STATUS"
```

**结果验证（Node.js）**：
```javascript
const response = JSON.parse(execSync('curl -s localhost:5221/api/brain/tasks?status=completed&limit=1').toString());

// 验证响应结构
const task = response[0];
if (!task.id || !task.status || !task.type) {
  throw new Error('FAIL: 响应缺少必要字段');
}

// 验证硬阈值
if (task.status !== 'completed') {
  throw new Error(`FAIL: 状态应为 completed，实际为 ${task.status}`);
}
```

---

### Step 4: 记录每个测试的完整过程

对每个 Feature，记录：

```markdown
## Feature X: <功能名>

**行为描述（来自合同）**: <从合同提取的描述>
**硬阈值（来自合同）**: <量化通过标准>

### 测试方案

**验证维度**: happy path / 边界 / 数据一致性
**触发方式**: <如何调用 API 或触发流程>
**预期状态**: <触发后系统应处于什么状态>

### 执行结果

**实际响应**:
```
<curl 或 psql 输出>
```

**阈值对比**:
- 预期: <硬阈值>
- 实际: <测试结果>
- 结论: ✅ PASS / ❌ FAIL

**FAIL 时的 Bug 报告**:
- 现象: <具体观察到什么>
- 预期 vs 实际: <精确对比>
- 影响: <这个 bug 的影响范围>
```

---

### Step 5: 写入 eval-round-N.md（CRITICAL — 无论成功失败必须执行）

> **版本说明**: v3.x 输出文件为 `evaluation.md`；v4.0+ 改为 `eval-round-N.md`（含轮次编号，支持多轮验证追踪）。

**无论任何情况（验证失败、命令报错、环境问题），必须写入 eval-round-N.md。**

```bash
EVAL_FILE="${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md"
```

文件格式：

```markdown
# Eval Round {N} — {PASS/FAIL}

**评估时间**: {时间}
**评估轮次**: {N}
**总体结论**: PASS / FAIL

## 功能验证结果

| Feature | 验证维度 | 硬阈值 | 实际结果 | 结论 |
|---------|---------|-------|---------|------|
| Feature 1 | happy path + 边界 | ... | ... | ✅ PASS |
| Feature 2 | happy path + 数据一致性 | ... | ... | ❌ FAIL |

## 详细报告

{每个 Feature 的完整测试记录（见 Step 4 格式）}

## FAIL 汇总（如有）

{所有 FAIL 的 Bug 报告，供 Generator 修复}
```

**错误兜底**（测试环境异常时）：
```markdown
# Eval Round {N} — ERROR（partial evaluation）

**状态**: 部分验证因环境问题中断
**已完成验证**: {N}/{Total} 个 Feature
**中断原因**: {具体错误信息}

## 已验证的 Feature

{已完成的测试结果}

## 未验证的 Feature

{因中断未能验证的 Feature 列表}

## 结论

由于评估不完整，本轮标记为 FAIL，请 Generator 检查环境并重新触发评估。
```

---

### Step 6: git commit + push

```bash
cd "$(git rev-parse --show-toplevel)"
CURRENT_BRANCH=$(git branch --show-current)
git add "${SPRINT_DIR}/eval-round-${EVAL_ROUND}.md"
git commit -m "feat(eval): eval-round-${EVAL_ROUND} verdict=${VERDICT} round=${EVAL_ROUND}"
git push origin "${CURRENT_BRANCH}"
```

---

### Step 7: 输出 JSON verdict（CRITICAL — 最后一条消息）

**最后一条消息**必须是以下 JSON（字面量，不要用代码块）：

PASS 时：
```
{"verdict": "PASS", "eval_round": N, "sprint_dir": "sprints/...", "failed_features": []}
```

FAIL 时：
```
{"verdict": "FAIL", "eval_round": N, "sprint_dir": "sprints/...", "failed_features": ["Feature 1: <具体失败原因>"]}
```

---

## 验证质量标准

一次好的 Evaluator 运行应该：

1. **广度**：每个 Feature 至少验证 3 个维度（happy path + 至少 2 个边界/一致性检查）
2. **真实性**：实际调用 API 或查 DB，不用静态文件检查替代运行时验证
3. **精确性**：Bug 报告包含精确的预期值 vs 实际值对比
4. **独立性**：测试方案完全由 Evaluator 自主设计，不依赖 Generator 的预写命令
5. **可复现性**：测试步骤足够清晰，另一个 Evaluator 可以独立重现同样结果

---

## 典型验证示例

### 示例 A：验证 "API 返回 tasks 列表且包含 status 字段"

**合同行为描述**: GET /api/brain/tasks 返回任务列表，每个任务包含 id、status、type 字段
**硬阈值**: 响应为数组，每个元素必须有 status 字段

**独立设计的测试方案**：
```bash
# Happy path: 查询并验证结构
RESPONSE=$(curl -s "localhost:5221/api/brain/tasks?limit=5")

node -e "
const tasks = JSON.parse(process.argv[1]);
if (!Array.isArray(tasks)) throw new Error('FAIL: 响应不是数组');
if (tasks.length === 0) { console.log('WARN: 无任务数据，跳过字段检查'); process.exit(0); }
const missing = tasks.filter(t => !t.status || !t.id || !t.type);
if (missing.length > 0) throw new Error('FAIL: ' + missing.length + ' 个任务缺少必要字段');
console.log('PASS: ' + tasks.length + ' 个任务，全部包含必要字段');
" "$RESPONSE"

# 边界: 空结果时的响应格式
EMPTY=$(curl -s "localhost:5221/api/brain/tasks?status=nonexistent_status")
node -e "
const r = JSON.parse(process.argv[1]);
if (!Array.isArray(r)) throw new Error('FAIL: 空结果应返回空数组，实际: ' + typeof r);
console.log('PASS: 空结果返回空数组');
" "$EMPTY"

# 数据一致性: API 结果与 DB 直查对比
API_COUNT=$(curl -s "localhost:5221/api/brain/tasks?status=completed&limit=100" | jq 'length')
DB_COUNT=$(psql cecelia -t -c "SELECT COUNT(*) FROM tasks WHERE status = 'completed';" | tr -d ' ')
[ "$API_COUNT" -eq "$DB_COUNT" ] && echo "PASS: API 与 DB 数据一致" || echo "FAIL: API($API_COUNT) 与 DB($DB_COUNT) 不一致"
```

### 示例 B：验证 "Brain tick 处理 queued 任务并更新状态"

**合同行为描述**: Brain tick 自动处理 queued 任务，完成后状态变为 completed 或 failed
**硬阈值**: 任务在 60 秒内离开 queued 状态

**独立设计的测试方案**：
```bash
# 触发真实任务
TASK=$(curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"type":"health_check","payload":{}}')
TASK_ID=$(echo $TASK | jq -r '.id')
echo "创建任务: $TASK_ID"

# 等待 tick 处理（最多 60 秒）
START=$(date +%s)
while true; do
  sleep 5
  STATUS=$(curl -s localhost:5221/api/brain/tasks/$TASK_ID | jq -r '.status')
  ELAPSED=$(( $(date +%s) - START ))
  echo "  ${ELAPSED}s: 状态 = $STATUS"
  [ "$STATUS" != "queued" ] && [ "$STATUS" != "in_progress" ] && break
  [ $ELAPSED -ge 60 ] && { echo "FAIL: 60 秒内未离开 queued 状态"; exit 1; }
done

# 验证硬阈值
[ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] \
  && echo "PASS: 任务在 ${ELAPSED}s 内处理完毕，状态: $STATUS" \
  || echo "FAIL: 意外状态: $STATUS"
```
