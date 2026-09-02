# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 36b99953756db7bbfbaa29fd6871c56a549f04acbec458352388564d4538b039

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未提供
- **本次推进预期**：新增可验收的 attempt-run 桥接中文说明

## 背景

为宿主和远端调用方提供单一、明确的 attempt-run 桥接契约，减少端点用途、鉴权、角色、请求字段及派发失败回滚语义的误用。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明鉴权并创建 attempt-run → 通过返回的 id 查询状态 → 在派发失败时确认关联状态均已回滚到终态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发一次运行，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询运行状态。
2. 文档说明两个端点受 `internalAuthOrLoopback` 保护；宿主与远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，不得展示真实 token。
3. 文档以九项清单列出角色白名单：`planner`、`proposer`、`critic`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`merger`、`reporter`。
4. 文档列出 payload 必填字段 `sprint_dir`、`base_repo`、`branch`，并明确 `base_sha` 可省略且由生产 Brain 自解析。
5. 文档说明派发失败时自动回滚为 `run → failed`、`session → closed`、`task → cancelled`，调用方可通过查询端点观察结果。

## 边界情况

- 匿名或 Bearer token 不正确的宿主/远端请求不得被描述为可访问。
- `base_sha` 缺失不得被描述为请求错误；生产 Brain 负责解析。
- 非白名单角色不得被描述为可派发角色。
- 派发失败不得留下运行中 session 或待执行 task。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文说明，覆盖两个端点用途、鉴权、九项角色白名单、payload 字段和失败回滚语义。

**不在范围内**：不修改任何代码、测试、API 行为、鉴权机制、角色集合、数据库结构或部署配置。

## 假设

- [ASSUMPTION: 九项角色白名单为 planner、proposer、critic、generator、generator-fix、evaluator、evaluator-fix、merger、reporter；proposer 必须用权威接口契约核对拼写，若不一致则以权威契约为准且仍保持九项。]
- [ASSUMPTION: gp_anchor 为 `none(docs)`，因此本说明不绑定既有 Journey Step。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增《attempt-run 桥接使用说明》中文文档。

## NFR 约束

- 安全：不得在文档中写入真实 `CECELIA_INTERNAL_TOKEN`。
- 准确性：端点、状态值、字段名和角色名须使用可由文档测试逐字匹配的字面值。
- 可维护性：内容按四个独立章节组织，便于机械检查。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [Planner 分支] Planner workspace 必须保持服务端签发的 planner_branch（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 将补充真实脚本；期望验收点：
# 1. docs/current/ 下恰有新增中文说明页，且 task_request_hash 可追溯。
# 2. 文档存在四个独立章节，逐字覆盖两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色、四个 payload 字段及三项失败终态。
# 3. git diff 的受影响路径仅包含该文档，不含代码文件。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia Brain 内部 attempt-run API 的使用说明，不包含用户界面。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在仓库工作区执行文档机械检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
