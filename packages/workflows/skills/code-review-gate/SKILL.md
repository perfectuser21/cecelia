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
  - 1.6.0: 新增 Evaluator Calibration（few-shot 锚定示例）；强化裁决规则为全通过制
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

## Evaluator Calibration（少样本锚定）

> **目的**：防止「自我认证」偏差——Evaluator 必须能稳定区分 PASS 与 FAIL，不受主 agent 信心影响。
> 每次审查前，先用以下 3 个锚定示例校准判断尺度，再开始真正审查。

### 示例 1 — 明确 FAIL（维度 A + B blocker）

```diff
// routes/api.js
- const query = `SELECT * FROM users WHERE id = ${req.params.id}`;
+ const query = `SELECT * FROM users WHERE id = ${userId}`;
  db.query(query, callback);
```

**裁决**：FAIL
**原因**：
- 维度 A blocker：SQL 拼接未参数化（`userId` 直接插入 SQL 字符串），SQL 注入漏洞
- 正确做法：`db.query('SELECT * FROM users WHERE id = ?', [userId], callback)`
- **全通过制**：此 blocker 直接导致整体 FAIL，不能降为 warning

---

### 示例 2 — 明确 PASS（改动干净，无 blocker）

```diff
// packages/brain/src/task-router.js
  const LOCATION_MAP = {
-   'code_review': 'us-mac',
+   'code_review': 'hk-vps',
+   'code_review_gate': 'us-mac',
  };
```

```diff
// packages/brain/src/thalamus.js
  const ACTION_WHITELIST = [
    'code_review',
+   'code_review_gate',
  ];
```

**裁决**：PASS
**原因**：
- 维度 A：无安全问题
- 维度 B：逻辑正确，新增路由与白名单同步更新
- 维度 G：假设 PRD 要求新增 code_review_gate 路由，改动与 DoD 对齐
- 维度 H：两个文件同步更新（thalamus + task-router），无模块一致性问题
- 无任何 blocker，所有维度通过 → PASS

---

### 示例 3 — 边界案例（维度 H blocker，易误判为 warning）

```diff
// packages/engine/skills/dev/steps/01-spec.md
- ## ⚡ 执行 spec_review Agent subagent（CRITICAL — Stage 1 最后一步）
+ ## ⚡ Sprint Contract Gate（CRITICAL — Stage 1 最后一步）
+
+ > spec_review subagent 独立写出测试方案，与主 agent 比对，一致才能继续。
```

```
// 未修改：packages/engine/skills/dev/SKILL.md（同目录）
// 其中仍有旧文字："Stage 1 完成后，调用 Agent subagent 同步审查 Task Card 质量"
// 与新的 Sprint Contract 描述语义冲突
```

**裁决**：FAIL
**原因**：
- 维度 H blocker（跨文件模块一致性）：改了 `01-spec.md` 但同目录的 `SKILL.md` 仍引用旧行为描述
- **关键判断**：旧描述"同步审查 Task Card 质量"与新描述"独立写测试方案比对"语义不同，属于矛盾引用
- 错误倾向：把这当作 warning（"只是描述方式不同"）→ 正确应为 blocker
- **全通过制**：同模块文件矛盾引用 = blocker，整体 FAIL，不能因为"只是文档"就降级

---

### 校准要点

| 常见误判 | 正确判断 |
|---------|---------|
| 把 SQL 拼接降为 warning（"看起来值是内部变量"） | 只要是字符串拼接进 SQL，就是 blocker |
| 把跨文件描述矛盾降为 warning（"只是表达方式"） | 同模块文件有矛盾引用 = blocker |
| 把无断言 BEHAVIOR Test 降为 warning（"至少有测试"） | [BEHAVIOR] 无断言 = blocker（适用于 spec_review） |
| 把重复代码降为 info（"还没到 3 次"） | 同一逻辑重复 3 次以上必须提取 = blocker（维度 C） |

---

## 裁决规则（全通过制）

### PASS

**所有 A-H 维度均无 blocker 级别问题**。warning 和 info 记录但不阻塞。

> **全通过制**：任何一个维度有 blocker = 整体 FAIL，不能降为 warning，不能忽略。
> 这是硬门禁，不是软建议。

### FAIL

**以下任一情况为 FAIL（无例外，不可降级）**：
- 维度 A：任何 SQL 注入、命令注入、XSS、硬编码凭据、认证绕过
- 维度 B：逻辑错误、边界条件未处理、未处理的 error
- 维度 C：同一逻辑重复 3 次以上（重复代码 blocker）
- 维度 E：O(n²) 可优化为 O(n) 的不必要循环
- 维度 G：DoD 漏实现、超范围改动
- 维度 H：替代性内容未删旧描述、跨文件模块一致性问题

FAIL 时必须修复所有 blocker 后重新提交审查，不能合并 PR。

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
