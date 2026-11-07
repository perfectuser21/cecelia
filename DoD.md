# DoD：CI 验证实际部署的前端代理

- [x] [BEHAVIOR] 测试启动真实 frontend-proxy.js，核对实际静态文件、gzip 字节、缓存、SPA 页面与失败响应；只使用私有文件及随机端口。
  Test: manual:node --test scripts/frontend-proxy.test.mjs
- [x] [BEHAVIOR] goals、captures 和 Brain 请求保留正确目标路径、方法、请求内容与返回状态；WebSocket 验证真实握手和双向数据。
  Test: manual:node --test scripts/frontend-proxy.test.mjs
- [x] [BEHAVIOR] 代理回归进入已有 Ops 检查，失败退出码真实传播；代理源码差分选择 Ops，不增加 workflow 或 job。
  Test: manual:node --test scripts/ci/__tests__/basic-ops-coverage.test.mjs scripts/ci/__tests__/basic-scope.test.mjs
- [x] [ARTIFACT] 本地隔离验收及 CI 配置检查通过；生产容器和发布版本不变。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
