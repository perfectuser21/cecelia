# Learning: Capability Probe 系统 + Auto-Fix RCA 上下文修复

## 分支
`cp-03191426-capability-probe-autofix`

## 变更摘要
1. 修复 `callCortexForRca()` — 从只传 5 个字段升级为完整故障上下文
2. 新增 `capability-probe.js` — 每小时探测 6 条关键链路
3. server.js 注册探针 + API 端点暴露

### 根本原因

auto-fix 链路代码完整但**从未触发过**（0 次），核心原因是 `callCortexForRca()` 只给 Cortex 传了 5 个字段（task_id, task_type, reason_code, layer, step_name），信息量不足以产生 ≥70% 信心度的 RCA 诊断。

同时，Cecelia 有 37 个 capability 但不知道哪些能力链路是通的、哪些是断的——缺乏类似人体本体感觉的"能力探针"系统。

数据佐证：
- 174 条 failure_pattern learning，0 条被应用
- 5046 次任务隔离，752 次熔断
- 0 条高信心度 RCA（confidence ≥ 0.7）

### 下次预防

- [ ] 新增的 Brain 子系统（如故障分析、自愈）上线前，验证端到端链路是否真的能走通，不能只验证代码存在
- [ ] 给 LLM 的 prompt 上下文，需要检查是否包含足够的决策信息（类似"给医生的病历"）
- [ ] 定期检查 auto-fix / learning 等闭环系统的实际触发数据（不能假设写了代码就在运行）

## 关键决策

| 决策 | 选择 | 原因 |
|------|------|------|
| RCA 上下文来源 | run_events + tasks 表联查 | 这是失败信息最完整的来源，包含 payload 中的 stderr/log_tail |
| Probe 频率 | 每小时 | 平衡探测开销与故障发现速度；太频繁浪费资源，太慢则故障持续时间长 |
| Probe 故障处理 | 直接走 auto-fix（confidence=0.75） | Probe 的诊断本身就是明确的（"X 模块不可用"），不需要再走 Cortex RCA |
| 探针数量 | 6 条（db/dispatch/auto_fix/notify/cortex/monitor_loop） | 覆盖 Cecelia 最核心的 6 条生命线 |
