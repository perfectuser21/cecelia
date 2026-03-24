---
branch: cp-03231919-6f99d7b4-add5-4d87-9c6a-98219d
date: 2026-03-23
---

# Learning: 重构 notionBlockToDBRow（switch → BLOCK_HANDLERS 查找表）

### 根本原因

`packages/brain/src/notion-sync.js` 中的 `notionBlockToDBRow` 函数使用含 10 个 case 的 switch 语句加内联 `||` 运算符，导致圈复杂度达到 24，超过阈值 10。大型 switch 语句在需要新增类型时容易遗漏 break、或在 case 间产生意外 fall-through，可维护性差。

### 解决方案

将 switch 语句替换为 `BLOCK_HANDLERS` 对象查找表，每种 block 类型对应一个处理函数，主函数通过 `BLOCK_HANDLERS[type]?.()` 分派调用，函数体降至 5 行以内，圈复杂度降至 10 以下。

### 下次预防

- [ ] 新增 block 类型时在查找表中追加条目，禁止退回 switch 写法
- [ ] 圈复杂度超过 10 时立即拆分，不等到扫描报告才处理
- [ ] 重构必须保持所有现有测试通过，不允许删除测试用例
