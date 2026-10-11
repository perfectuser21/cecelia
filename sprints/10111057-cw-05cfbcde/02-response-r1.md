### R-1
处理: 采纳
说明: 按 QA 方案 (b) 改。意图原文是「同一套中间件或同级开放策略」，这里取「同一套中间件」：S-1 改为新路由器顶部挂 `internalAuthOrLoopback`，和 `src/routes/spans.js` 写入侧用的是同一个中间件，满足 INV-50954d28。I-1～I-5 都没有要求不带 token 也能访问，验收条目不变。改动范围：S-1 补鉴权行为（token 已配时缺 token 或 token 错都回 401 `UNAUTHORIZED`；未配 token 时非 loopback 回 503），调用方 header 改为 `x-internal-token`；S-3 的挂载理由和集成测试断言改为「带 token 200」；S-4 的 smoke 在配了 token 时 GET 也带 token；Q-2 期望改为带 token 200，不带 token 或 token 错都 401，且 401 的 body 里不含记录字段；铁律对照里 INV-50954d28 如实写为由 S-1/S-3/Q-2 覆盖。原来「建议另立任务」那句已删。`GET /api/brain/spans` 本身是否收紧不属于本次 I-n，只在「未覆盖真实链路」里记为存量。验证：集成测试（S-1）断言 token 已配置时，不带 token 和带错 token 都是 401，带正确 token 是 200；QA 按 Q-2 实测。

### R-2
处理: 采纳
说明: 核实成立：`scripts/preview-env-start.sh:324-341` 没有显式设置 `CECELIA_INTERNAL_TOKEN` 和 `NODE_ENV`；`internal-auth.js:74-85` 在未配 token 时，非 loopback 请求一律回 503。改动：
1. `## QA 场景` 约定开头加了环境判定步骤。不带 token 向预览环境发 `POST /spans`：返回 401 说明已配 token，`TOKEN` 从预览宿主机的 Brain 进程环境里取（`/tmp/preview-<PR号>.pid` → `/proc/<pid>/environ`，非 Linux 用 `ps eww`）；返回 503 或取不到 token，就改用本机从本分支起的 Brain。约定里给出完整启动命令，显式设置 `CECELIA_INTERNAL_TOKEN=qa-local-token`、`NODE_ENV=development`、`PORT=5299`、`DATABASE_URL`，并要求在报告里注明。Q-1～Q-6 统一打 `<目标>`，统一带 `$TOKEN`。
2. Q-7 两端都改在本机起：本分支在 5299，main 在 5298。两端用同一条启动命令，同库、同 token、同 `NODE_ENV`，只差代码版本，不再拿配置未知的预览环境去比本机基线。
3. 铁律对照里 INV-909ce765、未覆盖真实链路第 2 条同步改了。

### R-3
处理: 采纳
说明: 建议级。`## 未覆盖真实链路` 新增「已知遮蔽」一条：`server.js:429` 的 `contentPipelineRoutes` 先挂载，run_id 恰好为 `stats`/`stages`/`output`/`publish-status` 时，请求会被它的 `/:id/<子路径>` 先接走。真实 run_id 形如 `coding-workflow:<uuid>`，不受影响，本次不处理。
