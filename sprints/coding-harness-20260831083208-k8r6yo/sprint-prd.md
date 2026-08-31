# Sprint PRD — attempt-run 桥接使用说明文档

## 目标

在 `docs/current/` 下新增一页《attempt-run 桥接使用说明》，仅修改文档，不修改应用代码。

## 必须覆盖

1. `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 两个端点的用途。
2. 鉴权方式为 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。
3. 角色白名单九项：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。
4. `payload` 必填字段：`sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自解析。
5. 派发失败时自动回滚：run → `failed`、session → `closed`、task → `cancelled`。

## 验收

- 文档位于 `docs/current/`。
- 文档使用中文并包含上述四类说明。
- 不修改任何应用代码。

## journey_type: dev_pipeline

## target_environment: local_api
