---
task_id: 05cfbcde-1108-4018-93d6-a48464324b11
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 8
回归风险: 8
可执行: 8

### R-1
针对: S-1, S-3, Q-2
严重度: 重要
场景: 验收时按铁律逐条核对，发现新上线的 `GET /api/brain/runs/:run_id` 不带任何 header 就能读到整行 runs 记录（含 `error`、`detail`、`executor_id`、`trigger_ref`；加 `include=spans` 还能读到每条 span 的 `evidence`）。但 `## 铁律对照` 里 INV-50954d28 写的是「覆盖」，实际是违反，后续收紧也只是一句「建议另立任务」。
依据: INV-50954d28 原文「每个 API 端点必须有 auth；无鉴权端点不准 ship」；S-1「鉴权：……不挂鉴权中间件」；`server.js:307-315` 全局 CORS `Access-Control-Allow-Origin: *`。意图只写了「以现有 spans GET 为准」，没有写出豁免这条铁律的决策；`## 未覆盖真实链路` ① 也没有 Brain 任务 ID。
说明: 意图要求和铁律在这里正面冲突，规格不能自己判成「覆盖」。二选一：(a) 在 `## 铁律对照` 里如实写「冲突」，附上主理人豁免本端点的 decisions ID，同时把「runs/spans 读接口统一收紧」登记成 Brain 任务并写出任务 ID；(b) 直接给新路由挂 `internalAuthOrLoopback`，并把 Q-2 的期望改成「带 token 200、不带 token 401」。I-1 只要求返回 200，本身不要求开放访问。

### R-2
针对: Q-1, Q-3, Q-4, Q-7, I-4, I-5
严重度: 重要
场景: QA 打开 PR 预览环境，从自己机器执行 Q-1 第 2 步 `POST /spans` 拿到 503 `INTERNAL_AUTH_NOT_CONFIGURED`（或者手里的 `<TOKEN>` 对不上而拿到 401），Q-1/Q-3/Q-4 全部没法往下做，I-4 验不了。Q-7 中，预览端「不带 token」返回 503，而 QA 本机起的 main 基线因为设了 token 返回 401，两边状态码不一致，被误判为回归。
依据: `scripts/preview-env-start.sh:324-341` 启动预览 Brain 时既没有显式设置 `CECELIA_INTERNAL_TOKEN`，也没有设置 `NODE_ENV`，全部继承父进程环境，QA 无法事先知道。`src/middleware/internal-auth.js:74-85` 中，token 未配置时非 loopback 请求一律 503。Q-7 的前提「预览环境已配置 `CECELIA_INTERNAL_TOKEN`」没有任何核实步骤，`<TOKEN>` 的来源也没写；`## 未覆盖真实链路` 第 2 条只说明了限制，没给替代执行路径。
说明: (1) 在 QA 场景开头加一个判定步骤：不带 token 发 `POST <预览环境>/api/brain/spans`，401 表示已配 token，再写明 `<TOKEN>` 从哪里取（1Password 条目名或预览环境的注入来源）；503 表示未配 token，QA 改用本机从本分支起的 Brain，显式设置 `CECELIA_INTERNAL_TOKEN`，在上面跑 Q-1～Q-7，并在报告里注明。(2) Q-7 的对比两端要用逐项相同、显式设置的环境变量（`CECELIA_INTERNAL_TOKEN`、`NODE_ENV`）。最好两端都在本机起（本分支 vs main，同库结构），不要拿配置未知的预览环境对比本机基线。

### R-3
针对: S-1, S-3
严重度: 建议
场景: 有人上报了 run_id 恰好为 `stats`、`stages`、`output` 或 `publish-status` 的运行，GET `/api/brain/runs/stats` 会被内容流水线的路由按 pipeline id=`runs` 先接走，返回的不是 run 总记录。
依据: `server.js:429` 把 `contentPipelineRoutes` 挂在 `/api/brain`，比新路由（计划挂在第 474 行前）早，而 `src/routes/content-pipeline.js:546/584/686/922` 有 `/:id/stages`、`/:id/output`、`/:id/publish-status`、`/:id/stats` 这几条路由。
说明: 真实 run_id 形如 `coding-workflow:<uuid>`，碰撞概率很低，不阻断。建议在 `## 未覆盖真实链路` 里登记这几个保留字冲突，或者在 S-3 里说明已知遮蔽。
