## Brain {VERSION} — fleet-worker 节点探针 worktree add 改 --no-checkout（修 MMV 永远 node_not_base_admitted）

- 根因：`node-probe.cjs` disposable 探针用 `git worktree add --detach` 对 8465 文件全量检出，MMV 实测 4–5.5s，撞 `DEFAULT_COMMAND_TIMEOUT_MS`=5s 被杀 → `worktree.root_ready`/`container.probe_succeeded` 恒 false → node-admission 拒绝 MMV（run d613b4fd 卡 `node_not_base_admitted`）；副作用是每 30s 一次全量检出与 `fleet-node-probe-*` 残留
- 修法：容器探针只检查 `/workspace/.git`，worktree add 加 `--no-checkout`（毫秒级）；回归测试 `fleet-worker.test.js` 断言参数含 `--no-checkout`（任务 e27e0bfd）
