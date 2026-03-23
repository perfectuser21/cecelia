# Learning: 修复意识层断链

**分支**: cp-03231045-fix-consciousness-layers
**日期**: 2026-03-23

## 根本原因

意识层数据断链有两个根因：

1. **emotion-layer.js 单点失败**：`runEmotionLayer` 只用 `callLLM('thalamus', ...)` 一个 provider，thalamus 配置为 gpt-5.4-mini（OpenAI）。当 OpenAI 返回空内容时函数静默返回 null，`working_memory.emotion_state` 停止更新。memory_stream 依然有写入（不同代码路径），造成两表数据新鲜度不一致。

2. **NARRATIVE_INTERVAL_MS = 24h 太稀疏**：日记每天写一次，系统运行13小时后嘴巴拿到的 Layer 3（叙事）几乎是空的。

## 下次预防

- [ ] LLM 调用关键路径（emotion、narrative、memory）必须有 fallback provider，不能单点失败
- [ ] 意识层数据新鲜度应有监控指标（`working_memory.updated_at` 超过 N 分钟报警）
- [ ] 诊断方法：`working_memory.updated_at` 和 `memory_stream` 最新时间不一致 → 说明写入路径中断
- [ ] 新增 agent 使用一个 LLM provider 时，必须同时配置 fallback
