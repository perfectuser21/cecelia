# Learning：环境 hard-off 必须枚举并控制所有独立 loop

本轮 staging 的 health 正确显示主 scheduler stopped，tick 日志也明确声明 hard-off 生效；但 server 仍无条件启动 scheduler-jobs 与 PromotionJob，staging DB 因而出现自动创建的 ci_patrol。单个入口的关闭状态不能代表整个进程没有调度副作用。

### 根本原因

- 调度能力已从单一 tick 拆成多个独立 loop，环境开关仍只挂在旧入口。
- health 的 scheduler 字段只观察 tick，不聚合 scheduler-jobs、PromotionJob 等实际执行体。
- staging 测试验证“主 tick 未启动”，没有验证“一段时间内数据库无自动写入”。

### 下次预防

- [ ] 新增独立 loop 时必须登记到统一生命周期注册表，并继承环境级 start/stop 合同。
- [ ] hard-off 验收同时检查进程、定时器、日志和数据库副作用，不能只看 health 单字段。
- [ ] 允许在隔离环境运行的纯观测 job 必须显式白名单，默认禁止写任务、发通知或触发部署。
- [ ] 架构巡检对环境隔离采用“配置 → 启动日志 → 真实数据变化”三层证据链。
