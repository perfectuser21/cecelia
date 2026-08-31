# PRD：attempt-run 桥接使用说明

目标：在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》；不修改任何代码。

文档必须覆盖：

1. `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途。
2. 鉴权为 `internalAuthOrLoopback`；宿主或远端调用必须发送 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。
3. 九项角色白名单：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。
4. payload 必填字段为 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自解析。
5. 派发失败自动回滚：run → `failed`、session → `closed`、task → `cancelled`。

## journey_type: dev_pipeline

## target_environment: local_api
