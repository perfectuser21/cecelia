# PRD: 修 detect-review-issues.js 对"未发现需要标记为🔴的严重问题"的误判

## 背景

PR #2453（恢复 archive tarball）DeepSeek review 结论文字为 "未发现需要标记为🔴的严重问题，属于正常的文档归档操作"。`scripts/devgate/detect-review-issues.js` 策略二的 `noIssuesDeclared` 正则只认 "未发现严重问题 / 没有发现严重问题" 两种紧连句式，漏掉"未发现...严重问题"中间有字符的常见变体，误判为真实 🔴 问题，阻塞 PR 合并。

## 成功标准

1. `noIssuesDeclared` 兼容变体："未发现需要标记为🔴的严重问题"、"未发现任何...严重问题"
2. 新增 7 条单元测试覆盖所有句式
3. 真实 🔴 严重问题仍能正确识别（不引入漏报）

## 非目标（YAGNI）

- 不改策略一（section 格式）
- 不改 DeepSeek prompt 本身
