# Step 7: 质检

> Audit Node 做代码审计，然后跑测试

---

## 流程

```
写完代码 → Audit Node → 审计报告 → blocker=0? → npm run qa
                                    ↓
                              blocker>0 → 停止，修复
```

---

## Step 7.1: Audit Node（必须）

**在跑测试前，必须输出审计报告**。

### 规范来源

参考 `skills/audit/SKILL.md` 中的规则：
- L1 阻塞性（必须修）
- L2 功能性（建议修）
- L3 最佳实践（可选）
- L4 过度优化（不修）

### 输入

- 本次改动的文件
- 目标层级：L2（默认）

### 输出

- `docs/AUDIT-REPORT.md`（必须创建）

### 输出 Schema（固定格式）

```yaml
# Audit Report
Branch: cp-xxx
Date: YYYY-MM-DD
Scope: file1, file2, ...
Target Level: L2

Summary:
  L1: 0
  L2: 0
  L3: 0
  L4: 0

Decision: PASS | FAIL

Findings:
  - id: A1-001
    layer: L1 | L2 | L3 | L4
    file: path/to/file
    line: 123
    issue: 问题描述
    fix: 修复建议
    status: fixed | pending

Blockers: []  # L1 + L2 问题列表
```

---

## Step 7.2: Blocker 检查

**硬规则：blocker > 0 则停止，不允许进入 PR**

```
查看 docs/AUDIT-REPORT.md:

Decision: PASS   → 继续 Step 7.3
Decision: FAIL   → 停止，修复 L1/L2 问题后重新审计
```

---

## Step 7.3: 跑测试

blocker 清零后，跑自动化测试：

```bash
npm run qa  # = typecheck + test + build
```

### 双模式质检

| 模式 | 检查内容 | 适用场景 |
|------|----------|----------|
| **pr** (默认) | L1 自动化测试 | 日常 PR → develop |
| **release** | L1 + L2B + L3 证据链 | 发版 develop → main |

---

## PR 模式检查项

- [ ] `npm run typecheck` 通过
- [ ] `npm run test` 通过
- [ ] `npm run build` 通过
- [ ] `.prd.md` 存在且内容有效
- [ ] `.dod.md` 存在且有验收清单
- [ ] `.dod.md` 包含 `QA:` 引用
- [ ] `docs/QA-DECISION.md` 存在
- [ ] `docs/AUDIT-REPORT.md` 存在且 `Decision: PASS`

---

## Release 模式检查项

PR 模式检查项 + 以下内容：

- [ ] `.layer2-evidence.md` 存在
- [ ] 截图 ID 对应文件存在
- [ ] `.dod.md` 所有 checkbox 打勾

---

## Gate 检查

PR Gate 会检查：
1. `docs/AUDIT-REPORT.md` 存在
2. 包含 `Decision: PASS`（FAIL 则 Gate 失败）

---

## 结果处理

| 结果 | 动作 |
|------|------|
| Audit → FAIL | 修复 blocker，重新审计 |
| Audit → PASS, npm run qa 失败 | 修复代码，重跑 |
| Audit → PASS, npm run qa 通过 | 继续 Step 8 (PR) |

---

## 质检原则

1. **先审计后测试** - Audit Node 是 npm run qa 的前置
2. **blocker 是硬门禁** - L1/L2 > 0 不能继续
3. **分层检查** - PR 只 L1，Release 才 L2B+L3
4. **产物留痕** - 审计报告必须存在
