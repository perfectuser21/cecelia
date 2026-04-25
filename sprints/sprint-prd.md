# Sprint PRD — Brain `/api/brain/build-info` 构建探查端点

## OKR 对齐

- **对应 KR**：Harness v6 zero-human-babysit 闭环（Planner → GAN → Phase B 派 Gen → PR auto-merge → Phase C E2E → done）的端到端稳定性验证
- **当前进度**：8 个 P0+P1 修复全部部署到 Brain v1.222.0；尚未跑通首个 fresh Initiative
- **本次推进预期**：完成首次 8-fix 齐全后的 zero-babysit 全自动闭环；同时给 Brain 留下一个可运维探查端点

## 背景

今晚针对 Harness v6 闭环修了 11 个 PR、覆盖 8 个核心断链（gh CLI、callback 链路、quarantine 状态、vitest threshold、brain-deploy 幂等、状态机三联、backpressure whitelist、initiative-lock、schema、env 协议、timeout）。这些修复都已经合入 Brain v1.222.0，但还没有一个 fresh Initiative 把它们串起来跑过。我们需要一个体量极小、副作用极低的功能作为"试金石 Initiative"，用最小集成面来验证 Planner → GAN → Generator → PR auto-merge → E2E 全链路是否能在没有人工 babysit 的情况下闭环。

同时，这个功能本身是有运维价值的：目前 Brain 只暴露 `/api/brain/context` 等业务端点，没有任何端点可以让运维快速看到当前实例对应的代码版本与构建时间，每次怀疑"是不是新代码没部署上"都得登容器看 `package.json` 或 `git rev-parse`。引入 `/api/brain/build-info` 解决这个长期痛点。

## 目标

对外暴露 `GET /api/brain/build-info`，**只**返回 `{git_sha, package_version, built_at}` 三个字段，作为 Brain 实例的构建探查端点，让运维一条 curl 就能确认"这个实例跑的是哪个 commit、哪个 npm version、什么时候启动的"。

## User Stories

- **US-001**（P0）：作为运维，我希望 `curl localhost:5221/api/brain/build-info` 立即返回 HTTP 200 + 三字段 JSON，以便我不进容器就能看到当前实例对应的代码版本
- **US-002**（P0）：作为运维，我希望 `git_sha` 是 7-12 字符 short SHA，`package_version` 等于 `packages/brain/package.json.version`，`built_at` 是 ISO 8601 时间戳（启动时缓存），以便不同次请求返回的版本和构建时间稳定一致
- **US-003**（P1）：作为 Harness 系统，我希望这个 Initiative 完整跑通 Planner → GAN → Generator → auto-merge → E2E 闭环，以便我们获得首次 zero-babysit 的端到端证据

## 验收场景（Given-When-Then）

**场景 1**（happy path，US-001）
- Given：Brain 进程在端口 5221 上正常监听
- When：执行 `curl -s -o /tmp/body -w '%{http_code}' localhost:5221/api/brain/build-info`
- Then：HTTP 状态码为 200；响应 body 是合法 JSON；JSON 顶层 keys 排序后**严格等于** `["built_at","git_sha","package_version"]`（不能多键也不能少键）

**场景 2**（package_version 一致性，US-002）
- Given：`packages/brain/package.json` 的 `version` 字段值为 `V`
- When：请求 `/api/brain/build-info`
- Then：响应 body 的 `package_version` 字段严格等于 `V`

**场景 3**（built_at 缓存稳定性，US-002）
- Given：Brain 已启动并已被请求过一次 `/api/brain/build-info`
- When：再请求一次 `/api/brain/build-info`
- Then：第二次响应的 `built_at` 与第一次完全相同（启动时缓存，不每次重算）

**场景 4**（built_at 格式合法，US-002）
- Given：任意一次 `/api/brain/build-info` 请求
- When：取响应 body 的 `built_at` 字段
- Then：该字符串能被 `new Date(built_at).toISOString()` 解析出与原值相同的字符串（即为合法 ISO 8601 UTC 时间戳）

**场景 5**（git_sha 容错，US-002）
- Given：环境变量 `GIT_SHA` 未设置且仓库 `.git` 不可读
- When：请求 `/api/brain/build-info`
- Then：响应 body 的 `git_sha` 字段为字符串 `"unknown"`，HTTP 仍为 200，不抛异常

**场景 6**（end-to-end 闭环，US-003）
- Given：本 Initiative 由 Harness v2 Runner 派发，4 个 Task 全部进入 GAN → Generator 流程
- When：4 个 PR 依次过 CI 并 auto-merge
- Then：Initiative 状态由 `in_progress` 直接到 `completed`（不经过 `needs_human` 或 `quarantined`），且整个过程中**没有**任何人工 PATCH 任务状态/手动合并 PR/手动重跑 hook

## 功能需求

- **FR-001**：新增模块 `packages/brain/src/routes/build-info.js`，导出一个 Express `Router`（默认导出或命名导出 `router` 都可），路由内只挂 `GET /` 一个 handler
- **FR-002**：handler 返回的 body 形态为 `{ git_sha: string, package_version: string, built_at: string }`，三键齐全且**只**这三键
- **FR-003**：`git_sha` 解析顺序为：(1) `process.env.GIT_SHA`（容器构建时 baked）；(2) 进程工作目录的 `.git/HEAD` + `.git/refs/...`；(3) fallback 字符串 `"unknown"`。任何一步失败都不应抛异常
- **FR-004**：`package_version` 在模块加载时一次性从 `packages/brain/package.json` 读取并缓存
- **FR-005**：`built_at` 在模块加载时一次性生成（`new Date().toISOString()`）并缓存，所有后续请求返回同一字符串
- **FR-006**：在 `packages/brain/server.js` 中通过 `app.use('/api/brain/build-info', buildInfoRoutes)` 挂载，与现有路由风格一致
- **FR-007**：handler 不查询数据库，不创建 `pg.Pool`、不 import `db.js`，不依赖 Redis / BullMQ / 任何外部服务
- **FR-008**：在 `packages/brain/Dockerfile` 中通过 `ARG GIT_SHA` + `ENV GIT_SHA=$GIT_SHA` 把构建参数注入容器环境，构建脚本传 `--build-arg GIT_SHA=$(git rev-parse --short HEAD)` 时镜像内即可读到真实 SHA
- **FR-009**：在 `packages/brain/src/__tests__/build-info.test.js` 新增 supertest 集成测试，覆盖上述 6 个验收场景中可在测试环境直接断言的部分（场景 1-5；场景 6 由 Harness 流水线自身的成功率证明）

## 成功标准

- **SC-001 [ARTIFACT]**：`packages/brain/src/routes/build-info.js` 文件存在且导出 Express `Router`
- **SC-002 [ARTIFACT]**：`packages/brain/server.js` 中存在 `app.use('/api/brain/build-info', ...)` 挂载语句
- **SC-003 [ARTIFACT]**：`packages/brain/Dockerfile` 中存在 `ARG GIT_SHA` 与 `ENV GIT_SHA=$GIT_SHA` 两行
- **SC-004 [ARTIFACT]**：`packages/brain/src/__tests__/build-info.test.js` 文件存在且包含 supertest import
- **SC-005 [BEHAVIOR]**：在 brain 包下 `npm test -- build-info` 全部通过，断言项至少覆盖：HTTP 200、三键且仅三键、`package_version === require('../../package.json').version`、`built_at` 是合法 ISO 8601、两次请求 `built_at` 完全相同、未设 `GIT_SHA` 时 `git_sha` 不抛异常
- **SC-006 [BEHAVIOR]**：在 staging Brain 实例上 `curl -s localhost:5221/api/brain/build-info | jq -e 'keys|sort == ["built_at","git_sha","package_version"]'` 退出码为 0
- **SC-007 [BEHAVIOR]**：本 Initiative 4 个 Task 对应的 4 个 PR 全部由 Harness 自动合并，Initiative 终态为 `completed`，全程无人工干预记录（`harness_handoffs` 表中 `manual_intervention_count = 0`）

## 假设

- [ASSUMPTION: brain-deploy 流水线在新 PR 合并后会自动构建并重启 Brain 容器，本 Initiative 不需要手动触发部署]
- [ASSUMPTION: 现有 Dockerfile 构建脚本（`scripts/brain-build.sh` 或类似）能接受新增的 `--build-arg GIT_SHA=...` 参数；如果脚本是固定参数，仅 Dockerfile 改动也能保证 `process.env.GIT_SHA` fallback 到 `"unknown"`，端点仍然可用]
- [ASSUMPTION: vitest 已配置 supertest 兼容（项目其他 routes 已有 supertest 测试，沿用即可），不需要新装依赖]
- [ASSUMPTION: `process.cwd()` 在测试环境与生产容器中都是 `packages/brain` 或仓库根，二者下 `require('../../package.json')` 或等价路径都能 resolve]

## 边界情况

- **`.git` 目录不存在**（容器内通常没有 `.git`）→ `git_sha` 走 env，env 没有就 fallback `"unknown"`，不抛异常
- **`GIT_SHA` 环境变量为空字符串**（非 unset）→ 视同未设置，继续往下尝试 fs，最终 fallback `"unknown"`
- **package.json 加载失败**（不应该发生，但 defensive）→ 模块加载即抛错并阻止 Brain 启动，比悄悄给空字符串更安全（这是 ARTIFACT，启动失败立刻被发现）
- **进程时钟在启动时未同步（NTP 还没拉到正确时间）**→ `built_at` 反映启动瞬间的 OS 时间，可能略有偏差，但不影响"两次请求完全相同"的不变量
- **并发请求**→ handler 完全无状态、读缓存即返回，不存在并发问题

## 范围限定

**在范围内**：
- 新增 `routes/build-info.js`、挂载到 server.js、修改 Dockerfile 注入 GIT_SHA、新增 supertest 测试
- 端点行为正确性 + 容器构建参数 + 测试覆盖

**不在范围内**：
- 不修改 `db.js`、`pg.Pool` 或任何 DB 相关代码
- 不在端点上加鉴权/限流（这是内网运维端点）
- 不暴露其他构建元数据（如 npm 依赖列表、Node 版本、构建机器信息）
- 不修改 `brain-build.sh` / CI 流程把 `--build-arg GIT_SHA=...` 传进 docker build（如需，是后续 follow-up Initiative）
- 不写任何 OpenAPI / Swagger 文档（Brain 目前没有这种规范）
- 不增加 brain 版本号（version bump 由 brain-deploy 流水线在合并后自行处理，不属于本 Initiative）

## 预期受影响文件

- `packages/brain/src/routes/build-info.js`（新增）：路由模块本体
- `packages/brain/server.js`（修改）：挂载新路由
- `packages/brain/Dockerfile`（修改）：注入 `ARG GIT_SHA` + `ENV GIT_SHA`
- `packages/brain/src/__tests__/build-info.test.js`（新增）：supertest 集成测试
