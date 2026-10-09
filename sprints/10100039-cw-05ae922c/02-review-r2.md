---
task_id: 05ae922c-4f2a-4c1c-9f86-d24937fc32d3
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 9
可验证: 8
场景覆盖: 8
回归风险: 8
可执行: 8

## 上轮问题
- R-1: 关闭 —— S-1 和 S-2 的验证部分已经写明：5 个用非 UUID id 的 GET 用例改用固定的合法 uuid（只含十六进制字符），mock 返回行的 id、`countParams`、`res.body.id` 断言一起改；404 文案、查询 2 次、先查 objectives 再查 key_results 这些断言保留，不删用例。PATCH 不在本次范围内（`task-projects.js:274`、`task-goals.js:223` 都没加校验），相关用例不受影响。
- R-2: 关闭 —— 公共前提已改成三步，可以照抄执行：`setup-test-db.sh`（文件已确认在 `packages/brain/scripts/`）、`DB_NAME=cecelia_test CECELIA_TICK_HARD_OFF=1 PORT=5299 node server.js`、用 `dev-records?limit=1` 做就绪检查返回 200。这样能连到测试库，tick loop 也被硬关了。
- R-3: 关闭 —— 公共前提把"数据库报错原文"统一定为 `invalid input syntax`、`for type uuid`、`22P02`、`LIMIT must not be negative` 这几个串，并注明不能用 `uuid` 判定。Q-1、Q-2、Q-3 用同一套判定标准，和规定的正确文案不再冲突。
