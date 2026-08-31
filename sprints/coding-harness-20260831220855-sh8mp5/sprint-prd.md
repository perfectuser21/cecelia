# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: fb7e86a156d48c9d342f74c8feee26cf570d7fed705eb39c86b41cd320c73050

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可执行中文使用说明，不修改运行行为

## 背景

宿主机和远端调用方需要一份单一入口文档，准确说明 attempt-run 的创建、查询、鉴权、合法角色、请求字段及派发失败后的状态回滚。

## Scope

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖约定的四类内容。

**不在范围内**：不修改代码、测试、配置、既有文档或 API 行为；不新增端点、角色、字段或回滚状态。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下的《attempt-run 桥接使用说明》进入 → 选择创建或查询端点 → 按调用位置完成鉴权并提交合法角色和 payload → 理解成功结果或派发失败后的状态出口。

具体：

1. 读者区分 `POST /api/brain/harness/attempt-run` 的创建用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 读者确认两端点使用 `internalAuthOrLoopback`；宿主或远端请求携带 `Bearer CECELIA_INTERNAL_TOKEN`，且文档不展示真实凭据。
3. 读者从文档获得九项角色白名单，并确认 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自解析。
4. 读者确认派发失败时状态自动收敛为 `run→failed`、`session→closed`、`task→cancelled`。

## Acceptance assertions

- **A1 文档与语言**：`docs/current/attempt-run-bridge-usage.md` 存在且正文为中文。测试文件映射：`docs/current/attempt-run-bridge-usage.md`（文档自检）。
- **A2 端点与鉴权**：文档同时出现两个端点、各自用途、`internalAuthOrLoopback`、`Bearer CECELIA_INTERNAL_TOKEN` 及宿主/远端需带令牌的说明。测试文件映射：`docs/current/attempt-run-bridge-usage.md`（文档自检）。
- **A3 角色白名单**：文档用独立章节列出生产 Brain 接受的九项角色，机械计数恰为九项。测试文件映射：`docs/current/attempt-run-bridge-usage.md`（文档自检）。
- **A4 payload**：文档明确 `sprint_dir`、`base_repo`、`branch` 必填，并明确 `base_sha` 可省略且由生产 Brain 自解析。测试文件映射：`docs/current/attempt-run-bridge-usage.md`（文档自检）。
- **A5 自动回滚**：文档逐项写明 `run→failed`、`session→closed`、`task→cancelled`。测试文件映射：`docs/current/attempt-run-bridge-usage.md`（文档自检）。
- **A6 变更边界**：候选 diff 除新增 `docs/current/attempt-run-bridge-usage.md` 外为空。测试文件映射：`docs/current/attempt-run-bridge-usage.md`（文档自检）。

## 边界情况

- 明确 loopback 与宿主/远端鉴权差异，避免把本机免令牌条件外推到远端。
- `base_sha` 只描述为可省略，禁止将其误写为必填或由调用方猜测。
- 自动回滚只描述派发失败后的三个终态，不承诺未给出的重试或补偿行为。

## 假设

- [ASSUMPTION: 九项角色的精确名称以生产 Brain 当前白名单为准；Proposer 必须从权威契约提取并在验收中固定，不能凭记忆补写。]
- [ASSUMPTION: 用户要求“映射到测试文件”在纯文档范围内解释为每条 assertion 映射到作为被测制品的文档文件，不授权新增测试代码。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-usage.md`：新增中文 attempt-run 桥接使用说明。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 安全：不写入真实 token；只展示 `CECELIA_INTERNAL_TOKEN` 环境变量名和 Bearer 用法。
- 准确性：字段、角色及失败终态必须与生产 Brain 权威契约一致。
- 可维护性：内容集中在单页，端点、鉴权、角色、payload、回滚各有清晰章节。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅列与本 docs-only slice 可触达的铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [环境假设] 环境假设值不得写死，必须从环境推导（来源: area）
- [真环境验证] 依赖生产真实调用方的接缝断言必须在目标环境验证后才算完成（来源: area）
- [Planner 分支] Planner 必须保持服务端签发分支，不得 checkout 或 switch（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：对新增文档执行存在性、中文、四节内容、九角色计数和唯一变更文件检查，全部断言为真。
```

## journey_type: autonomous
## journey_type_reason: 这是 Cecelia 仓库纯文档说明，不涉及 UI、远端 agent 协议或 Engine 开发流水线行为变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档验收在对应 Fleet 工作区执行。
## journey_id: none
## step_id: none（PrepPRD 未锚定，gp_anchor=none(docs)）
