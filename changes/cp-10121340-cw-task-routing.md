## Brain {VERSION} — coding workflow 建单保留编码语义与仓库

- 建单计划必填 change_kind 和 map_scope_hint，支持批次顶层继承；显式传 write 与规范仓库，服务端按编码变更校验。
- 核对建单回执的类型、仓库、地图、变更类型和执行者；不匹配停止批次并保留任务 ID，缺字段旧请求直接 400。
- 增加 CLI→HTTP→Work Router→真实 PG→GET 的回归，隔离事务整体回滚。
