# Learning: 修复 /dev subagent gates SKILL.md prompt 传入

## 任务背景
cp-03220004：修复 01-spec.md 和 02-code.md 中 subagent gates 只传 SKILL.md 路径而非内容的问题。

### 根本原因
伪代码注释写的是「SKILL.md 路径：packages/...」，AI 执行时误以为只需传路径字符串给 subagent，
导致 subagent 收不到评审维度，spec_review / code_review_gate 审查形同虚设。

### 修复方案
在调用 Agent subagent 前，明确用变量读取文件内容：
```
SPEC_REVIEW_SKILL=$(cat packages/workflows/skills/spec-review/SKILL.md)
```
然后将变量内容内联传入 prompt，不传路径。

### 下次预防
- [ ] 伪代码中引用文件内容时，必须显式写出读取步骤（变量 = 文件内容），不能只写路径
- [ ] spec_review 和 code_review_gate subagent prompt 模板检查：确保包含 SKILL 变量读取
- [ ] 新增步骤文件时，审查所有 Agent subagent 调用点是否传入了完整内容而非路径
