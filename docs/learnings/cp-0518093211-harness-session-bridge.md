## harness-session-bridge：Brain 重启后重连已有容器（2026-05-18）

### 根本原因

LangGraph 的 checkpoint 在**节点完成后**保存 state，但 harness 最耗时的工作（Claude Code 跑 30-90 分钟）发生在**节点内部**。Brain 进程死亡后重启，LangGraph 从 checkpoint 重入节点，会重新 spawn 新容器，触发 "container name already in use" 冲突。根本原因：SESSION_UUID 和容器名从未存入 LangGraph state。

### 下次预防

- [ ] 任何耗时操作（> 5 分钟）都应在 LangGraph state 里留下"可重连标记"，不能只靠节点级 checkpoint
- [ ] 新 harness 节点加入时，同步在 state schema 加 `${node}_session` 字段，不要事后补
- [ ] `reconnectOrSpawn` 的三路径（running/exited_ok/gone）是通用模式，evaluator 节点（Phase 2）直接复用
- [ ] docker inspect 调用必须用 callback 形式（非 promisify），否则 vitest mock 无法正确拦截
