# PRD：attempt-run 桥接使用说明文档

## 目标

在 `docs/current/` 下新增一页中文《attempt-run 桥接使用说明》，且不修改任何代码。

## 文档必含内容

1. 说明 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途，以及 `internalAuthOrLoopback` 鉴权；宿主或远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。
2. 完整列出角色白名单九项：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。
3. 说明 payload 必填字段为 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自行解析。
4. 说明派发失败自动回滚：run → `failed`、session → `closed`、task → `cancelled`。

## 验收边界

- 文档位于 `docs/current/attempt-run-bridge-guide.md`。
- 文档使用简体中文并包含上述四节。
- 除 Sprint 合同产物与目标文档外，不改代码或其他产品文件。

## journey_type: dev_pipeline

## target_environment: local_api
