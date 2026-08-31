# Sprint PRD — attempt-run 桥接使用说明

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明与可回归验收合同

## 背景

在 `docs/current/` 新增中文《attempt-run 桥接使用说明》，让调用方明确创建与查询 attempt-run 的合同，并记录 `task_request_hash=5dbbbf3ad1f660211c159b9545d24b55b156af6bbe302ad2946e1012ed5f8b92`。本次仅规划文档，不改任何代码；上游已授权本次 workflow-write-guard receipt。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按鉴权及 payload 合同调用创建端点 → 用返回标识查询 attempt-run → 能判断成功状态或派发失败后的完整回滚结果。

具体：
1. 文档用独立一节说明 `POST /api/brain/harness/attempt-run` 用于创建/派发 attempt-run，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询状态，并说明 `internalAuthOrLoopback` 鉴权；宿主和远端请求必须携带 `Bearer CECELIA_TOKEN`，且不得展示真实凭据。
2. 文档用独立一节完整列出接口合同允许的九项角色白名单，名称与既有测试覆盖的路由合同逐项一致，不能增删、使用别名或只给示例子集。
3. 文档用独立一节说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，省略时由生产 Brain 自解析，不能表述为调用方必填。
4. 文档用独立一节说明派发失败会自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，三项终态必须同时明确。
5. 验收测试读取该中文文档并对路径、四节内容、端点、鉴权、九项角色、payload 字段及三项回滚终态作机械断言；提交后 fresh read-back 给出路径、commit 与内容哈希证据。

## 边界情况

- loopback 与宿主/远端鉴权场景必须区分，不能让读者误以为远端可免 Bearer。
- 九项白名单必须完整且唯一；测试应阻止缺项、别名和额外角色进入文档合同。
- `base_sha` 的“可省略”只代表生产 Brain 自解析，不代表必填字段缺失可以被泛化接受。
- 回滚说明必须覆盖 run、session、task 三种对象，不能只描述其中一项。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文说明文档；包含上述四个独立章节；补充能够机械覆盖该文档合同的测试断言。

**不在范围内**：任何生产代码、API 行为、鉴权逻辑、角色白名单、数据库 schema、工作流或其他文档的修改；不扩展新端点或新角色。

## 假设

- [ASSUMPTION: 文档文件名采用仓库现有 `docs/current/` 命名规范，验收以该目录中唯一新增的 attempt-run 说明页为准。]
- [ASSUMPTION: 九项角色的精确名称以 implementation baseline `1ef19bd6f70b79e14a20ecb0e37ba8492f71a029` 上既有测试所断言的白名单为唯一事实源。]
- [ASSUMPTION: `gp_anchor=none(docs)` 表示本说明文档未锚定 Journey Step。]

## 预期受影响文件

- `docs/current/<attempt-run-桥接说明页>.md`：新增中文《attempt-run 桥接使用说明》，承载四节合同。
- `<既有 attempt-run 文档合同测试文件>`：增加对文档存在性和四节要求的机械断言，不改生产代码。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: implementation baseline 固定为 `1ef19bd6f70b79e14a20ecb0e37ba8492f71a029`
- 可观测: 验收必须提供 fresh read-back 的路径、commit、内容或哈希证据；文档断言必须由测试文件覆盖。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅列与本 scope 直接相关铁律 -->
- [授权隔离] 操作他人账号资源必须使用其本人的授权（来源: area）
- [共享禁区] 未经合同显式授权不得修改共享 CI 基础设施文件（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不准交付（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：测试从 docs/current/ 读取唯一新增的中文 attempt-run 桥接说明页，断言 task_request_hash、两个端点、internalAuthOrLoopback、远端 Bearer CECELIA_TOKEN、精确九项角色、三个必填 payload 字段、base_sha 可省略，以及 run/session/task 的三个回滚终态；同时断言无生产代码变更，并输出 fresh read-back 的路径、commit 和内容哈希。
```

## journey_type: dev_pipeline
## journey_type_reason: 说明对象是 Harness attempt-run 桥接与角色派发合同，属于开发执行流水线使用说明。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档合同测试在对应 fleet-worker 工作区执行。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
