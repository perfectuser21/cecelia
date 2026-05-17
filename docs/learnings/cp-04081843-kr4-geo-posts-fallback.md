---
id: learning-kr4-geo-posts-fallback
branch: cp-04081843-896cf089-f975-464d-8ccd-49ba64
created: 2026-04-08
task_id: 896cf089-f975-464d-8ccd-49ba648a481b
---

# Learning: KR4 geo 网站 posts 页空白 — 静态 fallback 修复

### 根本原因

`getAllShortPosts()` 在 API 调用失败时直接 `return []`，无静态 fallback。而 Astro 在构建时调用该函数，API 不可达（`dashboard.zenjoymedia.media:3000` 连接超时），导致 posts 页生成时内容为空，显示"动态即将上线"占位。

对比：`getAllPosts()`（blog）已有 `zhPosts` 静态 fallback，所以 blog 页正常显示。

### 下次预防

- [ ] 所有 `fetchFromAPI` 函数必须有静态 fallback（与 blog 页一致的模式）
- [ ] 构建前在本地验证 `BACKEND_API_URL=http://localhost:9999` 时各页面不报错（强制测试 API 失败路径）
- [ ] Cloudflare Pages 部署后立即用 `curl + grep` 验证关键页面内容存在（不只验证 HTTP 200）
- [ ] 新页面上线时，同步更新 KR 交付检查清单验收项

### 修复

- **文件**: `zenithjoy/apps/geoai/src/data/posts.ts`
- **改动**: 新增 `zhShortPosts`/`enShortPosts` 静态数组（4条中文 + 1条英文短帖）；`getAllShortPosts()` catch 块改为 `return locale === 'zh' ? zhShortPosts : enShortPosts`
- **部署**: `wrangler pages deploy dist/ --project-name=zenithjoyai --branch=main`
- **验证**: `curl https://zenithjoyai.com/zh/posts/ | grep "角色设定"` → 200 + 内容命中
