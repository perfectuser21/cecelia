# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 1ae0a336a9a4a815582cfeeeeab76d4ffec7545de6d6bf7f1d2d2cea4ef40238

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可执行使用契约

## 背景

当前需要在 `docs/current/` 提供一页中文《attempt-run 桥接使用说明》，让宿主与远端调用方能够正确创建、查询并判断派发失败后的回滚状态。本 Sprint 只交付文档，不改变任何运行时行为。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下的《attempt-run 桥接使用说明》进入 → 按文档完成鉴权与 payload 组装并调用 `POST /api/brain/harness/attempt-run` → 使用返回标识调用 `GET /api/brain/harness/attempt-run/:id` → 正确理解成功状态或派发失败后的自动回滚出口。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的创建用途和 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档完整列出角色白名单九项：`planner`、`proposer`、`proposer-critic`、`generator`、`generator-critic`、`evaluator`、`evaluator-critic`、`reporter`、`reporter-critic`。
4. 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，并由生产 Brain 自解析。实现基线的 `base_sha` 在各角色及 GAN 轮次间保持不变，角色 checkout 的 workspace `base_sha` 不得替代实现基线。
5. 文档说明派发失败时自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。
6. 读者能依据文档区分创建、查询、鉴权、请求约束和失败恢复五类信息。

## 边界情况

- loopback 与宿主/远端的鉴权要求不得混写成所有请求均可免鉴权。
- 不得把 `base_sha` 写成调用方必填，也不得暗示角色切换时可重置实现基线。
- 派发失败不得描述为部分成功；三个关联对象的终态都必须写明。
- 九项角色白名单必须完整且不得增加未支持角色。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文说明，覆盖两个端点与鉴权、九项角色白名单、payload/base_sha 规则及派发失败自动回滚。

**不在范围内**：任何源代码、测试代码、API 行为、数据库 schema、鉴权机制或派发流程改动；其他 Harness 文档重写。

## 假设

- [ASSUMPTION: 文档文件名采用能直接表达 attempt-run 主题的中文或英文 kebab-case 名称。]
- [ASSUMPTION: 九项角色名称按服务端白名单的原始拼写逐项呈现，不使用中文别名替代。]

## 预期受影响文件

- `docs/current/<attempt-run-bridge-guide>.md`：新增中文《attempt-run 桥接使用说明》的唯一交付物。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：全文使用简体中文。
- 准确性：端点、鉴权标识、环境变量、角色名、字段名和状态值保持原始字面。
- 可维护性：信息按端点与鉴权、角色白名单、payload/base_sha、失败回滚四个可定位章节组织。
- 代码影响：不得修改任何代码。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅保留与本 Sprint 可执行范围相关的 area 铁律 -->
- [规划分支] Planner workspace 必须保持在服务端签发的 planner_branch，Provider 只校验而不切换分支（来源: area）
- [权威地址] Dispatcher 与 Fleet Worker 使用服务端权威 HARNESS_BRAIN_URL，预检保持 fail-closed，不为单个 Attempt 绕过（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：docs/current/ 下恰有本 Sprint 新增的中文说明；可机器检出两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色、三个必填字段、base_sha 省略及生产 Brain 自解析规则、实现基线不变规则，以及 run→failed/session→closed/task→cancelled；git diff 中不存在代码文件变更。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部 Harness API 使用文档，不含用户界面或远端 Agent 协议行为变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档验收在该角色环境的仓库 checkout 中完成。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
