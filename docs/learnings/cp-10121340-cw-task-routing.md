# coding workflow 建单成功必须核对真实路由

Z0 任务 7ba57642 的 CLI 只发送 task_type 和 payload，没发 change_kind / mutation_intent / map_scope_hint。API 把它归为 coding_review，路由真身把 repo 置空，默认仓 daemon 抢走；dry-run 及只回显请求的假 API 没覆盖这个缺口。

修复：计划显式选择 change_kind 与地图节点；CLI 发 write/repo_hint 并核对服务端回执；coding_workflow 注册表加入 CM，旧缺字段请求 400，不再落错误任务。

验证：先 7 条失败、修复后 156 条相关回归通过；真实 scratch 中 CLI→HTTP→Work Router→PG→GET 与路由收据一致，400 请求零落行，最后事务完整回滚。地图投影是建单必需前提，测试不得把不存在的节点假装合法。

约束：dry-run 只证明输入计划可解析；真实建单成功必须检查 work_kind、repo、map_scope、orchestrator。服务端失败或返回不匹配时保留已建 ID，停止后续批次，不自动补造同一任务。

CI 补充：真实入账会解析 origin/main 的证据 SHA；brain-integration 默认浅克隆只有 PR merge ref，导致 routing_evidence_unavailable。为该 job 拉取完整 refs，不在测试里伪造 base_sha。

跨仓补充：ZJ 路径未配置时服务端可能回落 Cecelia cwd 的 origin/main，不能把该 SHA 当 ZJ 基线。调用方从目标仓库 fetch 后读取 origin/main，计划显式传可选 base_sha（40位小写hex，批次可继承/逐条覆盖）；CLI 顶层转发并核 payload.base_sha，错回或缺失就保留ID并停止后续。真实PG例同时核请求、task与不可变路由receipt的SHA一致。
