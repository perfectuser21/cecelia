---
name: cto-review
version: 1.0.0
updated: 2026-03-18
description: |
  CTO 整体审查 Skill。

  供 Brain 派发的 cto_review 类型任务在西安 Codex 执行。
  以 CTO 视角审查：enriched PRD + DoD + 核心代码 diff，
  判断实现是否真正交付了用户意图。

  输出：
  - REVIEW_RESULT: PASS（核心意图已交付）
  - REVIEW_RESULT: FAIL + FAIL_REASONS（有明显遗漏或方向错误）

  权限：只读代码 + gh CLI 访问（不修改任何文件）
---

# /cto-review — CTO 整体审查

> 不是逐行审代码质量，是整体判断：
> **"这个 PR，能不能交付用户在 PRD 里说的那件事？"**

---

## 核心原则

```
审查维度 = 意图交付度 + DoD 质量 + 架构合规
审查禁区 = 代码风格 / 性能优化 / 主观偏好
```

**宽松标准（避免误杀）**：
- 核心功能实现了 → PASS
- 有明显遗漏或方向错误 → FAIL + 具体原因

---

## 输入参数

Brain 派发的 `cto_review` 任务，`description` 字段已包含完整上下文：

| 字段 | 来源 | 说明 |
|------|------|------|
| `enriched_prd` | 父任务 `metadata.enriched_prd` | 意图扩展后的完整需求，含战略目标 |
| `parent_task_id` | `payload.parent_task_id` | 父任务 ID，用于回写审查结果 |
| `pr_number` | `payload.pr_number` | PR 编号，用于获取 diff |
| `BRAIN_URL` | 环境变量 | Brain API 地址（默认 localhost:5221） |

---

## 执行流程

### Step 1：获取 Enriched PRD

从任务 `description` 中直接读取 enriched PRD（Brain 已注入）。

如果任务描述中缺少 enriched PRD，则通过 API 补充：

```bash
PARENT_TASK_ID="<从 payload.parent_task_id 读取>"
BRAIN_URL="${BRAIN_URL:-localhost:5221}"

curl -s "$BRAIN_URL/api/brain/tasks/$PARENT_TASK_ID" | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
meta = d.get('metadata') or {}
prd = meta.get('enriched_prd') or d.get('prd_content') or d.get('description') or '（无 enriched PRD）'
print(prd)
"
```

**记录**：enriched PRD 的关键意图点（用户真正要实现的目标是什么）

---

### Step 2：获取 DoD 文件

在仓库中查找当前分支的 DoD / Task Card 文件：

```bash
# 优先查找 task card（新格式）
ls .task-*.md 2>/dev/null | head -1

# 退化：查找旧格式
ls .dod*.md 2>/dev/null | head -1
```

读取文件，提取：
- DoD 验收条目列表（- [ ] / - [x] 条目）
- Test 字段（验证方式）

---

### Step 3：获取核心 Diff

```bash
PR_NUMBER="<从 payload.pr_number 读取>"

# 列出变更文件
gh pr diff "$PR_NUMBER" --name-only
```

**过滤掉噪音文件**（不审查以下内容）：
- `package-lock.json` / `yarn.lock`
- `docs/learnings/`（学习记录，非功能代码）
- `.task-*.md` / `.dod-*.md`（DoD 文件本身）
- `*.sql`（数据库迁移文件，由专门机制保护）
- `*.md`（文档，除非 PRD 明确要求文档产出）

```bash
# 获取核心文件 diff
CORE_FILES=$(gh pr diff "$PR_NUMBER" --name-only | grep -Ev \
  "(package-lock\.json|yarn\.lock|docs/learnings/|\.task-.*\.md|\.dod-.*\.md|\.sql$)" | \
  head -20)

# 获取核心文件的完整 diff（限制大小）
gh pr diff "$PR_NUMBER" -- $CORE_FILES | head -1000
```

---

### Step 4：CTO 整体审查

以 CTO 视角，逐一检查以下维度：

#### 维度一：意图交付度

> PRD 说的，代码有没有真正实现？

检查方式：
1. 列出 enriched PRD 中的**核心功能点**（3-5 个关键交付物）
2. 逐一在 diff 中寻找对应实现
3. 判断实现是否与意图匹配（不是完全相同，但方向正确）

判断标准：
- ✅ PASS：核心功能点均有对应实现
- ❌ FAIL：有 PRD 明确要求的功能，diff 中完全找不到对应代码

#### 维度二：DoD 质量

> 测试是否真实覆盖了需求？

检查方式：
1. 逐条检查 DoD 条目的 Test 字段
2. 判断 Test 是否能真正验证该条目（而非假测试）

假测试特征（以下任一 → 质量不足）：
- `echo PASS` / `echo "OK"` 类命令（永远通过）
- `test -f <file>`（只验证文件存在，不验证内容）
- `grep -c pattern file` 只统计行数（不验证逻辑）
- `TODO` 占位符

判断标准：
- ✅ PASS：关键 [BEHAVIOR] 条目的 Test 能真正验证运行时行为
- ❌ FAIL：超过 50% 的 DoD 条目用假测试，或关键功能无测试

#### 维度三：架构合规

> 有无越界或系统性问题？

检查方式：
1. 确认改动范围是否在预期边界内
2. 检查是否有跨模块越界

Cecelia 系统边界规则：

| 包 | 允许改动 | 禁止越界 |
|----|---------|---------|
| `packages/brain/` | 数据库逻辑、API 端点、调度 | 不改 UI、不改 engine hooks |
| `packages/engine/` | Hooks、Skills、DevGate 脚本 | 不改 Brain 业务逻辑 |
| `apps/` | React 组件、页面、样式 | 不直接操作数据库 |
| `packages/workflows/skills/` | Skill 定义文件 | 不改 Brain/Engine 代码 |

判断标准：
- ✅ PASS：改动在合理范围内
- ❌ FAIL：明显越界（如 skill 文件直接修改了 Brain 调度逻辑）

---

### Step 5：输出结果

#### PASS 格式

```
REVIEW_RESULT: PASS

审查摘要：
- 意图交付度：[简要说明核心功能已实现]
- DoD 质量：[简要说明测试质量达标]
- 架构合规：[简要说明无越界问题]

审查完成，PR 可以合并。
```

#### FAIL 格式

```
REVIEW_RESULT: FAIL

FAIL_REASONS:
- 意图交付度不足：PRD 要求 [X]，但代码中未找到对应实现（diff 中无 [关键函数/模块]）
- DoD 质量不足：第 [N] 条 [条目名] 的 Test 是假测试（[具体原因]），无法验证运行时行为
- 架构合规问题：[模块A] 越界修改了 [模块B] 的内部逻辑

建议修复：
1. [具体修复建议 1]
2. [具体修复建议 2]

审查完成，请修复上述问题后重新提交 PR。
```

---

## 审查原则

### 宽松标准（避免误杀好 PR）

| 情形 | 处理 |
|------|------|
| 实现方式与 PRD 描述不同，但目标一致 | ✅ PASS |
| 有少量代码风格问题 | ✅ PASS（不是 CTO 关注点）|
| DoD 有 1-2 条测试偏弱，但核心功能测试覆盖 | ✅ PASS |
| 有 PRD 要求的核心功能完全缺失 | ❌ FAIL |
| 超过半数 DoD 条目是假测试 | ❌ FAIL |
| 明显架构越界 | ❌ FAIL |

### 严格标准（不放过真问题）

1. **意图遗漏**：PRD 明确说了"要 X"，代码里根本没有 → FAIL
2. **假 DoD**：写了条目但用 `echo` 假验证 → FAIL
3. **方向错误**：做了 A，但用户要的是 B → FAIL

---

## 调用方式

### Brain 自动派发

Brain 的 `request-cto-review` 接口会自动创建任务并分发到西安 Codex 执行：

```bash
# 父任务请求 CTO 审查（Brain 自动调用）
POST $BRAIN_URL/api/brain/tasks/:parentTaskId/request-cto-review
Body: { "pr_number": 123 }
```

### 手动触发（调试用）

```bash
/cto-review
# 在 PARENT_TASK_ID 和 PR_NUMBER 环境变量已设置时手动执行
```

---

## 结果回写

审查完成后，将结果通过 execution-callback 写入父任务：

```bash
# 回写审查结果
BRAIN_URL="${BRAIN_URL:-localhost:5221}"
curl -s -X POST "$BRAIN_URL/api/brain/tasks/$PARENT_TASK_ID/execution-callback" \
  -H "Content-Type: application/json" \
  -d "{
    \"status\": \"completed\",
    \"result\": \"REVIEW_RESULT: PASS\",
    \"metadata\": {
      \"review_result\": \"PASS\",
      \"review_summary\": \"...\",
      \"reviewed_at\": \"$(TZ=Asia/Shanghai date -Iseconds)\"
    }
  }"
```
