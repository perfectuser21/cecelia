# Learning: PROBE_FAIL_GEO_WEBSITE — 瞬时网络错误导致误派自动修复任务

**Branch**: fix/probe-geo-website-network-retry  
**Date**: 2026-06-01

## 背景

`geo_website` 探针返回 `ok=false`，detail：
`homepage=error(fetch failed) blog_list=error(fetch failed) posts_page=error(fetch failed)`

总探针延迟约 10s，三个 URL 同时失败。手动 `curl` 和 Node.js `fetch` 验证网站实际可访问（HTTP 200）。

## 根本原因

**瞬时网络抖动**（DNS 解析抖动或 TCP 连接超时）导致三个并行 fetch 均以 `TypeError: fetch failed` 失败。

由于 `dispatchAutoFixes` 在任何单次探针失败时立即触发（无需等待连续失败），一次网络抖动就会派发一个 `/dev` 自动修复任务。该任务本身不必要——网站并没有真正宕机。

## 修复方案

在 `probeGeoWebsite` 的每个 fetch 调用中加入**单次重试机制**：

```js
// 只对 TypeError 重试（网络级 DNS/TCP 失败）
// HTTP 错误（4xx/5xx）不重试 —— 表示真实故障
const doFetch = () => fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(PER_CHECK_TIMEOUT_MS) });
try {
  res = await doFetch();
} catch (err) {
  if (!(err instanceof TypeError)) throw err;
  await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
  res = await doFetch();
}
```

**时间预算调整**：`PER_CHECK_TIMEOUT_MS` 从 20s 缩短到 12s：
- 3 个 check 并行，每个最多：12s（第一次）+ 1s 延迟 + 12s（重试）= 25s
- 25s < 30s 外层 `PROBE_TIMEOUT_MS`，有安全余量

**诊断改善**：error detail 附加 `err.cause.message`，方便区分具体网络原因：
- 修复前：`homepage=error(fetch failed)`
- 修复后：`homepage=error(fetch failed:ENOTFOUND zenithjoyai.com)`

## 通用规则

> **对外部网络探针，网络级 TypeError（DNS/TCP）应重试一次，HTTP 错误不重试。**
> 单次重试可过滤瞬时网络抖动，避免触发不必要的自动修复任务派发。
> HTTP 4xx/5xx 表示服务器确实出错，不应重试——这些是真实故障。

> **error detail 应包含 `err.cause.message`**，Node.js fetch TypeError 的根因（ENOTFOUND/ECONNREFUSED/ETIMEDOUT）在 cause 里，message 层只有"fetch failed"。

## 文件修改

- `packages/brain/src/capability-probe.js`: 添加 fetch 重试逻辑，PER_CHECK_TIMEOUT_MS 12s，cause 附加到 error detail
- `packages/brain/src/__tests__/capability-probe-geo-website.test.js`: 新增 3 个测试：重试成功、重试均失败、HTTP 错误不重试
