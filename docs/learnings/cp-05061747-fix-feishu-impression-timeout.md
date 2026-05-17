# Learning: cp-05061747-fix-feishu-impression-timeout

## 事件

`packages/brain/src/routes/ops.js:953` `updateFeishuImpression` 写死 `timeout: 8000ms` 调 `callLLM('mouth', ...)`。但 `mouth` provider 走 cecelia-bridge OAuth Claude Code，bridge 实际响应 sonnet 通常 4-30s，偶尔到 170s。8s timeout 必然超时。

## 根本原因

**timeout 配置时假设 mouth 是低延迟 API，但实际是 bridge 的同步调用 OAuth claude-code（含网络往返 + claude code 内部启动 + 模型推理 + 流式回收尾）**。这是个错误的资源类型假设。

8s 来源不可考（git blame 显示是早期写死）——可能开发时按"GPT-3.5 fast endpoint"的延迟思维写的，没意识到 OAuth bridge 是把 claude code 当本地 CLI 跑。

## 下次预防

- [ ] **timeout 配置必须基于真实响应分布**：任何 callLLM/RPC 配 timeout 之前必须看实测 P95 / P99 数据，不能拍脑袋
- [ ] **同 provider 的 timeout 应该集中管理**：mouth provider 应该有 default timeout（依赖 provider 类型），不应该每个 caller 独立配置
- [ ] **mouth fallback 不应该掩盖 timeout**：当前 bridge 8s 超时 → fallback 到 codex/anthropic-api，结果掩盖了"bridge 本来 30s 就能完成"的事实。应该让超时直接报错而非静默 fallback
- [ ] **Walking Skeleton 视角**：本次属于 MJ4 Cecelia 自主神经的一段加厚——LLM caller 的 timeout 健康监测应该作为 thin feature 加入凭据巡检
- [ ] **加厚要先减肥**：本 PR 0→thin 修复（首次显式记录 timeout 决策）；未来若引入 default timeout 机制（替代 hardcoded），必须先删现有 hardcoded 8000/15000/30000，再写新机制
