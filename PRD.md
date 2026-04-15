# Langfuse 可观测接入 PRD

## 背景
Brain 所有 LLM 调用走 `packages/brain/src/llm-caller.js` 的 `callLLM()`，但无集中观测（token 消耗/延迟/失败/prompt 内容看不到）。HK VPS 已部署 Langfuse v3（http://100.86.118.99:3000，Tailscale 访问）。本迭代把 LLM 调用 trace 上报到 Langfuse，并在 Cecelia Dashboard 里加一个菜单 iframe 嵌 Langfuse UI。

## 成功标准
- Brain 启动时若读到 `~/.credentials/langfuse.env` 则初始化 Langfuse 上报；读不到静默跳过（不崩）
- 每次 `callLLM()` 调用（成功/失败均）异步上报 trace 到 Langfuse，内容含 agentId / model / provider / latency / input prompt / output text / error
- Dashboard 侧栏新增「LLM 观测」菜单，点进去渲染 iframe 嵌 `http://100.86.118.99:3000`（Tailscale 访问前提）
- 单元测试验证 trace payload 构造正确（不依赖真实 Langfuse）

## 不做
- Langfuse 公网暴露（后续另立任务）
- Dashboard 自画图表（档 2 后续）
- Session 关联 / Prompt 版本管理 / Evaluation
- 不引入 langfuse-node SDK（直接 fetch+basic auth，已验证）
