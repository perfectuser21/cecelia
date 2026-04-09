# Learning: Brain Quiet Mode — 关闭所有后台 LLM 调用

### 根本原因
Brain tick 每5分钟循环，固定调用 thalamus（claude-haiku）+ rumination/narrative/conversation-digest 等后台 LLM 任务，在用户不需要这些认知功能时持续消耗 token。缺少一个全局开关来暂停这些调用。

### 解决方案
在 tick.js 顶部定义 `QUIET_MODE = process.env.BRAIN_QUIET_MODE === 'true'`，在 thalamus 调用块和后台 LLM 任务块（10.3~10.11）前加 `if (!QUIET_MODE)` guard。在 launchd plist 中加入 `BRAIN_QUIET_MODE=true` 环境变量后重启 Brain 立即生效。

### 下次预防
- [ ] 若需要恢复认知功能，将 plist 中 `BRAIN_QUIET_MODE` 改为 `false` 或删除该行，重启 Brain
- [ ] arch_review/content-pipeline 等任务调度逻辑不受影响（guard 只包裹 LLM 认知层）
- [ ] 若只想停 Claude token（thalamus），可只在 thalamus 块加 guard；若想停所有 GPT 也一起包裹
