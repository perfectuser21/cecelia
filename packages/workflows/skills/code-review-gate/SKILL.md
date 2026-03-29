---
name: code-review-gate
version: 1.6.0
model: claude-sonnet-4-6
created: 2026-03-20
updated: 2026-03-29
changelog:
  - 1.0.0: 合并 code_quality + /simplify 为统一代码审查 Gate
  - 1.1.0: A1 C/E维度升级blocker；A2 新增维度G PRD/DoD对齐验证；A3 修复时机描述为Stage 2
  - 1.2.0: 清理过时描述，修正触发时机（push前 Stage 2），删除旧 Gate 编号引用
  - 1.3.0: 新增维度 H 信息卫生（引用已删除功能/路径=warning，同一概念矛盾描述=warning）
  - 1.4.0: 维度 H 新增 blocker：替代性内容加入但旧描述未删除（改A→B时A仍保留=blocker）
  - 1.5.0: 维度 H 新增 blocker：跨文件模块一致性（改文件X导致同模块文件Y出现矛盾引用=blocker）
  - 1.6.0: 新增 Evaluator Calibration 章节（3 个定锚样例：FAIL/PASS/Boundary）防止判断漂移
description: |
  代码审查 Gate（/dev Stage 2 最后一步）。合并了 code_quality（代码质量审查）和 /simplify（代码简化）。
  在 /dev Stage 2 代码写完后、push 之前触发。此时无 PR，通过 git diff 获取变更内容。
  覆盖安全、正确性、复用性、命名、效率、可维护性、PRD/DoD对齐、信息卫生九个维度。
  给出 PASS / FAIL 裁决。
  触发词：代码审查、code-review-gate、合并前检查、代码门禁。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# Code-Review-Gate — 代码审查 Gate

**唯一职责**：在 Stage 2 代码写完后、push 之前，审查代码质量。

合并了以下两个旧 Skill 的职责：
- `code_quality`：安全性、正确性审查
- `/simplify`：复用性、命名、效率优化

**时机**：/dev Stage 2 代码完成 -> Code-Review-Gate 审查（含 Simplify）-> PASS 后才能 push 进入 Stage 3。

---

## 触发方式

```
/code-review-gate                        # 审查当前 PR
/code-review-gate --pr <number>          # 指定 PR 编号
/code-review-gate --scope <path>         # 只审查指定路径
```

### Brain 自动派发

```json
{
  "task_type": "code_review_gate",
  "pr_number": 123,
  "repo_path": "/path/to/repo",
  "branch_name": "cp-XXXX-feature"
}
```

---

## 输入

从当前分支改动获取变更文件列表，逐文件审查。
在 /dev Stage 2（push 前）触发，此时无 PR，用 git diff。

```bash
# 获取变更文件列表
git diff origin/main..HEAD --name-only
# 获取完整 diff（最多 100KB）
git diff origin/main..HEAD
```

---

## 审查维度

### 维度 A：安全性

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **SQL 注入** | blocker | 检查 SQL 拼接（非参数化查询） |
| **命令注入** | blocker | exec/spawn + 用户输入拼接 |
| **XSS** | blocker | 用户输入直接渲染到 HTML |
| **硬编码凭据** | blocker | password= / key= / secret= / token= 硬编码值 |
| **认证绕过** | blocker | API 端点缺少认证检查 |
| **敏感信息泄露** | warning | 日志中打印了敏感数据 |

### 维度 B：正确性

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **逻辑错误** | blocker | 条件判断反转、算法错误 |
| **边界条件** | blocker | 空数组、null、undefined 未处理 |
| **未处理的 error** | blocker | catch 块为空或只 console.log |
| **异步问题** | warning | 缺少 await、Promise 未处理 |
| **资源泄露** | warning | 连接、文件句柄未关闭 |
| **类型错误** | warning | 隐式类型转换可能导致问题 |

### 维度 C：复用性（来自 /simplify）

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **重复代码** | blocker | 同一逻辑重复 3 次以上，应提取函数 |
| **大段复制** | warning | 跨文件复制粘贴 > 20 行相似代码 |
| **工具函数缺失** | info | 多处使用的通用逻辑未抽取为工具函数 |

### 维度 D：命名（来自 /simplify）

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **变量命名** | info | 单字母变量（循环变量除外）、无意义命名 |
| **函数命名** | info | 函数名不能反映其功能 |
| **常量命名** | info | 魔法数字未提取为命名常量 |

### 维度 E：效率（来自 /simplify）

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **不必要的循环** | blocker | O(n^2) 可优化为 O(n)、嵌套循环可用 Map 替代 |
| **过度抽象** | info | 为单一用途创建了复杂的类层次结构 |
| **不必要的依赖** | info | 引入整个库只用了一个函数 |

### 维度 F：可维护性

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **文件过大** | warning | 单文件 > 500 行，应拆分 |
| **关注点混合** | warning | 一个函数做了多件不相关的事 |
| **注释代码** | info | 遗留的注释代码块未清理 |
| **未用 import** | info | 导入了但未使用的模块 |
| **console.log 残留** | info | 调试用的 console.log 未清理 |

### 维度 G：PRD/DoD 对齐验证

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **DoD 漏实现** | blocker | DoD 中有 [ARTIFACT]/[BEHAVIOR] 条目但 git diff 中找不到对应改动 |
| **超范围改动** | blocker | git diff 改了 PRD「不做什么」中明确排除的文件或功能 |
| **孤儿实现** | warning | 代码中有新增逻辑但 DoD 中没有对应条目 |

**验证方法**：
1. 读取 `.task-cp-xxx.md` 的「成功标准」和「验收条件（DoD）」章节
2. 对每条 `- [ ] [ARTIFACT]` 或 `- [ ] [BEHAVIOR]` 条目，检查 git diff 是否有对应改动
3. 读取「不做什么」章节，检查 diff 是否越界

### 维度 H：信息卫生

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| **替代性内容未删旧描述** | blocker | diff 中新增行描述了新行为/新内容（如新步骤、新规则、新参数），但同文件中对应的旧描述没有在同一 PR 中被删除（没有 `-` 对应行） |
| **跨文件模块一致性** | blocker | 改动文件 X 后，同模块（同目录）其他文件 Y 中存在引用 X 旧行为/旧版本/旧步骤编号/旧路径的内容，且未在本 PR 中同步修复。发现此类矛盾 = blocker，FAIL |
| **引用已删除功能/路径** | warning | diff 中新增的文字引用了 changelog 里标记为"已删除"或"废弃"的功能名、旧文件路径或旧 API |
| **同一概念矛盾描述** | warning | 同一术语或流程在改动文件的不同位置有不一致的说法（如版本号两处不同、步骤顺序冲突） |
| **过时 changelog 条目未清理** | info | 新增的 changelog 条目里提及了已删除功能的历史记录，但正文中该功能已不存在 |

**验证方法**：
1. **blocker 检查（替代性内容）**：
   - 找出 diff `+` 行中描述新行为的句子（含关键词：现在、改为、新增、替换、升级、修改为等）
   - 在同文件的未删除行中搜索是否还存在对应的旧描述（语义重叠但说法不同）
   - 若旧描述仍存在且无对应 `-` 删除行 → blocker（典型例子：新增"步骤3做X"，但旧的"步骤3做Y"依然保留）
2. **blocker 检查（跨文件模块一致性）**：
   - 列出 diff 中所有改动文件，按目录分组
   - 对每个改动文件，读取同目录下其他文件（SKILL.md、步骤文件、配置、文档等）
   - 检查：同模块文件是否引用了被改掉的旧版本号、旧步骤编号、旧行为描述、旧路径？
   - 若找到矛盾引用且本 PR 未修复 → blocker，FAIL
3. **warning 检查（旧引用）**：扫描 `+` 行，对照 `changelog` 中的 `removed`/`deprecated` 标记，检查是否重新引用了已删除条目
4. **warning 检查（矛盾描述）**：在改动文件内搜索同一术语，检查多处说法是否一致

---

## 裁决规则

### PASS

所有维度无 blocker 级别问题。warning 和 info 记录但不阻塞。

### FAIL

以下任一情况为 FAIL：
- 任何 blocker 级别问题存在（包含维度 C/E 的 blocker 项，必须修复后才能继续）
- 安全维度发现任何注入或凭据暴露

FAIL 时必须修复 blocker 后重新提交审查，不能合并 PR。

---

## 输出格式（必须 JSON）

```json
{
  "verdict": "PASS | FAIL",
  "issues": [
    {
      "severity": "blocker | warning | info",
      "dimension": "A | B | C | D | E | F | G | H",
      "file": "path/to/file.js",
      "line": 42,
      "description": "具体问题描述",
      "suggestion": "修正建议或示例代码"
    }
  ],
  "stats": {
    "blocker": 0,
    "warning": 2,
    "info": 3
  },
  "summary": "一句话总结"
}
```

---

## Brain 回调

审查完成后回调 `/api/brain/execution-callback`：

```bash
curl -s -X POST http://localhost:5221/api/brain/execution-callback \
  -H "Content-Type: application/json" \
  -d "{
    \"task_id\": \"$TASK_ID\",
    \"run_id\": \"$RUN_ID\",
    \"status\": \"AI Done\",
    \"result\": {
      \"verdict\": \"PASS\",
      \"blocker_count\": 0,
      \"warning_count\": 2,
      \"summary\": \"$SUMMARY\"
    }
  }"
```

---

## 与现有 /code-review 的关系

| Skill | 职责 | 时机 |
|-------|------|------|
| `/code-review` | 日常巡检（时间窗口扫描、Initiative 集成审查） | 定时 / Brain 派发 |
| `/code-review-gate` | 单 PR 合并门禁（阻塞性审查） | /dev Stage 2 代码完成后（push 前）|

两者不冲突：`/code-review` 是主动巡逻，`/code-review-gate` 是必经关卡。

---

## 核心原则

1. **合并前最后一关**：通过了才能合并，不通过就修
2. **blocker 零容忍**：安全问题和逻辑错误必须修复
3. **具体到行号**：每个 issue 指出具体文件和行号
4. **建议可执行**：suggestion 给出具体的修复代码或方案
5. **快速审查**：一次审查不超过 5 分钟

---

## Evaluator Calibration

> **目的**：防止 Evaluator 判断漂移（过宽或过严）。阅读以下三个定锚样例后，以它们为基准做出裁决。
> **使用方式**：每次执行 code-review-gate 审查前，先内化这三个样例的判断标准，再审查实际 diff。

### Calibration Example 1 — FAIL 样例（明确阻塞）

**场景**：新增任务查询 API 端点。

```diff
// packages/brain/src/routes/tasks.js
+router.get('/tasks/:id', async (req, res) => {
+  const taskId = req.params.id;
+  const result = await db.query(
+    `SELECT * FROM tasks WHERE id = '${taskId}'`
+  );
+  res.json(result.rows[0]);
+});
```

**裁决：FAIL**

命中规则：
- 维度 A blocker：SQL 注入（string interpolation 拼接 `taskId` 进 SQL，未使用参数化查询）
- 维度 B blocker：未处理 `result.rows` 为空的情况（空数组访问 `[0]` 返回 `undefined`，调用方会得到 null 响应而非 404）

修复方案：
```diff
-    `SELECT * FROM tasks WHERE id = '${taskId}'`
+    'SELECT * FROM tasks WHERE id = $1', [taskId]
+  );
+  if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
```

---

### Calibration Example 2 — PASS 样例（明确通过）

**场景**：同一任务查询 API，正确实现版本。

```diff
// packages/brain/src/routes/tasks.js
+router.get('/tasks/:id', async (req, res) => {
+  const { id } = req.params;
+  try {
+    const result = await db.query(
+      'SELECT id, title, status, priority FROM tasks WHERE id = $1',
+      [id]
+    );
+    if (!result.rows[0]) {
+      return res.status(404).json({ error: 'Task not found' });
+    }
+    res.json(result.rows[0]);
+  } catch (err) {
+    console.error('[tasks] query failed:', err.message);
+    res.status(500).json({ error: 'Internal server error' });
+  }
+});
```

**裁决：PASS**

分析：
- 维度 A：参数化查询 `$1`，无 SQL 注入风险 ✅
- 维度 B：处理了 `rows[0]` 为空（404）和异常（catch + 500）✅
- 维度 C：无重复代码 ✅
- 维度 D：命名清晰（`id`，无单字母歧义变量）✅
- 维度 G：符合 Brain routes 模式 ✅

只有一个 info 级别：SELECT 指定了列名（非 `*`），良好实践。无任何 blocker。

---

### Calibration Example 3 — Boundary 边界案例（有 warning/info 但 PASS）

**场景**：新增 Brain 状态摘要工具函数。

```diff
// packages/brain/src/utils/status-summary.js
+const _ = require('lodash');  // only used for _.pick below
+
+function buildStatusSummary(tasks, alertness) {
+  const x = tasks.filter(t => t.status === 'in_progress');
+  const done = tasks.filter(t => t.status === 'completed');
+  // TODO: remove debug log later
+  console.log('Building summary, active tasks:', x.length);
+  return {
+    active: x.length,
+    completed: done.length,
+    alertnessLevel: alertness,
+    picked: _.pick({ a: 1, b: 2 }, ['a'])
+  };
+}
+
+module.exports = { buildStatusSummary };
```

**裁决：PASS**（含 warning/info，不阻塞）

分析：
- 维度 D info：变量 `x` 命名不清晰，建议改为 `activeTasks`
- 维度 F info：引入 `lodash` 只用了 `_.pick` 一个函数，建议换成原生 `Object.fromEntries`
- 维度 F info：`console.log` 调试日志残留，应在合并前清理

**判断理由**：以上问题均为 info 级，无 blocker（无安全问题、无逻辑错误、无重复代码 ≥3 次）。PASS 并在 issues 中标注 info 供开发者参考。

> **定锚意义**：看到只有命名+console.log+轻量依赖问题时，不要升级为 FAIL。这是 info 级，PASS。
