# Step 4: DoD

> 定义验收标准（Definition of Done）

---

## 流程

```
DoD 草稿 → QA Decision Node → QA 决策产物 → DoD 定稿
```

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

---

## Gate 检查

PR Gate 会检查：
1. `.dod.md` 存在且内容有效
2. `.dod.md` 包含 `QA: docs/QA-DECISION.md` 引用
3. `docs/QA-DECISION.md` 存在

---

## 完成后

```bash
echo "✅ Step 4 完成 (DoD + QA 决策)，可以开始写代码"
```

**DoD 定稿后，进入 Step 5：写代码**
