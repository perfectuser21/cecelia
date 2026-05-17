# Learning: 深度知识页接入 Dashboard

branch: cp-03270400-knowledge-modules-dashboard
date: 2026-03-27

### 根本原因

西安 Codex 生成的 86 个知识页（HTML）没有 Dashboard 原生入口：
1. KnowledgeHome 缺少「深度知识页」卡片（只有 4 张）
2. 已完成的知识页（有 output_url）只能新标签打开，不能在 Dashboard 内联查看
3. 缺少 HTML 内联渲染组件，任何想 iframe 解决的方案被明确禁止

### 解决方案

1. `KnowledgeHome.tsx` 添加第 5 张卡片 → `/knowledge/modules`
2. 新建 `KnowledgePageViewer.tsx`：fetch HTML → DOMParser 提取 body → `dangerouslySetInnerHTML` 渲染，路由 `/knowledge/view?url=...`
3. `KnowledgeModuleDetail.tsx` 已完成模块改用 `navigate('/knowledge/view?url=...')` 代替 `<a target="_blank">`

### 下次预防

- [ ] 新 HTML 页面需要在 Dashboard 内展示时，优先考虑 fetch + dangerouslySetInnerHTML 方案（适合内部生成页面）
- [ ] `[ARTIFACT]` DoD 条目的 Test 字段必须用 `manual:node -e "..."` 格式，不能用 backtick 包裹
- [ ] `[BEHAVIOR]` 测试引用路径必须是实际文件路径（`apps/api/features/...`），不能是 `tests/xxx`
- [ ] KnowledgeHome 新增卡片时检查现有卡片数量，避免遗漏入口
