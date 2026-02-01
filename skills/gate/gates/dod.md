# gate:dod - DoD 审核标准

## 触发时机

Step 4 (DoD 定稿 + QA 决策) 完成后

## 审核目标

确保 DoD 完全覆盖 PRD 需求，每条验收项都有有效的测试映射，QA 文件与当前任务关联。

## 审核标准

### 1. PRD ↔ DoD 覆盖率

| 检查项 | 要求 |
|--------|------|
| PRD 需求覆盖 | PRD 每个成功标准在 DoD 中都有对应验收项 |
| 无凭空出现 | DoD 验收项必须能追溯到 PRD |
| 合理扩展 | 实现细节的扩展（如部署验证）可以接受 |

### 2. 验收项具体性

每条验收项必须：
- 具体可测：不是"改进"、"优化"等模糊词
- 有预期结果：明确说明成功是什么样
- 有验证方法：能通过测试或手动验证

**反例**：
```
❌ "修改代码" - 改什么？
❌ "测试一下" - 测什么？
❌ "部署" - 部署到哪？怎么验证？
```

**正例**：
```
✅ "修改 hooks/branch-protect.sh，将正则改为 skills/(dev|qa|audit|semver)/"
✅ "Write ~/.claude/skills/dev/xxx → 被阻止 (exit 2)"
✅ "部署到 ~/.claude/hooks/，验证版本为 v18"
```

### 3. Test 字段有效性

| Test 类型 | 验证要求 |
|----------|---------|
| `tests/xxx.ts` | 文件必须存在 |
| `contract:xxx` | RCI ID 必须在 regression-contract.yaml 中 |
| `manual:xxx` | 必须说明具体验证方法，不能只写 "manual:done" |

### 4. QA 引用正确性

| 检查项 | 要求 |
|--------|------|
| QA 文件存在 | `docs/QA-DECISION*.md` 存在 |
| 任务关联 | QA 文件中的任务名与当前分支匹配 |
| 内容相关 | QA 的变更范围与实际修改一致 |

## Subagent Prompt 模板

**重要**: 只审核，不修改文件。返回 PASS 或 FAIL + 详细反馈。

```
你是独立的 DoD 审核员。审核以下文件：
- PRD: {prd_file}
- DoD: {dod_file}
- QA: {qa_file}
- 测试文件: {test_files}

## 审核标准

### 1. PRD ↔ DoD 覆盖率
对照 PRD 的每个成功标准，检查 DoD 是否有对应验收项。
- 列出 PRD 需求 → DoD 验收项的映射
- 标记缺失的需求
- 标记凭空出现的验收项

### 2. 验收项具体性
检查每条验收项：
- [ ] 具体可测？
- [ ] 有预期结果？
- [ ] 有验证方法？

### 3. Test 字段有效性
- 检查 `tests/xxx` 文件是否存在
- 检查 `contract:xxx` ID 是否有效
- 检查 `manual:xxx` 是否说明验证方法

### 4. QA 引用正确性
- QA 文件是否存在？
- QA 任务名是否与当前分支匹配？
- QA 变更范围是否准确？

## 输出格式

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
- 测试文件检查结果：...

**记住**: 不要调用 Edit/Write 工具修改文件，只返回审核结果。
```

## PASS 条件

1. PRD 需求 100% 覆盖
2. 所有验收项具体可测
3. 所有 Test 字段有效
4. QA 引用正确

## FAIL 条件

任一条件不满足，返回具体问题和修复要求
