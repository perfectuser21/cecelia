# Sprint PRD：attempt-run 桥接使用说明

## 目标

在 Cecelia 仓库 `docs/current/` 下新增一页中文《attempt-run 桥接使用说明》，且不修改任何代码。

## 验收范围

文档必须覆盖：

1. `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途，以及 `internalAuthOrLoopback` 鉴权；宿主或远端调用必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。
2. 九项角色白名单：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。
3. `payload` 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自行解析。
4. 派发失败自动回滚：run → `failed`、session → `closed`、task → `cancelled`。

## journey_type: dev_pipeline

## target_environment: local_api

