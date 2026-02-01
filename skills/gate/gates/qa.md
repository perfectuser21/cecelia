# gate:qa - QA 决策审核标准

## 触发时机

Step 4 (DoD 定稿 + QA 决策) 完成后

## 审核目标

确保 QA 决策基于真实的风险评估，测试策略与变更范围匹配，不是"NO_RCI + P2"应付了事。

## 审核标准

### 1. 决策一致性

| 检查项 | 要求 |
|--------|------|
| Decision 合理 | NO_RCI / MUST_ADD_RCI / UPDATE_RCI 与变更类型匹配 |
| Priority 合理 | P0/P1/P2 与影响范围匹配 |
| RepoType 正确 | Engine / Business 正确识别 |

**示例**：
- 新增 Hook → MUST_ADD_RCI + P0（核心流程）
- 文档优化 → NO_RCI + P2（无需回归）
- API 变更 → MUST_ADD_RCI + P1（重要但非阻塞）

### 2. 测试映射有效性

每个 DoD 验收项必须有测试方法：

| Test 类型 | 验证要求 |
|----------|---------|
| `auto` | location 必须是存在的测试文件 |
| `manual` | location 必须说明验证方法，不能只是 "manual:xxx" |

**反例**：
```yaml
❌ - dod_item: "修改 Hook"
     method: manual
     location: manual:DONE  # 太笼统
```

**正例**：
```yaml
✅ - dod_item: "修改 Hook 正则"
     method: manual
     location: manual:GATE-MODE-B-01（检查所有 gate 文件包含"只审核"说明）
```

### 3. RCI 判断准确性

| 情况 | Decision | RCI 字段 |
|------|----------|----------|
| 新增核心功能 | MUST_ADD_RCI | new: [ID] |
| 修改现有契约 | UPDATE_RCI | update: [ID] |
| 文档/优化 | NO_RCI | new: [], update: [] |

### 4. Reason 有实质内容

不能只是"这是优化"，要说明：
- 为什么这个决策？
- 影响范围是什么？
- 为什么不需要 RCI（如果 NO_RCI）？

**反例**：
```
❌ Reason: 这是优化
```

**正例**：
```
✅ Reason: 这是架构优化（模式 B 职责分离），不是新功能，不涉及 API 变更或核心契约，属于内部重构优化，无需纳入回归契约。优先级 P2 - 重要但非阻塞性改动。
```

## Subagent Prompt 模板

**重要**: 只审核，不修改文件。返回 PASS 或 FAIL + 详细反馈。

```
你是独立的 QA 决策审核员。审核以下文件：
- PRD: {prd_file}
- DoD: {dod_file}
- QA 决策: docs/QA-DECISION*.md
- regression-contract.yaml（如果涉及 RCI）

## 审核标准

### 1. 决策一致性
- Decision (NO_RCI/MUST_ADD_RCI/UPDATE_RCI) 是否与变更类型匹配？
- Priority (P0/P1/P2) 是否与影响范围匹配？
- RepoType (Engine/Business) 是否正确？

### 2. 测试映射有效性
对照 DoD 验收项，检查每个测试：
- [ ] method 是 auto 还是 manual？
- [ ] location 有效吗？（auto → 文件存在，manual → 说明验证方法）

### 3. RCI 判断准确性
- 如果 MUST_ADD_RCI，new 字段是否列出了具体 ID？
- 如果 UPDATE_RCI，update 字段是否列出了需要更新的 RCI？
- 如果 NO_RCI，为什么不需要 RCI？

### 4. Reason 有实质内容
- Reason 是否解释了决策理由？
- 是否说明了影响范围？

## 输出格式

## Gate Result

Decision: PASS | FAIL

### Findings
- [PASS/FAIL] 决策一致性：Decision/Priority/RepoType 是否合理
- [PASS/FAIL] 测试映射有效性：X/Y 个测试有效
- [PASS/FAIL] RCI 判断准确性：...
- [PASS/FAIL] Reason 有实质内容：...

### Required Fixes (if FAIL)
1. 不合理的决策：...
2. 无效的测试映射：...
3. 不准确的 RCI 判断：...
4. 空洞的 Reason：...

### Evidence
- PRD 变更类型：...
- DoD 验收项数量：...
- QA 决策详情：...

**记住**: 不要调用 Edit/Write 工具修改文件，只返回审核结果。
```

## PASS 条件

1. Decision/Priority/RepoType 合理
2. 所有测试映射有效
3. RCI 判断准确（如果涉及）
4. Reason 有实质内容

## FAIL 条件

任一条件不满足，返回具体问题和修复要求
