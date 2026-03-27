# Learning: KnowledgeHome 补充深度知识页入口

**Branch**: cp-03271829-knowledge-home-modules
**Date**: 2026-03-27

## 功能总结

补充 #1620 遗漏的 KnowledgeHome 入口卡片，指向 /knowledge/modules 页面。

### 根本原因

并行 PR #1620 实现了 /knowledge/modules 页面和 Brain API /modules 端点，但该 PR 没有同步更新 KnowledgeHome.tsx 中的导航卡片列表。
原因是两个 PR 同时开发同一功能，#1620 聚焦于路由和页面实现，但遗漏了 Home 导航入口。
当我的 PR #1621 尝试 rebase 时发现 #1620 已合并，但 KnowledgeHome 入口仍缺失，需要单独补充。

### 下次预防

- [ ] 并行 PR 合并后，立即检查是否存在遗漏的入口/路由导航未同步
- [ ] 功能完整性清单：页面 + API + 路由注册 + 导航入口 4 件套必须全部包含在同一 PR 中
