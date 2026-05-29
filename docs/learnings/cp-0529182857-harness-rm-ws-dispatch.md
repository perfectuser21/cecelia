# Learning: Harness 多 WS 调度残留清除

### 根本原因
harness-contract-proposer v8.0 和 harness-generator v7.0 改为单 Sprint 单 PR 模式，但 Brain execution.js 的调度层仍有完整的多 WS 链式触发逻辑（workstreamCount 提取 + safeWsCount + `currentWsIdx < totalWsCount` 链式触发）。若 Proposer 意外输出 workstream_count > 1，Brain 会自动创建多个 generator task。

### 下次预防
- [ ] Skill 改动（proposer/generator 粒度变更）时，必须同步检查 execution.js 的调度回调是否有对应的 payload 字段假设
- [ ] harness pipeline 的 payload schema 应在 DEFINITION.md 中明确，避免 skill 和 Brain 代码各自演化出现漂移
- [ ] executor.js 的 prompt 注入段（_prepareHarnessGeneratePrompt）应与 generator skill 的输入协议保持同步
