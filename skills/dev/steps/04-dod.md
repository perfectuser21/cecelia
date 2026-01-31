# Step 4: DoD

> 定义验收标准（Definition of Done）

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "in_progress" })`

---

## 流程

```
DoD 草稿 → DoD 定稿 → gate:dod + QA (并行 subagents) → 继续
```

**关键变化 (v3)**：gate:dod 和 QA Decision 并行执行，两个都 PASS 才能继续。

---

## Step 4.1: DoD 草稿

把 PRD 里的"成功标准"变成可勾选的清单（Test 可以先空）：

```
PRD 成功标准: "用户能登录"
    ↓
DoD 草稿:
  - [ ] 用户输入正确密码能登录成功
        Test: (待定)
  - [ ] 用户输入错误密码显示错误提示
        Test: (待定)
```

---

## Step 4.2: QA Decision Node（必须）

**在 DoD 定稿前，必须输出 QA 决策产物**。

### 规范来源

参考 `skills/qa/SKILL.md` 中的规则：
- 测试大类：Regression / Unit / E2E
- RCI 判定标准
- Golden Path 判定标准
- 测试方式决策（auto/manual）

### 输入

- PRD (.prd.md)
- DoD 草稿
- 改动类型（feature/bugfix/refactor）

### 输出

- `docs/QA-DECISION.md`（必须创建）

### 输出 Schema（固定格式）

```yaml
# QA Decision
Decision: NO_RCI | MUST_ADD_RCI | UPDATE_RCI
Priority: P0 | P1 | P2
RepoType: Engine | Business

Tests:
  - dod_item: "功能描述"
    method: auto | manual
    location: tests/xxx.test.ts | manual:描述

RCI:
  new: []      # 需要新增的 RCI ID
  update: []   # 需要更新的 RCI ID

Reason: 一句话说明决策理由
```

### ⚡ QA Node 完成后的强制指令

**生成 QA-DECISION.md 后，立即进入 Step 4.3 (DoD 定稿)**：

1. **不要**输出"QA 决策已生成！"
2. **不要**停顿或等待确认
3. **立即**继续下一步：补全 DoD 的 Test 字段

---

## Step 4.3: DoD 定稿

根据 QA 决策产物，补全每个 DoD 条目的 Test 字段：

```markdown
# DoD - <功能名>

QA: docs/QA-DECISION.md   ← 必须引用

## 验收标准

### 功能验收
- [ ] 用户输入正确密码能登录成功
      Test: tests/auth.test.ts
- [ ] 用户输入错误密码显示错误提示
      Test: tests/auth.test.ts

### 测试验收
- [ ] npm run qa 通过
      Test: contract:C2-001
```

---

## DoD 模板

```markdown
# DoD - <功能名>

QA: docs/QA-DECISION.md

## 验收标准

### 功能验收
- [ ] <功能点 1>
      Test: tests/... | contract:... | manual:...
- [ ] <功能点 2>
      Test: tests/... | contract:... | manual:...

### 测试验收
- [ ] npm run qa 通过
      Test: contract:C2-001
```

### Test 字段格式说明

| 格式 | 场景 | 优先级 | 示例 |
|------|------|--------|------|
| `tests/xxx.test.ts` | 自动化单元测试 | ⭐⭐⭐ 最优 | `tests/auth.test.ts` |
| `contract:RCI-ID` | 回归契约验证 | ⭐⭐ 次优 | `contract:C2-001` |
| `manual:描述` | 手动验证步骤 | ⭐ 最后 | `manual:截图验证UI` |

**选择原则**：能自动化测试的优先自动化，其次引用回归契约，最后才用手动验证。

---

## Gate 检查

PR Gate 会检查：
1. `.dod.md` 存在且内容有效
2. `.dod.md` 包含 `QA: docs/QA-DECISION.md` 引用
3. `docs/QA-DECISION.md` 存在

---

## Step 4.4: 并行审核（必须）

DoD 定稿后，**并行**启动两个 Subagent：gate:dod + gate:qa

### 循环逻辑

```
主 Agent 写 DoD + QA-DECISION.md
    ↓
并行启动 gate:dod + gate:qa Subagent（用一条消息发送两个 Task 调用）
    ↓
等待两个都返回
    ↓
├─ 任一 FAIL → 主 Agent 根据 Required Fixes 修改 → 再次并行启动
└─ 两个都 PASS → 生成 gate 文件 → 继续 Step 5
```

### gate:dod Subagent 调用

```
Task({
  subagent_type: "general-purpose",
  prompt: `你是独立的 DoD 审核员。审核以下文件：
- PRD: {prd_file}
- DoD: {dod_file}
- QA: docs/QA-DECISION.md
- 测试文件: {test_files}

## 审核标准

### 1. PRD ↔ DoD 覆盖率
对照 PRD 的每个成功标准，检查 DoD 是否有对应验收项。
- 列出 PRD 需求 → DoD 验收项的映射
- 标记缺失的需求
- 标记凭空出现的验收项

### 2. 验收项具体性
检查每条验收项：
- [ ] 具体可测？（不是"改进"、"优化"等模糊词）
- [ ] 有预期结果？
- [ ] 有验证方法？

反例（不可接受）：
- "修改代码" - 改什么？
- "测试一下" - 测什么？
- "部署" - 部署到哪？怎么验证？

正例（可接受）：
- "修改 hooks/xxx.sh，将正则改为 skills/(dev|qa)/"
- "Write ~/.claude/skills/dev/xxx → 被阻止 (exit 2)"
- "部署到 ~/.claude/hooks/，验证版本为 v18"

### 3. Test 字段有效性
- 检查 tests/xxx 文件是否存在
- 检查 contract:xxx ID 是否有效
- 检查 manual:xxx 是否说明验证方法（不能只写 "manual:done"）

### 4. QA 引用正确性
- QA 文件是否存在？
- QA 任务名是否与当前分支匹配？
- QA 变更范围是否准确？

## 输出格式（必须严格遵守）

## Gate Result

Decision: PASS | FAIL

### Findings
- [PASS/FAIL] PRD↔DoD 覆盖率：X/Y 需求已覆盖
- [PASS/FAIL] 验收项具体性：X/Y 项合格
- [PASS/FAIL] Test 字段有效性：X/Y 项有效
- [PASS/FAIL] QA 引用正确性：...

### Required Fixes (if FAIL)
1. 缺失的 PRD 需求：...
2. 模糊的验收项：...
3. 无效的 Test 字段：...
4. QA 引用问题：...

### Evidence
- PRD 需求列表：...
- DoD 验收项列表：...
- 测试文件检查结果：...`,
  description: "gate:dod"
})
```

### gate:qa Subagent 调用

```
Task({
  subagent_type: "general-purpose",
  prompt: `你是 QA 决策员。根据 PRD 和 DoD 做测试决策。
- PRD: {prd_file}
- DoD: {dod_file}

## 规则

### Repo 类型判断
- 仓库包含 regression-contract.yaml、hooks/、skills/ → RepoType = Engine
- 否则 → RepoType = Business

### RCI 判定标准
- 涉及核心功能（Hook、Gate、CI）→ MUST_ADD_RCI 或 UPDATE_RCI
- 只是文档或配置 → NO_RCI
- P0/P1 修复必须更新 RCI

### 测试方式决策
- 能自动化 → auto + tests/xxx.test.ts
- 回归契约覆盖 → auto + contract:xxx
- 无法自动化 → manual + 描述

## 输出格式（必须严格遵守，输出到 docs/QA-DECISION.md）

# QA Decision

Decision: NO_RCI | MUST_ADD_RCI | UPDATE_RCI
Priority: P0 | P1 | P2
RepoType: Engine | Business

Tests:
  - dod_item: "功能描述"
    method: auto | manual
    location: tests/xxx.test.ts | manual:描述

RCI:
  new: []
  update: []

Reason: 一句话说明决策理由`,
  description: "gate:qa"
})
```

### PASS 后操作

```bash
bash scripts/gate/generate-gate-file.sh dod
```

---

## 完成后

**Task Checkpoint**: `TaskUpdate({ taskId: "4", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/05-code.md`
2. 立即开始写代码
3. **不要**输出总结或等待确认
4. **不要**停顿

---

**Step 5：写代码**
