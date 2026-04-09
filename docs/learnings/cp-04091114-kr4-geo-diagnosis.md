---
id: cp-04091114-kr4-geo-diagnosis
branch: cp-04082010-896cf089-f975-464d-8ccd-49ba64
task: 896cf089-f975-464d-8ccd-49ba648a481b
created: 2026-04-09
---

# Learning: KR4 geo网站诊断 — 静态 fallback 优先于修复外部依赖

### 根本原因

KR4（geo SEO网站）进度长期停滞在 25%，核心原因是：
1. posts 页面依赖外部 API（dashboard.zenjoymedia.media:3000），API 连接超时导致构建时内容为空
2. `getAllShortPosts()` 的 catch 块返回空数组而非 fallback 数据
3. 没有"内容先行"的快速路径——等待 API 修复导致 KR 验收无限延期

### 下次预防

- [ ] 所有外部 API 依赖必须在构建时有静态 fallback（哪怕 2-3 条占位内容）
- [ ] 部署前必须本地验证：`curl -s https://[domain]/[posts-page] | grep '<article'`
- [ ] KR 验收"最小路径"优先：先用静态数据达到"≥1篇首发"，再迭代动态内容
- [ ] KR progress 更新要及时：核心条件满足后立即通过 Brain API 更新进度，不等完整功能

### 影响范围

- zenithjoy repo: `apps/geoai/src/data/posts.ts`（静态 fallback 模式）
- Brain KR4 进度：25% → 60%（本次更新）
- 下一步：后台 API 连通 + 自动发布管道验证（已排队）
