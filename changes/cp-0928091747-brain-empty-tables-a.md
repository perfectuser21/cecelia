## Brain {VERSION} — 删除 A 类 37 张空表 + 5 个依赖视图；capture-atoms 删写错表的 event 分支

- 09-28 盘点：大脑库 262 张表中 76 张为空，逐表核实建表迁移、读写文件、外键与视图，分四类（清单与完整备份 `~/db-backups/brain-empty-tables-20260928/`，决策 28674999）。
- 迁移 481：删除 A 类 37 张（拆库前 ZenithJoy 表 5、迁移改名备份 2、未启用的登录表 4、网页分析一套 5、瓶颈扫描一套 4、其他已删功能遗留 17）及 5 个依赖视图。非空闸：表存在且非空即 RAISE EXCEPTION 整体回滚；刻意不用 CASCADE。回滚脚本为生产 `pg_dump -s` 原样 DDL。完整生产表结构副本上实测：闸拦截、up 后 262→225、down 全恢复、重放幂等。
- `routes/capture-atoms.js`：删除 `event` 分支（向网页分析表 `events` 插不存在的 name/notes/area_id，一触发即 500；历史 0 条 event 原子）；未知 target_type 统一返回 400（决策 9ecb9628）。
- B 类 17 张（退役架构，写入代码仍挂着）暂不删；D 类 10 张「接口在无人调用」另走连代码删除的 PR；`org_unit_members` 与 C 类 6 张保留。
