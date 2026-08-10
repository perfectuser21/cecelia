---
id: cp-08101600-arch-review-fa84335c
task_id: fa84335c-ee62-4043-9e05-3bfd91a46823
created: 2026-08-10
category: architecture-review
---

# 架构巡检 Learning

## 16:00 UTC 架构巡检（2026-08-10）

### 根本原因

- 环境隔离只关旧 tick，没有控制 server 直接启动的 scheduler/projection/Promotion 等独立 loop；五个 preview Brain 因此同时生成同名巡检，两个还通过共享锁池并发执行。
- review 身份除了 claim/lock/payload 三套外，又隐含依赖 callback URL。preview 未设置 BRAIN_URL，child 回调默认指向生产 DB；即使进程 exit 0，也无法收口原 preview task。
- migration selfcheck 只校验 floor 不高于数据库 max，既发现不了已登记 relation 缺失，也发现不了生产 ledger/物理 schema 领先 main 正本。
- 测试文件仍在仓库不代表 CI 真实执行。完整 scheduler 测试被 exclude，显式传入也静默不收集，废弃的 xian 断言因而长期存活。
- 跨模块保护若只 grep 一个函数或字符串，会掩盖路径语义不一致：Engine 默认 `~/worktrees`，Janitor 的 dev-lock 守卫仍停在旧 `.claude/worktrees`。

### 下次预防

- 环境启动合同枚举全部 loop，preview 默认零副作用；用完整 4h 调度窗口验证零任务、零通知、零部署、零外部 executor。
- 异步执行以同一 environment/task/run 身份验证 claim、lock、heartbeat、callback URL 和 CAS，callback 未应用必须响亮失败。
- migration 门禁双向比较 main 清单与生产 ledger/物理 schema；修漂移只增可重入 forward migration，不改写历史。
- 测试命令记录“请求文件数、收集文件数、用例数”，三者不一致即失败；exclude 文件必须有独立 CI owner 或删除。
- 跨仓/跨模块守卫测试输入必须来自生产默认值，不能用字符串存在性代替路径与生命周期行为。
