# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 1838c4d9069d5b08f980716d3d248df5f1cd7a8d03b585d3c89b8195798071dc

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的中文使用入口，降低错误鉴权、错误派发与回滚状态误判风险

## 背景

宿主与远端调用方需要一份统一、可核对的 attempt-run 桥接说明，明确调用入口、鉴权、角色与请求字段，以及派发失败后的状态收口。本文档只描述已冻结的接口行为，不新增或修改接口行为。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按身份完成鉴权并用合法角色提交 attempt → 用返回标识查询状态 → 在成功派发或失败回滚后准确判断最终结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发一次 attempt，`GET /api/brain/harness/attempt-run/:id` 用于按标识查询该 attempt。
2. 文档说明两端点均使用 `internalAuthOrLoopback`；loopback 调用按该策略处理，宿主或远端调用必须发送 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，示例不得泄露真实 token。
3. 文档以独立清单列出生产端点接受的全部九项角色白名单，恰好九项、不使用“等”省略，并说明白名单外角色会被拒绝。
4. 文档说明 POST payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，省略时由生产 Brain 自解析，不暗示调用方自行猜测 SHA。
5. 文档说明派发失败会自动按 `run → failed`、`session → closed`、`task → cancelled` 完成回滚，调用方可通过 GET 看到失败终态。
6. 读者仅凭该页即可形成一次合法请求，并能解释查询结果与派发失败后的三个资源状态。

## 边界情况

- 宿主或远端请求缺少 Bearer token、token 无效或角色不在九项白名单内时，文档不得暗示请求可成功。
- `sprint_dir`、`base_repo`、`branch` 任一缺失时，文档必须明确请求不满足必填合同。
- 省略 `base_sha` 与显式传入 `base_sha` 均为允许形式；仅前者由生产 Brain 自解析。
- 派发失败不是半成功：run、session、task 三类状态都必须在说明中完整收口。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》；覆盖两个端点用途、鉴权、恰好九项角色白名单、payload 字段规则、派发失败自动回滚；提供不含真实凭据的请求与查询示例。

**不在范围内**：修改任何代码、路由、鉴权策略、角色白名单、数据模型、状态机、部署配置或既有文档；新增端点行为；验证真实派发副作用。

## 假设

- [ASSUMPTION: 文档中的九项角色名称必须逐字采用当前生产端点白名单；输入只声明数量而未提供名称，实施者应从现有生产合同抄录，不扩充、不改名。]
- [ASSUMPTION: 新文档文件名采用仓库 `docs/current/` 既有中文文档命名约定，标题必须为《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 本 sprint 为文档变更，GET 查询示例只说明可观察结果，不触发真实 attempt 派发。]

## 预期受影响文件

- `docs/current/attempt-run-桥接使用说明.md`：新增中文使用说明；这是唯一产品产物。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 派发失败必须能从查询结果辨识 run、session、task 的完整回滚终态
- 安全: 示例只使用 `CECELIA_INTERNAL_TOKEN` 占位引用，不出现真实凭据

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅列与本次文档合同直接相关的活跃铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [环境假设] 环境假设值禁止写死，须从环境推导或在真实环境校准（来源: area）
- [真环境验证] 依赖生产环境或真实调用方的接缝断言须在目标环境验证后才可判定完成（来源: area）
- [Planner 分支] Planner workspace 必须使用服务端签发的 planner_branch，Provider 不得切换分支（来源: area）
- [单槽串行] 一个 slot 内任务严格串行，并行仅允许跨 slot（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入只读文档验收脚本
# 期望验收点：docs/current/ 下恰有目标中文文档；正文含两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、恰好九项角色、四个 payload 字段及完整三段回滚状态；git diff 不含代码文件。
```

## 可执行验收计划

1. 断言目标文件存在且 UTF-8 正文包含《attempt-run 桥接使用说明》。
2. 逐字断言两个端点、`internalAuthOrLoopback`、`Bearer` 与 `CECELIA_INTERNAL_TOKEN` 均出现。
3. 定位“角色白名单”章节，机器统计清单恰好九项，并逐项与生产合同中的九项角色做集合相等比较。
4. 断言 payload 章节将 `sprint_dir`、`base_repo`、`branch` 标为必填，并明确 `base_sha` 可省略且由生产 Brain 自解析。
5. 断言回滚章节同时包含 `run → failed`、`session → closed`、`task → cancelled`。
6. 检查示例不含真实 token 值；检查本 sprint 产品变更仅新增 `docs/current/` 文档且不修改代码。

## journey_type: autonomous
## journey_type_reason: 产物是 Cecelia 后端桥接 API 的使用说明，不涉及 UI、远端 agent 协议实现或开发流水线改动。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 Cecelia 文档工作区执行只读内容与 diff 检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
