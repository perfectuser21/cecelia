# gate:audit - 审计报告审核标准

## 触发时机

Step 7 (质检 + Audit) 完成后

## 审核目标

确保审计报告基于真实证据，不是"Decision: PASS"废话式审计。

## 审核标准

### 1. 审计证据真实性

| 检查项 | 要求 |
|--------|------|
| 文件引用 | 引用的文件路径真实存在 |
| 行号准确 | 引用的行号与实际内容匹配 |
| 命令输出 | 引用的命令输出是真实的执行结果 |

### 2. 问题识别

审计报告应该：
- 检查实际的代码/配置
- 识别潜在问题（即使最终 PASS）
- 说明为什么某些潜在问题可以接受

**反例**：
```
❌ Decision: PASS
❌ Reason: 代码看起来没问题
```

**正例**：
```
✅ Decision: PASS
✅ Findings:
   - 检查了 hooks/branch-protect.sh L94-120
   - 正则表达式 skills/(dev|qa|audit|semver)/ 正确区分保护/非保护
   - 潜在问题：新增 skill 需要手动更新正则（可接受，frequency low）
✅ Evidence:
   - 测试覆盖：tests/hooks/branch-protect.test.ts L118-204
   - 手动验证：在本地测试 dev/ 阻止，my-skill/ 放行
```

### 3. 风险点识别

即使 PASS，也应识别：
- 已知限制（Known Limitations）
- 未来风险（Future Risks）
- 监控建议（Monitoring Suggestions）

### 4. 与变更范围一致

| 检查项 | 要求 |
|--------|------|
| 覆盖范围 | 审计覆盖 PRD 中列出的所有影响文件 |
| 不遗漏 | 没有跳过重要文件 |

## Subagent Prompt 模板

**重要**: 只审核，不修改文件。返回 PASS 或 FAIL + 详细反馈。

```
你是独立的审计审核员。审核以下文件：
- PRD: {prd_file}（查看影响范围）
- 审计报告: docs/AUDIT-REPORT.md
- 实际代码: {affected_files}

## 审核标准

### 1. 审计证据真实性
- 检查审计报告引用的文件是否存在
- 检查引用的行号是否准确
- 检查命令输出是否真实

### 2. 问题识别
- 审计是否检查了实际代码？
- 是否识别了潜在问题？
- 是否解释了为什么 PASS？

### 3. 风险点识别
- 是否列出了 Known Limitations？
- 是否识别了 Future Risks？

### 4. 与变更范围一致
- PRD 列出的影响文件是否都被审计？

## 输出格式

## Gate Result

Decision: PASS | FAIL

### Findings
- [PASS/FAIL] 证据真实性：引用的文件/行号是否存在
- [PASS/FAIL] 问题识别：是否有实质内容
- [PASS/FAIL] 风险点识别：是否识别限制/风险
- [PASS/FAIL] 覆盖范围：是否覆盖所有影响文件

### Required Fixes (if FAIL)
1. 虚假的证据引用：...
2. 缺失的问题分析：...
3. 未覆盖的文件：...

### Evidence
- 审计报告引用验证：...
- PRD 影响范围 vs 审计覆盖：...

**记住**: 不要调用 Edit/Write 工具修改文件，只返回审核结果。
```

## PASS 条件

1. 所有证据引用真实存在
2. 审计有实质内容（不是废话）
3. 识别了风险点（即使最终 PASS）
4. 覆盖 PRD 中所有影响文件

## FAIL 条件

1. 证据引用不存在或不准确
2. 审计是废话（只有 Decision: PASS）
3. 完全没有风险识别
4. 遗漏重要文件
