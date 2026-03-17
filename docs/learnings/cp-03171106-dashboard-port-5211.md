# Learning: Dashboard 端口约定

## 根本原因
vite.config.ts 中 `server.port` 写成了 5212 而非约定的 5211。

## 下次预防
- [ ] Dashboard 端口约定：**5211**，不要改
- [ ] vite.config.ts 改动时检查 server.port 是否为 5211
