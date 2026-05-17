# Learning: 角色精简 10→5 + 丘脑 domain-only 路由

分支: cp-03211910-role-thalamus-refactor
日期: 2026-03-21

## 变更内容

- role-registry.js 精简为 5 个核心角色（CTO/CPO/CMO/CFO/COO），保留旧角色名作为向后兼容别名
- 每个角色新增 task_types 字段，列出该角色可派发的任务类型
- thalamus.js prompt 删除硬编码的意图→task_type 路由表，改为只判断 domain
- 新增 buildDomainRouteTable() 函数，动态生成丘脑可用的 domain 路由表

### 根本原因

丘脑绕过了 role-registry 角色体系，自己硬编码了一套关键词→task_type 映射。导致：
1. 所有 coding 类请求直接变成 task_type=dev（1 PR），跳过了层级判断
2. 10 个角色有重叠（CTO/CISO/VP QA），domain 边界不清
3. 角色体系形同虚设，丘脑和角色各走各的

### 下次预防

- [ ] 丘脑 prompt 改动后，验证输出 domain 字段是否被下游正确消费
- [ ] 角色精简时保留向后兼容别名，避免大量测试断裂
- [ ] 新增角色或 domain 时，只需改 role-registry.js，丘脑 prompt 通过 buildDomainRouteTable() 自动感知
