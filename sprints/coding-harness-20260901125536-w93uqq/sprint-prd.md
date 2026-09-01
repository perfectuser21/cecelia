# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 6d5e0d33c7728fc734bbfc8bdbee19109a114ad343e38f6ec691e02a7fbfbecf

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的当前使用契约，降低错误调用与故障处置歧义

## 背景

为调用方提供一页中文的《attempt-run 桥接使用说明》，统一描述端点用途、鉴权、角色、payload 与派发失败后的状态回滚。本文档只解释现有契约，不引入或改变运行时行为。

## Golden Path（核心场景）

调用方从阅读 `docs/current/attempt-run-bridge.md` → 按文档构造并鉴权 POST 请求 → 查询对应 attempt-run 状态 → 能够解释成功派发或失败回滚后的最终状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发一次 attempt-run，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询该次运行状态。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主或远端调用必须发送 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，并区分 loopback 调用条件。
3. 文档完整列出服务接受的九项角色白名单，明确白名单外角色不属于合法请求。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，省略时由生产 Brain 自解析。
5. 文档说明派发失败后自动回滚为 `run → failed`、`session → closed`、`task → cancelled`，调用方可通过查询端点观察失败结果。

## 验收断言

1. [TEST-DOC-01] 测试文件断言 `docs/current/attempt-run-bridge.md` 存在且包含中文正文。
2. [TEST-DOC-02] 测试文件断言文档同时出现 POST、GET 两个完整端点及其用途。
3. [TEST-DOC-03] 测试文件断言文档包含 `internalAuthOrLoopback`、Bearer 与 `CECELIA_INTERNAL_TOKEN`，并明确宿主/远端必须携带令牌。
4. [TEST-DOC-04] 测试文件从文档角色章节提取角色，断言恰为生产白名单九项、无缺项或额外项。
5. [TEST-DOC-05] 测试文件断言 payload 章节将 `sprint_dir`、`base_repo`、`branch` 标为必填，并将 `base_sha` 标为可省略且由生产 Brain 自解析。
6. [TEST-DOC-06] 测试文件断言回滚章节同时包含 `run → failed`、`session → closed`、`task → cancelled` 三个状态转换。
7. [TEST-DOC-07] 测试文件断言本次实现差异仅包含上述文档，不含代码、测试或配置文件变更。

## 边界情况

- 区分 loopback 与宿主/远端请求，禁止把 loopback 的鉴权豁免误写成远端可匿名访问。
- `base_sha` 省略只表示由生产 Brain 自解析，不表示其他三个必填字段可省略。
- 派发失败必须同时描述 run、session、task 三类对象的终态，不能只写其中一项。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文 attempt-run 桥接说明，覆盖两个端点、鉴权、九项角色白名单、payload 字段和失败回滚，并满足七条可由测试文件覆盖的断言。

**不在范围内**：不修改任何代码、测试、配置、API 行为、鉴权策略、角色白名单或数据库状态；不新增其他说明页。

## 假设

- [ASSUMPTION: 文档中的九项角色名称以生产 Brain 当前接受的权威白名单为准；PrepPRD 仅规定数量，未逐项给出名称。]
- [ASSUMPTION: 本文档固定命名为 `docs/current/attempt-run-bridge.md`。]

## 预期受影响文件

- `docs/current/attempt-run-bridge.md`：新增《attempt-run 桥接使用说明》；这是唯一允许变更的文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须让调用方能通过 GET 端点识别派发失败后的三类对象终态。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 id 去重；列出与本 sprint 直接约束相关的有效项 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [Planner 分支] Planner workspace 必须保持服务端签发的 planner_branch，Provider 不得 checkout 或切换分支（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
DOC=docs/current/attempt-run-bridge.md
test -f "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer.*CECELIA_INTERNAL_TOKEN' "$DOC"
grep -q 'sprint_dir' "$DOC" && grep -q 'base_repo' "$DOC" && grep -q 'branch' "$DOC" && grep -q 'base_sha' "$DOC"
grep -q 'run.*failed' "$DOC" && grep -q 'session.*closed' "$DOC" && grep -q 'task.*cancelled' "$DOC"
test "$(git diff --name-only 5599211397c88c3827d5ce4e9c6061b3802b4fc5...HEAD | sort -u)" = "$DOC"
```

角色白名单的九项精确集合与以上章节断言由测试文件验证；全部断言通过且基线差异仅含该文档，才算验收完成。

## journey_type: autonomous
## journey_type_reason: 仅新增 Cecelia 后端桥接使用说明，不涉及 UI、远端 Agent 协议或开发流水线行为。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档与测试验收在对应 Cecelia checkout 执行。
## journey_id: none
## step_id: none(docs)
