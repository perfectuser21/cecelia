## Brain {VERSION} — 固定 Activity 与 Workflow 统一纯 Skill 调用

- 增加统一 resolve/invoke/readback 内部接口，消费服务器候选摘要或不可变定义版本；复用原生路由任务、run 与事件账，不创建新执行器或轮询器。
- 固定 Skill 全文及字节摘要直接进入既有 research/Codex Bridge 进程，派发前复核候选授权、资源、Skill 活性与正式发布证据。纯 Skill 之外的代码、写入及未接通 transport 如实阻塞。
- 租户与请求键在事务锁内保持目标版本和输入摘要幂等；预留后结果未知不重发。回执校验任务、run、租户、固定版本及结构化输出映射，证据账不完整不展示完成。
- 真实 scratch PostgreSQL 并发、撤权与回读验收；真实 Codex 只读进程对 Activity 单调和 Workflow 整调生成同一结构化产物。此验收为隔离候选验证，不授予生产发布或客户触达权限。
