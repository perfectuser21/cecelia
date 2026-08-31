# Sprint PRD — attempt-run 桥接使用说明

## 目标

在 `docs/current/` 下新增一页中文的《attempt-run 桥接使用说明》，且不修改任何代码。

## 范围

文档必须覆盖：

1. `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途，以及 `internalAuthOrLoopback` 鉴权；宿主或远端调用必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。
2. 九项角色白名单：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。
3. payload 必填字段 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自行解析。
4. 派发失败自动回滚：run → `failed`、session → `closed`、task → `cancelled`。

## 非目标

- 不修改 `packages/`、`apps/`、脚本、工作流或其他代码。
- 不新增或改变 API 行为。

## journey_type: dev_pipeline

## target_environment: local_api
