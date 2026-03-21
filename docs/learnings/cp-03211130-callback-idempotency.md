# Learning: execution-callback 幂等性保护

## 背景
execution-callback 端点缺少幂等性保护，重复 callback 导致 decision_log 重复写入和副作用链重复执行。

### 根本原因
decision_log 表的 INSERT 是纯 INSERT 无任何去重机制，且端点入口没有检查同一 run_id + status 是否已处理过。当网络重试或外部系统重复调用时，整个 callback 处理链（包括通知、thalamus 决策、progress rollup）都会重复执行。

### 下次预防
- [ ] 所有接收外部回调的端点必须设计幂等性保护
- [ ] INSERT 语句优先使用 ON CONFLICT 或 WHERE NOT EXISTS
- [ ] 对于无唯一约束的表，在业务层做入口级去重检查
