# Langfuse TCP Proxy — Design Spec

**日期**: 2026-04-30  
**分支**: cp-0430122226-langfuse-tcp-proxy

## 问题

TracesPage "查看详情"链接指向 `http://100.86.118.99:3000/trace/<id>`（Tailscale 内网 IP），浏览器不开 Tailscale 无法访问。

## 方案

**frontend-proxy.js**：在 `server.listen` 之前加一个 `net.createServer` TCP 隧道，监听 3001 端口，把所有 TCP 连接透传到 `100.86.118.99:3000`（Langfuse）。容器 `network_mode: host`，端口自动可达，无需改 docker-compose。

**TracesPage.tsx**：构造链接时把 `langfuseUrl`（`http://100.86.118.99:3000/trace/<id>`）中的 host 部分替换成 `${window.location.hostname}:3001`，这样链接与 Dashboard 同主机，不依赖 Tailscale。

**langfuse.js**：不改，原始 Tailscale URL 保留在后端，仅前端做替换。

## 测试策略

两处改动均 trivial（< 15 行，无跨模块 I/O）→ **静态源码检查 unit test**：
- `frontend-proxy.js`：源码含 `net.createServer` + `3001`
- `TracesPage.tsx`：源码含 `window.location.hostname` + `:3001`
