# Sprint PRD — attempt-run 桥接使用说明

## 目标

在 Cecelia 仓库 `docs/current/` 下新增一页《attempt-run 桥接使用说明》。

文档必须覆盖：

1. `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 两个端点的用途、鉴权方式（`internalAuthOrLoopback`；宿主/远端必须带 `Bearer CECELIA_INTERNAL_TOKEN`）。
2. 角色白名单九项。
3. payload 必填字段：`sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自解析。
4. 派发失败自动回滚行为：run → `failed`、session → `closed`、task → `cancelled`。

## 范围

只新增中文说明文档，不修改任何代码。

## journey_type: dev_pipeline

## target_environment: local_api
