# Task 4 真 DB 冒烟结论（2026-07-08）

> 计划原用 brain-deploy.sh 重启 Brain 跑 HTTP curl；因 localhost:5221 是**生产** Brain，
> 未合并分支重部署会把未审代码推上生产，故改用 **psql 层直验 handler 用的真 SQL**
> （HTTP 层的 404/400/status code 已由 mock-pool 行为测试覆盖）。migration 319 已应用到 cecelia DB。

样板 ability_id: 78734deb-d98f-4323-8fe5-439a4aa7e870

| 验证 | 期望 | 实测 | 结果 |
|---|---|---|---|
| 插 3 项(valid) | 成功 | 插入 OK | ✅ |
| COUNT FILTER 聚合(handler 用的 SQL) | done0 doing0 todo3 | `0\|0\|3` | ✅ |
| PATCH done + done_at=now() | done1, done_at 非空 | `1\|t` | ✅ |
| 反例A 非法 status | CHECK 拒 | violates check constraint advancement_items_status_check | ✅ 报红 |
| 反例B 非法 ability_id | FK 拒不建孤儿 | violates foreign key constraint advancement_items_ability_id_fkey | ✅ 报红 |
| 清理 | 表回 0 | count=0 | ✅ |

proven-to-fire：CHECK 与 FK 均亲眼见其对坏输入报红（拒绝写入），非从不失败的空守卫。
