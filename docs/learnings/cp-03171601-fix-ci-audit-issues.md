# Learning: cp-03171601-fix-ci-audit-issues

## 任务

修复 CI 审计发现的 5 个问题（coverage-delta 漏报、.mts 不支持、[CONFIG] 豁免过宽、release: 豁免缺失、changes 失败防御缺失）。

## 根本原因

### DoD 测试命令写法陷阱

本次两个 DoD 测试字段在本地通过但 CI 失败：
1. **逻辑过于复杂**：L35 测试用了多层嵌套正则，实际跑出来逻辑错误
2. **indexOf vs lastIndexOf**：L41 测试用 `indexOf('changes.outputs.engine')` 找到第一次出现（在 job if 条件里），但新加的防御逻辑在文件末尾，导致 substring 截取的块根本不含 `changes.result`

### 修复规则

- **DoD Test 命令必须本地先跑一遍，输出结果肉眼确认**，不能只判断"应该通过"
- 检查文件内容是否包含某字符串时，优先用最简单的 `f.includes('唯一标识字符串')` 而不是复杂 regexp 或位置推算
- 选择"唯一标识字符串"：挑改动引入的、其他地方不会出现的独特词语（如 `'cannot determine engine scope'`）

### 下次预防

- [ ] DoD Test 命令写完立即本地验证一遍再提交
- [ ] 检查文件是否含某逻辑时，用 `f.includes('改动引入的唯一标识')` 而非复杂推算
- [ ] 避免在 Test 命令里用 `indexOf` + `substring` 做位置推算，位置会随文件变化
