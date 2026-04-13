# Learning: Bridge /llm-call ENOENT + llm-caller 隐式 fallback

## 背景

Bridge `/llm-call` 端点在 CLAUDE_BIN 指向无效路径时抛出 `spawn ENOENT`，导致 500。
使用 `anthropic` provider 但未配置 fallbacks 的 agent 因此无法降级到直连 API。

### 根本原因

1. **硬编码 + env fallback 不验证可执行性**：`process.env.CLAUDE_BIN || '/opt/homebrew/bin/claude'` 直接使用，不检查文件是否存在/可执行。当 CLAUDE_BIN 设置为无效路径时，spawn 直接 ENOENT。

2. **llm-caller 缺少隐式 fallback**：设计上 bridge 是 `anthropic` provider 的唯一通道，当 bridge 整体不可用时（ENOENT/500），没有降级到 Anthropic API 直连的路径，导致整个 LLM 调用链断裂。

### 下次预防

- [ ] 任何使用外部二进制文件的地方，启动时验证可执行性并记录发现路径（`discoverXxxBin` 模式）
- [ ] provider 层应有 implicit fallback 设计原则：当 bridge 类 provider 整体不可用时，自动降级到直连 API
- [ ] 系统启动健康检查中加入 claude 二进制可执行性验证，早发现早告警

## 修复内容

- `cecelia-bridge.cjs`: 添加 `discoverClaudeBin()` 函数，模块初始化时自动发现并缓存 claude 路径
- `packages/brain/src/llm-caller.js`: 在 `callLLM` 所有候选失败后，当 primary provider 为 `anthropic` 时自动尝试 `callAnthropicAPI` 直连
