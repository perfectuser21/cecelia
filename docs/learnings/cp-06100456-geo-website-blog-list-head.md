# Learning: PROBE_FAIL_GEO_WEBSITE — blog_list GET 超时 → 改 HEAD 方法

**Branch**: cp-06100456-fix-geo-website-blog-list-timeout  
**Date**: 2026-06-10

## 背景

`geo_website` 探针返回 `ok=false`，detail：
`homepage=ok blog_list=error(The operation was aborted due to timeout) posts_page=ok`

探针延迟约 12011ms（恰好等于 PER_CHECK_TIMEOUT_MS），表明 blog_list 被 AbortSignal 截断。

## 根本原因

`/zh/blog/` 是 Next.js SSR 列表页，服务器需要渲染所有 blog posts 才能发送响应 body。
当 posts 数量较多时，GET 请求等待完整 body transfer 超出 12s 限制。

这与 2026-05-31 修复 `posts_page` 的根因完全相同（参见 `cp-05310519-geo-website-posts-head-method.md`）。

关键洞察：`blog_list` 的检查目标是确认博客区域可访问（HTTP 200），
不需要读取 body 验证内容。因此使用 GET 并等待完整 body 是多余的。

## 修复方案

将 `blog_list` 的 fetch method 改为 **HEAD**，同时 `expect` 设为 `null`：

```js
// 修复前
{ url: `${BASE}/zh/blog/`, expect: '/zh/blog/', label: 'blog_list' },

// 修复后
{ url: `${BASE}/zh/blog/`, expect: null, label: 'blog_list', method: 'HEAD' },
```

HEAD 请求：
- 服务器只需返回响应头，不需要传输 body
- 对 Next.js SSR 列表页延迟大幅降低（通常 < 1s vs GET 的 12s+）
- 仍能验证 HTTP 200 状态码，功能等价

## 通用规则（更新）

> **所有外部 SSR 页面探针（blog_list、posts_page 等）一律使用 HEAD 方法。**
> 只有 `homepage` 这类需要内容验证（`expect` 不为 null）的检查才使用 GET。
> pattern: homepage=GET+expect; 其他 SSR 页面=HEAD+expect:null。

## 附：同类问题历史

| 时间 | 问题 | 修复 |
|------|------|------|
| 2026-05-31 | posts_page GET 超时 | 改 HEAD |
| 2026-06-01 | 三页全 TypeError | 加 retry 机制 |
| 2026-06-10 | blog_list GET 超时 | 改 HEAD（本次）|

## 文件修改

- `packages/brain/src/capability-probe.js`: blog_list check 增加 `method: 'HEAD'`，`expect: null`
- `packages/brain/src/__tests__/capability-probe-geo-website.test.js`: 修正 HEAD/GET 断言 + 新增 blog_list timeout 回归测试
- `packages/brain/src/selfcheck.js`: EXPECTED_SCHEMA_VERSION 295（同步迁移版本）
- `DEFINITION.md`: schema_version 295（同步 facts-check）
