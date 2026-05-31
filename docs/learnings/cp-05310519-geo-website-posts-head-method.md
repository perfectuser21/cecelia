# Learning: PROBE_FAIL_GEO_WEBSITE — posts_page 超时 → 改 HEAD 方法

**Branch**: fix/probe-geo-website-timeout
**Date**: 2026-05-31

## 背景

`geo_website` 探针持续返回 `ok=false`，detail：
`homepage=ok blog_list=ok posts_page=error(The operation was aborted due to timeout)`

上一轮修复（commit 95177dff8）已将串行 fetch 改为并行（Promise.allSettled）+ per-check timeout 提升到 20s，
但 `posts_page` 在生产环境仍然超时（latency ~10s）。

## 根本原因

`/zh/posts/` 是 Next.js SSR 页面，服务器需要渲染所有 posts 数据后才能发送响应 body。
当 posts 数据量较大时，GET 请求等待完整 body transfer 超出 20s 限制。

关键洞察：`posts_page` 的 check config 是 `expect: null`，即我们只需要确认页面返回 200，
**完全不需要读取 body**。因此使用 GET 并等待完整 body 是不必要的。

## 修复方案

将 `posts_page` 的 fetch method 改为 **HEAD**：

```js
// 修复前
{ url: `${BASE}/zh/posts/`, expect: null, label: 'posts_page' }

// 修复后
{ url: `${BASE}/zh/posts/`, expect: null, label: 'posts_page', method: 'HEAD' }
```

同时在 fetch 调用时透传 `method`：
```js
const res = await fetch(check.url, {
  method: check.method || 'GET',
  redirect: 'follow',
  signal: AbortSignal.timeout(PER_CHECK_TIMEOUT_MS),
});
```

HEAD 请求：
- 服务器只需返回响应头，不需要传输 body
- 对 Next.js 等 SSR 框架来说延迟大幅降低（通常 < 1s vs GET 的 10s+）
- 仍能验证 HTTP 200 状态码，功能等价

## 通用规则

> **HTTP 探针只检查 URL 存活性（expect: null）时，应优先使用 HEAD 方法。**
> GET 请求会强制服务器渲染并传输完整 body，对 SSR 页面尤其耗时。
> HEAD = 验活 + 低延迟；GET = 验活 + 验内容（仅当 expect 有值时使用）。

## 文件修改

- `packages/brain/src/capability-probe.js`: posts_page check 增加 `method: 'HEAD'`，fetch 透传 method
- `packages/brain/src/__tests__/capability-probe-geo-website.test.js`: 新增测试验证 posts_page 使用 HEAD，homepage/blog_list 使用 GET
