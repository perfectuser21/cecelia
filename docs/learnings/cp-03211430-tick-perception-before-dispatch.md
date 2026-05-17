# Learning: tick 感知模块位置重构

## 背景
tick.js executeTick() 函数中，zombie sweep、Pipeline Patrol、health check、initiative-closer、kr-progress 等感知模块位于 thalamus 和 canDispatch 之间，容易被 early return 跳过。

### 根本原因
感知模块随时间逐步添加，每次都插入到 executeTick() 末尾最近的空位，没有考虑"感知 vs 行动"的语义分层。结果是所有模块混在一起，thalamus dispatch_task 的 early return（第 1529 行）和 canDispatch=false 的 early return（第 2331 行）都能跳过感知模块。

### 下次预防
- [ ] executeTick() 内新增模块时，先判断属于"感知层"还是"行动层"，插入到对应区域
- [ ] 感知层代码必须在所有 early return 点之前
- [ ] 用清晰的注释分隔感知层和行动层边界

## 修复
把 9 个感知模块从 thalamus-canDispatch 之间移到 alertness/cognition 评估之后、thalamus 之前，并加上"感知层：不受 canDispatch 限制"注释标记。
