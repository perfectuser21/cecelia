# Sprint PRD：attempt-run 桥接使用说明文档

## 目标

在 `docs/current/` 下新增一页中文《attempt-run 桥接使用说明》，仅新增文档，不修改代码。

## 必须覆盖

1. `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途。
2. 鉴权方式为 `internalAuthOrLoopback`；宿主或远端调用必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。
3. 九项角色白名单：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。
4. `payload` 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 解析。
5. 派发失败时自动回滚：run → `failed`、session → `closed`、task → `cancelled`。

## 验收

- 文档位于 `docs/current/attempt-run-bridge-guide.md`。
- 文档为中文，并包含上述四类说明。
- 不修改任何生产代码。

## journey_type: dev_pipeline

## target_environment: local_api
