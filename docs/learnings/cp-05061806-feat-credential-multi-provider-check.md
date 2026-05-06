# Learning: cp-05061806-feat-credential-multi-provider-check

## 事件

凭据健康巡检（credentials-health-scheduler.js）覆盖了 NotebookLM / Claude OAuth / Codex / 发布器 cookies 共 4 类，但**漏了** Anthropic API 直连和 OpenAI 两个 API key 类凭据。结果这两个凭据失效（余额 0 / quota 超）后 mouth fallback / embedding-service 持续报错，没人发现。

## 根本原因

**凭据健康检查机制按"现有凭据列表"驱动，不按"代码实际调用的所有 provider"驱动**——添加新的外部依赖（Anthropic API / OpenAI）时没同步更新 health checker。这是个单点失败：health check 只查它知道的，对它不知道的 provider 失效完全失明。

更深：**没有"代码 grep + checker 同步"自动化**。理论上 CI 可以扫 src/ 找所有外部 API 调用 → 校验每个都在 health checker 里。但当前没这种 lint。

## 下次预防

- [ ] **添加新外部 LLM/API 必须同步更新 health checker**：可作为 CI lint（grep `fetch(.*api\.openai|api\.anthropic`）→ 校验对应 checker 存在
- [ ] **凭据健康抽象统一**：现在 credentials-health-scheduler 是 4 类硬编码，随着 provider 增多会膨胀。应该有 `registerProvider(name, healthCheck)` plugin 模式
- [ ] **加厚先减肥**：本 PR 0→thin（独立 module，未接调度）。未来 thin→medium 接入 scheduler 时，必须先**删除现有 scheduler 中关于"未来要支持 anthropic-api / openai"的 TODO 注释**（如有），避免 stale TODO 永久存在
- [ ] **Walking Skeleton 视角**：本 PR 是 MJ4 自主神经"凭据健康"加厚段第一刀，0→thin。后续按真实反馈决定加厚方向（scheduler 接入 / alert / dashboard / 自动 disable）
