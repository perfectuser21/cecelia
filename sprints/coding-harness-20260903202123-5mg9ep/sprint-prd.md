# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 9f48a29c7e5432b05fd3b452403d6041dc79d18d9de780669c0734caf119369b

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明与可回归验收依据

## 背景

attempt-run 桥接已有两个调用端点，需要一页中文说明统一用途、鉴权、角色与 payload 合同，以及派发失败后的状态回滚语义，降低宿主与远端接入歧义。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入，按说明鉴权并提交 `POST /api/brain/harness/attempt-run`，再用 `GET /api/brain/harness/attempt-run/:id` 查询结果；文档同时使调用方能预判合法角色、必填 payload 和派发失败后的回滚状态。

具体：
1. 文档分别说明 POST 创建/派发 attempt-run 与 GET 按 id 查询 attempt-run 的用途。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端调用必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档完整列出九项角色白名单，并列明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自解析。
4. 文档说明派发失败自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。
5. 测试读取文档并对上述四节及关键字面合同进行断言，形成可执行验收。

## 边界情况

- 区分 loopback 与宿主/远端鉴权要求，不将 token 示例写成真实凭据。
- 不把 `base_sha` 误列为必填字段，也不暗示由调用方固定实现基线。
- 九项角色必须逐项出现，不能只写“支持全部 Harness 角色”。
- 回滚说明必须同时覆盖 run、session、task 三类实体及其目标状态。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文 attempt-run 桥接说明；覆盖两个端点、鉴权、九项角色白名单、payload 字段合同和派发失败回滚；新增或更新文档验收测试以检查该页面。

**不在范围内**：不修改任何生产代码、端点行为、鉴权逻辑、数据库结构或派发流程；不新增其他 Harness API 文档。

## 假设

- [ASSUMPTION: 九项角色的权威名称由现有 attempt-run 合同或测试固定，验收测试应逐项按该权威列表断言。]
- [ASSUMPTION: 文档文件名可由实现者在 `docs/current/` 内选择清晰且稳定的英文 kebab-case 名称。]

## 预期受影响文件

- `docs/current/attempt-run-bridge.md`: 新增中文《attempt-run 桥接使用说明》。
- `packages/brain/test/`: 仅允许新增或更新读取文档内容的验收测试；不得改生产代码。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 文档与当前 attempt-run 合同一致
- 可观测: 验收失败必须指出缺失章节或合同关键字

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；列出与本 sprint 直接相关的有效 area 铁律 -->
- [Planner 分支] Planner workspace 必须保持服务端签发的 planner_branch，不得切换分支（来源: area）
- [基线权威] Harness 所有角色必须消费 initial workspace 冻结的同一 base_sha，禁止用角色 checkout SHA 替换（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言必须在目标环境验证后才算 done（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 应产出可执行测试：定位 docs/current/ 新增中文文档，逐项断言以下合同。
# 1. POST /api/brain/harness/attempt-run 与 GET /api/brain/harness/attempt-run/:id 的用途。
# 2. internalAuthOrLoopback，以及宿主/远端所需 Bearer CECELIA_INTERNAL_TOKEN。
# 3. 九项角色白名单；payload 必填 sprint_dir/base_repo/branch，base_sha 可省略并由生产 Brain 自解析。
# 4. 派发失败回滚 run→failed/session→closed/task→cancelled，并确认除文档及其验收测试外无代码改动。
```

## journey_type: dev_pipeline
## journey_type_reason: 文档描述 Harness attempt-run 开发流水线桥接合同。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档与测试在服务端签发工作区验收。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
