# Learning: SelfDrive auth 失败导致成功率恐慌死循环

**分支**: cp-04080103-a4df60a9-94b4-4ca9-8cce-bf1b04  
**日期**: 2026-04-08

### 根本原因

account3 API 凭据临时失效时，Claude 返回 401 auth 错误，任务立即 exit_code=1，标记为 `failure_class=auth`。

`getTaskStats24h()` 把 auth 失败纳入成功率分母，导致成功率从实际 89.5% 虚降至 39%。SelfDrive LLM 看到低成功率后恐慌，创建大量"诊断任务"，但这些任务运行在同一个 account3 上 → 同样 401 失败 → 成功率继续下跌 → 生成更多诊断任务 → 死循环。

**数据佐证**：40 个 dev 任务隔离中，33 个（83%）= 401 auth 失败，0 个 = 真正的代码质量问题。

### 修复

`getTaskStats24h()` 新增 `auth_failed` 字段，将 `payload->>'failure_class' = 'auth'` 的任务从成功率分母中排除。  
SelfDrive prompt 新增独立的基础设施失败提示，避免 LLM 将 auth 失败误解为代码质量问题。

### 下次预防

- [ ] auth 失败不应参与业务成功率计算 — 已修复
- [ ] SelfDrive 看到 auth 失败时，应创建"检查凭据"任务而非"代码质量诊断"任务
- [ ] 如果 N 个连续 auth 失败，应触发账号轮换或人工告警，而非反复重试
