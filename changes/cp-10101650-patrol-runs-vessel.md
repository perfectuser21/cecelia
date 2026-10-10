## Brain {VERSION} — task_runs 正式 Notion 投影配置

- 新增内部鉴权的 configure/bootstrap 入口，显式 enabled 与 actor 才能登记代码运行记录库。
- 复用现有 task_runs 推送；补列读回、来源标记及有界分页防重复，不抢占旧 Ops Runs 映射。
