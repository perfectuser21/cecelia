# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 822efa5de9ac8ce887218ced1d5d6569f14d4d021f36d2e42c86135c1322e6b1

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的操作者文档，不承诺直接改变 KR 百分比

## 背景

宿主机及远端调用方需要一页中文说明，准确理解 attempt-run 桥接的提交、查询、鉴权、角色限制、payload 合同和失败回滚结果，避免因调用约定不清造成派发失败或状态残留。

## Golden Path（核心场景）

操作者从 `docs/current/` 的《attempt-run 桥接使用说明》进入 → 按文档理解并准备 `POST /api/brain/harness/attempt-run` 请求 → 使用 `GET /api/brain/harness/attempt-run/:id` 查询对应 attempt-run → 能核对鉴权、角色、payload 与失败回滚语义。

具体：

1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于提交 attempt-run，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询 attempt-run。
2. 文档说明两个端点均受 `internalAuthOrLoopback` 保护；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`，且不得展示真实凭据。
3. 文档完整列出权威合同中的九项角色白名单，不增项、不漏项、不用笼统表述代替。
4. 文档区分 payload 必填的 `sprint_dir`、`base_repo`、`branch`，以及可省略、由生产 Brain 自解析的 `base_sha`。
5. 文档说明派发失败会自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。
6. 读者可从同一页完成上述信息核对，无需阅读实现代码。

## 边界情况

- loopback 与宿主/远端调用的鉴权要求不得混写成所有调用均免鉴权，或所有调用均必须显式携带 Bearer。
- `base_sha` 不得写成必填，也不得写成由调用方随意推断；省略时由生产 Brain 自解析。
- 自动回滚必须同时覆盖 run、session、task 三类状态及其目标值，不得只写“请求失败”。
- 九项角色白名单须来自权威合同；本文档不得自行创造角色别名。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点用途、鉴权、九项角色白名单、payload 字段及派发失败自动回滚。

**不在范围内**：修改任何代码、路由、鉴权逻辑、角色白名单、payload 行为、数据库状态机、测试或既有文档；新增英文版本；改变 API 合同。

## 假设

- [ASSUMPTION: 实现阶段从实现基线 `88929fa377f5bed3cd1876a575c366ff1b93c0d5` 的权威合同逐字提取九项角色白名单，任务证据仅规定数量而未列出名称。]
- [ASSUMPTION: 新文档文件名采用 `docs/current/attempt-run-bridge-guide.md`，标题固定为《attempt-run 桥接使用说明》。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文 attempt-run 桥接使用说明；这是唯一允许的实现产物。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 文档语言：简体中文。
- 准确性：字段、鉴权、九项角色和回滚状态须与实现基线的权威合同一致。
- 安全性：只展示凭据变量名，不写入真实 token 或其他 secret。
- 超时/延迟：不适用（纯文档变更）。
- 频控：不适用（纯文档变更）。
- 版本要求：实现基线 `88929fa377f5bed3cd1876a575c366ff1b93c0d5`。
- 可观测：验收能从 Git diff 和文档文本直接判定结果。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；列出与本 sprint 直接相关的有效铁律 -->
- [分支归属] Planner workspace 必须保持服务端签发的 planner_branch，不得 checkout 或 switch（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

> Proposer 应把以下验收点翻译为可执行的文档检查，且总 DoD 不超过 8 条。

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：唯一新增产物位于 docs/current/ 且为中文 Markdown；文本包含两个指定端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、恰好九项权威角色、三个必填字段、base_sha 省略语义和三项失败回滚；git diff 不含代码文件变化。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库中的内部 API 使用文档，无 UI 或远端 agent 执行流程变化。
## target_environment: local_api
## target_environment_reason: 纯文档范围按 Cecelia 后台默认在本地工作区执行文本与 Git diff 验收。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
