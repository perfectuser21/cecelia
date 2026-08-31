# Sprint PRD — attempt-run 桥接使用说明

## 目标

在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，仅交付文档，不修改应用代码。

## Golden Path

调用方阅读说明 → 理解 POST 创建派发与 GET 按 id 查询 → 按鉴权约束构造请求 → 选择九项白名单角色之一并填写 payload → 能识别派发失败后的完整回滚结果。

文档必须覆盖：

1. `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途。
2. 两端点采用 `internalAuthOrLoopback`；宿主或远端必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，不得写入真实 token。
3. 完整列出生产实现 `ALLOWED_ROLES` 的九项角色白名单。
4. `payload` 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自解析。
5. 派发失败自动回滚为 `run → failed`、`session → closed`、`task → cancelled`。

## 范围

- 唯一产品产物：`docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md`。
- 合同与冻结测试位于本 sprint 目录。
- 不修改端点、鉴权、数据库或其他应用代码。

## journey_type: autonomous
## target_environment: mac_web
