# Learning: Brain 自治闭环三个断点

## 概要
Brain 的 Probe 发现链路故障后，auto-fix 创建修复任务失败。同时 alertness 和 goal-evaluator 因缺列报错。

### 根本原因
1. auto-fix.js 的 dispatchToDevSkill 缺少 trigger_source:'auto_fix'，导致 createTask 校验 goal_id 失败
2. tick_history 表缺 completed_at 列（migration 从 028 开始重跑时漏了中间定义）
3. goals 表缺 starvation_score 列（同上）

### 下次预防
- [ ] 新增 createTask 调用时必须指定 trigger_source
- [ ] Brain 启动时自检所有查询涉及的列是否存在
