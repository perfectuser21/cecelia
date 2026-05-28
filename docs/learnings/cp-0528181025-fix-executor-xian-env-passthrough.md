## executor dockerEnv 未透传 HARNESS_XIAN_ENABLED 给 initiative 容器（2026-05-28）

### 根本原因
`HARNESS_DOCKER_ENABLED=true` 时，initiative LangGraph 在 Docker 容器内运行。
`spawnNode` 读取 `process.env.HARNESS_XIAN_ENABLED` 但 `executor.js` 构建 `dockerEnv` 时
未将 Brain 进程的 `HARNESS_XIAN_ENABLED` / `HARNESS_XIAN_BRIDGE_URL` 注入容器，
导致 Codex Bridge 路径对 `spawnNode` 完全不可见，始终 fallback 到本地 Docker。

### 下次预防
- [ ] 新增 Brain 级环境变量时，检查是否需要同步透传给 initiative Docker 容器（`executor.js dockerEnv`）
- [ ] 新增 LangGraph 节点读取 `process.env.*` 时，确认该变量在容器 env 中存在
- [ ] smoke test 应验证 initiative 容器的实际 env，而不只是源码字符串匹配
