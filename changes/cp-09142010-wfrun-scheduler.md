## Brain {VERSION} — workflow_run 进 tasks 账 + 排班员 v1

- OpenClaw/n8n 派发不再绕账：派发即建 workflow_run task（operations 路线），run 终态自动收账（决策 2dbabb48）
- 排班员 v1：同 workflow 在途互斥（⏸ 排队回执，Delegated 即队列自动重试）+ Plan Date 时间窗（🕐 到点自动派发）
- 状态回执防雪球：⚠/⏸/🕐/▶ 尾巴剥离后重拼；migration 446 扩 task_type 枚举
