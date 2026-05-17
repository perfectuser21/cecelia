# Learning: Knowledge System 补齐 — 导航 + 新增入口 + Markdown

**Branch**: cp-03242210-knowledge-system-polish
**Date**: 2026-03-24

## 完成内容

补齐了已有 Knowledge & Documentation System 的 4 个核心缺口：
1. `navGroups: []` 改为实际导航组 → 侧边栏出现 5 个文档入口
2. 新建 `strategic-decisions.js` Brain 路由，区分"战略决策"与"丘脑决策日志"
3. DecisionRegistry 切换到新端点 + 加"记录决策"Modal
4. DesignVault 加 Markdown 渲染 + "新建文档" Modal
5. DevLog 加 1-10 自评分输入并 PUT 保存

### 根本原因

`decisions` 表同时存放两类数据：
- 战略决策（`category IS NOT NULL`）— 人工业务决策
- 丘脑决策日志（`category IS NULL`，trigger='thalamus'）— AI 自动记录

原 `/api/brain/decisions` 端点返回的是丘脑日志，DecisionRegistry 拿到的数据 schema 完全不匹配，导致页面空白。

### 下次预防

- [ ] 新建表/端点前先检查现有表是否已有同名字段用于多用途存储
- [ ] 共享表不同数据类型应通过 `category IS NOT NULL` 之类的条件严格区分，或建独立路由
- [ ] 前端页面上线前必须验证 API 返回的字段是否与 interface 定义匹配
