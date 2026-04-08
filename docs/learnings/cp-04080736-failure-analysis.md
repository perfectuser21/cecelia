### 根本原因

**三层失败叠加，account3 认证故障是主因（93%）**

1. **account3 认证层故障** → pipeline_rescue dispatch 到 account3 → Claude Code 进程无法启动 → liveness_dead → quarantine storm（289 个 rescue 任务全部失败）
2. **export_path 数据断链** → content_publish 子任务创建时 payload 中 export_path=null → 103 个发布任务无内容可发 → 级联取消
3. **成功率计算被 rescue storm 稀释** → 表面成功率 54%，排除 pipeline_rescue 噪音后真实为 64%

### 下次预防

- [ ] pipeline_rescue 被 dispatch 前必须检查目标账号 auth 状态：auth 不可用 → 跳过 dispatch，不创建任务
- [ ] rescue storm 告警：单日 pipeline_rescue quarantine 超过 20 → Brain 告警
- [ ] content-export 完成回调中，必须校验 export_path 非空再标记 completed，否则直接 fail pipeline
- [ ] 系统成功率展示时，默认排除 pipeline_rescue 和 dept_heartbeat 这两个"噪音类型"，给出"业务成功率"而非"总成功率"
- [ ] auth 失败熔断已存在但未覆盖 pipeline_rescue 路径，需扩展 auth 熔断到所有任务类型
