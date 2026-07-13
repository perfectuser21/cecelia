# Learning: staging unknown 线显式策略 + relay env 宿主路径（跨 repo 刀3 cecelia 半件）

## 背景
harness 跨 repo 化审计（Notion Issue 98e5dff4）发现：第三方 repo 的 staging_e2e 任务会把
cecelia brain 误部署到 :5222；controller 容器内切 judge API 化缺宿主 worktree 路径。

### 根本原因
1. `resolveLine` 三态（internal/customer/unknown）里 unknown 从未被显式处理——`deployStaging`
   的分支结构是 if(internal)/if(customer)/else，unknown 静默落进 else 与"cecelia 默认部署"混路。
   隐式 fallback 在单 repo 时代无害，跨 repo 后成为错误目标。
2. relay spawn 只把 worktreePath 交给 docker mount（容器内固定 /workspace），没有任何 env
   透出宿主路径——容器内进程要跟 Brain（另一容器、按宿主路径挂载）交换文件路径时无据可依。

### 下次预防
- [ ] 枚举型分流（line/verdict/status）新增取值时，逐个消费点显式处理，禁止静默落 else
- [ ] 容器间要交换文件路径时，统一传宿主绝对路径 + 双侧同路径挂载，env 显式注入（HARNESS_WORKTREE_HOST 模式）
- [ ] 早退分支的"不做某副作用"（不抢锁/不 deploy）用注入 spy 断言进单测，不留在注释层
