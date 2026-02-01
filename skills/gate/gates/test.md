# gate:test - 测试审核标准

## 触发时机

Step 6 (写测试) 完成后

## 审核目标

确保测试真正覆盖 DoD 验收项，包含边界用例和反例测试，不是只有测试文件没有测试质量。

## 审核标准

### 1. DoD ↔ 测试覆盖率

| 检查项 | 要求 |
|--------|------|
| 验收项覆盖 | DoD 中 `Test: tests/xxx` 的每条验收项都有对应测试用例 |
| 测试存在 | 引用的测试文件真实存在 |
| 测试有效 | 测试用例能运行且测试正确的东西 |

### 2. 边界用例

测试应覆盖：
- 正常路径：预期输入 → 预期输出
- 边界值：最小值、最大值、空值、临界值
- 异常路径：无效输入、错误状态

**示例**（正则匹配测试）：
```typescript
// 正常路径
it("should match ~/.claude/skills/dev/xxx", ...)

// 边界用例
it("should NOT match ~/.claude/skills/dev-tools/xxx", ...)  // 相似但不同
it("should match ~/.claude/skills/qa/", ...)                 // 多个受保护 skill
it("should NOT match ~/.claude/skills/my-skill/", ...)       // 非保护 skill

// 异常路径
it("should handle empty path", ...)
it("should handle path without skills/", ...)
```

### 3. 反例测试

测试不应该只验证"正确时通过"，还要验证"错误时失败"。

**反例**：
```
❌ 只测 "valid input → success"
❌ 测试永远 pass（没有断言或断言太宽松）
```

**正例**：
```
✅ 测 "valid input → success"
✅ 测 "invalid input → error message"
✅ 测 "edge case → expected behavior"
```

### 4. 测试质量

| 检查项 | 要求 |
|--------|------|
| 有断言 | 每个测试用例有 expect/assert |
| 断言明确 | 断言具体值，不是 toBeTruthy() |
| 独立性 | 测试之间不相互依赖 |

## Subagent Prompt 模板

**重要**: 只审核，不修改文件。返回 PASS 或 FAIL + 详细反馈。

```
你是独立的测试审核员。审核以下文件：
- DoD: {dod_file}
- 测试文件: {test_files}

## 审核标准

### 1. DoD ↔ 测试覆盖率
- 列出 DoD 中 `Test: tests/xxx` 的验收项
- 检查对应测试文件是否存在
- 检查是否有对应的测试用例

### 2. 边界用例
检查测试是否覆盖：
- [ ] 正常路径
- [ ] 边界值（空、最小、最大、临界）
- [ ] 异常路径

### 3. 反例测试
- [ ] 是否测试失败情况？
- [ ] 是否测试错误输入？

### 4. 测试质量
- [ ] 每个测试有断言？
- [ ] 断言具体明确？
- [ ] 测试独立？

## 输出格式

## Gate Result

Decision: PASS | FAIL

### Findings
- [PASS/FAIL] DoD↔测试覆盖率：X/Y 验收项有测试
- [PASS/FAIL] 边界用例：覆盖/缺失
- [PASS/FAIL] 反例测试：有/无
- [PASS/FAIL] 测试质量：...

### Required Fixes (if FAIL)
1. 缺失测试的验收项：...
2. 缺失的边界用例：...
3. 缺失的反例测试：...
4. 测试质量问题：...

### Evidence
- DoD 验收项列表：...
- 测试文件内容摘要：...
- 测试用例统计：X 个正例，Y 个反例，Z 个边界

**记住**: 不要调用 Edit/Write 工具修改文件，只返回审核结果。
```

## PASS 条件

1. DoD 所有 `Test: tests/xxx` 验收项都有对应测试
2. 测试覆盖正常路径 + 至少 1 个边界用例
3. 测试包含至少 1 个反例
4. 测试有明确断言

## FAIL 条件

任一条件不满足，返回具体问题和修复要求
