# Spawn 历史目录的保留模块

旧 `spawn()`、宿主 Claude 启动器及其 attempt-loop 已退役；它们没有现役生产消费者，专属测试随实现清退。`SPAWN_V2_ENABLED` 不再是公共派发开关。

本目录保留 `middleware/resource-tier.js` 及其行为回归。`quarantine.js` 仍使用它判断资源等级；该模块不负责启动进程。公共派发入口为 `src/executor.js`，用户开发交现役 Codex Agent 或有头 `/dev` 会话，以各入口的当前实现为准。

设计文档中的 Layer 3 与旧 middleware 链仅作为历史背景，不构成当前运行合同。
