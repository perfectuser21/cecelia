# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: fecce72e9b5339d695765169ba0305cde40a19c2de48f09f36558c166e996531

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：通过补齐 attempt-run 桥接的中文操作合同，降低误派发与错误恢复风险

## 背景

当前 attempt-run 桥接缺少集中、可测试的中文使用说明。本 sprint 仅在 `docs/current/` 新增《attempt-run 桥接使用说明》，明确调用、鉴权、角色、payload 与失败回滚合同，不修改代码。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》开始 → 按文档携带正确鉴权和 payload 调用 `POST /api/brain/harness/attempt-run` → 使用返回标识调用 `GET /api/brain/harness/attempt-run/:id` 查询状态 → 成功获得 attempt-run 派发与状态信息；若派发失败，可从文档确认系统自动完成 `run→failed/session→closed/task→cancelled` 回滚。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发一次 Harness 角色 attempt，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询该 attempt 的运行状态。
2. 文档说明两端点均使用 `internalAuthOrLoopback`；宿主或远端请求必须发送 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不得展示真实凭据。
3. 文档完整列出接口接受的九项角色白名单，并明确白名单外角色不受支持；该清单由测试按生产端点的权威角色集合逐项核对。
4. 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，省略时由生产 Brain 自解析。
5. 文档明确派发失败后的自动回滚终态：run 为 `failed`、session 为 `closed`、task 为 `cancelled`。
6. 文档给出不含真实 token 的宿主/远端请求示例，以及创建后按 id 查询的连续示例。

## 边界情况

- loopback 与宿主/远端鉴权差异必须表述清楚，不能让读者把 loopback 例外外推到远端。
- `base_sha` 仅为可省略字段，不得写成必填，也不得暗示调用方自行猜测其值。
- 派发失败不得描述为部分成功；三个对象的终态必须同时、逐项写明。
- 角色白名单必须恰好九项，并与生产端点的权威集合一致，不得仅写数量或示例子集。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》；覆盖两个端点的用途与鉴权、九项角色白名单、payload 字段规则、派发失败自动回滚；为每条验收断言提供测试覆盖。

**不在范围内**：修改任何代码、接口行为、鉴权策略、角色白名单、状态机、数据库结构或其他文档。

## 假设

- [ASSUMPTION: 九项角色名称以生产 attempt-run 端点已有的权威角色集合为准，文档测试直接与该集合核对，避免在规划阶段复制并漂移实现常量。]
- [ASSUMPTION: 文档文件名使用可被现有文档测试稳定定位的中文或等价英文 slug，标题必须为“attempt-run 桥接使用说明”。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文《attempt-run 桥接使用说明》。
- `packages/brain/test/attempt-run-bridge-doc.test.js`：逐条覆盖本文八项 DoD；仅新增测试，不改生产代码。

## DoD（可执行验收计划）

1. 测试断言 `docs/current/attempt-run-bridge-guide.md` 存在、标题为中文《attempt-run 桥接使用说明》，且 git diff 中没有生产代码变更。
2. 测试断言文档同时包含 `POST /api/brain/harness/attempt-run`、`GET /api/brain/harness/attempt-run/:id` 及两者各自用途。
3. 测试断言文档包含 `internalAuthOrLoopback`，并明确宿主/远端使用 `Bearer CECELIA_INTERNAL_TOKEN`；示例不得包含真实 token。
4. 测试从生产端点权威白名单取得九项角色，断言数量恰为九且每项均在文档中，文档不得额外声明第十项支持角色。
5. 测试断言 payload 必填字段仅明确包含 `sprint_dir`、`base_repo`、`branch`，并明确 `base_sha` 可省略且由生产 Brain 自解析。
6. 测试断言派发失败回滚章节同时包含 `run`→`failed`、`session`→`closed`、`task`→`cancelled` 三组映射。
7. 测试断言文档包含不泄露凭据的 POST 创建示例和 GET 按 id 查询示例。
8. 运行该文档测试文件，所有断言通过，并用 `git diff --name-only` 证明变更范围只含目标文档与其验收测试。

## NFR 约束

<!-- 来源: PrepPRD 主源 + decisions category=nfr 副源；副源为空 -->
- 安全：真实 `CECELIA_INTERNAL_TOKEN` 不进入文档、git 或测试日志。
- 一致性：角色清单与 payload/回滚行为必须由测试对照生产权威定义，防止文档漂移。
- 语言：正文为简体中文，端点、字段、角色和状态标识保留原始技术字面。
- 性能/频控/版本要求：待定（PrepPRD 未指定，且本 sprint 不改变运行时行为）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step 与 journey_feature 为空，area 三源结果按 id 去重后仅列与本 sprint 有直接约束的铁律 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [禁止写死环境假设值] 环境假设值不得写死，须从环境推导（来源: area）
- [Planner角色分支] Planner workspace 必须保持服务端签发的 planner_branch，禁止自行切换（来源: area）
- [单slot串行] 一个 slot 内任务串行执行，同一时刻只推进一个任务状态（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 将把以下验收点翻译为可执行脚本：
# 运行专用文档测试，逐条验证两个端点、鉴权、九项角色、payload、回滚、中文与变更范围；
# 再检查 git diff，确认仅新增目标文档及其测试，未修改生产代码。
```

## journey_type: autonomous
## journey_type_reason: thin_prd 仅锚定 docs/current/ 文档且无 UI、远端 agent 或 engine 路径线索，按默认规则归为 autonomous。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 Fleet Worker 的仓库 checkout 中执行文档测试。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
