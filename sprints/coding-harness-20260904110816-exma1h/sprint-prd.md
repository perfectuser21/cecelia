# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 0207fb013c7d30227edea6e345a287b4561ac99dd9406c7b38d5501d1b078d37

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明，降低错误派发风险

## 背景

宿主机和远端调用方需要一页中文说明，准确使用 attempt-run 的创建与查询接口，并理解鉴权、角色、工作区字段和失败回滚语义。

## Golden Path（核心场景）

调用方从 `docs/current/` 阅读《attempt-run 桥接使用说明》→ 按说明创建并查询 attempt-run → 能在派发失败时辨认完整回滚结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发一次 attempt，以及 `GET /api/brain/harness/attempt-run/:id` 用于按 id 查询状态。
2. 文档说明鉴权采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，并明确回环请求与非回环请求的差异。
3. 文档以恰好九项的清单列出生产端认可的完整角色白名单；角色名称逐项与生产端权威白名单一致，不增加别名。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，省略时由生产 Brain 自解析。
5. 文档说明派发失败后的自动回滚终态：`run → failed`、`session → closed`、`task → cancelled`。
6. 读者可依据文档构造请求，并从查询结果判断成功派发或上述回滚终态。

## 边界情况

- 非回环请求缺少或携带错误 Bearer token 时，不得描述为可访问。
- role 不在九项白名单内时，不得描述为可派发。
- 任一必填 payload 字段缺失时，不得暗示 Brain 会代填；只有 `base_sha` 可省略并由生产 Brain 解析。
- 派发失败时，三个关联对象的终态必须全部写明，禁止只描述 run 失败。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文 Markdown 文档，包含端点用途与鉴权、九项角色白名单、payload 字段、失败自动回滚四节。

**不在范围内**：任何代码、接口、鉴权策略、角色白名单、数据模型、配置或既有文档的修改；不新增运行时行为。

## 假设

- [ASSUMPTION: 九项角色的精确名称以生产 Brain 的权威白名单为准；验收测试必须对文档清单与该白名单做精确集合比对，避免在规划阶段猜测名称。]
- [ASSUMPTION: 文档文件名可由实现者在 `docs/current/` 下选择清晰、唯一且与 attempt-run 对应的名称。]

## 预期受影响文件

- `docs/current/<attempt-run-usage>.md`：新增《attempt-run 桥接使用说明》；唯一允许的仓库变更。

## 可执行验收计划

1. 文件性断言：对实现基线 `2721277993f33d00b8a4c2d94fdec5b1ac4f7f32` 与候选提交执行 `git diff --name-status`，结果必须只有 `docs/current/` 下一个状态为 `A` 的 `.md` 文件。
2. 中文与章节断言：读取该文件，必须存在“端点用途与鉴权”“角色白名单”“payload 必填字段”“派发失败自动回滚”四个独立章节，并至少含中文字符。
3. 端点与鉴权断言：必须同时包含字面量 `POST /api/brain/harness/attempt-run`、`GET /api/brain/harness/attempt-run/:id`、`internalAuthOrLoopback`、`Bearer`、`CECELIA_INTERNAL_TOKEN`，并写明宿主/远端必须携带 token。
4. 角色断言：解析“角色白名单”章节的列表，条目数必须等于 9，且与生产 Brain 权威角色白名单精确同集；任何缺项、多项或别名均失败。
5. payload 断言：必须把 `sprint_dir`、`base_repo`、`branch` 标为必填，把 `base_sha` 标为可省略，并写明省略时由生产 Brain 自解析。
6. 回滚断言：必须同时包含 `run`/`failed`、`session`/`closed`、`task`/`cancelled` 三组对象与终态映射。
7. 非代码断言：候选 diff 中不得出现 Markdown 之外文件，且不得出现可执行代码文件变更。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：中文。
- 准确性：端点、鉴权、字段必填性与回滚终态必须使用上述精确字面量。
- 可维护性：角色清单由验收测试与生产权威白名单精确对账。
- 超时/延迟：待定（PrepPRD 未指定，且本 sprint 不改变运行时）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源读取并按 id 去重；以下为与本 sprint 范围直接相关的约束 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [分支权威] Planner workspace 必须保持在服务端签发的 planner_branch，Provider 不得 checkout 或切换分支（来源: area）
- [凭据隔离] 多人多账号协作时，操作他人资源必须使用资源所属人的授权凭据（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 把“可执行验收计划”翻译为真实检查脚本。
# 期望验收点：候选提交只新增一页 docs/current 中文文档，且四类内容与全部字面合同均通过机械断言。
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 仅新增 Cecelia 内部 Harness API 使用文档，无用户界面或远端 agent 协议行为变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 Cecelia 仓库工作区进行文档与 diff 检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定，gp_anchor=none(docs)）
