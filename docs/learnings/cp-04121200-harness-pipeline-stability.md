# Harness Pipeline 稳定性修复 Learning

## 问题
Harness Pipeline 无法无人值守运行，需要人工持续监控。

### 根本原因
1. execution.js 中 harness_report 处理块被 copy-paste 重复，session crash 时创建双倍 retry 任务
2. Planner crash 后 plannerBranch 为 null，Proposer 静默拿到垃圾数据继续运行
3. 4月9日架构决策（CI 替代独立 Evaluator）只改了一半 — 删了 ci_watch 创建但没加内联 CI 检查，Generator/Fix 完成后不验证 CI 直接出报告
4. harness_report 只在 session crash（result=null）时重试，AI Failed 不触发重试
5. harness-watcher.js 的 _checkDeployStatus 吞掉所有异常返回 success
6. monitor-loop 盲目重启 harness 链式任务，导致下游重复任务

### 下次预防
- [ ] 架构决策执行时必须全链路检查：删一个环节 = 用新逻辑替换，不能留空洞
- [ ] copy-paste 代码块后必须搜索文件中是否有重复
- [ ] catch 块永远不应该返回"成功"状态，至少返回"未知/重试"
- [ ] 链式任务系统（pipeline）的 monitor/restart 逻辑必须感知链关系
