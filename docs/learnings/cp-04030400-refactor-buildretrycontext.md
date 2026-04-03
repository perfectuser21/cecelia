## 根本原因

`buildRetryContext` 函数承担了三个独立职责：
1. 构建失败分类文本块
2. 构建反馈文本块
3. 拼装并截断最终上下文字符串

三者混在一个函数里，加上多个条件分支（optional chaining、三元表达式、Array.isArray 判断），导致圈复杂度达到 22，超出阈值（10）两倍以上。

## 解决方案

将三个职责提取为独立私有函数：
- `_retryFailureBlock(classification, watchdogKill)` — 处理失败分类
- `_retryFeedbackBlock(feedback)` — 处理反馈条目
- `_assembleRetryContext(failureCount, body)` — 拼装 + 截断

主函数 `buildRetryContext` 仅做调度，复杂度降至 3。

## 下次预防

- [ ] 单函数职责不超过 1 个，超出即提取
- [ ] 复杂度扫描阈值 10，超出时拆分是首选而非重写
- [ ] 私有辅助函数用 `_` 前缀标记，与公共 API 区分
