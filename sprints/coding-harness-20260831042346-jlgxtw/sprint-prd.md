# Sprint PRD — attempt-run 桥接使用说明

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：通过补齐 attempt-run 桥接的权威中文说明，降低宿主与远端调用误用风险

## 背景

为 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 增加一页可独立使用的中文说明，使调用者能确定鉴权、角色、payload 与派发失败后的状态回滚语义。本 sprint 仅新增文档，不改变端点或运行行为。Unified Map 未配置：task payload 缺少有效的 `map_scope`/`map_repo` 映射。

## Golden Path（核心场景）

宿主或远端调用者从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 确认端点用途与鉴权 → 按九项角色白名单选择角色 → 组装必填 payload 并理解 `base_sha` 省略语义 → 能依据查询结果识别成功派发或失败回滚的最终状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发 attempt-run，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询运行状态。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主/远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不得展示真实令牌。
3. 文档以明确列表列出且仅列出 API 接受的九项角色白名单。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败会自动收敛为 `run→failed`、`session→closed`、`task→cancelled`，调用者可通过查询端点观察结果。

## 边界情况

- loopback 与宿主/远端鉴权要求不得混写成所有请求均可免 token。
- `base_sha` 不得误写为必填，也不得暗示由客户端随意猜测。
- 派发失败不得描述为遗留 running/open/pending 状态。
- 九项角色的具体名称以现有 attempt-run API 合同为准；本次输入只给出数量，未提供名称。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文 Markdown 文档；覆盖两个端点、鉴权、九项角色白名单、payload 字段与失败回滚四节。

**不在范围内**：修改任何代码、测试、API 行为、角色白名单、鉴权策略、数据库状态机或既有文档。

## 假设

- [ASSUMPTION: 文档文件名使用可表达 `attempt-run` 的 Markdown 文件名；最终验收按内容与目录判断，不绑定未由 PrepPRD 指定的精确文件名。]
- [ASSUMPTION: 九项角色名称由后续角色从现有 attempt-run API 合同逐项转录；不得创造第十项或省略任一项。]
- [ASSUMPTION: documentation-only 变更无需启动 Brain 或真实派发 attempt，验收真相为仓库文件内容与 git diff。]

## 预期受影响文件

- `docs/current/<attempt-run 使用说明>.md`：新增中文桥接使用说明；这是唯一允许的产品变更文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 派发失败后的 run/session/task 三类终态必须在文档中清晰可识别。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step 与 journey_feature 无数据；area 级按本 documentation-only scope 取直接适用项，按 decision id 去重 -->
- [Planner 分支] Planner 必须保持在服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [禁止写死环境假设] 环境值必须从环境推导，禁止把真实 token 或环境专属值写入说明（来源: area）
- [验证命令真跑] 合同中的验证命令必须实跑并确认 exit code 语义（来源: area）
- [单 slot 串行] 一个 slot 内只允许一个任务状态并串行收口（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# proposer 应将下列确定性断言细化为可直接执行的 macOS/bash 脚本：
# 1. 在 implementation baseline f06b922d05c1105783b66c22b5912d3430dc2d44 的候选 diff 中，docs/current/ 下恰有一份新增 Markdown 说明，且除该文档外无文件变化。
# 2. 文件可按 UTF-8 读取并含中文，存在四个可识别章节：端点与鉴权、角色白名单、payload 字段、派发失败自动回滚。
# 3. 内容逐字包含 POST /api/brain/harness/attempt-run、GET /api/brain/harness/attempt-run/:id、internalAuthOrLoopback、Bearer、CECELIA_INTERNAL_TOKEN。
# 4. 角色白名单章节可机械解析出恰好九个角色项，且与现有 API 合同集合相等。
# 5. 内容逐字包含 sprint_dir、base_repo、branch、base_sha，并明确前三者必填、base_sha 可省略且由生产 Brain 自解析。
# 6. 内容逐字包含 run→failed、session→closed、task→cancelled，或一一等价且可机械匹配的三组状态映射。
# 7. 文档不得包含真实 token；git diff 不得触及代码、测试或配置文件。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 内部 Brain API 的 documentation-only 使用说明，不含 UI 用户流程。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档内容与 git diff 验收在该工作区执行。
## journey_id: none
## step_id: none（PrepPRD 锚定为 none(docs)）
