# Learning: 成功率计算精度改进

## 任务背景
[SelfDrive] 分析并修复任务成功率下降（57% → 90%）— 第二轮精确化

## 根本原因
PR #1885 修复了主要问题（pipeline_rescue 任务风暴 + total 全量统计），成功率从 57% 升到 94.9%。

残余问题：
1. `started_at IS NOT NULL` 作为 total 仍会包含 cancelled 任务（12 content-export 任务被父 pipeline 取消后 started_at 保留）
2. quarantine.js 不设 `completed_at/updated_at`，导致隔离任务时间戳缺失
3. content-pipeline-orchestrator cancel SQL 缺 `updated_at = NOW()`

### 根本原因
`total` 的定义语义不准确：用 `started_at IS NOT NULL` 代替「执行到终态的任务数」，把被外部取消的任务也算作「分母」。

### 下次预防
- [ ] 成功率 total 永远用终态 (`completed/failed/quarantined`) 而非执行状态标志
- [ ] 所有 UPDATE tasks 的 SQL 都应包含 `updated_at = NOW()`（通用规则）
- [ ] quarantine 是一种「终态」，必须设 `completed_at`
