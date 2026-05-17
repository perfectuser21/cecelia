# Learning: fix GTDWarRoom 绝对 URL 导致暂无数据

**Branch**: cp-03271857-fix-warroom-url
**Task**: ff51920f-a188-49c8-9b6b-1c5cf548186d

### 根本原因

GTDWarRoom.tsx 中硬编码了 `http://localhost:5221/api/brain/tasks`。
浏览器从 `http://perfect21:5211` 访问时，`localhost` 解析为客户端本机而非服务器，
导致 fetch 失败，Promise.all 整体 reject，catch 块将 tree 也清空，页面全空。

### 下次预防

- [ ] 前端组件中禁止硬编码 `http://localhost:PORT`，所有 API 调用一律用相对路径（`/api/...`）
- [ ] 多个独立请求用 `Promise.allSettled` 而非 `Promise.all`，防止单个失败影响全局
- [ ] 写完组件后检查：有没有 `localhost` 字样？有的话必须改相对路径
